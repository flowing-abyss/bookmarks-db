import { BookmarksService } from './lib/bookmarks.js';
import { computeColorScheme } from './lib/colors.js';
import { loadSettings } from './lib/storage.js';

class App {
  constructor() {
    this.bookmarks = new BookmarksService();
    this.selectedIndex = -1;
    this.flatBookmarks = [];
    this.collapsedFolders = new Set();
  }

  async init() {
    const settings = await loadSettings();
    this.applyColorScheme(settings.bgColor);
    await this.bookmarks.load();

    if (settings.rootFolderId) {
      this.bookmarks.filterByRoot(settings.rootFolderId);
    }

    const results = this.bookmarks.search('');
    results.forEach((g, i) => {
      if (g.type === 'folder') this.collapsedFolders.add(i);
    });

    this.render();
    this.setListeners();
  }

  applyColorScheme(bgColor) {
    const colors = computeColorScheme(bgColor);
    for (const [prop, value] of Object.entries(colors)) {
      document.documentElement.style.setProperty(prop, value);
    }
  }

  createBookmarkElement(b, isSelected) {
    const item = document.createElement('div');
    item.className = 'bookmark-item' + (isSelected ? ' selected' : '');
    item.dataset.id = b.id;
    item.addEventListener('click', () => this.openBookmark(b.id));
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.openBookmarkInNewTab(b.id);
      }
    });

    const favicon = document.createElement('img');
    favicon.className = 'bookmark-favicon';
    favicon.alt = '';
    favicon.loading = 'lazy';
    this.setFavicon(favicon, b.domain, b.title);

    const title = document.createElement('span');
    title.className = 'bookmark-title';
    title.textContent = b.title;

    const domain = document.createElement('span');
    domain.className = 'bookmark-domain';
    domain.textContent = b.domain;

    item.appendChild(favicon);
    item.appendChild(title);
    item.appendChild(domain);
    return item;
  }

  setFavicon(imgEl, domain, title) {
    const fallbackSvg = this._makeFallbackSvg(domain, title);

    // For local/internal domains, skip external APIs entirely
    if (this._isLocalDomain(domain)) {
      imgEl.src = fallbackSvg;
      return;
    }

    // Cascade: Google → DuckDuckGo → fallback
    const sources = [
      `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    ];

    let attempt = 0;
    const tryNext = () => {
      attempt++;
      if (attempt >= sources.length) {
        imgEl.src = fallbackSvg;
        imgEl.onerror = null;
        imgEl.onload = null;
        return;
      }
      imgEl.src = sources[attempt];
    };

    imgEl.onload = () => {
      if (imgEl.naturalWidth < 10) {
        tryNext();
      } else {
        imgEl.onload = null;
        imgEl.onerror = null;
      }
    };

    imgEl.onerror = () => {
      tryNext();
    };

    imgEl.src = sources[0];
  }

  _isLocalDomain(domain) {
    return !domain ||
      domain === 'localhost' ||
      domain.startsWith('127.') ||
      domain.startsWith('192.168.') ||
      domain.startsWith('10.') ||
      domain.startsWith('172.') ||
      domain.endsWith('.local') ||
      domain.includes('local:') ||
      domain.startsWith('0.');
  }

  _makeFallbackSvg(domain, title) {
    const letter = (title || domain || '?')[0].toUpperCase();
    const hue = hashCode(domain || title) % 360;
    const bg = `hsl(${hue}, 50%, 40%)`;
    const fg = `hsl(${hue}, 80%, 85%)`;
    return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${encodeURIComponent(bg)}"/><text x="12" y="17" text-anchor="middle" fill="${encodeURIComponent(fg)}" font-family="system-ui,-apple-system,sans-serif" font-weight="700" font-size="13">${letter}</text></svg>`;
  }

  _renderGroup(group, groupIndex, results, container) {
    if (group.type === 'root') {
      group.bookmarks.forEach((b, itemIndex) => {
        const globalIdx = this._getGlobalIndex(results, groupIndex, itemIndex);
        const el = this.createBookmarkElement(b, this.selectedIndex === globalIdx);
        container.appendChild(el);
      });
      return;
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'folder-group';
    groupEl.dataset.folderIndex = String(groupIndex);

    const header = document.createElement('div');
    header.className = 'folder-header';
    header.addEventListener('click', () => this.toggleFolder(groupIndex));

    const folderIcon = document.createElement('span');
    folderIcon.textContent = '▸';
    folderIcon.className = 'folder-arrow';
    const folderText = document.createElement('span');
    folderText.textContent = group.name;
    const folderCount = document.createElement('span');
    folderCount.className = 'folder-count';
    folderCount.textContent = `${group.bookmarks.length}`;
    header.appendChild(folderIcon);
    header.appendChild(folderText);
    header.appendChild(folderCount);

    const content = document.createElement('div');
    content.className = 'folder-content';
    content.id = `folder-${groupIndex}`;
    if (!this.collapsedFolders.has(groupIndex)) {
      content.classList.add('expanded');
    }

    group.bookmarks.forEach((b, itemIndex) => {
      const globalIdx = this._getGlobalIndex(results, groupIndex, itemIndex);
      const isSelected = this.selectedIndex === globalIdx;
      content.appendChild(this.createBookmarkElement(b, isSelected));
    });

    groupEl.appendChild(header);
    groupEl.appendChild(content);
    container.appendChild(groupEl);
  }

  _getGlobalIndex(results, groupIndex, itemIndex) {
    let offset = 0;
    for (let i = 0; i < groupIndex; i++) {
      offset += results[i].bookmarks.length;
    }
    return offset + itemIndex;
  }

  render() {
    const results = this.bookmarks.search('');
    this.flatBookmarks = results.flatMap((r) => r.bookmarks);

    const container = document.getElementById('bookmarks-list');
    container.textContent = '';

    results.forEach((group, i) => {
      this._renderGroup(group, i, results, container);
    });
  }

  renderSearch(query) {
    const results = this.bookmarks.search(query);
    this.flatBookmarks = results.flatMap((r) => r.bookmarks);
    if (this.selectedIndex >= this.flatBookmarks.length) {
      this.selectedIndex = this.flatBookmarks.length - 1;
    }

    const container = document.getElementById('bookmarks-list');
    container.textContent = '';

    // Expand all when searching
    if (query.trim()) {
      this.collapsedFolders.clear();
    }

    results.forEach((group, i) => {
      this._renderGroup(group, i, results, container);
    });
  }

  navigate(direction) {
    const newIndex = this.selectedIndex + direction;
    if (newIndex >= 0 && newIndex < this.flatBookmarks.length) {
      const prev = document.querySelector('.bookmark-item.selected');
      if (prev) prev.classList.remove('selected');
      this.selectedIndex = newIndex;
      const next = document.querySelectorAll('.bookmark-item')[newIndex];
      if (next) {
        next.classList.add('selected');
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  setListeners() {
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', (e) => {
      this.renderSearch(e.target.value);
    });

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.querySelector('.modal-overlay');
        if (modal) { modal.remove(); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault(); this.navigate(1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault(); this.navigate(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); this.navigate(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); this.navigate(-1);
      } else if (e.key === 'Enter' && this.selectedIndex >= 0) {
        e.preventDefault(); this.openSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd' && this.selectedIndex >= 0) {
        e.preventDefault(); this.deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'e' && this.selectedIndex >= 0) {
        e.preventDefault(); this.editSelected();
      }
    });
  }

  openSelected() {
    const bookmark = this.flatBookmarks[this.selectedIndex];
    if (bookmark) this.openBookmark(bookmark.id);
  }

  async openBookmark(id) {
    const bookmark = this.bookmarks.bookmarks.find((b) => b.id === id);
    if (!bookmark) return;
    const settings = await loadSettings();
    await chrome.tabs.create({ url: bookmark.url, active: !settings.openInBackground });
  }

  async openBookmarkInNewTab(id) {
    const bookmark = this.bookmarks.bookmarks.find((b) => b.id === id);
    if (!bookmark) return;
    await chrome.tabs.create({ url: bookmark.url, active: true });
  }

  async deleteSelected() {
    const bookmark = this.flatBookmarks[this.selectedIndex];
    if (!bookmark) return;
    if (!confirm(`Delete "${bookmark.title}"?`)) return;
    await this.bookmarks.remove(bookmark.id);
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.render();
  }

  async editSelected() {
    const bookmark = this.flatBookmarks[this.selectedIndex];
    if (!bookmark) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal';

    const title = document.createElement('h2');
    title.textContent = 'Edit Bookmark';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'form-group';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'edit-title';
    titleInput.value = bookmark.title;
    titleGroup.appendChild(titleLabel);
    titleGroup.appendChild(titleInput);

    const urlGroup = document.createElement('div');
    urlGroup.className = 'form-group';
    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'URL';
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.id = 'edit-url';
    urlInput.value = bookmark.url;
    urlGroup.appendChild(urlLabel);
    urlGroup.appendChild(urlInput);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const newTitle = titleInput.value.trim();
      const newUrl = urlInput.value.trim();
      if (newTitle && newUrl) {
        await this.bookmarks.update(bookmark.id, { title: newTitle, url: newUrl });
        this.render();
      }
      overlay.remove();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    modal.appendChild(title);
    modal.appendChild(titleGroup);
    modal.appendChild(urlGroup);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    titleInput.focus();
  }

  toggleFolder(index) {
    const content = document.getElementById(`folder-${index}`);
    if (!content) return;
    if (this.collapsedFolders.has(index)) {
      this.collapsedFolders.delete(index);
      content.classList.add('expanded');
    } else {
      this.collapsedFolders.add(index);
      content.classList.remove('expanded');
    }
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

const app = new App();
app.init();
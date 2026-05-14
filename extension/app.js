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

    // Apply root folder filter
    if (settings.rootFolderId) {
      this.bookmarks.filterByRoot(settings.rootFolderId);
    }

    // Collapse all folders by default
    const results = this.bookmarks.search('');
    results.forEach((_, i) => this.collapsedFolders.add(i));

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
      // Middle click (wheel) - open in new tab
      if (e.button === 1) {
        e.preventDefault();
        this.openBookmarkInNewTab(b.id);
      }
    });

    const favicon = document.createElement('img');
    favicon.className = 'bookmark-favicon';
    favicon.src = `https://www.google.com/s2/favicons?domain=${b.domain}&sz=32`;
    favicon.alt = '';
    favicon.onerror = () => {
      // Fallback: colored circle with first letter
      const letter = (b.title || b.domain || '?')[0].toUpperCase();
      const hue = hashCode(b.domain || b.title) % 360;
      const color = `hsl(${hue}, 60%, 55%)`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="4" fill="${encodeURIComponent(color)}"/><text x="14" y="20" text-anchor="middle" fill="white" font-size="14" font-family="system-ui,sans-serif" font-weight="600">${letter}</text></svg>`;
      favicon.src = `data:image/svg+xml,${svg}`;
    };

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

  render() {
    const results = this.bookmarks.search('');
    this.flatBookmarks = results.flatMap(([, bookmarks]) => bookmarks);

    const container = document.getElementById('bookmarks-list');
    container.textContent = '';

    results.forEach(([folder, bookmarks], folderIndex) => {
      const group = document.createElement('div');
      group.className = 'folder-group';
      group.dataset.folderIndex = String(folderIndex);

      const header = document.createElement('div');
      header.className = 'folder-header';
      header.addEventListener('click', () => this.toggleFolder(folderIndex));

      const folderIcon = document.createElement('span');
      folderIcon.textContent = '▸';
      folderIcon.className = 'folder-arrow';
      const folderText = document.createElement('span');
      folderText.textContent = folder;
      const folderCount = document.createElement('span');
      folderCount.className = 'folder-count';
      folderCount.textContent = `${bookmarks.length}`;
      header.appendChild(folderIcon);
      header.appendChild(folderText);
      header.appendChild(folderCount);

      const content = document.createElement('div');
      content.className = 'folder-content';
      content.id = `folder-${folderIndex}`;
      if (this.collapsedFolders.has(folderIndex)) {
        content.style.display = 'none';
      }

      bookmarks.forEach((b, itemIndex) => {
        const globalIdx = this.getGlobalIndexFromResults(results, folderIndex, itemIndex);
        const isSelected = this.selectedIndex === globalIdx;
        content.appendChild(this.createBookmarkElement(b, isSelected));
      });

      group.appendChild(header);
      group.appendChild(content);
      container.appendChild(group);
    });
  }

  getGlobalIndexFromResults(results, folderIndex, itemIndex) {
    let offset = 0;
    for (let i = 0; i < folderIndex; i++) {
      offset += results[i][1].length;
    }
    return offset + itemIndex;
  }

  renderSearch(query) {
    const results = this.bookmarks.search(query);
    this.flatBookmarks = results.flatMap(([, bookmarks]) => bookmarks);
    if (this.selectedIndex >= this.flatBookmarks.length) {
      this.selectedIndex = this.flatBookmarks.length - 1;
    }

    const container = document.getElementById('bookmarks-list');
    container.textContent = '';

    results.forEach(([folder, bookmarks], folderIndex) => {
      const group = document.createElement('div');
      group.className = 'folder-group';
      group.dataset.folderIndex = String(folderIndex);

      const header = document.createElement('div');
      header.className = 'folder-header';
      header.addEventListener('click', () => this.toggleFolder(folderIndex));

      const folderIcon = document.createElement('span');
      folderIcon.textContent = '▸';
      folderIcon.className = 'folder-arrow';
      const folderText = document.createElement('span');
      folderText.textContent = folder;
      const folderCount = document.createElement('span');
      folderCount.className = 'folder-count';
      folderCount.textContent = `${bookmarks.length}`;
      header.appendChild(folderIcon);
      header.appendChild(folderText);
      header.appendChild(folderCount);

      const content = document.createElement('div');
      content.className = 'folder-content';
      content.id = `folder-${folderIndex}`;

      bookmarks.forEach((b, itemIndex) => {
        const globalIdx = this.getGlobalIndexFromResults(results, folderIndex, itemIndex);
        const isSelected = this.selectedIndex === globalIdx;
        content.appendChild(this.createBookmarkElement(b, isSelected));
      });

      group.appendChild(header);
      group.appendChild(content);
      container.appendChild(group);
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

    // Settings button - no keyboard focus (tabindex=-1)
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
      });
    }

    // Keyboard navigation - Ctrl or Cmd
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.querySelector('.modal-overlay');
        if (modal) {
          modal.remove();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        this.navigate(1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.navigate(-1);
      } else if (e.key === 'Enter' && this.selectedIndex >= 0) {
        e.preventDefault();
        this.openSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd' && this.selectedIndex >= 0) {
        e.preventDefault();
        this.deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'e' && this.selectedIndex >= 0) {
        e.preventDefault();
        this.editSelected();
      }
    });

    // Mouse wheel navigation (when search is empty)
    document.addEventListener('wheel', (e) => {
      const searchInput = document.getElementById('search');
      if (document.activeElement !== searchInput || !searchInput.value) {
        if (e.deltaY > 10) {
          this.navigate(1);
        } else if (e.deltaY < -10) {
          this.navigate(-1);
        }
      }
    });
  }

  openSelected() {
    const bookmark = this.flatBookmarks[this.selectedIndex];
    if (bookmark) {
      this.openBookmark(bookmark.id);
    }
  }

  async openBookmark(id) {
    const bookmark = this.bookmarks.bookmarks.find((b) => b.id === id);
    if (!bookmark) return;

    const settings = await loadSettings();
    await chrome.tabs.create({
      url: bookmark.url,
      active: !settings.openInBackground,
    });
  }

  async openBookmarkInNewTab(id) {
    const bookmark = this.bookmarks.bookmarks.find((b) => b.id === id);
    if (!bookmark) return;

    await chrome.tabs.create({
      url: bookmark.url,
      active: true,
    });
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
    saveBtn.id = 'save-edit';
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
    } else {
      this.collapsedFolders.add(index);
    }
    content.style.display = this.collapsedFolders.has(index) ? 'none' : 'block';
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

const app = new App();
app.init();
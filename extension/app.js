import { BookmarksService } from './lib/bookmarks.js';
import { computeColorScheme } from './lib/colors.js';
import {
  loadBookmarkActivity,
  loadSettings,
  saveBookmarkActivity,
  saveSettings,
} from './lib/storage.js';

const SORT_MODE_LABELS = {
  relevance: 'Relevance',
  title: 'Title',
  domain: 'Domain',
  recent: 'Recent',
  frequent: 'Frequent',
};

class App {
  constructor() {
    this.bookmarks = new BookmarksService();
    this.selectedBookmarkId = null;
    this.flatBookmarks = [];
    this.visibleBookmarks = [];
    this.currentResults = [];
    this.currentQuery = '';
    this.sortMode = 'relevance';
    this.settings = null;
    this.bookmarkActivity = {};
    this.collapsedFolders = new Set();
    this.faviconSrcCache = new Map();
    this.chromeFaviconBaseUrl = chrome.runtime.getURL('/_favicon/');
    this.selectionFeedbackTimer = null;
    this.contextMenuEl = null;
  }

  async init() {
    this.settings = await loadSettings();
    this.sortMode = this.settings.sortMode || 'relevance';
    this.bookmarkActivity = await loadBookmarkActivity();
    this.applyColorScheme(this.settings);

    await this.bookmarks.load();
    if (this.settings.rootFolderId) {
      this.bookmarks.filterByRoot(this.settings.rootFolderId);
    }

    this._hydrateControls();
    this.render('');
    this.setListeners();
    this._focusSearch();
  }

  async _reloadBookmarks(options = {}) {
    await this.bookmarks.load();
    if (this.settings.rootFolderId) {
      this.bookmarks.filterByRoot(this.settings.rootFolderId);
    }

    if (options.selectedBookmarkId) {
      this.selectedBookmarkId = String(options.selectedBookmarkId);
    }

    this.render(this.currentQuery);
  }

  applyColorScheme(settings) {
    const colors = computeColorScheme(settings.themeMode, settings.bgColor);
    for (const [prop, value] of Object.entries(colors)) {
      document.documentElement.style.setProperty(prop, value);
    }
  }

  _hydrateControls() {
    const sortSelect = document.getElementById('sort-mode');
    if (sortSelect) {
      sortSelect.value = this.sortMode;
    }
  }

  render(query = this.currentQuery) {
    this.currentQuery = query;
    this._closeContextMenu();
    this.currentResults = this.bookmarks.search(this.currentQuery, {
      sortMode: this.sortMode,
      activityMap: this.bookmarkActivity,
    });

    if (this.currentQuery.trim()) {
      this.collapsedFolders.clear();
    } else {
      this._collapseFolders(this.currentResults);
    }

    this.flatBookmarks = this.currentResults.flatMap((group) => group.bookmarks);
    this.visibleBookmarks = this._getVisibleBookmarks(this.currentResults);
    this._syncSelection();

    const container = document.getElementById('bookmarks-list');
    container.textContent = '';
    this._updateSummary(this.currentResults, this.currentQuery);
    this._updateSortBadge();

    if (this.flatBookmarks.length === 0) {
      container.appendChild(this._createEmptyState(this.currentQuery));
      this._updateInspector();
      return;
    }

    this.currentResults.forEach((group, index) => {
      this._renderGroup(group, index, this.currentResults, container);
    });

    this._updateInspector();
  }

  createBookmarkElement(bookmark, isSelected) {
    const item = document.createElement('div');
    item.className = 'bookmark-item' + (isSelected ? ' selected' : '');
    item.dataset.id = bookmark.id;
    item.title = bookmark.url;
    item.addEventListener('click', async () => {
      this.selectBookmark(bookmark.id, { scrollIntoView: false });
      await this.openBookmark(bookmark.id, {
        active: true,
        closeCurrentTab: Boolean(this.settings.closeOnEnterOpen),
      });
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.selectBookmark(bookmark.id, { scrollIntoView: false });
      this._openContextMenu(bookmark, event.clientX, event.clientY);
    });
    item.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.selectBookmark(bookmark.id);
        this.openBookmarkInBackgroundTab(bookmark.id);
      }
    });

    const favicon = document.createElement('img');
    favicon.className = 'bookmark-favicon';
    favicon.alt = '';
    favicon.loading = 'lazy';
    this.setFavicon(favicon, bookmark.url, bookmark.domain, bookmark.title, bookmark.origin);

    const title = document.createElement('span');
    title.className = 'bookmark-title';
    title.title = bookmark.title;
    this._renderHighlightedText(title, bookmark.title, bookmark.match?.titleRanges || []);

    const domain = document.createElement('span');
    domain.className = 'bookmark-domain';
    domain.title = bookmark.domain;
    this._renderHighlightedText(domain, bookmark.domain, bookmark.match?.domainRanges || []);

    item.appendChild(favicon);
    item.appendChild(title);
    item.appendChild(domain);
    return item;
  }

  setFavicon(imgEl, url, domain, title, origin) {
    const fallbackSvg = this._makeFallbackSvg(domain, title);
    const cacheKey = this._getFaviconCacheKey(url, origin, domain);
    const cachedSrc = this.faviconSrcCache.get(cacheKey);
    if (cachedSrc) {
      imgEl.src = cachedSrc;
      return;
    }

    const pageUrl = this._getFaviconPageUrl(url, origin, domain);
    if (!pageUrl) {
      this.faviconSrcCache.set(cacheKey, fallbackSvg);
      imgEl.src = fallbackSvg;
      return;
    }

    const faviconSrc = `${this.chromeFaviconBaseUrl}?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
    const finalize = (src) => {
      this.faviconSrcCache.set(cacheKey, src);
      imgEl.src = src;
      imgEl.onerror = null;
      imgEl.onload = null;
    };

    imgEl.onerror = () => finalize(fallbackSvg);
    imgEl.onload = () => {
      this.faviconSrcCache.set(cacheKey, faviconSrc);
      imgEl.onerror = null;
      imgEl.onload = null;
    };
    imgEl.src = faviconSrc;
  }

  _getFaviconCacheKey(url, origin, domain) {
    return origin || url || domain || '';
  }

  _getFaviconPageUrl(url, origin, domain) {
    if (origin && this._isSupportedFaviconOrigin(origin)) {
      return origin;
    }

    if (url) {
      try {
        const parsed = new URL(url);
        if (this._isSupportedFaviconOrigin(parsed.origin)) {
          return parsed.origin;
        }
      } catch {
        return null;
      }
    }

    if (!domain || this._isLocalDomain(domain)) {
      return null;
    }

    return `https://${domain}`;
  }

  _isSupportedFaviconOrigin(origin) {
    return origin && origin !== 'null' && /^https?:\/\//.test(origin);
  }

  _isLocalDomain(domain) {
    if (!domain) return true;
    return (
      domain === 'localhost' ||
      domain.startsWith('127.') ||
      domain.startsWith('192.168.') ||
      domain.startsWith('10.') ||
      domain.startsWith('172.') ||
      domain.endsWith('.local') ||
      domain.includes('local:') ||
      domain.startsWith('0.')
    );
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
      group.bookmarks.forEach((bookmark) => {
        container.appendChild(this.createBookmarkElement(bookmark, this.selectedBookmarkId === bookmark.id));
      });
      return;
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'folder-group';
    groupEl.dataset.folderIndex = String(groupIndex);

    const header = document.createElement('div');
    header.className = 'folder-header' + (this.collapsedFolders.has(groupIndex) ? '' : ' expanded');
    header.addEventListener('click', () => this.toggleFolder(groupIndex));
    header.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this._openFolderContextMenu(group, event.clientX, event.clientY);
    });

    const folderIcon = document.createElement('span');
    folderIcon.textContent = '▸';
    folderIcon.className = 'folder-arrow';

    const folderLabel = document.createElement('div');
    folderLabel.className = 'folder-label';

    const folderMeta = document.createElement('div');
    folderMeta.className = 'folder-meta';

    const folderKind = document.createElement('span');
    folderKind.className = 'folder-kind';
    folderKind.textContent = 'Folder';

    const folderText = document.createElement('span');
    folderText.className = 'folder-name';
    folderText.textContent = group.name;
    folderText.title = group.name;

    const folderCount = document.createElement('span');
    folderCount.className = 'folder-count';
    folderCount.textContent = `${group.bookmarks.length} rows`;

    folderLabel.appendChild(folderIcon);
    folderMeta.appendChild(folderKind);
    folderMeta.appendChild(folderText);
    folderLabel.appendChild(folderMeta);
    header.appendChild(folderLabel);
    header.appendChild(folderCount);

    const content = document.createElement('div');
    content.className = 'folder-content';
    content.id = `folder-${groupIndex}`;
    if (!this.collapsedFolders.has(groupIndex)) {
      content.classList.add('expanded');
    }

    group.bookmarks.forEach((bookmark) => {
      content.appendChild(this.createBookmarkElement(bookmark, this.selectedBookmarkId === bookmark.id));
    });

    groupEl.appendChild(header);
    groupEl.appendChild(content);
    container.appendChild(groupEl);
  }

  _renderHighlightedText(element, text, ranges) {
    element.textContent = '';
    if (!ranges.length) {
      element.textContent = text;
      return;
    }

    let cursor = 0;
    ranges.forEach(([start, end]) => {
      if (start > cursor) {
        element.appendChild(document.createTextNode(text.slice(cursor, start)));
      }

      const mark = document.createElement('mark');
      mark.className = 'match-highlight';
      mark.textContent = text.slice(start, end);
      element.appendChild(mark);
      cursor = end;
    });

    if (cursor < text.length) {
      element.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  _collapseFolders(results) {
    this.collapsedFolders.clear();
    results.forEach((group, index) => {
      if (group.type === 'folder') {
        this.collapsedFolders.add(index);
      }
    });
  }

  _getVisibleBookmarks(results) {
    return results.flatMap((group, index) => {
      if (group.type === 'root') {
        return group.bookmarks;
      }

      return this.collapsedFolders.has(index) ? [] : group.bookmarks;
    });
  }

  _syncSelection() {
    if (this.visibleBookmarks.length === 0) {
      this.selectedBookmarkId = null;
      return;
    }

    const selectedBookmark = this.selectedBookmarkId
      ? this.visibleBookmarks.find((bookmark) => bookmark.id === this.selectedBookmarkId)
      : null;

    this.selectedBookmarkId = selectedBookmark ? selectedBookmark.id : this.visibleBookmarks[0].id;
  }

  selectBookmark(id, options = {}) {
    const bookmark = this.visibleBookmarks.find((entry) => entry.id === id);
    if (!bookmark) return;

    this.selectedBookmarkId = id;
    this._applySelectionState(options.scrollIntoView !== false);
  }

  _applySelectionState(shouldScroll) {
    document.querySelector('.bookmark-item.selected')?.classList.remove('selected');
    const next = this.selectedBookmarkId
      ? document.querySelector(`.bookmark-item[data-id="${CSS.escape(this.selectedBookmarkId)}"]`)
      : null;
    if (next) {
      next.classList.add('selected');
      if (shouldScroll) {
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    this._updateInspector();
  }

  navigate(direction) {
    if (this.visibleBookmarks.length === 0) return;

    const currentIndex = this.selectedBookmarkId
      ? this.visibleBookmarks.findIndex((bookmark) => bookmark.id === this.selectedBookmarkId)
      : -1;
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : this.visibleBookmarks.length - 1
        : (currentIndex + direction + this.visibleBookmarks.length) % this.visibleBookmarks.length;

    this.selectedBookmarkId = this.visibleBookmarks[nextIndex].id;
    this._applySelectionState(true);
  }

  _updateSummary(results, query) {
    const countEl = document.getElementById('bookmarks-count');
    if (!countEl) return;

    const rowCount = this.flatBookmarks.length;
    const folderCount = results.filter((group) => group.type === 'folder').length;
    const rowLabel = rowCount === 1 ? 'row' : 'rows';

    if (query.trim()) {
      countEl.textContent = `${rowCount} ${rowLabel} matched`;
      return;
    }

    countEl.textContent =
      folderCount > 0 ? `${rowCount} ${rowLabel} in ${folderCount} folders` : `${rowCount} ${rowLabel}`;
  }

  _updateSortBadge() {
    const sortBadge = document.getElementById('sort-badge');
    if (!sortBadge) return;
    sortBadge.textContent = `Sort: ${SORT_MODE_LABELS[this.sortMode] || this.sortMode}`;
  }

  _updateInspector() {
    const selected = this.getSelectedBookmark();
    const urlEl = document.getElementById('selection-url');
    const pathEl = document.getElementById('selection-path');
    const usageEl = document.getElementById('selection-usage');

    if (!selected) {
      urlEl.textContent = 'No selection';
      pathEl.textContent = 'Select a row to inspect its path';
      usageEl.textContent = '0 opens';
      this._setActionState(false);
      return;
    }

    urlEl.textContent = selected.url;
    pathEl.textContent = selected.pathText || 'Root';
    usageEl.textContent = this._formatUsage(selected.match);
    this._setActionState(true);
  }

  _setActionState(isEnabled) {
    [
      'action-open',
      'action-background',
      'action-copy',
      'action-edit',
      'action-delete',
    ].forEach((id) => {
      const button = document.getElementById(id);
      if (button) {
        button.disabled = !isEnabled;
      }
    });
  }

  _formatUsage(match = {}) {
    const openCount = match.openCount || 0;
    const countLabel = `${openCount} ${openCount === 1 ? 'open' : 'opens'}`;
    if (!match.lastOpened) {
      return countLabel;
    }

    return `${countLabel} • ${this._formatRelativeTime(match.lastOpened)}`;
  }

  _formatRelativeTime(timestamp) {
    const deltaMs = Date.now() - timestamp;
    const deltaMinutes = Math.round(deltaMs / 60000);
    if (deltaMinutes < 1) return 'opened just now';
    if (deltaMinutes < 60) return `opened ${deltaMinutes}m ago`;

    const deltaHours = Math.round(deltaMinutes / 60);
    if (deltaHours < 24) return `opened ${deltaHours}h ago`;

    const deltaDays = Math.round(deltaHours / 24);
    return `opened ${deltaDays}d ago`;
  }

  _createEmptyState(query) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = query.trim()
      ? 'No rows matched the current filter. Try a shorter term or sort by title.'
      : 'No bookmarks available.';
    return empty;
  }

  getSelectedBookmark() {
    if (!this.selectedBookmarkId) return null;
    return this.flatBookmarks.find((bookmark) => bookmark.id === this.selectedBookmarkId) || null;
  }

  setListeners() {
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', (event) => {
      this.render(event.target.value);
    });

    const sortSelect = document.getElementById('sort-mode');
    if (sortSelect) {
      sortSelect.addEventListener('change', async (event) => {
        this.sortMode = event.target.value;
        this.settings.sortMode = this.sortMode;
        await saveSettings({ sortMode: this.sortMode });
        this.render(this.currentQuery);
      });
    }

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
      });
    }

    document.getElementById('new-bookmark-btn')?.addEventListener('click', () => this.createBookmark());

    document.getElementById('action-open')?.addEventListener('click', () => this.openSelected());
    document
      .getElementById('action-background')
      ?.addEventListener('click', () => this.openSelectedInBackground());
    document.getElementById('action-copy')?.addEventListener('click', () => this.copySelectedUrl());
    document.getElementById('action-edit')?.addEventListener('click', () => this.editSelected());
    document.getElementById('action-delete')?.addEventListener('click', () => this.deleteSelected());
    document.addEventListener('pointerdown', (event) => {
      if (this.contextMenuEl && event.target instanceof Node && !this.contextMenuEl.contains(event.target)) {
        this._closeContextMenu();
      }
    });
    document.addEventListener(
      'scroll',
      () => {
        this._closeContextMenu();
      },
      true
    );
    window.addEventListener('resize', () => this._closeContextMenu());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this._closeContextMenu();
        const modal = document.querySelector('.modal-overlay');
        if (modal) {
          modal.remove();
          return;
        }

        if (searchInput.value) {
          searchInput.value = '';
          this.render('');
          return;
        }
      }

      if (this._isTypingContext(event.target) && !(event.metaKey || event.ctrlKey)) {
        const isSearchTarget = this._isSearchInput(event.target);
        const allowedSearchKeys = new Set(['Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End']);
        if (!isSearchTarget || !allowedSearchKeys.has(event.key)) {
          return;
        }
      }

      if (event.key === '/' && !this._isTypingContext(event.target)) {
        event.preventDefault();
        this._focusSearch();
        return;
      }

      if (
        event.key.toLowerCase() === 'n' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        this.createBookmark();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        this._focusSearch();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        this.createBookmark();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'j') {
        event.preventDefault();
        this.navigate(1);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        this.navigate(-1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.navigate(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.navigate(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        this.selectFirst();
      } else if (event.key === 'End') {
        event.preventDefault();
        this.selectLast();
      } else if (
        event.key === 'Enter' &&
        this.selectedBookmarkId &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        this.openSelectedInBackground();
      } else if (event.key === 'Enter' && this.selectedBookmarkId) {
        event.preventDefault();
        this.openSelected({ closeAfterOpen: Boolean(this.settings.closeOnEnterOpen) });
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && this.selectedBookmarkId) {
        event.preventDefault();
        this.deleteSelected();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e' && this.selectedBookmarkId) {
        event.preventDefault();
        this.editSelected();
      }
    });
  }

  _isTypingContext(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );
  }

  _isSearchInput(target) {
    return target instanceof HTMLElement && target.id === 'search';
  }

  _focusSearch() {
    const searchInput = document.getElementById('search');
    if (!searchInput) return;
    searchInput.focus();
    searchInput.select();
  }

  selectFirst() {
    if (this.visibleBookmarks.length === 0) return;
    this.selectedBookmarkId = this.visibleBookmarks[0].id;
    this._applySelectionState(true);
  }

  selectLast() {
    if (this.visibleBookmarks.length === 0) return;
    this.selectedBookmarkId = this.visibleBookmarks[this.visibleBookmarks.length - 1].id;
    this._applySelectionState(true);
  }

  async openSelected(options = {}) {
    const bookmark = this.getSelectedBookmark();
    if (bookmark) {
      this._closeContextMenu();
      await this.openBookmark(bookmark.id, { active: true, closeCurrentTab: Boolean(options.closeAfterOpen) });
    }
  }

  async openSelectedInBackground() {
    const bookmark = this.getSelectedBookmark();
    if (bookmark) {
      this._closeContextMenu();
      await this.openBookmark(bookmark.id, { active: false });
    }
  }

  async openBookmark(id, options = {}) {
    const bookmark = this.bookmarks.bookmarks.find((entry) => entry.id === id);
    if (!bookmark) return;

    await chrome.tabs.create({
      url: bookmark.url,
      active: typeof options.active === 'boolean' ? options.active : !this.settings.openInBackground,
    });

    await this._recordBookmarkOpen(id);

    if (options.closeCurrentTab) {
      await this._closeCurrentTab();
    }
  }

  async openBookmarkInBackgroundTab(id) {
    await this.openBookmark(id, { active: false });
  }

  async _closeCurrentTab() {
    try {
      const currentTab = await chrome.tabs.getCurrent();
      if (currentTab?.id != null) {
        await chrome.tabs.remove(currentTab.id);
      }
    } catch {
      // Ignore close failures; bookmark opening is already complete.
    }
  }

  async _recordBookmarkOpen(id) {
    const nextActivity = this.bookmarkActivity[id] || { openCount: 0, lastOpened: 0 };
    this.bookmarkActivity = {
      ...this.bookmarkActivity,
      [id]: {
        openCount: nextActivity.openCount + 1,
        lastOpened: Date.now(),
      },
    };

    await saveBookmarkActivity(this.bookmarkActivity);
    this.render(this.currentQuery);
  }

  async copySelectedUrl() {
    const bookmark = this.getSelectedBookmark();
    if (!bookmark) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(bookmark.url);
      } else {
        fallbackCopyText(bookmark.url);
      }

      this._setSelectionFeedback('URL copied to clipboard.');
    } catch {
      this._setSelectionFeedback('Clipboard access failed.');
    }
  }

  _setSelectionFeedback(message) {
    const feedbackEl = document.getElementById('selection-feedback');
    if (!feedbackEl) return;

    feedbackEl.textContent = message;
    feedbackEl.classList.add('visible');
    clearTimeout(this.selectionFeedbackTimer);
    this.selectionFeedbackTimer = window.setTimeout(() => {
      feedbackEl.textContent = '';
      feedbackEl.classList.remove('visible');
    }, 1800);
  }

  async deleteSelected() {
    const bookmark = this.getSelectedBookmark();
    if (!bookmark) return;
    await this.deleteBookmark(bookmark.id);
  }

  async deleteBookmark(id) {
    const bookmark = this.flatBookmarks.find((entry) => entry.id === id);
    if (!bookmark) return;
    if (!confirm(`Delete "${bookmark.title}"?`)) return;

    this._closeContextMenu();
    await this.bookmarks.remove(bookmark.id);
    delete this.bookmarkActivity[bookmark.id];
    await saveBookmarkActivity(this.bookmarkActivity);

    this.selectedBookmarkId = null;
    await this._reloadBookmarks();
  }

  async createBookmark(options = {}) {
    this._closeContextMenu();
    await this._openBookmarkEditor({
      mode: 'create',
      preferredParentId: options.parentId || null,
    });
  }

  async editSelected() {
    const bookmark = this.getSelectedBookmark();
    if (!bookmark) return;
    await this.editBookmark(bookmark.id);
  }

  async editBookmark(id) {
    const bookmark = this.flatBookmarks.find((entry) => entry.id === id);
    if (!bookmark) return;

    this._closeContextMenu();
    await this._openBookmarkEditor({ mode: 'edit', bookmark });
  }

  toggleFolder(index) {
    const content = document.getElementById(`folder-${index}`);
    if (!content) return;

    const header = content.previousElementSibling;
    if (this.collapsedFolders.has(index)) {
      this.collapsedFolders.delete(index);
      content.classList.add('expanded');
      header?.classList.add('expanded');
    } else {
      this.collapsedFolders.add(index);
      content.classList.remove('expanded');
      header?.classList.remove('expanded');
    }
  }

  async _openBookmarkEditor({ mode, bookmark = null, preferredParentId = null }) {
    const selected = this.getSelectedBookmark();
    const defaultParentId =
      mode === 'edit'
        ? bookmark?.parentId || null
        : this.bookmarks.getDefaultCreateParentId(
            preferredParentId || selected?.parentId || null,
            this.settings.rootFolderId
          );
    const folders = this.bookmarks.getFolderTree(this.settings.rootFolderId || null);
    if (!folders.length && defaultParentId) {
      const defaultNode = this.bookmarks.getNodeById(defaultParentId);
      if (defaultNode) {
        folders.push({
          id: defaultNode.id,
          path: defaultNode.title || 'Untitled',
        });
      }
    }
    const fallbackParentId = folders[0]?.id || defaultParentId;
    const initialParentId = String(defaultParentId || fallbackParentId || '');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal';

    const heading = document.createElement('h2');
    heading.textContent = mode === 'edit' ? 'Edit Bookmark' : 'New Bookmark';

    const form = document.createElement('form');
    form.className = 'modal-form';

    const titleGroup = this._createField('Title');
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.name = 'title';
    titleInput.autocomplete = 'off';
    titleInput.value = bookmark?.title || '';
    titleGroup.appendChild(titleInput);

    const urlGroup = this._createField('URL');
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.name = 'url';
    urlInput.value = bookmark?.url || 'https://';
    urlGroup.appendChild(urlInput);

    const folderGroup = this._createField('Folder');
    const folderSearchInput = document.createElement('input');
    folderSearchInput.type = 'search';
    folderSearchInput.name = 'folderSearch';
    folderSearchInput.placeholder = 'Search folders';

    const folderSelect = document.createElement('select');
    folderSelect.name = 'parentId';
    let selectedParentId = initialParentId;

    const renderFolderOptions = (filterValue = '') => {
      const normalizedFilter = filterValue.trim().toLowerCase();
      const filteredFolders = normalizedFilter
        ? folders.filter((folder) => folder.path.toLowerCase().includes(normalizedFilter))
        : folders;

      folderSelect.textContent = '';

      if (filteredFolders.length === 0) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'No folders matched';
        emptyOption.disabled = true;
        emptyOption.selected = true;
        folderSelect.appendChild(emptyOption);
        folderSelect.disabled = true;
        return;
      }

      folderSelect.disabled = false;
      const hasSelectedFolder = filteredFolders.some((folder) => String(folder.id) === String(selectedParentId));
      if (!hasSelectedFolder) {
        selectedParentId = String(filteredFolders[0].id);
      }

      for (const folder of filteredFolders) {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.path;
        option.selected = String(folder.id) === String(selectedParentId);
        folderSelect.appendChild(option);
      }
    };

    folderSearchInput.addEventListener('input', () => {
      renderFolderOptions(folderSearchInput.value);
    });
    folderSelect.addEventListener('change', () => {
      selectedParentId = folderSelect.value;
    });

    renderFolderOptions();
    folderGroup.appendChild(folderSearchInput);
    folderGroup.appendChild(folderSelect);

    const errorMessage = document.createElement('p');
    errorMessage.className = 'modal-error';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = mode === 'edit' ? 'Save' : 'Create';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(titleGroup);
    form.appendChild(urlGroup);
    form.appendChild(folderGroup);
    form.appendChild(errorMessage);
    form.appendChild(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const nextTitle = titleInput.value.trim();
      const nextUrl = urlInput.value.trim();
      const nextParentId = folderSelect.disabled ? '' : folderSelect.value || selectedParentId;

      if (!nextTitle || !nextUrl || !nextParentId) {
        errorMessage.textContent = 'Title, URL, and folder are required.';
        return;
      }

      try {
        new URL(nextUrl);
      } catch {
        errorMessage.textContent = 'Enter a valid URL, including the protocol.';
        return;
      }

      if (mode === 'edit' && bookmark) {
        await this.bookmarks.update(bookmark.id, { title: nextTitle, url: nextUrl });
        if (String(bookmark.parentId || '') !== String(nextParentId)) {
          await this.bookmarks.move(bookmark.id, nextParentId);
        }
        overlay.remove();
        await this._reloadBookmarks({ selectedBookmarkId: bookmark.id });
        return;
      }

      const created = await this.bookmarks.create({
        title: nextTitle,
        url: nextUrl,
        parentId: nextParentId,
      });
      overlay.remove();
      await this._reloadBookmarks({ selectedBookmarkId: created.id });
    });

    modal.appendChild(heading);
    modal.appendChild(form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    titleInput.focus();
    titleInput.select();
  }

  _createField(labelText) {
    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.textContent = labelText;
    group.appendChild(label);
    return group;
  }

  async _openFolderRenameDialog(folder) {
    const folderNode = folder?.id ? this.bookmarks.getNodeById(folder.id) : null;
    if (!folderNode) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });

    const modal = document.createElement('div');
    modal.className = 'modal';

    const heading = document.createElement('h2');
    heading.textContent = 'Rename Folder';

    const form = document.createElement('form');
    form.className = 'modal-form';

    const nameGroup = this._createField('Folder name');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.name = 'folderName';
    nameInput.value = folderNode.title || '';
    nameGroup.appendChild(nameInput);

    const errorMessage = document.createElement('p');
    errorMessage.className = 'modal-error';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Rename';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(nameGroup);
    form.appendChild(errorMessage);
    form.appendChild(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const nextTitle = nameInput.value.trim();
      if (!nextTitle) {
        errorMessage.textContent = 'Folder name is required.';
        return;
      }

      await this.bookmarks.updateFolder(folder.id, nextTitle);
      overlay.remove();
      await this._reloadBookmarks();
    });

    modal.appendChild(heading);
    modal.appendChild(form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    nameInput.focus();
    nameInput.select();
  }

  async _deleteFolder(folder) {
    if (!folder?.id) return;
    if (!confirm(`Delete folder "${folder.name}" and everything inside it?`)) return;

    const folderNode = this.bookmarks.getNodeById(folder.id);
    if (folderNode) {
      for (const bookmarkId of this._collectBookmarkIds(folderNode)) {
        delete this.bookmarkActivity[bookmarkId];
      }
      await saveBookmarkActivity(this.bookmarkActivity);
    }

    this._closeContextMenu();
    await this.bookmarks.removeFolder(folder.id);
    await this._reloadBookmarks();
  }

  _collectBookmarkIds(node) {
    const ids = [];
    const visit = (entry) => {
      if (entry.url) {
        ids.push(entry.id);
        return;
      }

      for (const child of entry.children || []) {
        visit(child);
      }
    };

    visit(node);
    return ids;
  }

  _openContextMenu(bookmark, clientX, clientY) {
    this._showContextMenu(
      [
        {
          label: 'Edit bookmark',
          action: async () => {
            await this.editBookmark(bookmark.id);
          },
        },
        {
          label: 'Delete bookmark',
          danger: true,
          action: async () => {
            await this.deleteBookmark(bookmark.id);
          },
        },
      ],
      clientX,
      clientY
    );
  }

  _openFolderContextMenu(folder, clientX, clientY) {
    this._showContextMenu(
      [
        {
          label: 'Rename folder',
          action: async () => {
            await this._openFolderRenameDialog(folder);
          },
        },
        {
          label: 'New bookmark here',
          action: async () => {
            await this.createBookmark({ parentId: folder.id });
          },
        },
        {
          label: 'Delete folder',
          danger: true,
          action: async () => {
            await this._deleteFolder(folder);
          },
        },
      ],
      clientX,
      clientY
    );
  }

  _showContextMenu(items, clientX, clientY) {
    this._closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `context-menu-item${item.danger ? ' context-menu-item-danger' : ''}`;
      button.textContent = item.label;
      button.addEventListener('click', async () => {
        this._closeContextMenu();
        await item.action();
      });
      menu.appendChild(button);
    });

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - rect.width - 12);
    const top = Math.min(clientY, window.innerHeight - rect.height - 12);
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${Math.max(12, top)}px`;
    this.contextMenuEl = menu;
  }

  _closeContextMenu() {
    this.contextMenuEl?.remove();
    this.contextMenuEl = null;
  }
}

function fallbackCopyText(value) {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

const app = new App();
app.init();

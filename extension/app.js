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
    this.folderSearchQuery = '';
    this.activeFolderPath = '';
    this.activeFolderMode = 'root';
    this.expandedFolderPaths = new Set();
    this.sortMode = 'relevance';
    this.settings = null;
    this.bookmarkActivity = {};
    this.faviconSrcCache = new Map();
    this.chromeFaviconBaseUrl = chrome.runtime.getURL('/_favicon/');
    this.selectionFeedbackTimer = null;
    this.contextMenuEl = null;
    this.draggedBookmarkId = null;
    this.dragOverRowId = null;
    this.dragOverPosition = null;
    this.dragOverFolderId = null;
    this.folderDragOpenTimer = null;
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
    const parsedQuery = this._parseQuery(this.currentQuery);
    const effectiveSortMode = parsedQuery.sortMode || this.sortMode;
    this.currentResults = this.bookmarks.search(parsedQuery.terms.join(' '), {
      sortMode: effectiveSortMode,
      activityMap: this.bookmarkActivity,
    });
    const baseRows = this.currentResults
      .flatMap((group) => group.bookmarks)
      .filter((bookmark) => this._matchesSiteFilter(bookmark, parsedQuery.site));
    const activeScope = this._getActiveScope(parsedQuery);
    this.flatBookmarks = baseRows;
    this.visibleBookmarks = baseRows.filter((bookmark) =>
      this._isBookmarkInScope(bookmark, activeScope)
    );

    this._sortVisibleBookmarks(effectiveSortMode, parsedQuery.terms);
    this._syncSelection();

    const container = document.getElementById('bookmarks-list');
    container.textContent = '';
    this._updateSummary(this.visibleBookmarks, activeScope);
    this._updateSortBadge(effectiveSortMode);
    this._renderFolderRail(baseRows, activeScope);
    document
      .getElementById('table-wrap')
      ?.setAttribute('data-mode', activeScope.mode === 'all' ? 'all' : 'scoped');

    if (this.visibleBookmarks.length === 0) {
      container.appendChild(this._createEmptyState(this.currentQuery));
      this._updateInspector();
      this._updateStatusLine(null, activeScope);
      return;
    }

    this.visibleBookmarks.forEach((bookmark) => {
      container.appendChild(
        this.createBookmarkElement(bookmark, this.selectedBookmarkId === bookmark.id)
      );
    });

    this._updateInspector();
    this._updateStatusLine(this.getSelectedBookmark(), activeScope);
  }

  createBookmarkElement(bookmark, isSelected) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'row' + (isSelected ? ' selected' : '');
    item.dataset.id = bookmark.id;
    item.draggable = true;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    item.title = bookmark.url;
    item.addEventListener('click', async () => {
      this.selectBookmark(bookmark.id, { scrollIntoView: false });
      await this.openBookmarkWithDefaultBehavior(bookmark.id);
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
    item.addEventListener('dragstart', (event) => this._handleBookmarkDragStart(event, bookmark));
    item.addEventListener('dragend', () => this._handleBookmarkDragEnd());
    item.addEventListener('dragover', (event) => this._handleBookmarkRowDragOver(event, bookmark));
    item.addEventListener('dragleave', (event) =>
      this._handleBookmarkRowDragLeave(event, bookmark)
    );
    item.addEventListener('drop', (event) => this._handleBookmarkRowDrop(event, bookmark));

    const titleCell = document.createElement('span');
    titleCell.className = 'cell title-cell';

    const siteIcon = document.createElement('span');
    siteIcon.className = 'site-icon';
    siteIcon.setAttribute('aria-hidden', 'true');

    const fallback = document.createElement('span');
    fallback.className = 'site-icon-fallback';
    fallback.textContent = this._getSiteInitial(bookmark.domain, bookmark.title);

    const favicon = document.createElement('img');
    favicon.alt = '';
    favicon.loading = 'lazy';
    this.setFavicon(favicon, bookmark.url, bookmark.domain, bookmark.title, bookmark.origin);

    const title = document.createElement('span');
    title.className = 'title-text';
    title.title = bookmark.title;
    this._renderHighlightedText(title, bookmark.title, bookmark.match?.titleRanges || []);

    siteIcon.appendChild(fallback);
    siteIcon.appendChild(favicon);
    titleCell.appendChild(siteIcon);
    titleCell.appendChild(title);

    const folder = document.createElement('span');
    folder.className = 'cell folder-cell cell-folder';
    folder.textContent = bookmark.pathText || 'Root';
    folder.title = bookmark.pathText || 'Root';

    const domain = document.createElement('span');
    domain.className = 'cell domain-cell cell-domain';
    domain.title = bookmark.url;
    domain.textContent = this._formatUrl(bookmark.url);

    const lastOpened = document.createElement('span');
    lastOpened.className = 'cell metric-cell cell-last';
    lastOpened.textContent = this._formatLastOpened(bookmark.match?.lastOpened);

    const opens = document.createElement('span');
    opens.className = 'cell metric-cell cell-opens';
    opens.textContent = String(bookmark.match?.openCount || 0);

    item.appendChild(titleCell);
    item.appendChild(folder);
    item.appendChild(domain);
    item.appendChild(lastOpened);
    item.appendChild(opens);
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

  _parseQuery(raw) {
    const tokens = String(raw || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const parsed = {
      sortMode: '',
      site: '',
      folder: '',
      terms: [],
    };

    for (const token of tokens) {
      const lower = this._normalize(token);
      if (lower.startsWith('sort:')) {
        const mode = lower.slice(5);
        const sortMode =
          mode === 'site' || mode === 'domain' ? 'domain' : mode === 'opens' ? 'frequent' : mode;
        if (Object.prototype.hasOwnProperty.call(SORT_MODE_LABELS, sortMode)) {
          parsed.sortMode = sortMode;
          continue;
        }
      }

      if (lower.startsWith('site:') || lower.startsWith('domain:')) {
        parsed.site = lower.slice(lower.indexOf(':') + 1);
        continue;
      }

      if (lower.startsWith('in:')) {
        parsed.folder = token.slice(3);
        continue;
      }

      parsed.terms.push(lower);
    }

    return parsed;
  }

  _normalize(value) {
    return String(value || '')
      .toLowerCase()
      .trim();
  }

  _formatFolderPath(value) {
    return String(value || '')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' / ');
  }

  _matchesSiteFilter(bookmark, siteFilter) {
    if (!siteFilter) return true;
    return (
      this._normalize(bookmark.domain).includes(siteFilter) ||
      this._normalize(bookmark.url).includes(siteFilter)
    );
  }

  _getActiveScope(parsedQuery) {
    if (parsedQuery.folder) {
      const path = this._formatFolderPath(parsedQuery.folder);
      return { mode: 'folder', path, label: path };
    }

    if (this._hasGlobalSearch(parsedQuery)) {
      return { mode: 'all', path: '', label: 'all' };
    }

    if (this.activeFolderMode === 'folder' && this.activeFolderPath) {
      const path = this._formatFolderPath(this.activeFolderPath);
      return { mode: 'folder', path, label: path };
    }

    if (this.activeFolderMode === 'all') {
      return { mode: 'all', path: '', label: 'all' };
    }

    return { mode: 'root', path: '', label: 'root' };
  }

  _hasGlobalSearch(parsedQuery) {
    return parsedQuery.terms.length > 0 || Boolean(parsedQuery.site);
  }

  _isBookmarkInScope(bookmark, scope) {
    if (scope.mode === 'all') return true;
    if (scope.mode === 'root') return this._isRootBookmark(bookmark);

    const folderScope = this._normalize(this._formatFolderPath(scope.path));
    const bookmarkPath = this._normalize(this._formatFolderPath(bookmark.pathText));
    return bookmarkPath === folderScope || bookmarkPath.startsWith(`${folderScope} / `);
  }

  _isRootBookmark(bookmark) {
    return this._normalize(bookmark.pathText) === 'root';
  }

  _sortVisibleBookmarks(sortMode, terms) {
    if (sortMode !== 'relevance' || terms.length > 0) {
      return;
    }

    this.visibleBookmarks.sort((left, right) => left.order - right.order);
  }

  _formatUrl(url) {
    return String(url || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');
  }

  _getSiteInitial(domain, title) {
    const value = String(domain || title || '')
      .trim()
      .replace(/^www\./, '');
    return (value[0] || '?').toUpperCase();
  }

  _formatLastOpened(timestamp) {
    if (!timestamp) return '-';
    return this._formatRelativeTime(timestamp).replace(/^opened /, '');
  }

  _renderFolderRail(baseRows, activeScope) {
    const folderList = document.getElementById('folder-list');
    if (!folderList) return;

    const folders = this._getFolderTreeForCurrentRoot();
    const tree = this._buildFolderTree(folders, baseRows);
    const selectedKey = activeScope.mode === 'folder' ? this._normalize(activeScope.path) : '';
    const rootCount = baseRows.filter((bookmark) => this._isRootBookmark(bookmark)).length;
    folderList.textContent = '';

    folderList.appendChild(
      this._createFolderRailRow({
        path: '',
        title: 'all',
        count: baseRows.length,
        selected: activeScope.mode === 'all',
        mode: 'all',
        isLeaf: true,
      })
    );

    folderList.appendChild(
      this._createFolderRailRow({
        path: '',
        title: 'root',
        count: rootCount,
        selected: activeScope.mode === 'root',
        mode: 'root',
        isLeaf: true,
        folderId: this._getRootDropParentId(),
      })
    );

    const appendNode = (node, parentEl = folderList) => {
      if (this.folderSearchQuery && !node.matchesSearch) {
        return;
      }

      const item = document.createElement('div');
      item.className = 'folder-item';
      item.appendChild(
        this._createFolderRailRow({
          path: node.path,
          title: node.title,
          count: node.count,
          selected: this._normalize(node.path) === selectedKey,
          mode: 'folder',
          isLeaf: node.children.length === 0,
          isOpen: this._isFolderNodeOpen(node),
          folderId: node.id,
        })
      );

      if (node.children.length > 0 && this._isFolderNodeOpen(node)) {
        const childrenEl = document.createElement('div');
        childrenEl.className = 'folder-children';
        node.children.forEach((child) => appendNode(child, childrenEl));
        if (childrenEl.children.length > 0) {
          item.appendChild(childrenEl);
        }
      }

      parentEl.appendChild(item);
    };

    tree.forEach((node) => appendNode(node));
  }

  _isFolderNodeOpen(node) {
    if (node.children.length === 0) {
      return false;
    }

    return (
      this.expandedFolderPaths.has(this._normalize(node.path)) ||
      (Boolean(this.folderSearchQuery.trim()) && node.matchesSearch)
    );
  }

  _buildFolderTree(folders, rows) {
    const counts = new Map();
    for (const bookmark of rows) {
      const parts = this._formatFolderPath(bookmark.pathText).split(' / ').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = current ? `${current} / ${part}` : part;
        counts.set(this._normalize(current), (counts.get(this._normalize(current)) || 0) + 1);
      }
    }

    const nodeMap = new Map();
    for (const folder of folders) {
      const key = this._normalize(folder.path);
      if (!key) continue;
      nodeMap.set(key, {
        ...folder,
        count: counts.get(key) || 0,
        children: [],
        matchesSearch: true,
      });
    }

    const roots = [];
    for (const node of nodeMap.values()) {
      const parentPath = node.path.split(' / ').slice(0, -1).join(' / ');
      const parent = nodeMap.get(this._normalize(parentPath));
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const folderSearch = this._normalize(this.folderSearchQuery);
    const markMatches = (node) => {
      const ownMatch = !folderSearch || this._normalize(node.path).includes(folderSearch);
      const childMatch = node.children.map(markMatches).some(Boolean);
      node.matchesSearch = ownMatch || childMatch;
      return node.matchesSearch;
    };

    const sortNodes = (nodes) => {
      nodes.sort((left, right) =>
        left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
      );
      nodes.forEach((node) => sortNodes(node.children));
    };

    roots.forEach(markMatches);
    sortNodes(roots);
    return roots;
  }

  _createFolderRailRow({
    path,
    title,
    count,
    selected,
    isLeaf,
    isOpen = false,
    mode = 'folder',
    folderId = null,
  }) {
    const row = document.createElement('div');
    row.className = 'folder-row';
    row.dataset.folder = path;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'folder-toggle';
    toggle.dataset.state = isLeaf ? 'leaf' : isOpen ? 'open' : 'closed';
    toggle.setAttribute(
      'aria-label',
      isLeaf ? 'Folder' : isOpen ? 'Collapse folder' : 'Expand folder'
    );
    if (isLeaf) {
      toggle.tabIndex = -1;
    }
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (isLeaf || !path) return;
      const key = this._normalize(path);
      if (this.expandedFolderPaths.has(key)) {
        this.expandedFolderPaths.delete(key);
      } else {
        this.expandedFolderPaths.add(key);
      }
      this.render(this.currentQuery);
    });

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'folder-toggle-icon';
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggle.appendChild(toggleIcon);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `folder-button${selected ? ' selected' : ''}`;
    button.dataset.folder = path;
    button.dataset.mode = mode;
    if (folderId) {
      button.dataset.folderId = folderId;
    }
    button.addEventListener('click', () => {
      this.activeFolderMode = mode;
      this.activeFolderPath = mode === 'folder' ? path : '';
      this.selectedBookmarkId = null;
      this.render(this.currentQuery);
    });
    button.addEventListener('contextmenu', (event) => {
      if (mode !== 'folder' || !path) return;
      const folder = this._getFolderTreeForCurrentRoot().find(
        (entry) => this._normalize(entry.path) === this._normalize(path)
      );
      if (!folder) return;
      event.preventDefault();
      this._openFolderContextMenu({ ...folder, name: folder.path }, event.clientX, event.clientY);
    });
    if ((mode === 'folder' || mode === 'root') && folderId) {
      button.addEventListener('dragover', (event) =>
        this._handleFolderDragOver(event, { path, isLeaf, mode })
      );
      button.addEventListener('dragleave', (event) =>
        this._handleFolderDragLeave(event, path, mode)
      );
      button.addEventListener('drop', (event) =>
        this._handleFolderDrop(event, path, folderId, mode)
      );
    }

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = title;
    name.title = path || 'all';

    const countEl = document.createElement('span');
    countEl.className = 'folder-count';
    countEl.textContent = String(count);

    button.appendChild(name);
    button.appendChild(countEl);
    row.appendChild(toggle);
    row.appendChild(button);
    return row;
  }

  _getFolderTreeForCurrentRoot() {
    const rootId = this.settings.rootFolderId || null;
    if (!rootId) {
      return this.bookmarks.getFolderTree();
    }

    const rootNode = this.bookmarks.getNodeById(rootId);
    if (!rootNode) {
      return [];
    }

    const folders = [];
    const traverse = (node, depth = 0, parentPath = []) => {
      if (!node || node.url || !node.children) return;

      const title = node.title || 'Untitled';
      const path = [...parentPath, title].join(' / ');
      folders.push({
        id: node.id,
        title,
        depth,
        path,
      });

      for (const child of node.children) {
        if (!child.url) {
          traverse(child, depth + 1, [...parentPath, title]);
        }
      }
    };

    for (const child of rootNode.children || []) {
      if (!child.url) {
        traverse(child, 0, []);
      }
    }

    return folders;
  }

  _getFolderIdByPath(path) {
    const normalizedPath = this._normalize(path);
    return (
      this._getFolderTreeForCurrentRoot().find(
        (folder) => this._normalize(folder.path) === normalizedPath
      )?.id || null
    );
  }

  _getRootDropParentId() {
    return (
      this.settings.rootFolderId ||
      this.bookmarks.getDefaultCreateParentId(null, this.settings.rootFolderId)
    );
  }

  _handleBookmarkDragStart(event, bookmark) {
    this._closeContextMenu();
    this.draggedBookmarkId = bookmark.id;
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', bookmark.id);
    event.dataTransfer.setData('application/x-bookmark-id', bookmark.id);
  }

  _handleBookmarkDragEnd() {
    this._clearDragState();
  }

  _handleBookmarkRowDragOver(event, bookmark) {
    if (!this._canAcceptBookmarkDrop(bookmark.id)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    this._setRowDropTarget(bookmark.id, position);
  }

  _handleBookmarkRowDragLeave(event, bookmark) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    if (this.dragOverRowId === bookmark.id) {
      this._setRowDropTarget(null, null);
    }
  }

  async _handleBookmarkRowDrop(event, targetBookmark) {
    if (!this._canAcceptBookmarkDrop(targetBookmark.id)) return;

    event.preventDefault();
    const bookmarkId = this._getDraggedBookmarkId(event);
    const moved = await this._moveBookmarkBeforeOrAfter(
      bookmarkId,
      targetBookmark,
      this.dragOverPosition
    );
    this._clearDragState();
    if (moved) {
      await this._reloadBookmarks({ selectedBookmarkId: bookmarkId });
    }
  }

  _handleFolderDragOver(event, folder) {
    if (!this._canAcceptBookmarkDrop()) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this._setFolderDropTarget(folder.path, folder.mode);

    if (folder.mode === 'folder' && !folder.isLeaf) {
      this._scheduleFolderDragOpen(folder.path);
    }
  }

  _handleFolderDragLeave(event, path, mode = 'folder') {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    if (this.dragOverFolderId === this._getFolderDropKey(path, mode)) {
      this._setFolderDropTarget(null, mode);
    }
  }

  async _handleFolderDrop(event, path, folderId, mode = 'folder') {
    if (!this._canAcceptBookmarkDrop()) return;

    event.preventDefault();
    const bookmarkId = this._getDraggedBookmarkId(event);
    const targetFolderId = folderId || this._getFolderIdByPath(path);
    const bookmark = this.bookmarks.bookmarks.find((entry) => entry.id === bookmarkId);
    this._clearDragState();

    if (
      !targetFolderId ||
      !bookmark ||
      String(bookmark.parentId || '') === String(targetFolderId)
    ) {
      return;
    }

    await this.bookmarks.move(bookmarkId, targetFolderId);
    this.activeFolderMode = mode === 'root' ? 'root' : 'folder';
    this.activeFolderPath = mode === 'root' ? '' : path;
    if (mode === 'folder') {
      for (const parentPath of this._getParentFolderPaths(path)) {
        this.expandedFolderPaths.add(this._normalize(parentPath));
      }
    }
    await this._reloadBookmarks({ selectedBookmarkId: bookmarkId });
  }

  _canAcceptBookmarkDrop(targetBookmarkId = null) {
    if (!this.draggedBookmarkId) return false;
    return !targetBookmarkId || String(this.draggedBookmarkId) !== String(targetBookmarkId);
  }

  _getDraggedBookmarkId(event) {
    return (
      event.dataTransfer.getData('application/x-bookmark-id') ||
      event.dataTransfer.getData('text/plain') ||
      this.draggedBookmarkId ||
      ''
    );
  }

  async _moveBookmarkBeforeOrAfter(bookmarkId, targetBookmark, position) {
    const bookmark = this.bookmarks.bookmarks.find((entry) => entry.id === bookmarkId);
    if (!bookmark || !targetBookmark || bookmark.id === targetBookmark.id) {
      return false;
    }

    const parentId = targetBookmark.parentId;
    if (!parentId) return false;

    let index = targetBookmark.index + (position === 'after' ? 1 : 0);
    if (String(bookmark.parentId || '') === String(parentId) && bookmark.index < index) {
      index -= 1;
    }

    if (String(bookmark.parentId || '') === String(parentId) && bookmark.index === index) {
      return false;
    }

    await this.bookmarks.move(bookmarkId, parentId, index);
    return true;
  }

  _setRowDropTarget(bookmarkId, position) {
    if (this.dragOverRowId === bookmarkId && this.dragOverPosition === position) return;

    document.querySelectorAll('.row.drop-before, .row.drop-after').forEach((row) => {
      row.classList.remove('drop-before', 'drop-after');
    });

    this.dragOverRowId = bookmarkId;
    this.dragOverPosition = position;
    if (!bookmarkId || !position) return;

    const row = document.querySelector(`.row[data-id="${CSS.escape(bookmarkId)}"]`);
    row?.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
  }

  _getFolderDropKey(path, mode = 'folder') {
    return `${mode}:${this._normalize(path)}`;
  }

  _setFolderDropTarget(path, mode = 'folder') {
    const key = path == null ? null : this._getFolderDropKey(path, mode);
    if (this.dragOverFolderId === key) return;

    document.querySelectorAll('.folder-button.drop-target').forEach((button) => {
      button.classList.remove('drop-target');
    });

    this.dragOverFolderId = key;
    if (path == null) return;

    const button = document.querySelector(
      `.folder-button[data-folder="${CSS.escape(path)}"][data-mode="${CSS.escape(mode)}"]`
    );
    button?.classList.add('drop-target');
  }

  _scheduleFolderDragOpen(path) {
    const key = this._normalize(path);
    if (this.expandedFolderPaths.has(key)) return;

    if (this.folderDragOpenTimer) {
      clearTimeout(this.folderDragOpenTimer);
    }
    this.folderDragOpenTimer = window.setTimeout(() => {
      this.expandedFolderPaths.add(key);
      this.render(this.currentQuery);
    }, 500);
  }

  _clearDragState() {
    if (this.folderDragOpenTimer) {
      clearTimeout(this.folderDragOpenTimer);
    }
    this.folderDragOpenTimer = null;
    this.draggedBookmarkId = null;
    this.dragOverRowId = null;
    this.dragOverPosition = null;
    this.dragOverFolderId = null;
    document.querySelectorAll('.row.dragging, .row.drop-before, .row.drop-after').forEach((row) => {
      row.classList.remove('dragging', 'drop-before', 'drop-after');
    });
    document.querySelectorAll('.folder-button.drop-target').forEach((button) => {
      button.classList.remove('drop-target');
    });
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
    const previous = document.querySelector('.row.selected');
    previous?.classList.remove('selected');
    previous?.setAttribute('aria-selected', 'false');
    const next = this.selectedBookmarkId
      ? document.querySelector(`.row[data-id="${CSS.escape(this.selectedBookmarkId)}"]`)
      : null;
    if (next) {
      next.classList.add('selected');
      next.setAttribute('aria-selected', 'true');
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

  _updateSummary(rows, activeScope) {
    const countEl = document.getElementById('bookmarks-count');
    if (!countEl) return;

    const rowCount = rows.length;
    const rowLabel = rowCount === 1 ? 'row' : 'rows';

    if (activeScope.mode !== 'all') {
      countEl.textContent = `${rowCount} ${rowLabel} in ${activeScope.label}`;
      return;
    }

    countEl.textContent = `${rowCount} ${rowLabel}`;
  }

  _updateSortBadge(sortMode = this.sortMode) {
    const sortBadge = document.getElementById('sort-badge');
    if (!sortBadge) return;
    sortBadge.textContent = `sort: ${SORT_MODE_LABELS[sortMode] || sortMode}`;
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

  _updateStatusLine(selected, activeScope) {
    const statusLine = document.getElementById('status-line');
    if (!statusLine) return;

    const scope = activeScope.label;
    if (!selected) {
      statusLine.textContent = `0 rows / scope ${scope}`;
      return;
    }

    const query = this.currentQuery.trim();
    const queryPart = query ? ` / ${query}` : '';
    statusLine.textContent = `${this.visibleBookmarks.length} rows / scope ${scope}${queryPart} / ${selected.title} / ${selected.domain}`;
  }

  _setActionState(isEnabled) {
    ['action-open', 'action-background', 'action-copy', 'action-edit', 'action-delete'].forEach(
      (id) => {
        const button = document.getElementById(id);
        if (button) {
          button.disabled = !isEnabled;
        }
      }
    );
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
      const parsedQuery = this._parseQuery(event.target.value);
      if (!parsedQuery.folder && this._hasGlobalSearch(parsedQuery)) {
        this.activeFolderMode = 'all';
        this.activeFolderPath = '';
      }
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

    document
      .getElementById('new-bookmark-btn')
      ?.addEventListener('click', () => this.createBookmark());
    document.getElementById('new-folder-btn')?.addEventListener('click', () => this.createFolder());

    const folderSearchInput = document.getElementById('folder-search');
    folderSearchInput?.addEventListener('input', (event) => {
      this.folderSearchQuery = event.target.value;
      this.render(this.currentQuery);
    });
    folderSearchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.folderSearchQuery = '';
        folderSearchInput.value = '';
        this.render(this.currentQuery);
      }
    });

    document.getElementById('action-open')?.addEventListener('click', () => this.openSelected());
    document
      .getElementById('action-background')
      ?.addEventListener('click', () => this.openSelectedInBackground());
    document.getElementById('action-copy')?.addEventListener('click', () => this.copySelectedUrl());
    document.getElementById('action-edit')?.addEventListener('click', () => this.editSelected());
    document
      .getElementById('action-delete')
      ?.addEventListener('click', () => this.deleteSelected());
    document.addEventListener('pointerdown', (event) => {
      if (
        this.contextMenuEl &&
        event.target instanceof Node &&
        !this.contextMenuEl.contains(event.target)
      ) {
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

      if (event.key.toLowerCase() === 'y' && !this._isTypingContext(event.target)) {
        event.preventDefault();
        this.copySelectedUrl();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        this._focusSearch();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        this.createBookmark();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        this.navigate(1);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
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
        this.openSelected({ useDefaultBehavior: true });
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'd' &&
        this.selectedBookmarkId
      ) {
        event.preventDefault();
        this.deleteSelected();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'e' &&
        this.selectedBookmarkId
      ) {
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
      if (options.useDefaultBehavior) {
        await this.openBookmarkWithDefaultBehavior(bookmark.id);
        return;
      }

      await this.openBookmark(bookmark.id, { active: true, closeCurrentTab: false });
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
      active:
        typeof options.active === 'boolean' ? options.active : !this.settings.openInBackground,
    });

    await this._recordBookmarkOpen(id);

    if (options.closeCurrentTab) {
      await this._closeCurrentTab();
    }
  }

  async openBookmarkInBackgroundTab(id) {
    await this.openBookmark(id, { active: false });
  }

  async openBookmarkWithDefaultBehavior(id) {
    const openInBackground = Boolean(this.settings.openInBackground);
    await this.openBookmark(id, {
      active: !openInBackground,
      closeCurrentTab: !openInBackground && Boolean(this.settings.closeOnEnterOpen),
    });
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

  async createFolder(options = {}) {
    this._closeContextMenu();
    await this._openFolderCreateDialog({
      preferredParentId: options.parentId || null,
      initialPath:
        options.initialPath ||
        (this.activeFolderMode === 'folder' ? this.activeFolderPath : '') ||
        '',
      basePath: options.basePath || '',
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
      const hasSelectedFolder = filteredFolders.some(
        (folder) => String(folder.id) === String(selectedParentId)
      );
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

  async _openFolderCreateDialog({
    preferredParentId = null,
    initialPath = '',
    basePath = '',
  } = {}) {
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
    heading.textContent = 'New Folder';

    const form = document.createElement('form');
    form.className = 'modal-form';

    const pathGroup = this._createField('Folder path');
    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.name = 'folderPath';
    pathInput.autocomplete = 'off';
    pathInput.placeholder = 'research / refs';
    pathInput.value = initialPath;
    pathGroup.appendChild(pathInput);

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
    saveBtn.textContent = 'Create';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(pathGroup);
    form.appendChild(errorMessage);
    form.appendChild(actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const folderPath = this._formatFolderPath(pathInput.value);
      if (!folderPath) {
        errorMessage.textContent = 'Folder path is required.';
        return;
      }

      try {
        await this.bookmarks.createFolderPath(folderPath, {
          parentId: preferredParentId,
          rootFolderId: this.settings.rootFolderId,
        });
        overlay.remove();
        this.activeFolderMode = 'folder';
        this.activeFolderPath = this._formatFolderPath(
          basePath ? `${basePath} / ${folderPath}` : folderPath
        );
        for (const path of this._getParentFolderPaths(this.activeFolderPath)) {
          this.expandedFolderPaths.add(this._normalize(path));
        }
        await this._reloadBookmarks();
      } catch {
        errorMessage.textContent = 'Could not create folder.';
      }
    });

    modal.appendChild(heading);
    modal.appendChild(form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    pathInput.focus();
    pathInput.select();
  }

  _getParentFolderPaths(path) {
    const parts = this._formatFolderPath(path).split(' / ').filter(Boolean);
    const paths = [];
    let current = '';
    for (const part of parts) {
      current = current ? `${current} / ${part}` : part;
      paths.push(current);
    }
    return paths;
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
          label: 'New folder here',
          action: async () => {
            await this.createFolder({
              parentId: folder.id,
              initialPath: '',
              basePath: folder.name,
            });
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

export class BookmarksService {
  constructor() {
    this.bookmarks = [];
    this.folders = new Map();
    this.allBookmarks = [];
    this.allFolders = new Map();
    this.allRootBookmarks = [];
    this.rootFolderName = null;
    this.rootBookmarks = [];
    this.hasRootFilter = false;
    this.sequence = 0;
  }

  async load() {
    const tree = await chrome.bookmarks.getTree();
    this.fullTree = tree[0];
    this.sequence = 0;
    this.bookmarks = [];
    this.folders = new Map();
    this.rootBookmarks = [];
    this.rootFolderName = null;
    this.hasRootFilter = false;
    this.parseTree(tree[0].children || [], []);
    this.allBookmarks = [...this.bookmarks];
    this.allFolders = new Map(this.folders);
    this.allRootBookmarks = [...this.rootBookmarks];
    return this;
  }

  parseTree(nodes, parentPath) {
    for (const node of nodes) {
      if (node.url) {
        const folderKey = parentPath.join(' / ');
        const bookmark = this._createBookmarkRecord(node, parentPath, folderKey);
        this.bookmarks.push(bookmark);

        if (parentPath.length === 0) {
          this.rootBookmarks.push(bookmark);
          continue;
        }

        if (!this.folders.has(folderKey)) {
          this.folders.set(folderKey, []);
        }
        this.folders.get(folderKey).push(bookmark);
      } else if (node.children) {
        const folderKey = [...parentPath, node.title || 'Untitled'].join(' / ');
        if (folderKey && !this.folders.has(folderKey)) {
          this.folders.set(folderKey, []);
        }
        this.parseTree(node.children, [...parentPath, node.title || 'Untitled']);
      }
    }
  }

  _createBookmarkRecord(node, parentPath, folderKey) {
    const domain = this.extractDomain(node.url);
    const origin = this.extractOrigin(node.url);

    return {
      id: node.id,
      parentId: node.parentId || null,
      title: node.title,
      url: node.url,
      domain,
      origin,
      parentPath: [...parentPath],
      folderKey,
      pathText: folderKey || 'Root',
      order: this.sequence++,
    };
  }

  getFolderTree(rootId = null) {
    const folders = [];
    const traverse = (node, depth = 0, parentPath = []) => {
      if (!node || node.url || !node.children) {
        return;
      }

      const title = node.title || 'Untitled';
      const nextPath = [...parentPath, title];
      folders.push({
        id: node.id,
        title,
        depth,
        path: nextPath.join(' / '),
      });

      for (const child of node.children) {
        if (!child.url) {
          traverse(child, depth + 1, nextPath);
        }
      }
    };

    const startNodes = rootId
      ? [this.getNodeById(rootId)].filter(Boolean)
      : this.fullTree?.children?.filter((child) => !child.url) || [];

    for (const node of startNodes) {
      traverse(node, 0, []);
    }

    return folders;
  }

  getNodeById(id, node = this.fullTree) {
    if (!node) return null;
    if (node.id === id) return node;

    for (const child of node.children || []) {
      const found = this.getNodeById(id, child);
      if (found) {
        return found;
      }
    }

    return null;
  }

  filterByRoot(rootId) {
    function findNode(node, id) {
      if (node.id === id) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child, id);
          if (found) return found;
        }
      }
      return null;
    }

    const rootNode = findNode(this.fullTree, rootId);
    if (!rootNode) return;

    this.rootFolderName = rootNode.title || 'Root';
    this.bookmarks = [];
    this.folders = new Map();
    this.rootBookmarks = [];
    this.hasRootFilter = true;
    const children = rootNode.children || [];
    this._parseTreeFiltered(children);
  }

  _parseTreeFiltered(nodes) {
    for (const node of nodes) {
      if (node.url) {
        const bookmark = this._createBookmarkRecord(node, [], '');
        this.bookmarks.push(bookmark);
        this.rootBookmarks.push(bookmark);
      } else if (node.children) {
        const folderKey = node.title || 'Untitled';
        if (folderKey && !this.folders.has(folderKey)) {
          this.folders.set(folderKey, []);
        }
        this.parseTree(node.children, [node.title || 'Untitled']);
      }
    }
  }

  resetFilter() {
    this.bookmarks = [...this.allBookmarks];
    this.folders = new Map(this.allFolders);
    this.rootBookmarks = [...this.allRootBookmarks];
    this.hasRootFilter = false;
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  extractOrigin(url) {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  }

  search(query, options = {}) {
    const normalizedQuery = query.toLowerCase().trim();
    const tokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];
    const sortMode = options.sortMode || 'relevance';
    const activityMap = options.activityMap || {};
    const groups = [];

    const rootMatches = this._filterBookmarks(
      this.rootBookmarks,
      tokens,
      normalizedQuery,
      activityMap
    );
    if (rootMatches.length > 0) {
      groups.push({
        type: 'root',
        bookmarks: this._sortBookmarks(rootMatches, sortMode, normalizedQuery),
      });
    }

    for (const [folder, bookmarks] of this.folders.entries()) {
      const matched = this._filterBookmarks(bookmarks, tokens, normalizedQuery, activityMap);
      if (matched.length > 0) {
        groups.push({
          type: 'folder',
          id: matched[0]?.parentId || null,
          name: folder,
          pathSegments: folder.split(' / '),
          bookmarks: this._sortBookmarks(matched, sortMode, normalizedQuery),
        });
      }
    }

    return this._sortGroups(groups, sortMode, normalizedQuery);
  }

  _filterBookmarks(bookmarks, tokens, normalizedQuery, activityMap) {
    const records = [];

    for (const bookmark of bookmarks) {
      const record = this._createSearchRecord(
        bookmark,
        tokens,
        normalizedQuery,
        activityMap[bookmark.id]
      );
      if (record) {
        records.push(record);
      }
    }

    return records;
  }

  _createSearchRecord(bookmark, tokens, normalizedQuery, activity = {}) {
    const title = bookmark.title.toLowerCase();
    const domain = bookmark.domain.toLowerCase();
    const url = bookmark.url.toLowerCase();
    const path = bookmark.pathText.toLowerCase();
    const hasQuery = tokens.length > 0;

    if (hasQuery) {
      const allTokensMatch = tokens.every(
        (token) =>
          title.includes(token) ||
          domain.includes(token) ||
          url.includes(token) ||
          path.includes(token)
      );

      if (!allTokensMatch) {
        return null;
      }
    }

    const openCount = Number.isFinite(activity.openCount) ? activity.openCount : 0;
    const lastOpened = Number.isFinite(activity.lastOpened) ? activity.lastOpened : 0;
    const score = this._computeMatchScore(bookmark, normalizedQuery, tokens, openCount, lastOpened);

    return {
      ...bookmark,
      match: {
        score,
        openCount,
        lastOpened,
        titleRanges: this._collectMatchRanges(bookmark.title, tokens),
        domainRanges: this._collectMatchRanges(bookmark.domain, tokens),
      },
    };
  }

  _computeMatchScore(bookmark, normalizedQuery, tokens, openCount, lastOpened) {
    if (!tokens.length) {
      return 0;
    }

    const title = bookmark.title.toLowerCase();
    const domain = bookmark.domain.toLowerCase();
    const url = bookmark.url.toLowerCase();
    const path = bookmark.pathText.toLowerCase();
    let score = 0;

    if (normalizedQuery) {
      if (title === normalizedQuery) score += 400;
      if (domain === normalizedQuery) score += 360;
      if (url === normalizedQuery) score += 320;
      if (title.startsWith(normalizedQuery)) score += 250;
      if (domain.startsWith(normalizedQuery)) score += 210;
      if (url.startsWith(normalizedQuery)) score += 160;
      if (title.includes(normalizedQuery)) score += 140;
      if (domain.includes(normalizedQuery)) score += 100;
      if (url.includes(normalizedQuery)) score += 70;
      if (path.includes(normalizedQuery)) score += 30;
    }

    for (const token of tokens) {
      if (title.includes(token)) score += 42;
      if (domain.includes(token)) score += 28;
      if (url.includes(token)) score += 18;
      if (path.includes(token)) score += 8;
    }

    if (
      title &&
      normalizedQuery &&
      title.replaceAll(' ', '').startsWith(normalizedQuery.replaceAll(' ', ''))
    ) {
      score += 18;
    }

    score += Math.min(openCount * 3, 24);
    if (lastOpened > 0) {
      const ageHours = (Date.now() - lastOpened) / 36e5;
      if (ageHours < 24) score += 16;
      else if (ageHours < 24 * 7) score += 8;
    }

    return score;
  }

  _collectMatchRanges(text, tokens) {
    if (!tokens.length || !text) {
      return [];
    }

    const lowerText = text.toLowerCase();
    const ranges = [];

    for (const token of tokens) {
      let startIndex = 0;
      while (startIndex < lowerText.length) {
        const index = lowerText.indexOf(token, startIndex);
        if (index === -1) break;
        ranges.push([index, index + token.length]);
        startIndex = index + token.length;
      }
    }

    if (ranges.length === 0) {
      return [];
    }

    ranges.sort((a, b) => a[0] - b[0]);
    const mergedRanges = [ranges[0]];

    for (let i = 1; i < ranges.length; i++) {
      const previous = mergedRanges[mergedRanges.length - 1];
      const current = ranges[i];
      if (current[0] <= previous[1]) {
        previous[1] = Math.max(previous[1], current[1]);
      } else {
        mergedRanges.push(current);
      }
    }

    return mergedRanges;
  }

  _sortBookmarks(bookmarks, sortMode, normalizedQuery) {
    return [...bookmarks].sort((left, right) => {
      if (sortMode === 'title') {
        return (
          this._compareText(left.title, right.title) || this._compareText(left.domain, right.domain)
        );
      }

      if (sortMode === 'domain') {
        return (
          this._compareText(left.domain, right.domain) || this._compareText(left.title, right.title)
        );
      }

      if (sortMode === 'recent') {
        return (
          (right.match.lastOpened || 0) - (left.match.lastOpened || 0) ||
          this._compareText(left.title, right.title)
        );
      }

      if (sortMode === 'frequent') {
        return (
          (right.match.openCount || 0) - (left.match.openCount || 0) ||
          this._compareText(left.title, right.title)
        );
      }

      if (normalizedQuery) {
        return right.match.score - left.match.score || this._compareText(left.title, right.title);
      }

      return left.order - right.order;
    });
  }

  _sortGroups(groups, sortMode, normalizedQuery) {
    const compareGroups = (left, right, metric = 0) => {
      if (left.type === 'root' && right.type !== 'root') return -1;
      if (right.type === 'root' && left.type !== 'root') return 1;
      if (metric !== 0) return metric;
      return this._compareFolderPaths(left.name || '', right.name || '');
    };

    if (sortMode === 'title' || sortMode === 'domain') {
      return [...groups].sort((left, right) => compareGroups(left, right));
    }

    if (sortMode === 'recent') {
      return [...groups].sort((left, right) => {
        const leftLastOpened = left.bookmarks[0]?.match.lastOpened || 0;
        const rightLastOpened = right.bookmarks[0]?.match.lastOpened || 0;
        return compareGroups(left, right, rightLastOpened - leftLastOpened);
      });
    }

    if (sortMode === 'frequent') {
      return [...groups].sort((left, right) => {
        const leftOpenCount = left.bookmarks[0]?.match.openCount || 0;
        const rightOpenCount = right.bookmarks[0]?.match.openCount || 0;
        return compareGroups(left, right, rightOpenCount - leftOpenCount);
      });
    }

    if (!normalizedQuery) {
      return [...groups].sort((left, right) => compareGroups(left, right));
    }

    return [...groups].sort((left, right) => {
      const leftScore = left.bookmarks[0]?.match.score || 0;
      const rightScore = right.bookmarks[0]?.match.score || 0;
      return compareGroups(left, right, rightScore - leftScore);
    });
  }

  _compareText(left, right) {
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  }

  _compareFolderPaths(left, right) {
    const leftParts = left ? left.split(' / ') : [];
    const rightParts = right ? right.split(' / ') : [];
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index += 1) {
      const leftPart = leftParts[index];
      const rightPart = rightParts[index];

      if (leftPart == null) return -1;
      if (rightPart == null) return 1;

      const diff = this._compareText(leftPart, rightPart);
      if (diff !== 0) {
        return diff;
      }
    }

    return leftParts.length - rightParts.length;
  }

  async remove(id) {
    await chrome.bookmarks.remove(id);
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.rootBookmarks = this.rootBookmarks.filter((b) => b.id !== id);
    for (const [folder, bookmarks] of this.folders.entries()) {
      this.folders.set(
        folder,
        bookmarks.filter((b) => b.id !== id)
      );
    }
  }

  async update(id, updates) {
    await chrome.bookmarks.update(id, updates);
    const bookmark = this.bookmarks.find((b) => b.id === id);
    if (bookmark) {
      Object.assign(bookmark, updates);
      if (updates.url) {
        bookmark.domain = this.extractDomain(updates.url);
        bookmark.origin = this.extractOrigin(updates.url);
      }
      if (updates.title || updates.url) {
        bookmark.folderKey = bookmark.parentPath.join(' / ');
        bookmark.pathText = bookmark.folderKey || 'Root';
      }
    }
  }

  getDefaultCreateParentId(preferredParentId = null, rootFolderId = null) {
    if (preferredParentId) return preferredParentId;
    if (rootFolderId) return rootFolderId;
    return this.fullTree?.children?.[0]?.id || this.fullTree?.id || null;
  }

  async create({ title, url, parentId }) {
    return chrome.bookmarks.create({ title, url, parentId });
  }

  async createFolderPath(path, options = {}) {
    const parts = String(path || '')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    if (!parts.length) {
      return null;
    }

    let parentId = this.getDefaultCreateParentId(
      options.parentId || null,
      options.rootFolderId || null
    );
    let parentNode = this.getNodeById(parentId);
    let createdOrExisting = null;

    for (const part of parts) {
      const existing = (parentNode?.children || []).find(
        (child) => !child.url && child.title.toLowerCase() === part.toLowerCase()
      );

      if (existing) {
        createdOrExisting = existing;
        parentId = existing.id;
        parentNode = existing;
        continue;
      }

      createdOrExisting = await chrome.bookmarks.create({ parentId, title: part });
      parentId = createdOrExisting.id;
      parentNode = { ...createdOrExisting, children: [] };
    }

    return createdOrExisting;
  }

  async move(id, parentId) {
    return chrome.bookmarks.move(id, { parentId });
  }

  async updateFolder(id, title) {
    return chrome.bookmarks.update(id, { title });
  }

  async removeFolder(id) {
    return chrome.bookmarks.removeTree(id);
  }
}

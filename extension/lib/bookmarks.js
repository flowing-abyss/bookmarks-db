export class BookmarksService {
  constructor() {
    this.bookmarks = [];
    this.folders = new Map();
    this.allBookmarks = [];
    this.allFolders = new Map();
    this.rootFolderName = null;
    this.rootBookmarks = []; // bookmarks directly in root (no folder header)
    this.hasRootFilter = false;
  }

  async load() {
    const tree = await chrome.bookmarks.getTree();
    this.fullTree = tree[0];
    this.parseTree(tree[0].children || [], []);
    this.allBookmarks = [...this.bookmarks];
    this.allFolders = new Map(this.folders);
    return this;
  }

  parseTree(nodes, parentPath) {
    for (const node of nodes) {
      if (node.url) {
        const domain = this.extractDomain(node.url);
        const bookmark = {
          id: node.id,
          title: node.title,
          url: node.url,
          domain,
          parentPath: [...parentPath],
        };
        this.bookmarks.push(bookmark);

        const folderKey = parentPath.join(' / ') || 'Other';
        if (!this.folders.has(folderKey)) {
          this.folders.set(folderKey, []);
        }
        this.folders.get(folderKey).push(bookmark);
      } else if (node.children && node.children.length > 0) {
        this.parseTree(node.children, [...parentPath, node.title || 'Untitled']);
      }
    }
  }

  getFolderTree() {
    const folders = [];
    function traverse(node, depth = 0, parentPath = []) {
      if (node.children && node.children.length > 0) {
        const hasBookmarks = node.children.some((c) => c.url);
        const hasSubfolders = node.children.some((c) => c.children);
        if (hasBookmarks || hasSubfolders) {
          folders.push({
            id: node.id,
            title: node.title || 'Untitled',
            depth,
            path: [...parentPath, node.title || 'Untitled'].join(' / '),
          });
        }
        for (const child of node.children) {
          if (!child.url) {
            traverse(child, depth + 1, [...parentPath, node.title || 'Untitled']);
          }
        }
      }
    }
    if (this.fullTree) {
      traverse(this.fullTree);
    }
    return folders;
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
        const domain = this.extractDomain(node.url);
        const bookmark = {
          id: node.id,
          title: node.title,
          url: node.url,
          domain,
          parentPath: [],
        };
        this.bookmarks.push(bookmark);
        this.rootBookmarks.push(bookmark);
      } else if (node.children && node.children.length > 0) {
        this.parseTree(node.children, [node.title || 'Untitled']);
      }
    }
  }

  resetFilter() {
    this.bookmarks = [...this.allBookmarks];
    this.folders = new Map(this.allFolders);
    this.rootBookmarks = [];
    this.hasRootFilter = false;
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  _filterBookmarks(bookmarks, q) {
    if (!q) return bookmarks;
    return bookmarks.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.domain.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q)
    );
  }

  // Returns array of { type: 'root' | 'folder', name?, bookmarks[] }
  search(query) {
    const q = query.toLowerCase().trim();
    const results = [];

    // Root bookmarks (no folder header)
    let rootBm = this._filterBookmarks(this.rootBookmarks, q);
    if (rootBm.length > 0) {
      results.push({ type: 'root', bookmarks: rootBm });
    }

    // Subfolder bookmarks (with folder header)
    for (const [folder, bookmarks] of this.folders.entries()) {
      const matched = this._filterBookmarks(bookmarks, q);
      if (matched.length > 0) {
        results.push({ type: 'folder', name: folder, bookmarks: matched });
      }
    }

    return results;
  }

  async remove(id) {
    await chrome.bookmarks.remove(id);
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.rootBookmarks = this.rootBookmarks.filter((b) => b.id !== id);
    for (const [folder, bookmarks] of this.folders.entries()) {
      this.folders.set(folder, bookmarks.filter((b) => b.id !== id));
    }
  }

  async update(id, updates) {
    await chrome.bookmarks.update(id, updates);
    const bookmark = this.bookmarks.find((b) => b.id === id);
    if (bookmark) {
      Object.assign(bookmark, updates);
      if (updates.url) {
        bookmark.domain = this.extractDomain(updates.url);
      }
    }
  }
}
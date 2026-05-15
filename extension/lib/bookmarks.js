export class BookmarksService {
  constructor() {
    this.bookmarks = [];
    this.folders = new Map();
    this.allBookmarks = [];
    this.allFolders = new Map();
    this.rootFolderName = null;
    this.rootBookmarks = []; // bookmarks directly in root (not grouped)
  }

  async load() {
    const tree = await chrome.bookmarks.getTree();
    // Save full tree for root folder selection
    this.fullTree = tree[0];
    this.parseTree(tree[0].children || [], []);
    // Save copies of all bookmarks
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
    // Build a flat list of all folders with their IDs for the settings dropdown
    const folders = [];
    function traverse(node, depth = 0, parentPath = []) {
      if (node.children && node.children.length > 0) {
        // Only add folders that have bookmark children or subfolders
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

    const rootName = rootNode.title || 'Root';
    this.rootFolderName = rootName;
    this.bookmarks = [];
    this.folders = new Map();
    this.rootBookmarks = [];
    const children = rootNode.children || [];
    this._parseTreeFiltered(children);
  }

  // Like parseTree but: direct bookmarks go to rootBookmarks, subfolders grouped normally
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
        // Direct bookmarks in root — no folder grouping
        this.rootBookmarks.push(bookmark);
      } else if (node.children && node.children.length > 0) {
        // Subfolders use their own name
        this.parseTree(node.children, [node.title || 'Untitled']);
      }
    }
  }

  resetFilter() {
    this.bookmarks = [...this.allBookmarks];
    this.folders = new Map(this.allFolders);
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  search(query) {
    const q = query.toLowerCase().trim();
    const hasFilter = !!q;
    const results = [];

    // Root bookmarks first (no folder grouping)
    let rootBm = this.rootBookmarks;
    if (hasFilter) {
      rootBm = rootBm.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.domain.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q)
      );
    }
    if (rootBm.length > 0) {
      results.push([this.rootFolderName || 'Bookmarks', rootBm]);
    }

    // Then subfolder bookmarks
    const folderEntries = Array.from(this.folders.entries());
    for (const [folder, bookmarks] of folderEntries) {
      let matched = bookmarks;
      if (hasFilter) {
        matched = bookmarks.filter(b =>
          b.title.toLowerCase().includes(q) ||
          b.domain.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q)
        );
      }
      if (matched.length > 0) {
        results.push([folder, matched]);
      }
    }

    return results;
  }

  async remove(id) {
    await chrome.bookmarks.remove(id);
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
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
      }
    }
  }
}

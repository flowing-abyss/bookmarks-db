export class BookmarksService {
  constructor() {
    this.bookmarks = [];
    this.folders = new Map();
  }

  async load() {
    const tree = await chrome.bookmarks.getTree();
    this.parseTree(tree[0].children || [], []);
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
          parentPath: [...parentPath]
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

  extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  search(query) {
    const q = query.toLowerCase().trim();
    if (!q) return Array.from(this.folders.entries());
    
    const filtered = new Map();
    for (const [folder, bookmarks] of this.folders.entries()) {
      const matched = bookmarks.filter(b => 
        b.title.toLowerCase().includes(q) || 
        b.domain.toLowerCase().includes(q)
      );
      if (matched.length > 0) {
        filtered.set(folder, matched);
      }
    }
    return Array.from(filtered.entries());
  }

  async remove(id) {
    await chrome.bookmarks.remove(id);
    this.bookmarks = this.bookmarks.filter(b => b.id !== id);
    for (const [folder, bookmarks] of this.folders.entries()) {
      this.folders.set(folder, bookmarks.filter(b => b.id !== id));
    }
  }

  async update(id, updates) {
    await chrome.bookmarks.update(id, updates);
    const bookmark = this.bookmarks.find(b => b.id === id);
    if (bookmark) {
      Object.assign(bookmark, updates);
      if (updates.url) {
        bookmark.domain = this.extractDomain(updates.url);
      }
    }
  }
}

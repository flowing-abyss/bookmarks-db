# Bookmarks DB

`Bookmarks DB` is a new-tab replacement for working with large bookmark collections as a compact searchable data grid.

It is built for keyboard-heavy use, but mouse actions, context menus, folder management, and inline editing are also supported.

## Features

- Replaces the new tab page with a searchable bookmarks index
- Fast filtering across bookmark title, domain, URL, and folder path
- Search result ranking with `Relevance`, `Title`, `Domain`, `Recent`, and `Frequent` sort modes
- Built-in favicon loading with caching to avoid repeated external favicon requests
- Collapsible folder groups with strict table-style layout
- Bottom action bar for open, background open, copy URL, edit, and delete
- Context menu on bookmarks:
  `Edit bookmark`, `Delete bookmark`
- Context menu on folders:
  `Rename folder`, `New bookmark here`, `Delete folder`
- Create and edit bookmark modals with:
  `Title`, `URL`, `Folder`, folder search
- Activity tracking for recent/frequent sorting
- Theme settings for `Base16 Dark`, `Base16 Light`, or `Follow System`
- Optional root-folder scoping
- Optional behavior to close the `Bookmarks DB` tab after a normal `Enter` open

## Installation

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the [extension](./extension) folder
5. Open a new tab

If you change extension files later, click `Reload` in `chrome://extensions/`.

## Usage

### Search and navigation

- Start typing to filter bookmarks
- `/` focuses the search field
- `⌘J` / `Ctrl+J` moves down
- `⌘K` / `Ctrl+K` moves up
- `ArrowUp` / `ArrowDown` also navigate visible rows
- Navigation is cyclic: moving past the last row jumps to the first, and vice versa

### Opening bookmarks

- `Enter` opens the selected bookmark in a focused tab
- `⌘Enter` / `Ctrl+Enter` opens the selected bookmark in a background tab
- Left click behaves like `Enter`
- Middle click opens a background tab

### Editing bookmarks

- `⌘E` / `Ctrl+E` edits the selected bookmark
- `⌘D` / `Ctrl+D` deletes the selected bookmark
- Right click on a bookmark opens its context menu

### Creating bookmarks

- `N` opens the `New Bookmark` dialog inside the page
- The `New Bookmark` button does the same
- Right click on a folder and choose `New bookmark here` to preselect that folder

Note:
The browser may reserve `⌘N` / `Ctrl+N` before the page can intercept it, so the reliable in-page shortcut is `N`.

## Settings

Open settings in either of these ways:

1. Click `Configure` inside the new-tab page
2. Open `chrome://extensions/` and use the extension `Options`

Available settings:

- `Theme Palette`
  `Base16 Dark`, `Base16 Light`, `Follow System`
- `Root Folder`
  Restricts the visible bookmark index to one subtree
- `Open bookmarks in background tab`
  Default behavior for generic background-opening actions
- `Close Bookmarks DB tab after Enter opens a bookmark`
  Applies only to normal `Enter`-style opens, not background opens

## Development

### Scripts

- `npm run lint`
- `npm run lint:fix`
- `npm run format`
- `npm run format:check`
- `npm run knip`
- `npm run typecheck`

### Notes

- `npm run lint` should pass
- `npm run typecheck` currently reports existing project-wide issues and is not yet clean

## Permissions

The extension uses these permissions:

- `bookmarks`
  Read, create, update, move, and delete bookmarks and folders
- `favicon`
  Load site favicons through the built-in favicon service
- `storage`
  Persist settings and bookmark activity
- `tabs`
  Open bookmarks in foreground/background tabs and optionally close the current `Bookmarks DB` tab

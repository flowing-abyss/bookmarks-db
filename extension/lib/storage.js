const DEFAULTS = {
  bgColor: '#181818',
  themeMode: null,
  sortMode: 'relevance',
  openInBackground: true,
  closeOnEnterOpen: false,
  rootFolderId: null,
};

const ACTIVITY_DEFAULTS = {
  bookmarkActivity: {},
};

export async function loadSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

export async function saveSettings(settings) {
  return chrome.storage.sync.set(settings);
}

export async function loadBookmarkActivity() {
  const { bookmarkActivity } = await chrome.storage.local.get(ACTIVITY_DEFAULTS);
  return bookmarkActivity;
}

export async function saveBookmarkActivity(bookmarkActivity) {
  return chrome.storage.local.set({ bookmarkActivity });
}

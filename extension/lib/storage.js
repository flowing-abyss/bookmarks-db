const DEFAULTS = {
  bgColor: '#1a1a2e',
  openInBackground: true
};

export async function loadSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

export async function saveSettings(settings) {
  return chrome.storage.sync.set(settings);
}

const DEFAULTS = {
  bgColor: '#1a1a2e',
  openInNewTab: false
};

export async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (settings) => {
      resolve(settings);
    });
  });
}

export async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, resolve);
  });
}

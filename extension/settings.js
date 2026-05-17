import { loadSettings, saveSettings } from './lib/storage.js';
import { computeColorScheme, resolveThemeMode } from './lib/colors.js';
import { BookmarksService } from './lib/bookmarks.js';

const DEFAULTS = {
  bgColor: '#181818',
  themeMode: 'dark',
  sortMode: 'relevance',
  openInBackground: true,
  closeOnEnterOpen: false,
  rootFolderId: null,
};

async function init() {
  const settings = await loadSettings();

  const themeModeInput = document.getElementById('theme-mode');
  const openBehaviorInput = document.getElementById('open-behavior');
  const rootFolderSelect = document.getElementById('root-folder');

  // Load bookmarks to populate folder dropdown
  const bookmarksService = new BookmarksService();
  await bookmarksService.load();
  const folders = bookmarksService.getFolderTree();

  // Populate dropdown
  folders.forEach((folder) => {
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = '  '.repeat(folder.depth) + '📁 ' + folder.title;
    rootFolderSelect.appendChild(option);
  });

  // Apply settings
  themeModeInput.value =
    settings.themeMode || resolveThemeMode(settings.themeMode, settings.bgColor);
  openBehaviorInput.value = settings.openInBackground ? 'background' : 'open-close';
  if (settings.rootFolderId) {
    rootFolderSelect.value = settings.rootFolderId;
  }
  updatePreview(themeModeInput.value, settings.bgColor);

  themeModeInput.addEventListener('change', (e) => {
    updatePreview(e.target.value, settings.bgColor);
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const shouldOpenInBackground = openBehaviorInput.value === 'background';
    await saveSettings({
      bgColor: settings.bgColor,
      themeMode: themeModeInput.value,
      openInBackground: shouldOpenInBackground,
      closeOnEnterOpen: !shouldOpenInBackground,
      rootFolderId: rootFolderSelect.value || null,
    });
    alert('Settings saved!');
  });

  document.getElementById('reset-settings').addEventListener('click', async () => {
    await saveSettings(DEFAULTS);
    themeModeInput.value = DEFAULTS.themeMode;
    openBehaviorInput.value = DEFAULTS.openInBackground ? 'background' : 'open-close';
    rootFolderSelect.value = '';
    updatePreview(DEFAULTS.themeMode, DEFAULTS.bgColor);
    alert('Settings reset to defaults');
  });

  function updatePreview(themeMode, bgColor) {
    const colors = computeColorScheme(themeMode, bgColor);
    for (const [prop, value] of Object.entries(colors)) {
      document.documentElement.style.setProperty(prop, value);
    }
  }
}

init();

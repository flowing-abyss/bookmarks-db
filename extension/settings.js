import { loadSettings, saveSettings } from './lib/storage.js';
import { computeColorScheme } from './lib/colors.js';
import { BookmarksService } from './lib/bookmarks.js';

const DEFAULTS = {
  bgColor: '#1a1a2e',
  openInBackground: true,
  rootFolderId: null,
};

async function init() {
  const settings = await loadSettings();

  const bgColorInput = document.getElementById('bg-color');
  const colorPreview = document.getElementById('color-preview');
  const openInBackgroundInput = document.getElementById('open-in-new-tab');
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
  bgColorInput.value = settings.bgColor;
  openInBackgroundInput.checked = settings.openInBackground;
  if (settings.rootFolderId) {
    rootFolderSelect.value = settings.rootFolderId;
  }
  updatePreview(settings.bgColor);

  bgColorInput.addEventListener('input', (e) => {
    updatePreview(e.target.value);
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    await saveSettings({
      bgColor: bgColorInput.value,
      openInBackground: openInBackgroundInput.checked,
      rootFolderId: rootFolderSelect.value || null,
    });
    alert('Settings saved!');
  });

  document.getElementById('reset-settings').addEventListener('click', async () => {
    await saveSettings(DEFAULTS);
    bgColorInput.value = DEFAULTS.bgColor;
    openInBackgroundInput.checked = DEFAULTS.openInBackground;
    rootFolderSelect.value = '';
    updatePreview(DEFAULTS.bgColor);
    alert('Settings reset to defaults');
  });

  function updatePreview(color) {
    colorPreview.style.background = color;
    const colors = computeColorScheme(color);
    document.documentElement.style.setProperty('--bg', colors['--bg']);
    document.documentElement.style.setProperty('--text', colors['--text']);
  }
}

init();

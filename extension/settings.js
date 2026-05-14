import { loadSettings, saveSettings } from './lib/storage.js';
import { computeColorScheme } from './lib/colors.js';

const DEFAULTS = {
  bgColor: '#1a1a2e',
  openInBackground: true
};

async function init() {
  const settings = await loadSettings();
  
  const bgColorInput = document.getElementById('bg-color');
  const colorPreview = document.getElementById('color-preview');
  const openInBackgroundInput = document.getElementById('open-in-new-tab');
  
  bgColorInput.value = settings.bgColor;
  openInBackgroundInput.checked = settings.openInBackground;
  updatePreview(settings.bgColor);
  
  bgColorInput.addEventListener('input', (e) => {
    updatePreview(e.target.value);
  });
  
  document.getElementById('save-settings').addEventListener('click', async () => {
    await saveSettings({
      bgColor: bgColorInput.value,
      openInBackground: openInBackgroundInput.checked
    });
    alert('Settings saved!');
  });
  
  document.getElementById('reset-settings').addEventListener('click', async () => {
    await saveSettings(DEFAULTS);
    bgColorInput.value = DEFAULTS.bgColor;
    openInBackgroundInput.checked = DEFAULTS.openInBackground;
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

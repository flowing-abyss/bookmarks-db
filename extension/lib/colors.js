const DARK_THEME = {
  '--bg': '#181818',
  '--bg-accent': '#282828',
  '--surface': '#181818',
  '--surface-strong': '#282828',
  '--surface-soft': '#282828',
  '--text': '#d8d8d8',
  '--text-secondary': '#b8b8b8',
  '--text-muted': '#585858',
  '--border': '#383838',
  '--border-strong': '#585858',
  '--hover': 'rgba(56, 56, 56, 0.72)',
  '--focus': '#7cafc2',
  '--focus-soft': 'rgba(124, 175, 194, 0.22)',
  '--shadow': '0 18px 48px rgba(0, 0, 0, 0.36)',
  '--grid-line': 'rgba(40, 40, 40, 0.42)',
  '--page-gradient-start': '#181818',
  '--page-gradient-end': '#181818',
  '--panel-overlay': 'linear-gradient(180deg, rgba(40, 40, 40, 0.42) 0%, rgba(24, 24, 24, 0) 100%)',
  '--table-header-overlay':
    'linear-gradient(180deg, rgba(124, 175, 194, 0.12) 0%, rgba(40, 40, 40, 0) 100%)',
  '--chip-bg': '#282828',
  '--selection-fill':
    'linear-gradient(90deg, rgba(124, 175, 194, 0.18) 0%, rgba(40, 40, 40, 0.18) 100%)',
};

const LIGHT_THEME = {
  '--bg': '#f8f8f8',
  '--bg-accent': '#e8e8e8',
  '--surface': '#f8f8f8',
  '--surface-strong': '#e8e8e8',
  '--surface-soft': '#e8e8e8',
  '--text': '#383838',
  '--text-secondary': '#585858',
  '--text-muted': '#b8b8b8',
  '--border': '#d8d8d8',
  '--border-strong': '#b8b8b8',
  '--hover': 'rgba(216, 216, 216, 0.82)',
  '--focus': '#7cafc2',
  '--focus-soft': 'rgba(124, 175, 194, 0.18)',
  '--shadow': '0 18px 48px rgba(56, 56, 56, 0.08)',
  '--grid-line': 'rgba(216, 216, 216, 0.72)',
  '--page-gradient-start': '#f8f8f8',
  '--page-gradient-end': '#f8f8f8',
  '--panel-overlay':
    'linear-gradient(180deg, rgba(232, 232, 232, 0.76) 0%, rgba(248, 248, 248, 0) 100%)',
  '--table-header-overlay':
    'linear-gradient(180deg, rgba(124, 175, 194, 0.14) 0%, rgba(232, 232, 232, 0.1) 100%)',
  '--chip-bg': '#e8e8e8',
  '--selection-fill':
    'linear-gradient(90deg, rgba(124, 175, 194, 0.16) 0%, rgba(232, 232, 232, 0.3) 100%)',
};

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 24, g: 24, b: 24 };
}

export function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
}

export function lighten(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * (percent / 100),
    g + (255 - g) * (percent / 100),
    b + (255 - b) * (percent / 100)
  );
}

export function darken(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - percent / 100), g * (1 - percent / 100), b * (1 - percent / 100));
}

export function getContrastColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

export function blend(hex1, hex2, percent) {
  const { r: r1, g: g1, b: b1 } = hexToRgb(hex1);
  const { r: r2, g: g2, b: b2 } = hexToRgb(hex2);
  return rgbToHex(
    r1 + (r2 - r1) * (percent / 100),
    g1 + (g2 - g1) * (percent / 100),
    b1 + (b2 - b1) * (percent / 100)
  );
}

export function resolveThemeMode(themeMode, legacyBgColor = '#181818') {
  if (themeMode === 'dark' || themeMode === 'light') {
    return themeMode;
  }

  if (
    themeMode === 'auto' &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return getContrastColor(legacyBgColor) === '#ffffff' ? 'dark' : 'light';
}

export function computeColorScheme(themeMode = 'dark', legacyBgColor = '#181818') {
  const resolvedThemeMode = resolveThemeMode(themeMode, legacyBgColor);
  return resolvedThemeMode === 'light' ? LIGHT_THEME : DARK_THEME;
}

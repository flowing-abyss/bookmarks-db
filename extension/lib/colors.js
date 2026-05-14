export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 26, g: 26, b: 46 };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
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
  return rgbToHex(
    r * (1 - percent / 100),
    g * (1 - percent / 100),
    b * (1 - percent / 100)
  );
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

export function computeColorScheme(bgColor) {
  const isDark = getContrastColor(bgColor) === '#ffffff';
  const surface = isDark ? lighten(bgColor, 8) : darken(bgColor, 3);
  const text = getContrastColor(bgColor);
  const textSecondary = blend(bgColor, text, 60);
  const border = blend(bgColor, text, 20);
  const hover = blend(bgColor, text, 6);
  const focus = blend(bgColor, '#5dabf7', 30);
  
  return {
    '--bg': bgColor,
    '--surface': surface,
    '--text': text,
    '--text-secondary': textSecondary,
    '--border': border,
    '--hover': hover,
    '--focus': focus
  };
}

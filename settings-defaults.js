const DEFAULT_SETTINGS = {
  blackHoleSize: 0.11,
  diskColor: '#ffae24',
};

const BASE_WINDOW_SIZE = 280;
const SIZE_GLOW_MARGIN = 1.12;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function diskPaletteFromColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return {
    hot: [mix(r, 1, 0.42), mix(g, 1, 0.38), mix(b, 1, 0.32)],
    warm: [r, g, b],
    cool: [1, mix(g, 0.18, 0.55), mix(b, 0.06, 0.65)],
  };
}

function getPetWindowSize(blackHoleSize) {
  const ratio = blackHoleSize / DEFAULT_SETTINGS.blackHoleSize;
  return Math.round(BASE_WINDOW_SIZE * ratio * SIZE_GLOW_MARGIN);
}

function settingsToRenderPayload(settings) {
  const palette = diskPaletteFromColor(settings.diskColor);
  return {
    blackHoleSize: settings.blackHoleSize,
    viewRef: BASE_WINDOW_SIZE,
    diskHot: palette.hot,
    diskWarm: palette.warm,
    diskCool: palette.cool,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  BASE_WINDOW_SIZE,
  getPetWindowSize,
  diskPaletteFromColor,
  settingsToRenderPayload,
};

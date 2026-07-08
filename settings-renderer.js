const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const diskColor = document.getElementById('diskColor');
const closeBtn = document.getElementById('closeBtn');

let defaults = null;
let applying = false;

function formatSize(v) {
  return Number(v).toFixed(3);
}

function applyUi(settings) {
  applying = true;
  sizeSlider.value = settings.blackHoleSize;
  sizeValue.textContent = formatSize(settings.blackHoleSize);
  diskColor.value = settings.diskColor;
  applying = false;
}

async function init() {
  if (!window.cosmicSettings) return;
  const [settings, defs] = await Promise.all([
    window.cosmicSettings.getSettings(),
    window.cosmicSettings.getDefaults(),
  ]);
  defaults = defs;
  applyUi(settings);
}

sizeSlider.addEventListener('input', async () => {
  if (applying || !window.cosmicSettings) return;
  const value = Number(sizeSlider.value);
  sizeValue.textContent = formatSize(value);
  await window.cosmicSettings.setSetting('blackHoleSize', value);
});

diskColor.addEventListener('input', async () => {
  if (applying || !window.cosmicSettings) return;
  await window.cosmicSettings.setSetting('diskColor', diskColor.value);
});

document.querySelectorAll('[data-reset]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!window.cosmicSettings) return;
    const key = btn.dataset.reset;
    const settings = await window.cosmicSettings.resetSetting(key);
    applyUi(settings);
  });
});

closeBtn.addEventListener('click', () => {
  window.cosmicSettings?.closeWindow();
});

init();

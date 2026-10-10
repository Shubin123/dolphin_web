// Only preference keys belong in a reset. Game/library data lives separately.
export const SETTINGS_STORAGE_KEY = 'dolphin-emulator-settings';
const PREFERENCE_KEYS = [
  SETTINGS_STORAGE_KEY, 'dolphin-auto-profile', 'dolphin-volume', 'dolphin-muted',
  'dolphin-mouse-mode', 'dolphin-controller-mode', 'dolphin-controller-deadzone',
  'dolphin-display-upscaling', 'wasmDolphinAspect', 'wasmDolphinPanelOpen',
  'wasm-dolphin.debug-open', 'wasm-dolphin.osd-visible',
  'dolphin-keyboard-bindings', 'dolphin-touch-look', 'dolphin-touch-controls',
  'dolphin-save-slot', 'dolphin-library-source', 'dolphin-library-search',
  'dolphin-library-region', 'dolphin-library-sort', 'dolphin-library-page-size'
];

export function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key, value) {
  try { localStorage.setItem(key, String(value)); return true; } catch { return false; }
}

export function resetPreferences({ layout = false } = {}) {
  for (const key of [...PREFERENCE_KEYS, ...(layout ? ['dolphin-widget-layout'] : [])]) {
    try { localStorage.removeItem(key); } catch {}
  }
}

export function wireStoredControl(control, key, event = 'change') {
  const saved = readPreference(key);
  if (saved !== null) {
    if (control.type === 'checkbox') {
      if (saved === 'true' || saved === 'false') control.checked = saved === 'true';
    } else if (control.tagName === 'SELECT') {
      if ([...control.options].some(option => option.value === saved)) control.value = saved;
    } else if (control.type === 'range') {
      const value = Number(saved);
      if (saved.trim() && Number.isFinite(value) && value >= Number(control.min) && value <= Number(control.max)) control.value = saved;
    } else control.value = saved;
  }
  control.addEventListener(event, () => writePreference(key, control.type === 'checkbox' ? control.checked : control.value));
}

export function wirePreferences(root = document) {
  for (const [id, key, event] of [
    ['settingAutoProfile', 'dolphin-auto-profile'],
    ['volumeDial', 'dolphin-volume', 'input'],
    ['mouseMode', 'dolphin-mouse-mode'],
    ['controllerSelect', 'dolphin-controller-mode'],
    ['controllerDeadzone', 'dolphin-controller-deadzone', 'input']
  ]) wireStoredControl(root.querySelector(`#${id}`), key, event);
}

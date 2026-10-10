import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, readSettingsFromSearch, restoreSettingsHref, saveSettings } from '../app/src/settings.js';
import { resetPreferences } from '../app/src/preferences.js';

function storage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  return values;
}

test('cached emulator choices restore on new visits while URL overrides and diagnostics are preserved', () => {
  storage();
  assert(saveSettings({ ...DEFAULT_SETTINGS, video: 'ogl', speed: '0.75', wasmjit: '0', jittier: 'guarded', presenter: '2d' }));
  const restored = new URL(restoreSettingsHref('https://example.test/dolphin_web/'));
  assert.equal(readSettingsFromSearch(restored.search).video, 'ogl');
  assert.equal(readSettingsFromSearch(restored.search).speed, '0.75');
  const override = new URL(restoreSettingsHref('https://example.test/dolphin_web/?video=software&wasmjit=2&speed=1&wgpurenderprobe=semantic&custom=keep#game'));
  assert.equal(readSettingsFromSearch(override.search).video, 'software');
  assert.equal(readSettingsFromSearch(override.search).wasmjit, '1');
  assert.equal(readSettingsFromSearch(override.search).jittier, 'mixed');
  assert.equal(readSettingsFromSearch(override.search).speed, '1');
  assert.equal(override.searchParams.get('presenter'), '2d');
  assert.equal(override.searchParams.get('wgpurenderprobe'), 'semantic');
  assert.equal(override.searchParams.get('custom'), 'keep');
  assert.equal(override.hash, '#game');
});

test('corrupt and unavailable preference storage do not prevent startup', () => {
  const values = storage();
  const href = 'https://example.test/dolphin_web/';
  for (const value of ['{broken', '[]', 'null', '{"video":"invalid","speed":500,"presenter":"invalid"}']) {
    values.set('dolphin-emulator-settings', value);
    assert.equal(restoreSettingsHref(href), href);
  }
  globalThis.localStorage = {
    getItem() { throw new Error('Blocked'); },
    setItem() { throw new Error('Quota exceeded'); },
    removeItem() { throw new Error('Blocked'); }
  };
  assert.equal(restoreSettingsHref(href), href);
  assert.equal(saveSettings(DEFAULT_SETTINGS), false);
  assert.doesNotThrow(() => resetPreferences({ layout: true }));
});

test('settings and full resets remove only owned preferences and optionally layout', () => {
  const values = storage();
  values.set('dolphin-widget-layout', 'custom layout');
  values.set('dolphin-emulator-settings', 'custom settings');
  values.set('dolphin-mouse-mode', 'off');
  values.set('unrelated-data', 'keep');
  resetPreferences();
  assert.equal(values.get('dolphin-widget-layout'), 'custom layout');
  assert(!values.has('dolphin-emulator-settings'));
  assert(!values.has('dolphin-mouse-mode'));
  resetPreferences({ layout: true });
  assert.deepEqual([...values], [['unrelated-data', 'keep']]);
});

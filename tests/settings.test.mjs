import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, buildPlayablePresetHref, buildSettingsHref, readSettingsFromSearch, restoreSettingsHref, saveSettings } from '../app/src/settings.js';
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

test('automatic hardware preference is the default and explicit software survives restarts', () => {
  storage();
  assert.equal(readSettingsFromSearch('').video, 'auto');
  assert.equal(readSettingsFromSearch('').pacing, 'auto');
  const preset = new URL(buildPlayablePresetHref('https://example.test/?video=software&pacing=tick'));
  assert.equal(readSettingsFromSearch(preset.search).video, 'auto');
  assert.equal(readSettingsFromSearch(preset.search).pacing, 'auto');
  const software = new URL(buildSettingsHref(preset.href, { ...DEFAULT_SETTINGS, video: 'software' }));
  assert.equal(software.searchParams.get('video'), 'software');
  saveSettings({ ...DEFAULT_SETTINGS, video: 'software' });
  assert.equal(readSettingsFromSearch(new URL(restoreSettingsHref(preset.href)).search).video, 'software');
  saveSettings(DEFAULT_SETTINGS);
  assert.equal(restoreSettingsHref(preset.href), preset.href);
});


test('optimal preset restores adaptive JIT warmup while ordinary settings preserve an explicit override', () => {
  const explicit = 'https://example.test/?jitwarmup=700&forcejit=1&oc=0.5&shortprefix=1&disable=all';
  const ordinary = new URL(buildSettingsHref(explicit, DEFAULT_SETTINGS));
  assert.equal(ordinary.searchParams.get('jitwarmup'), '700');
  assert.equal(ordinary.searchParams.get('shortprefix'), '1');
  const preset = new URL(buildPlayablePresetHref(explicit));
  assert.equal(preset.searchParams.get('jitwarmup'), null);
  assert.equal(preset.searchParams.get('forcejit'), null);
  assert.equal(preset.searchParams.get('oc'), '1');
  assert.equal(preset.searchParams.get('shortprefix'), null);
  assert.equal(preset.searchParams.get('disable'), null);
});

// Save-state slots widget. The backend host owns capture, storage and
// validation; this module only presents slots and routes clicks to it.
const SLOT_COUNT = 4;
const SELECTED_KEY = 'dolphin-save-slot';

function describe(entry) {
  if (!entry?.saved) return 'Empty';
  const parts = [];
  if (entry.savedAt) {
    const date = new Date(entry.savedAt);
    const today = date.toDateString() === new Date().toDateString();
    parts.push(today
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' }));
  } else parts.push('Saved');
  if (entry.size) parts.push(`${(entry.size / 1048576).toFixed(1)} MB`);
  return parts.join(' · ');
}

// Slots are scoped to the mounted game, so its title labels every saved slot.
const gameTitle = game => (game?.name || game?.gameId || '')
  .replace(/\.(iso|gcm|rvz|wbfs|wad|dol|elf|ciso|gcz)$/i, '');

// Modal confirmation. A top-layer <dialog> stays visible in fullscreen.
function createConfirmDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'save-confirm';
  dialog.setAttribute('aria-labelledby', 'saveConfirmTitle');
  dialog.innerHTML = `<form method="dialog">
    <h3 id="saveConfirmTitle"></h3>
    <p data-save-confirm-body></p>
    <div class="save-confirm-actions">
      <button type="submit" value="cancel" data-save-cancel>Cancel</button>
      <button type="submit" value="save" data-save-confirm class="primary">Save</button>
    </div>
  </form>`;
  document.body.append(dialog);
  const title = dialog.querySelector('h3');
  const body = dialog.querySelector('[data-save-confirm-body]');
  const accept = dialog.querySelector('[data-save-confirm]');
  return (heading, message, action) => new Promise(resolve => {
    title.textContent = heading;
    body.textContent = message;
    accept.textContent = action;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'save'), { once: true });
    dialog.showModal();
    accept.focus();
  });
}

export function wireSaveStatePanel({ root, host, onLoaded = () => {}, onStatus = () => {}, onAvailability = () => {}, download, upload, pickUpload }) {
  const list = root.querySelector('[data-save-slots]');
  const status = root.querySelector('[data-save-status]');
  let selected = 0;
  try { selected = Math.min(SLOT_COUNT - 1, Math.max(0, Math.trunc(Number(localStorage.getItem(SELECTED_KEY))) || 0)); } catch {}
  let busy = false;
  let entries = [];
  let entriesGame;
  let refreshVersion = 0;
  const rows = [];
  const confirm = createConfirmDialog();
  const ready = () => host.mode === 'dolphin' && Boolean(host.game?.mounted);
  const report = (message, tone = '') => {
    status.textContent = message;
    status.classList.toggle('error', tone === 'error');
    onStatus(message, tone);
  };

  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const row = document.createElement('li');
    row.className = 'save-slot';
    const pick = document.createElement('label');
    pick.className = 'save-slot-pick';
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'saveSlot'; radio.value = String(slot);
    radio.addEventListener('change', () => select(slot));
    const name = document.createElement('strong');
    name.textContent = `Slot ${slot + 1}`;
    const game = document.createElement('span');
    game.className = 'save-slot-game';
    const meta = document.createElement('span');
    meta.className = 'save-slot-meta';
    pick.append(radio, name, game, meta);
    const save = document.createElement('button');
    save.type = 'button'; save.textContent = 'Save';
    save.setAttribute('aria-label', `Save to slot ${slot + 1}`);
    save.addEventListener('click', () => saveSlot(slot));
    const load = document.createElement('button');
    load.type = 'button'; load.textContent = 'Load';
    load.setAttribute('aria-label', `Load slot ${slot + 1}`);
    load.addEventListener('click', () => loadSlot(slot));
    row.append(pick, save, load);
    list.append(row);
    rows.push({ row, radio, game, meta, save, load });
  }
  root.querySelector('[data-save-download]')?.addEventListener('click', () => downloadFile());
  root.querySelector('[data-save-upload]')?.addEventListener('click', () => pickUpload());

  function select(slot) {
    selected = slot;
    try { localStorage.setItem(SELECTED_KEY, String(slot)); } catch {}
    rows.forEach((entry, index) => {
      entry.radio.checked = index === slot;
      entry.row.classList.toggle('is-selected', index === slot);
    });
    render();
  }

  function render() {
    const mounted = ready();
    root.classList.toggle('is-disabled', !mounted);
    root.setAttribute('aria-busy', String(busy));
    rows.forEach((entry, slot) => {
      const info = entries[slot];
      entry.meta.textContent = mounted ? describe(info) : 'No game';
      entry.game.textContent = mounted && info?.saved ? gameTitle(host.game) : '';
      entry.game.title = entry.game.textContent;
      entry.game.hidden = !entry.game.textContent;
      entry.radio.disabled = busy;
      entry.save.disabled = !mounted || busy;
      entry.load.disabled = !mounted || busy || !info?.saved;
    });
    root.querySelectorAll('.save-state-files button').forEach(button => {
      button.disabled = !mounted || busy;
    });
    onAvailability({ canSave: mounted && !busy, canLoad: mounted && !busy && Boolean(entries[selected]?.saved), busy });
  }

  async function refresh() {
    const version = ++refreshVersion;
    const game = host.game;
    if (game !== entriesGame) {
      entriesGame = game;
      entries = [];
      status.textContent = ready()
        ? 'Choose a slot and Save to keep your progress.'
        : 'Open a game, then save your progress to a slot.';
      status.classList.remove('error');
    }
    render();
    try {
      const updated = ready() ? await host.listStateSlots() : [];
      if (version !== refreshVersion || game !== host.game) return;
      entries = updated;
      render();
    } catch (error) {
      if (version !== refreshVersion || game !== host.game) return;
      entries = [];
      render();
      report(`Could not read saved slots: ${error.message}`, 'error');
    }
  }

  async function guarded(message, operation, successFlag, successMessage, approve) {
    if (busy) return null;
    if (!ready()) {
      report('Open a game before using save states.', 'error');
      return null;
    }
    busy = true;
    render();
    try {
      // Approval runs inside the guard so no other operation can start meanwhile.
      if (approve && !await approve()) {
        report('Save cancelled.');
        return null;
      }
      report(message);
      const result = await operation();
      if (!result?.[successFlag]) throw new Error(result?.error || 'The emulator could not complete the operation');
      report(successMessage(result));
      return result;
    } catch (error) {
      report(`Save state failed: ${error.message}`, 'error');
      return null;
    } finally {
      busy = false;
      await refresh();
    }
  }

  const saveSlot = (slot = selected) => guarded(`Saving to slot ${slot + 1}…`, async () => {
    select(slot);
    return host.saveState(slot);
  }, 'saved', () => `Saved to slot ${slot + 1}. You can close this page and return later.`, () => {
    const info = entries[slot];
    const title = gameTitle(host.game) || 'this game';
    return info?.saved
      ? confirm(`Overwrite slot ${slot + 1}?`,
          `Slot ${slot + 1} already holds ${title} (${describe(info)}). Saving replaces it with your current progress.`, 'Overwrite')
      : confirm(`Save to slot ${slot + 1}?`, `Save your current progress in ${title} to slot ${slot + 1}?`, 'Save');
  });
  const loadSlot = (slot = selected) => guarded(`Loading slot ${slot + 1}…`, async () => {
    select(slot);
    const result = await host.loadState(slot);
    if (result?.loaded) onLoaded(result);
    return result;
  }, 'loaded', () => `Loaded slot ${slot + 1}.`);
  const downloadFile = () => guarded('Preparing save-state download…', download, 'saved', result => `Downloaded ${result.file}.`);
  const uploadFile = file => guarded(`Loading ${file.name}…`, async () => {
    const result = await upload(file);
    if (result?.loaded) onLoaded(result);
    return result;
  }, 'loaded', () => `Loaded ${file.name}. Save to a slot to keep it in this browser.`);

  select(selected);
  refresh();
  return { refresh, save: () => saveSlot(), load: () => loadSlot(), download: downloadFile, upload: uploadFile, get selected() { return selected; } };
}

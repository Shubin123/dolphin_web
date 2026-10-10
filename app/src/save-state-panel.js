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

export function wireSaveStatePanel({ root, host, onLoaded = () => {}, download, upload }) {
  const list = root.querySelector('[data-save-slots]');
  let selected = 0;
  try { selected = Math.min(SLOT_COUNT - 1, Math.max(0, Number(localStorage.getItem(SELECTED_KEY)) || 0)); } catch {}
  let busy = false;
  const rows = [];

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
    const meta = document.createElement('span');
    meta.className = 'save-slot-meta';
    pick.append(radio, name, meta);
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
    rows.push({ row, radio, meta, save, load });
  }
  root.querySelector('[data-save-download]')?.addEventListener('click', () => download());
  root.querySelector('[data-save-upload]')?.addEventListener('click', () => upload());

  function select(slot) {
    selected = slot;
    try { localStorage.setItem(SELECTED_KEY, String(slot)); } catch {}
    rows.forEach((entry, index) => {
      entry.radio.checked = index === slot;
      entry.row.classList.toggle('is-selected', index === slot);
    });
  }

  async function refresh() {
    const ready = host.mode === 'dolphin' && Boolean(host.game?.mounted);
    root.classList.toggle('is-disabled', !ready);
    const entries = ready ? await host.listStateSlots() : [];
    rows.forEach((entry, slot) => {
      const info = entries[slot];
      entry.meta.textContent = ready ? describe(info) : 'No game';
      entry.save.disabled = !ready || busy;
      entry.load.disabled = !ready || busy || !info?.saved;
    });
  }

  async function guarded(operation) {
    if (busy) return null;
    busy = true;
    await refresh();
    try { return await operation(); } finally { busy = false; await refresh(); }
  }

  const saveSlot = (slot = selected) => guarded(async () => {
    select(slot);
    return host.saveState(slot);
  });
  const loadSlot = (slot = selected) => guarded(async () => {
    select(slot);
    const result = await host.loadState(slot);
    onLoaded(result);
    return result;
  });

  select(selected);
  refresh();
  return { refresh, save: () => saveSlot(), load: () => loadSlot(), get selected() { return selected; } };
}

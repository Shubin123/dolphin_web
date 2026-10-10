// Dolphin state files are scoped to the disc and exact core build.
export const STATE_SLOT_COUNT = 4;

export function stateSlotKey(game, adapter, slot = 0) {
  if (!game?.mounted || !game.gameId) throw new Error('Mount a game before using save states');
  if (!adapter?.expectedCoreSha256) throw new Error('Core build identity unavailable');
  return `${game.gameId}:${adapter.expectedCoreSha256}:${slot}`;
}

export class IndexedDbStateStore {
  async transact(mode, operation) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('wasm-dolphin-save-states', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('slots');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('slots', mode);
        const request = operation(transaction.objectStore('slots'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Save transaction aborted'));
      });
    } finally { db.close(); }
  }
  get(key) { return this.transact('readonly', store => store.get(key)); }
  put(key, value) { return this.transact('readwrite', store => store.put(value, key)); }
  getKey(key) { return this.transact('readonly', store => store.getKey(key)); }
}

export class SaveStateSlots {
  constructor(store = new IndexedDbStateStore()) {
    this.store = store;
    this.busy = false;
  }
  async run(operation) {
    if (this.busy) throw new Error('A save-state operation is already in progress');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  save(game, adapter, slot = 0) {
    return this.run(async () => {
      const key = stateSlotKey(game, adapter, slot);
      const result = await adapter.saveStateFile();
      if (!result?.saved || !result.bytes?.byteLength) throw new Error(result?.error || 'Save-state capture failed');
      const savedAt = new Date().toISOString();
      await this.store.put(key, { bytes: result.bytes, savedAt });
      // Small sidecar so slot lists never read whole states back.
      await this.store.put(`${key}:meta`, { savedAt, size: result.bytes.byteLength });
      return { saved: true, size: result.bytes.byteLength, savedAt };
    });
  }
  load(game, adapter, slot = 0) {
    return this.run(async () => {
      const state = await this.store.get(stateSlotKey(game, adapter, slot));
      if (!state?.bytes?.byteLength) throw new Error('No saved state for this game and core build');
      // The worker transfers ownership, so never hand it our stored buffer.
      const result = await adapter.loadStateFile(new Uint8Array(state.bytes.slice(0)));
      if (!result?.loaded) throw new Error(result?.error || 'Core rejected the saved state');
      return result;
    });
  }
  async list(game, adapter, count = STATE_SLOT_COUNT) {
    if (!game?.mounted || !game.gameId || !adapter?.expectedCoreSha256) return [];
    return Promise.all(Array.from({ length: count }, async (_, slot) => {
      const key = stateSlotKey(game, adapter, slot);
      const meta = await this.store.get(`${key}:meta`);
      if (meta) return { slot, saved: true, savedAt: meta.savedAt, size: meta.size };
      // States written before sidecars existed only report that they exist.
      const exists = this.store.getKey ? (await this.store.getKey(key)) !== undefined : Boolean(await this.store.get(key));
      return { slot, saved: exists, savedAt: null, size: null };
    }));
  }
}

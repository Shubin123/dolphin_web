// Dolphin state files are scoped to the disc and exact core build.
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
      await this.store.put(key, { bytes: result.bytes, savedAt: new Date().toISOString() });
      return { saved: true, size: result.bytes.byteLength };
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
}

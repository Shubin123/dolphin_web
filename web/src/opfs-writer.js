// Older Safari exposes OPFS writes through dedicated-worker sync handles.
// Transfer only one copied chunk at a time; never buffer an entire disc.
export async function createOpfsWriter(handle) {
  if (typeof handle.createWritable === 'function') return handle.createWritable();
  const worker = new Worker(new URL('./opfs-writer-worker.js', import.meta.url), { type: 'module' });
  let nextId = 0; let closed = false;
  const pending = new Map();
  const stop = error => {
    closed = true; worker.terminate();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.onerror = event => stop(new Error(event.message || 'Browser storage worker failed'));
  worker.onmessage = ({data}) => {
    const request = pending.get(data.id); if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error)); else request.resolve();
  };
  const request = (type, payload = {}, transfer = []) => new Promise((resolve,reject) => {
    if (closed) return reject(new Error('Storage writer is closed'));
    const id = ++nextId; pending.set(id,{resolve,reject});
    try { worker.postMessage({id,type,...payload},transfer); }
    catch (error) { pending.delete(id); reject(error); }
  });
  try { await request('open',{handle}); } catch (error) { stop(error); throw error; }
  return {
    async write(value) {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value)
        : value instanceof Uint8Array ? value.slice() : new Uint8Array(value).slice();
      await request('write',{bytes},[bytes.buffer]);
    },
    async close() { try { await request('close'); } finally { stop(new Error('Storage writer closed')); } },
    async abort() { try { if (!closed) await request('abort'); } finally { stop(new Error('Storage writer aborted')); } }
  };
}

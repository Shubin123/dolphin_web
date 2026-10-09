let handle; let position = 0;
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'open') {
      if (typeof data.handle.createSyncAccessHandle !== 'function') throw new Error('This Safari version cannot write cached game files');
      handle = await data.handle.createSyncAccessHandle();
      await handle.truncate(0);
    } else if (data.type === 'write') {
      let offset = 0;
      while (offset < data.bytes.byteLength) {
        const written = handle.write(data.bytes.subarray(offset), {at:position});
        if (!written) throw new Error('Browser storage write made no progress');
        position += written; offset += written;
      }
    } else if (data.type === 'close') {
      await handle.truncate(position); await handle.flush(); await handle.close(); handle = null;
    } else if (data.type === 'abort') {
      if (handle) { await handle.truncate(0); await handle.close(); handle = null; }
    } else throw new Error('Unknown storage operation');
    self.postMessage({id:data.id});
  } catch (error) {
    if (handle) { try { await handle.close(); } catch {} handle = null; }
    self.postMessage({id:data.id,error:error.message});
  }
};

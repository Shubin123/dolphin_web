import { createOpfsWriter } from "./opfs-writer.js";
// GPL-2.0-or-later. Stream multi-GiB images to OPFS without an in-memory copy.
export const ARCHIVE_SOURCE = Object.freeze({
  id: 'Wii_ISO',
  link: 'https://archive.org/download/Wii_ISO',
  stream: 'https://archive.org/cors/Wii_ISO',
  metadata: 'https://archive.org/metadata/Wii_ISO',
});
export const DISC_EXTENSION = /\.(iso|gcm|rvz|ciso|wbfs)$/i;

export function archiveGames(metadata) {
  if (!Array.isArray(metadata?.files)) throw new Error('Archive catalog is missing its file listing.');
  const seen = new Set();
  return metadata.files.flatMap(file => {
    if (typeof file.name !== 'string' || !DISC_EXTENSION.test(file.name) || file.private || seen.has(file.name)
      || file.name.split('/').some(part => !part || part === '.' || part === '..')) return [];
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size <= 0) return [];
    seen.add(file.name);
    const region = /\(USA(?:[,)]|\s)/i.test(file.name) ? 'USA'
      : /\(Europe(?:[,)]|\s)/i.test(file.name) ? 'Europe'
      : /\(Japan(?:[,)]|\s)/i.test(file.name) ? 'Japan' : 'Other';
    return [{ name: file.name, title: file.name.replace(DISC_EXTENSION, ''), size, region,
      url: `${ARCHIVE_SOURCE.link}/${file.name.split('/').map(encodeURIComponent).join('/')}`,
      streamUrl: `${ARCHIVE_SOURCE.stream}/${file.name.split('/').map(encodeURIComponent).join('/')}`,
      added: 0 }];
  });
}

// Metadata is the commit marker. Failed and cancelled streams never become playable entries.
export async function storeStream(directory, stream, metadata, { signal, onProgress = () => {}, key = crypto.randomUUID() } = {}) {
  let writer;
  let reader;
  let completed = false;
  const cancelRead = () => { void reader?.cancel(signal.reason).catch(() => {}); };
  try {
    signal?.throwIfAborted();
    reader = stream.getReader();
    signal?.addEventListener('abort', cancelRead, { once: true });
    writer = await createOpfsWriter(await directory.getFileHandle(key, { create: true }));
    let loaded = 0;
    onProgress(0);
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      await writer.write(value);
      loaded += value.byteLength;
      if (metadata.size && loaded > metadata.size) throw new Error('Download exceeds the catalog file size.');
      onProgress(loaded);
    }
    if (metadata.size && loaded !== metadata.size) throw new Error('Download is incomplete; it was not cached.');
    await writer.close();
    writer = null;
    signal?.throwIfAborted();
    const entry = { ...metadata, key, size: loaded, added: Date.now() };
    const record = await createOpfsWriter(await directory.getFileHandle(`${key}.json`, { create: true }));
    try { await record.write(JSON.stringify(entry)); await record.close(); }
    catch (error) { await record.abort().catch(() => {}); throw error; }
    completed = true;
    return entry;
  } finally {
    signal?.removeEventListener('abort', cancelRead);
    if (!completed) {
      await reader?.cancel().catch(() => {});
      await writer?.abort().catch(() => {});
      await directory.removeEntry(key).catch(() => {});
      await directory.removeEntry(`${key}.json`).catch(() => {});
    }
    reader?.releaseLock();
  }
}

export async function downloadToStore(game, directory, { signal, onProgress, fetchFile = fetch, storage = navigator.storage } = {}) {
  if (!directory) throw new Error('Browser storage is unavailable. Use Download to save the image and Open disc to play it.');
  signal?.throwIfAborted();
  const estimate = await storage?.estimate?.();
  if (estimate?.quota && game.size > estimate.quota - (estimate.usage || 0)) {
    throw new Error('Not enough browser storage for this image. Remove cached games or use Download and Open disc.');
  }
  const response = await fetchFile(game.streamUrl || game.url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Archive download returned HTTP ${response.status}. Try the Download link.`);
  if (!response.body || /text\/html/i.test(response.headers.get('content-type') || '')) {
    throw new Error('The archive returned a web page instead of a disc image. Try the Download link.');
  }
  return storeStream(directory, response.body, game, { signal, onProgress });
}

export async function loadArchiveCatalog({ fetchCatalog = fetch, cacheStorage = globalThis.caches, signal } = {}) {
  let cache;
  try { cache = await cacheStorage?.open('dolphin-library-catalog-v1'); } catch { /* Catalog works without caching. */ }
  try {
    const response = await fetchCatalog(ARCHIVE_SOURCE.metadata, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}.`);
    const json = await response.json();
    const games = archiveGames(json);
    if (!games.length) throw new Error('The archive has no supported disc images.');
    await cache?.put(ARCHIVE_SOURCE.metadata, new Response(JSON.stringify(json), {
      headers: { 'Content-Type': 'application/json' },
    })).catch(() => {});
    return { games, cached: false };
  } catch (error) {
    try {
      const previous = await cache?.match(ARCHIVE_SOURCE.metadata);
      if (previous) return { games: archiveGames(await previous.json()), cached: true };
    } catch { /* Use the bundled snapshot if the cache is corrupt. */ }
    const snapshot = await fetchCatalog(new URL('./wii-catalog.json', import.meta.url));
    if (!snapshot.ok) throw error;
    return { games: archiveGames(await snapshot.json()), cached: true };
  }
}

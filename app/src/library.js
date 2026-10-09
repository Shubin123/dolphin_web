// GPL-2.0-or-later. Azahar-style archive catalog and persistent playable library.
import { readGameId } from './game-profiles.js';
import { ARCHIVE_SOURCE, DISC_EXTENSION, downloadToStore, loadArchiveCatalog, storeStream } from './library-download.js';

export function filterGames(games, query, region, sort) {
  const filtered = games.filter(game => `${game.title || ''} ${game.name}`.toLowerCase().includes(query.trim().toLowerCase()) && (region === 'all' || game.region === region));
  return filtered.sort((a, b) => sort === 'recent' ? b.added - a.added
    : sort === 'size' ? a.size - b.size : (a.title || a.name).localeCompare(b.title || b.name));
}
const bytes = size => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

export async function initLibrary({ mountFile }) {
  const section = document.createElement('section');
  section.className = 'library-section';
  section.setAttribute('aria-label', 'Game library');
  section.innerHTML = `<h2>Game Library <span id="libraryCount">0</span></h2>
    <div class="library-toolbar"><select id="librarySource" aria-label="Library source"><option value="archive">Internet Archive · Wii ISO</option><option value="local">My cached games</option></select>
    <a id="librarySourceLink" href="${ARCHIVE_SOURCE.link}" target="_blank" rel="noopener noreferrer">Open Wii ISO archive ↗</a><button id="libraryRefresh" type="button">Refresh catalog</button></div>
    <p class="library-note">Play downloads and caches an image before starting. Cached games play without another download. Download saves the original file to your device.</p>
    <div class="library-toolbar"><button id="libraryAdd" type="button">Add games</button><input id="libraryFiles" type="file" multiple accept=".iso,.gcm,.rvz,.ciso,.wbfs" hidden>
    <input id="librarySearch" type="search" placeholder="Search games…" aria-label="Search games"><select id="libraryRegion" aria-label="Region"><option value="all">All regions</option><option>USA</option><option>Europe</option><option>Japan</option><option>Other</option></select>
    <select id="librarySort" aria-label="Sort"><option value="title">Title A–Z</option><option value="recent">Recently added</option><option value="size">Size · smallest first</option></select>
    <select id="libraryPageSize" aria-label="Games per page"><option value="20">20 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></select></div>
    <p id="libraryStatus" class="library-note" role="status"></p>
    <div id="libraryDownload" class="library-download" hidden><strong id="libraryDownloadTitle"></strong><progress id="libraryProgress" max="100" value="0" aria-label="Download progress"></progress>
    <p id="libraryDownloadStats" role="status"></p><button id="libraryCancel" type="button">Cancel download</button></div>
    <div class="library-table-scroll"><table class="library-table"><thead><tr><th>Title</th><th>Region</th><th class="size-column">Size</th><th>Actions</th></tr></thead><tbody id="libraryRows"></tbody></table></div>
    <div class="library-toolbar"><button id="libraryPrev" type="button">Previous</button><span id="libraryPage"></span><button id="libraryNext" type="button">Next</button></div>
    <div id="libraryReady" class="library-ready"><h3>Ready to play <span id="libraryReadyCount">(0)</span></h3><p class="library-note">Images stored in this browser. Removing one frees its cache space.</p><ul id="libraryReadyList"></ul></div>`;
  document.querySelector('.play-area').append(section);
  const el = id => section.querySelector(`#${id}`);
  const status = message => { el('libraryStatus').textContent = message; };
  let directory;
  let games = [];
  let catalog = [];
  let catalogLoading = false;
  let catalogRequest = 0;
  let page = 1;
  let activeDownload;
  let importing = false;
  let playing = false;
  const sessionFiles = new Map();

  try {
    directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('dolphin-library-v1', { create: true });
    for await (const [key, handle] of directory.entries()) {
      if (handle.kind !== 'file' || !key.endsWith('.json')) continue;
      try {
        const game = JSON.parse(await (await handle.getFile()).text());
        if (typeof game.key !== 'string' || !DISC_EXTENSION.test(game.name)) continue;
        const image = await (await directory.getFileHandle(game.key)).getFile();
        if (image.size === game.size) games.push(game);
      } catch { /* An interrupted metadata write is not a playable game. */ }
    }
  } catch (error) { status(`Persistent storage unavailable (${error.message}). Add local files for this session, or use Download and Open disc.`); }

  const cached = game => game.url ? games.find(entry => entry.url === game.url) : game;
  const busy = () => Boolean(activeDownload || importing || playing);
  async function imageFile(game) {
    const blob = sessionFiles.get(game.key) || await (await directory.getFileHandle(game.key)).getFile();
    return new File([blob], game.name.split('/').pop(), { type: 'application/octet-stream' });
  }
  async function play(game) {
    if (playing) return;
    playing = true;
    render();
    try {
      status(`Loading cached ${game.title || game.name}…`);
      if (await mountFile(await imageFile(game)) === false) throw new Error('The emulator rejected this image; see the emulator status for details.');
      document.querySelector('#screen').scrollIntoView({ behavior: 'smooth', block: 'center' });
      status(`Selected ${game.title || game.name} from the local cache.`);
    } catch (error) { status(`Unable to load game: ${error.message}`); }
    finally { playing = false; render(); }
  }
  async function saveFile(game) {
    try {
      const url = URL.createObjectURL(await imageFile(game));
      const link = document.createElement('a');
      link.href = url; link.download = game.name.split('/').pop(); link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { status(`Unable to save file: ${error.message}`); }
  }
  async function remove(game) {
    if (busy()) return;
    try {
      // Remove the commit marker first so a failed delete never leaves a broken playable.
      if (directory && !sessionFiles.has(game.key)) {
        await directory.removeEntry(`${game.key}.json`);
        await directory.removeEntry(game.key);
      }
      sessionFiles.delete(game.key);
      games = games.filter(entry => entry.key !== game.key);
      status(`Removed ${game.title || game.name} from the cache.`);
      render();
    } catch (error) { status(`Unable to remove game: ${error.message}`); }
  }
  async function download(game, shouldPlay) {
    if (busy()) return;
    const previous = cached(game);
    if (previous) { if (shouldPlay) await play(previous); else status(`${game.title} is already cached.`); return; }
    const controller = new AbortController();
    activeDownload = { game, controller };
    el('libraryDownload').hidden = false;
    el('libraryDownloadTitle').textContent = `Downloading ${game.title}`;
    el('libraryProgress').value = 0;
    const started = performance.now();
    let lastUpdate = -Infinity;
    render();
    try {
      // A browser may decline the persistence request; normal OPFS still works.
      await navigator.storage?.persist?.().catch(() => {});
      const entry = await downloadToStore(game, directory, {
        signal: controller.signal,
        onProgress(loaded) {
          const now = performance.now();
          if (now - lastUpdate < 150 && loaded < game.size) return;
          lastUpdate = now;
          const percent = Math.min(100, loaded / game.size * 100);
          const speed = loaded / Math.max(.001, (now - started) / 1000);
          el('libraryProgress').value = percent;
          el('libraryDownloadStats').textContent = `${percent.toFixed(1)}% · ${bytes(loaded)} / ${bytes(game.size)} · ${bytes(speed)}/s${speed ? ` · ~${Math.ceil((game.size - loaded) / speed)}s remaining` : ''}`;
        },
      });
      games.push(entry);
      status(`Cached ${game.title}. Ready to play without another download.`);
      activeDownload = null;
      render();
      if (shouldPlay) await play(entry);
    } catch (error) {
      status(controller.signal.aborted ? 'Download cancelled. Partial data was removed.' : `Download failed: ${error.message}`);
    } finally {
      activeDownload = null;
      el('libraryDownload').hidden = true;
      render();
    }
  }
  function action(label, handler, enabled = true) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.disabled = busy() || !enabled; button.onclick = handler;
    return button;
  }
  function cachedActions(game) {
    return [action('Play', () => play(game)), action('Save file', () => saveFile(game)), action('Remove', () => remove(game))];
  }
  function renderReady() {
    el('libraryReadyCount').textContent = `(${games.length})`;
    el('libraryReadyList').replaceChildren();
    for (const game of [...games].sort((a, b) => a.name.localeCompare(b.name))) {
      const item = document.createElement('li'); item.className = 'library-ready-game';
      const info = document.createElement('span'); info.textContent = `${game.title || game.name} · ${bytes(game.size)}`;
      const actions = document.createElement('div'); actions.append(...cachedActions(game));
      item.append(info, actions); el('libraryReadyList').append(item);
    }
    if (!games.length) el('libraryReadyList').textContent = 'No cached games yet.';
  }
  function render() {
    const remote = el('librarySource').value === 'archive';
    const source = remote ? catalog : games;
    const filtered = filterGames(source, el('librarySearch').value, el('libraryRegion').value, el('librarySort').value);
    const pageSize = Number(el('libraryPageSize').value);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, pages);
    el('libraryCount').textContent = `(${source.length})`;
    el('libraryPage').textContent = `${page} / ${pages} · ${filtered.length} games`;
    el('libraryPrev').disabled = page === 1;
    el('libraryNext').disabled = page === pages;
    el('libraryAdd').disabled = busy();
    el('libraryRefresh').disabled = catalogLoading;
    el('libraryRows').replaceChildren();
    for (const game of filtered.slice((page - 1) * pageSize, page * pageSize)) {
      const row = document.createElement('tr');
      row.dataset.name = game.name;
      const stored = cached(game);
      for (const [value, cls] of [[`${game.title || game.name}${remote && stored ? ' · Cached' : ''}`, ''], [game.region, ''], [bytes(game.size), 'size-column']]) {
        const cell = document.createElement('td'); cell.textContent = value; cell.className = cls; row.append(cell);
      }
      const actions = document.createElement('td');
      if (remote) {
        const link = document.createElement('a'); link.href = game.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Download'; link.className = 'library-download-link'; link.setAttribute('download', game.name.split('/').pop());
        actions.append(link, action('Play', () => stored ? play(stored) : download(game, true), Boolean(stored || directory)), action(stored ? 'Cached' : 'Cache', () => download(game, false), !stored && Boolean(directory)));
      } else actions.append(...cachedActions(game));
      row.append(actions); el('libraryRows').append(row);
    }
    if (!filtered.length) {
      const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 4;
      cell.textContent = remote && catalogLoading ? 'Loading Wii ISO catalog…' : source.length ? 'No matching games.' : remote ? 'Catalog unavailable. Use Refresh catalog or open the archive link.' : 'Your library is empty. Add a game to begin.';
      row.append(cell); el('libraryRows').append(row);
    }
    renderReady();
  }
  async function refreshCatalog() {
    const request = ++catalogRequest;
    catalogLoading = true;
    render();
    try {
      const result = await loadArchiveCatalog({ signal: AbortSignal.timeout(15000) });
      if (request !== catalogRequest) return;
      catalog = result.games;
      if (!busy()) status(`${catalog.length} Wii disc images${result.cached ? ' · using the saved catalog; live refresh unavailable' : ' from Internet Archive'}.`);
    } catch (error) { if (!busy()) status(`Unable to load catalog: ${error.message}`); }
    finally { if (request === catalogRequest) { catalogLoading = false; section.dataset.catalogLoaded = 'true'; render(); } }
  }
  el('libraryCancel').onclick = () => { activeDownload?.controller.abort(); };
  el('libraryRefresh').onclick = refreshCatalog;
  el('libraryAdd').onclick = () => el('libraryFiles').click();
  el('libraryFiles').onchange = async () => {
    if (busy()) return;
    importing = true;
    render();
    try {
      for (const file of el('libraryFiles').files) {
        if (!DISC_EXTENSION.test(file.name)) { status(`Unsupported file: ${file.name}`); continue; }
        let gameId = ''; try { gameId = await readGameId(file) || ''; } catch {}
        const region = ({ E: 'USA', P: 'Europe', J: 'Japan' })[gameId[3]] || 'Other';
        const metadata = { name: file.name, size: file.size, gameId, region };
        status(`Saving ${file.name} to browser storage…`);
        try {
          const game = directory ? await storeStream(directory, file.stream(), metadata) : { ...metadata, key: crypto.randomUUID(), added: Date.now() };
          if (!directory) sessionFiles.set(game.key, file);
          games.push(game);
          status(`Added ${file.name}`);
        } catch (error) { status(`Unable to save ${file.name}: ${error.message}. Use Open disc for session play.`); }
      }
    } finally { el('libraryFiles').value = ''; importing = false; render(); }
  };
  for (const name of ['librarySearch', 'libraryRegion', 'librarySort', 'librarySource', 'libraryPageSize']) el(name).addEventListener('input', () => { page = 1; render(); });
  el('libraryPrev').onclick = () => { page--; render(); };
  el('libraryNext').onclick = () => { page++; render(); };
  render();
  section.dataset.ready = 'true';
  void refreshCatalog();
}

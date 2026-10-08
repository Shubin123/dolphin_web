import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveGames, ARCHIVE_SOURCE, storeStream, downloadToStore, loadArchiveCatalog } from '../src/library-download.js';

function fakeDirectory({ failWrite = false } = {}) {
  const files = new Map();
  return {
    files,
    async getFileHandle(key) {
      const file = { size: 0, text: '', maxChunk: 0 }; files.set(key, file);
      return { async createWritable() { return {
        async write(value) {
          if (failWrite && typeof value !== 'string') throw new DOMException('Storage full', 'QuotaExceededError');
          if (typeof value === 'string') file.text += value;
          else { file.size += value.byteLength; file.maxChunk = Math.max(file.maxChunk, value.byteLength); }
        },
        async close() { file.closed = true; },
        async abort() { file.aborted = true; },
      }; } };
    },
    async removeEntry(key) { files.delete(key); },
  };
}
const stream = (...values) => new ReadableStream({ start(controller) { for (const value of values) controller.enqueue(value); controller.close(); } });
const game = { name: 'Test (USA).iso', title: 'Test', region: 'USA', size: 8, url: `${ARCHIVE_SOURCE.link}/Test%20(USA).iso` };

test('archive catalog keeps playable files, regions, large sizes and encoded URLs', () => {
  const entries = archiveGames({ files: [
    {name:'Test & #1 (USA, Asia).iso',size:'4699979776'},
    {name:'Japan (Japan).rvz',size:'500'},
    {name:'Europe (Europe).wbfs',size:'500'},
    {name:'Wii_ISO_meta.xml',size:'100'},
    {name:'private.iso',size:'100',private:true},
    {name:'bad.iso',size:'not-a-size'},
    {name:'Japan (Japan).rvz',size:'500'},
  ] });
  assert.equal(entries.length, 3);
  assert.equal(entries[0].size, 4699979776);
  assert.equal(entries[0].region, 'USA');
  assert(entries[0].streamUrl.startsWith('https://archive.org/cors/Wii_ISO/'));
  assert.equal(entries[1].region, 'Japan');
  assert.equal(entries[2].region, 'Europe');
  assert.equal(new URL(entries[0].url).pathname, '/download/Wii_ISO/Test%20%26%20%231%20(USA%2C%20Asia).iso');
});

test('stream commits metadata only after the complete file closes', async () => {
  const dir = fakeDirectory(); const progress = [];
  const entry = await storeStream(dir, stream(new Uint8Array(3),new Uint8Array(5)), game, {key:'test',onProgress:loaded=>progress.push(loaded)});
  assert.equal(entry.key, 'test');
  assert.equal(dir.files.get('test').closed, true);
  assert.equal(JSON.parse(dir.files.get('test.json').text).url, game.url);
  assert.deepEqual(progress,[0,3,8]);
});

test('stream counts beyond 4 GiB while holding one small chunk at a time', async () => {
  const dir = fakeDirectory(); const chunk = new Uint8Array(1024*1024);
  let count = 0;
  const source = new ReadableStream({ pull(controller) { if(count++<4097) controller.enqueue(chunk); else controller.close(); } });
  const entry = await storeStream(dir, source, {...game,size:4097*chunk.length}, {key:'large'});
  assert.equal(entry.size, 2**32 + 1024*1024);
  assert.equal(dir.files.get('large').maxChunk,1024*1024);
});

for (const size of [7,9]) test(`size mismatch (${size} bytes expected) removes partial cache`, async () => {
  const dir = fakeDirectory();
  await assert.rejects(storeStream(dir,stream(new Uint8Array(8)),{...game,size},{key:'partial'}), /incomplete|exceeds/);
  assert.equal(dir.files.size,0);
});

test('cancel interrupts a stalled read and removes all partial data', async () => {
  const dir = fakeDirectory(); const controller = new AbortController(); let cancelled=false;
  const pending = storeStream(dir,new ReadableStream({cancel(){cancelled=true;}}),game,{signal:controller.signal,key:'cancel'});
  setTimeout(()=>controller.abort(),10);
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(cancelled,true);
  assert.equal(dir.files.size,0);
});

test('write quota failure cancels the body and leaves no cache entry', async () => {
  const dir = fakeDirectory({failWrite:true}); let cancelled=false;
  const body = new ReadableStream({start(c){c.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
  await assert.rejects(storeStream(dir,body,game,{key:'quota'}),{name:'QuotaExceededError'});
  assert.equal(cancelled,true); assert.equal(dir.files.size,0);
});

test('quota preflight does not start a network download', async () => {
  let requests=0;
  await assert.rejects(downloadToStore(game,fakeDirectory(),{
    storage:{estimate:async()=>({quota:10,usage:5})},fetchFile:async()=>{requests++;},
  }), /Not enough browser storage/);
  assert.equal(requests,0);
});

test('HTTP failures and login HTML are not cached', async () => {
  for (const response of [new Response('Denied',{status:403}),new Response('<html>Log in</html>',{headers:{'content-type':'text/html'}})]) {
    const dir = fakeDirectory();
    await assert.rejects(downloadToStore(game,dir,{storage:{},fetchFile:async()=>response}),/HTTP 403|web page/);
    assert.equal(dir.files.size,0);
  }
});

test('catalog uses saved metadata when the network is unavailable', async () => {
  const saved = {files:[{name:'Test (USA).iso',size:'8'}]}; let fallbackFetches=0;
  const result = await loadArchiveCatalog({fetchCatalog:async()=>{fallbackFetches++;throw new Error('Offline');},cacheStorage:{open:async()=>({match:async()=>new Response(JSON.stringify(saved))})}});
  assert.equal(result.cached,true); assert.equal(result.games.length,1); assert.equal(fallbackFetches,1);
});

test('catalog falls back to the bundled snapshot when cache and live catalog fail', async () => {
  let calls=0;
  const result = await loadArchiveCatalog({cacheStorage:null,fetchCatalog:async url=>{
    calls++;if(String(url)===ARCHIVE_SOURCE.metadata) throw new Error('Offline');
    return new Response(JSON.stringify({files:[{name:'Snapshot.iso',size:'8'}]}));
  }});
  assert.equal(result.cached,true); assert.equal(result.games[0].name,'Snapshot.iso'); assert.equal(calls,2);
});

test('browser downloads use Archive CORS stream while preserving the canonical source URL', async () => {
  const archiveGame = archiveGames({files:[{name:'Test (USA).iso',size:'8'}]})[0];
  let requested;
  const entry = await downloadToStore(archiveGame, fakeDirectory(), { storage:{}, fetchFile:async url=>{
    requested=url;return new Response(new Uint8Array(8),{headers:{'content-type':'application/octet-stream'}});
  }});
  assert.equal(requested,archiveGame.streamUrl);
  assert.equal(entry.url,archiveGame.url);
});

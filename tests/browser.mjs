import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
const root = resolve('web');
let discBytes;
let imageRequests = 0;
let metadataRequests = 0;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/dolphin_web/')) { response.writeHead(404).end(); return; }
    if (url.pathname === '/dolphin_web/test-download') {
      imageRequests++;
      response.writeHead(200, {'content-type':'application/octet-stream','access-control-allow-origin':'*','content-length':discBytes.length});
      if (url.searchParams.get('name') === 'Cancelled (USA).iso') {
        response.write(discBytes.subarray(0, 128));
        const timer = setInterval(() => response.write(discBytes.subarray(0, 128)), 500);
        response.on('close', () => clearInterval(timer));
      } else response.end(discBytes);
      return;
    }
    const file = resolve(root, decodeURIComponent(url.pathname.slice('/dolphin_web/'.length)) || 'index.html');
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
    // Intentionally omit isolation headers to exercise the GitHub Pages worker.
    const body = await readFile(file);
    response.writeHead(200, {'content-type':types[extname(file)] || 'application/octet-stream'});
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const temp = await mkdtemp(join(tmpdir(), 'dolphin-browser-'));
let browser;
try {
  browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--enable-unsafe-webgpu', ...(process.env.CI ? ['--no-sandbox'] : [])]});
  const page = await browser.newPage();
  const errors = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url() === 'https://archive.org/metadata/Wii_ISO') {
      metadataRequests++;
      return request.respond({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({files:[
        {name:'Remote test (USA).iso',size:0x3000},
        {name:'Cancelled (USA).iso',size:0x3000},
        {name:'Broken (USA).iso',size:0x3001},
      ]})});
    }
    if (request.url().startsWith('https://archive.org/cors/Wii_ISO/')) {
      return request.respond({status:302,headers:{'access-control-allow-origin':'*',location:`http://127.0.0.1:${server.address().port}/dolphin_web/test-download?name=${encodeURIComponent(decodeURIComponent(new URL(request.url()).pathname.split('/').pop()))}`}});
    }
    void request.continue();
  });
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR',error.message); });
  page.on('console', message => { if(message.type() === 'error') console.log('CONSOLE',message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/dolphin_web/`);
  await page.waitForFunction(() => crossOriginIsolated && window.__host && document.querySelector('.library-section')?.dataset.ready === 'true', {timeout:60000});
  assert.equal(await page.evaluate(() => window.__host.coreKind), 'upstream');
  await page.select('#librarySource','local');
  // Generated metadata-only disc: validates DiscIO, not commercial gameplay.
  const bytes = Buffer.alloc(0x3000);
  bytes.write('TSTE01', 0); bytes.writeUInt32BE(0xc2339f3d, 0x1c); bytes.write('Dolphin test image', 0x20);
  const fields = {0x420:0x1000,0x424:0x2800,0x428:0x24,0x458:1,0x1000:0x100,0x1048:0x80003100,0x1090:0x40,0x10d8:0x80400000,0x10dc:0x1000,0x10e0:0x80003100,0x2454:0x20,0x2458:0x10,0x2800:0x01000000,0x2808:2,0x2810:0x2900,0x2814:4};
  for (const [offset,value] of Object.entries(fields)) bytes.writeUInt32BE(value, Number(offset));
  bytes.write('2026/10/08',0x2440); bytes.write('opening.bnr',0x2818); bytes.write('BNR1',0x2900);
  discBytes = bytes;
  const image = join(temp, 'Dolphin test.iso'); await writeFile(image, bytes);
  await (await page.$('#libraryFiles')).uploadFile(image);
  await page.waitForFunction(() => document.querySelector('#libraryCount').textContent === '(1)').catch(async error=>{console.log(await page.$eval('#libraryStatus',el=>el.textContent));throw error;});
  await page.goto(`http://127.0.0.1:${server.address().port}/dolphin_web/?visit=2`, {waitUntil:'networkidle0'});
  await page.waitForFunction(() => document.querySelector('.library-section')?.dataset.ready === 'true');
  await page.select('#librarySource','local');
  await page.waitForFunction(() => document.querySelector('#libraryCount')?.textContent === '(1)');
  await page.type('#librarySearch','no-match');
  assert.equal(await page.$eval('#libraryRows', node => node.textContent), 'No matching games.');
  await page.$eval('#librarySearch',node=>{node.value='';node.dispatchEvent(new Event('input'));});
  await page.click('#libraryRows button');
  await page.waitForFunction(() => window.__host?.game?.gameId === 'TSTE01', {timeout:60000});
  assert.equal(await page.evaluate(() => window.__host.mode), 'dolphin');
  assert.equal(await page.evaluate(() => window.__host.game.bootDolOffset), 0x1000);
  await page.click('#libraryRows button:last-child');
  await page.waitForFunction(() => document.querySelector('#libraryCount').textContent === '(0)');
  await page.goto(`http://127.0.0.1:${server.address().port}/dolphin_web/?visit=3`);
  await page.waitForFunction(() => document.querySelector('.library-section')?.dataset.ready === 'true');
  await page.select('#librarySource','local');
  await page.waitForFunction(() => document.querySelector('#libraryCount')?.textContent === '(0)');

  // Archive catalog, download cancellation, truncation cleanup and cached replay.
  await page.waitForFunction(() => document.querySelector('.library-section')?.dataset.catalogLoaded === 'true');
  await page.select('#librarySource','archive');
  await page.waitForFunction(() => document.querySelector('#libraryCount').textContent === '(3)');
  assert.equal(await page.$eval('#librarySourceLink', node => node.href), 'https://archive.org/download/Wii_ISO');
  const remoteRow = '#libraryRows tr[data-name="Remote test (USA).iso"]';
  const cancelRow = '#libraryRows tr[data-name="Cancelled (USA).iso"]';
  const brokenRow = '#libraryRows tr[data-name="Broken (USA).iso"]';
  await page.click(`${cancelRow} button:last-child`);
  await page.waitForFunction(() => !document.querySelector('#libraryDownload').hidden && document.querySelector('#libraryProgress').value > 0);
  await page.click('#libraryCancel');
  await page.waitForFunction(() => document.querySelector('#libraryStatus').textContent.includes('Download cancelled'));
  assert.equal(await page.$eval('#libraryReadyCount', node => node.textContent), '(0)');
  await page.click(`${brokenRow} button:last-child`);
  await page.waitForFunction(() => document.querySelector('#libraryStatus').textContent.includes('incomplete'));
  assert.equal(await page.$eval('#libraryReadyCount', node => node.textContent), '(0)');
  await page.click(`${remoteRow} button:last-child`);
  await page.waitForFunction(() => document.querySelector('#libraryReadyCount').textContent === '(1)');
  assert.equal(imageRequests,3);
  assert((await page.$eval(`${remoteRow} a`, node => node.href)).startsWith('https://archive.org/download/Wii_ISO/'));
  const save = await page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('dolphin-library-v1');
    const entries=[];for await(const [key] of directory.entries()) entries.push(key);return entries;
  });
  assert.equal(save.length,2,'only the complete disc and metadata should remain');
  const session = await page.createCDPSession();
  await session.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:temp});
  await page.click('#libraryReadyList button:nth-child(2)');
  const saveDeadline = Date.now() + 5000;
  let savedFile;
  while (Date.now() < saveDeadline) {
    try { savedFile = await readFile(join(temp, 'Remote test (USA).iso')); if (savedFile.length === bytes.length) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(savedFile, bytes, 'Save file must download the cached image to the device');
  await page.goto(`http://127.0.0.1:${server.address().port}/dolphin_web/?visit=4`);
  await page.waitForFunction(() => document.querySelector('#libraryReadyCount')?.textContent === '(1)');
  await page.setOfflineMode(true);
  await page.click('#libraryReadyList button');
  await page.waitForFunction(() => document.querySelector('#libraryStatus').textContent.includes('from the local cache'), {timeout:60000});
  assert.equal(await page.evaluate(() => window.__host.game.gameId),'TSTE01');
  assert.equal(imageRequests,3,'cached Play must not fetch the disc again');
  await page.click('#libraryReadyList button:last-child');
  await page.waitForFunction(() => document.querySelector('#libraryReadyCount').textContent === '(0)');
  await page.setOfflineMode(false);
  await page.waitForFunction(() => document.querySelector('.library-section')?.dataset.catalogLoaded === 'true');
  await page.click(`${remoteRow} button`);
  await page.waitForFunction(() => document.querySelector('#libraryStatus').textContent.includes('from the local cache') && document.querySelector('#libraryReadyCount').textContent === '(1)', {timeout:60000});
  assert.equal(imageRequests,4,'Play on an uncached archive row must download, cache and mount it');
  await page.click('#libraryReadyList button:last-child');
  await page.waitForFunction(() => document.querySelector('#libraryReadyCount').textContent === '(0)');
  assert(metadataRequests >= 1);
  assert.deepEqual(errors, []);
  console.log('PASS: Pages isolation, real Dolphin DiscIO, local library, archive catalog/downloads, cancellation, truncation cleanup, persistence and offline cached replay. Gameplay not exercised.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  await rm(temp, {recursive:true, force:true});
}

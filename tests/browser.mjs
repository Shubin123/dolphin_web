import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
const root = resolve('web');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/dolphin_web/')) { response.writeHead(404).end(); return; }
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
  browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--enable-unsafe-webgpu']});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR',error.message); });
  page.on('console', message => { if(message.type() === 'error') console.log('CONSOLE',message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/dolphin_web/`);
  await page.waitForFunction(() => crossOriginIsolated && window.__host && document.querySelector('#libraryRows'), {timeout:60000});
  assert.equal(await page.evaluate(() => window.__host.coreKind), 'upstream');
  // Generated metadata-only disc: validates DiscIO, not commercial gameplay.
  const bytes = Buffer.alloc(0x3000);
  bytes.write('TSTE01', 0); bytes.writeUInt32BE(0xc2339f3d, 0x1c); bytes.write('Dolphin test image', 0x20);
  const fields = {0x420:0x1000,0x424:0x2800,0x428:0x24,0x458:1,0x1000:0x100,0x1048:0x80003100,0x1090:0x40,0x10d8:0x80400000,0x10dc:0x1000,0x10e0:0x80003100,0x2454:0x20,0x2458:0x10,0x2800:0x01000000,0x2808:2,0x2810:0x2900,0x2814:4};
  for (const [offset,value] of Object.entries(fields)) bytes.writeUInt32BE(value, Number(offset));
  bytes.write('2026/10/08',0x2440); bytes.write('opening.bnr',0x2818); bytes.write('BNR1',0x2900);
  const image = join(temp, 'Dolphin test.iso'); await writeFile(image, bytes);
  await (await page.$('#libraryFiles')).uploadFile(image);
  await page.waitForFunction(() => document.querySelector('#libraryCount').textContent === '(1)').catch(async error=>{console.log(await page.$eval('#libraryStatus',el=>el.textContent));throw error;});
  await page.goto(`http://127.0.0.1:${server.address().port}/dolphin_web/?visit=2`, {waitUntil:'networkidle0'});
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
  await page.waitForFunction(() => document.querySelector('#libraryCount')?.textContent === '(0)');
  assert.deepEqual(errors, []);
  console.log('PASS: Pages subpath isolation, Dolphin WASM/DiscIO, library import, persistence, search, replay and removal. Gameplay not exercised.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  await rm(temp, {recursive:true, force:true});
}

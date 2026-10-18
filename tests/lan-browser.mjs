import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const serverSource = await readFile(new URL('../web/src/lan-server.js', import.meta.url));
const source = await readFile(new URL('../web/src/lan.js', import.meta.url));
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(req.url === '/lan-server.js' ? serverSource : req.url === '/lan.js' ? source : '<canvas width="64" height="64"></canvas><video autoplay muted></video>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  for (const page of pages) {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const { createLanSession } = await import('/lan.js');
      window.receivedControls = []; window.saveBytes = null;
      window.session = createLanSession({ onControls: buttons => { window.receivedControls = buttons; }, onTrack: stream => { document.querySelector('video').srcObject = stream; }, onSave: async file => { window.saveBytes = [...new Uint8Array(await file.arrayBuffer())]; } });
      const canvas = document.querySelector('canvas'); const ctx = canvas.getContext('2d');
      setInterval(() => { ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 64, 64); }, 30);
    });
  }
  const [host, guest] = pages;
  const offer = await host.evaluate(() => session.offer(document.querySelector('canvas')));
  const answer = await guest.evaluate(code => session.answer(code), offer);
  await host.evaluate(code => session.accept(code), answer);
  for (const page of pages) await page.waitForFunction(() => session.connected);
  await guest.waitForFunction(() => document.querySelector('video').videoWidth === 64);
  await guest.evaluate(() => session.controls(['A', 'Up']));
  await host.waitForFunction(() => receivedControls.join(',') === 'A,Up');
  await guest.evaluate(() => session.controls([]));
  await host.waitForFunction(() => receivedControls.length === 0);
  const bytes = Array.from({ length: 80000 }, (_, i) => i % 251);
  await host.evaluate(data => session.sendSave(new File([new Uint8Array(data)], 'test.sav')), bytes);
  await guest.waitForFunction(() => saveBytes?.length === 80000);
  assert.deepEqual(await guest.evaluate(() => saveBytes), bytes);
  await guest.evaluate(async () => {
    try { await session.sendSave(new File(['bad'], 'bad.iso')); throw Error('accepted invalid file'); }
    catch (error) { if (!error.message.includes('.sav')) throw error; }
    await session.sendSave(new File([new Uint8Array([9, 8, 7])], 'return.sav'));
  });
  await host.waitForFunction(() => saveBytes?.join(',') === '9,8,7');
  await guest.evaluate(() => session.controls(['B']));
  await host.waitForFunction(() => receivedControls[0] === 'B');
  await guest.evaluate(() => session.close());
  await host.waitForFunction(() => !session.connected && receivedControls.length === 0);
  console.log('LAN: two-browser pairing, video, controls/release, bidirectional chunked saves, invalid files and disconnect passed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { createLobbyHandler } from '../tools/lan-lobbies.mjs';
const index = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const start = index.lastIndexOf('<section', index.indexOf('id="lanPlay"'));
const end = index.indexOf('<form class="settings-panel', start);
const fixture = `<canvas width="64" height="64"></canvas>${index.slice(start, end)}`;
const handler = createLobbyHandler();
let offline = false;
const server = createServer(async (req, res) => {
  if (offline && req.url.startsWith('/lan-api/')) { res.writeHead(503).end('{}'); return; }
  if (await handler(req, res)) return;
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(fixture); return; }
  if (['/src/lan.js', '/src/lan-server.js'].includes(req.url)) {
    res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../web' + req.url, import.meta.url))); return;
  }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const wait = (page, predicate) => page.waitForFunction(predicate, { polling: 100, timeout: 15000 });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  for (const page of pages) {
    page.on('pageerror', error => console.log('Lobby page error', error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const { wireLanWidgets } = await import('/src/lan.js');
      window.remoteButtons = []; window.loaded = false;
      wireLanWidgets({ host: { game: { mounted: true } }, getCanvas: () => document.querySelector('canvas'), controls: buttons => { window.remoteButtons = buttons; }, allowedControls: ['A', 'B'], loadSave: async file => { window.loaded = file.name === 'sample.sav'; return { loaded: true }; } });
      const ctx = document.querySelector('canvas').getContext('2d');
      setInterval(() => { ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, 64, 64); }, 30);
    });
    assert.equal(await page.$eval('#lanLobbyActions', el => el.disabled), true);
    assert.equal(await page.$eval('#lanSaveActions', el => el.disabled), true);
    await page.$eval('#lanConnect', el => el.click());
    await wait(page, () => !document.querySelector('#lanLobbyActions').disabled);
  }
  const [host, guest] = pages;
  // Private room is hidden from discovery and joined by invitation.
  await host.$eval('#lanHost', el => el.click());
  await wait(host, () => document.querySelector('#lanRoom').textContent.includes('Private invitation:'));
  const invitation = await host.$eval('#lanRoom', el => el.textContent.split('Private invitation: ')[1]);
  await wait(guest, () => document.querySelector('#lanLobbies').children.length === 0);
  await guest.$eval('#lanInvite', (el, code) => { el.value = code; }, invitation); await guest.$eval('#lanJoin', el => el.click());
  for (const page of pages) await wait(page, () => !document.querySelector('#lanSaveActions').disabled).catch(async error => { console.log('Lobby status', await page.$eval('#lanStatus', el => el.textContent)); throw error; });
  await wait(guest, () => document.querySelector('#lanVideo').videoWidth === 64);
  await guest.$eval('[data-lan-control="A"]', el => el.scrollIntoView());
  const control = await guest.$('[data-lan-control="A"]'); const box = await control.boundingBox();
  await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await guest.mouse.down();
  await wait(host, () => remoteButtons[0] === 'A');
  await guest.mouse.up();
  await wait(host, () => remoteButtons.length === 0);
  await host.evaluate(() => {
    const input = document.querySelector('#lanSend'); const data = new DataTransfer(); data.items.add(new File([new Uint8Array([1, 2, 3])], 'sample.sav')); input.files = data.files; input.dispatchEvent(new Event('change'));
  });
  await wait(guest, () => !document.querySelector('#lanLoad').disabled);
  assert.equal(await guest.evaluate(() => window.loaded), false);
  await guest.$eval('#lanLoad', el => el.click()); await wait(guest, () => window.loaded);
  await guest.$eval('#lanLeave', el => el.click());
  await wait(guest, () => document.querySelector('#lanSaveActions').disabled);
  await wait(host, () => document.querySelector('#lanSaveActions').disabled);
  await host.$eval('#lanLeave', el => el.click());
  await wait(host, () => document.querySelector('#lanRoom').textContent === 'No lobby joined.');
  await host.$eval('#lanPublic', el => el.click()); await host.$eval('#lanHost', el => el.click());
  await wait(guest, () => document.querySelector('#lanLobbies button'));
  await guest.$eval('#lanLobbies button', el => el.click());
  for (const page of pages) await wait(page, () => !document.querySelector('#lanSaveActions').disabled).catch(async error => { console.log('Lobby status', await page.$eval('#lanStatus', el => el.textContent)); throw error; });
  offline = true;
  for (const page of pages) {
    await wait(page, () => document.querySelector('#lanLobbyActions').disabled && document.querySelector('#lanSaveActions').disabled);
    assert.equal(await page.$eval('#lanVideo', el => el.srcObject), null);
    assert.deepEqual(await page.evaluate(() => remoteButtons), []);
  }
  console.log('PASS: server gating, private invitation, public lobby discovery, remote video/input, explicit save loading, leave/rejoin and server-loss cleanup.');
} finally { if (browser) for (const page of await browser.pages()) await page.evaluate(() => document.querySelector('#lanDisconnect')?.click()).catch(() => {}); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

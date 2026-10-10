import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { makeHomebrewDisc } from './helpers/homebrew-disc.mjs';

const root = resolve('web');
let injection = '';
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, path.slice(1) || 'index.html');
    if (!file.startsWith(root + sep)) return response.writeHead(403).end();
    let body = await readFile(file);
    if (file.endsWith('/src/upstream-discio-worker.js') && injection) body = Buffer.concat([Buffer.from(injection), body]);
    response.writeHead(200, {
      'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(file)] || 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp'
    }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const temp = await mkdtemp(join(tmpdir(), 'dolphin-renderer-'));
let browser;
try {
  const file = join(temp, 'Renderer CPU homebrew.iso');
  await writeFile(file, makeHomebrewDisc());
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', ...(process.env.CI ? ['--no-sandbox'] : [])] });
  const cases = [
    { name: 'hardware preferred', injection: '' },
    { name: 'surface initialization rejected', injection: 'const originalContext=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(type,...args){if(type==="webgpu"&&this.width>1)throw Error("test surface rejected");return originalContext.call(this,type,...args)};\n' },
    { name: 'missing WebGPU', injection: 'Object.defineProperty(navigator,"gpu",{value:undefined});\n' },
    { name: 'no adapter', injection: 'Object.defineProperty(navigator,"gpu",{value:{requestAdapter:async()=>null}});\n' },
    { name: 'device rejected', injection: 'Object.defineProperty(navigator,"gpu",{value:{requestAdapter:async()=>({info:{},features:new Set(),limits:{},requestDevice:async()=>{throw Error("test device rejected")}})}});\n' },
    { name: 'software GPU adapter', injection: 'Object.defineProperty(navigator,"gpu",{value:{requestAdapter:async()=>({info:{isFallbackAdapter:true}})}});\n' },
  ];
  for (const scenario of cases) {
    injection = scenario.injection;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // A stale software presenter preference must not disable hardware replay.
    await page.goto(`http://127.0.0.1:${server.address().port}/?presenter=2d`);
    await page.waitForFunction(() => window.__host && document.querySelector('#romInput'), { timeout: 60000 });
    assert.equal(await page.$eval('#settingVideo', el => el.value), 'auto');
    assert.equal(await page.$eval('#settingPacing', el => el.value), 'auto');
    await page.evaluate(() => { window.originalRendererCanvas = document.querySelector('#screen'); });
    await (await page.$('#romInput')).uploadFile(file);
    await page.waitForFunction(() => window.__host.game?.coreBoot?.accepted, { timeout: 60000 });
    await page.waitForFunction(async () => (await window.__host.adapter.request('validationReadCoreProgress')).coreTicks > 0, { timeout: 60000 });
    const renderer = await page.evaluate(async () => ({
      backend: window.__host.videoBackend,
      fallback: window.__host.adapter.rendererFallbackReason,
      pacing: window.__host.presentationPacing,
      diagnostics: await window.__host.adapter.request('rendererDiagnostics')
    }));
    if (scenario.injection || renderer.fallback) {
      assert.equal(renderer.backend, 'Software Renderer');
      assert.equal(renderer.diagnostics.configuredVideoBackend, 'Software Renderer');
      assert.equal(renderer.pacing, 'tick');
      assert(renderer.fallback);
    } else {
      assert.equal(renderer.backend, 'WebGPU-Real');
      assert.equal(renderer.diagnostics.configuredVideoBackend, 'WebGPU-Real');
      assert.equal(renderer.diagnostics.activePresenterBackend, 'webgpu');
      assert.equal(renderer.diagnostics.adapter.isFallbackAdapter, false);
      assert.equal(renderer.pacing, 'smooth');
    }
    const before = await page.evaluate(() => window.__host.adapter.request('validationReadCoreProgress'));
    // CPU-only homebrew never submits a graphics frame. On hardware its GPU
    // thread can wait for that absent frame; verify guest execution and native
    // input independently. Software's core browser test covers continuing ticks.
    assert(before.coreTicks > 0);
    await page.keyboard.down('x');
    await page.waitForFunction(async () => (await window.__host.adapter.request('validationReadWebInput')).wiiA === 1, { timeout: 10000 });
    await page.keyboard.up('x');
    if (renderer.fallback?.includes('test surface rejected')) {
      assert(await page.evaluate(() => document.querySelector('#screen') !== window.originalRendererCanvas));
      // Replacement must preserve focus, mouse aim and on-screen touch input.
      const box = await (await page.$('#screen')).boundingBox();
      await page.mouse.move(box.x + box.width * .75, box.y + box.height * .25);
      await page.waitForFunction(async () => {
        const input = await window.__host.adapter.request('validationReadWebInput');
        return Math.abs(input.pointerX - .5) < .03 && Math.abs(input.pointerY - .5) < .03;
      }, { timeout: 10000 });
      await page.$eval('#screen', el => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 991, clientX: r.x + r.width * .8, clientY: r.y + r.height * .2 }));
      });
      await page.waitForFunction(async () => (await window.__host.adapter.request('validationReadWebInput')).wiiA === 1, { timeout: 10000 });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${scenario.name}: ${renderer.backend}; native guest execution and input verified`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  await rm(temp, { recursive: true, force: true });
}

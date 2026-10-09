import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { makeHomebrewDisc } from './helpers/homebrew-disc.mjs';
const root = resolve('web');
const server = createServer(async (request,response) => {
  try {
    const path = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const file = resolve(root, path.slice(1) || 'index.html');
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm'})[extname(file)] || 'application/octet-stream',
      'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp'});
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const temp = await mkdtemp(join(tmpdir(),'dolphin-core-'));
let browser;
try {
  const file = join(temp,'Dolphin CPU homebrew.iso'); await writeFile(file,makeHomebrewDisc());
  browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu', ...(process.env.CI ? ['--no-sandbox'] : [])]});
  const page = await browser.newPage(); const errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.message)});
  page.on('console',message=>{if(message.type()==='error') console.log('CONSOLE',message.text())});
  await page.goto(`http://127.0.0.1:${server.address().port}/?video=software&presenter=2d&cpu=dual`);
  await page.waitForFunction(()=>window.__host && document.querySelector('#romInput'),{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('.library-section')?.dataset.ready === 'true',{timeout:60000});
  await (await page.$('#libraryFiles')).uploadFile(file);
  await page.waitForFunction(()=>document.querySelector('#libraryReadyList button')?.disabled === false,{timeout:60000});
  // Reload to prove that Play boots a persisted image rather than the import.
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#libraryReadyList button')?.disabled === false,{timeout:60000});
  await page.click('#libraryReadyList button');
  await page.waitForFunction(()=>window.__host?.game?.coreBoot?.accepted,{timeout:60000});
  await page.waitForFunction(()=>document.activeElement?.id === 'screen',{timeout:10000});
  console.log('Boot accepted');
  const first = await page.evaluate(()=>window.__host.adapter.request('validationReadCoreProgress'));
  console.log('First progress',first);
  await page.waitForFunction(async()=>{
    const progress=await window.__host.adapter.request('validationReadCoreProgress');
    const pc = progress.ppcPc >>> 0;
    return pc >= 0x8000310c && pc <= 0x80003114 && progress.coreTicks > 0;
  },{timeout:60000,polling:200});
  const running = await page.evaluate(()=>window.__host.adapter.request('validationReadCoreProgress'));
  assert(running.coreTicks > first.coreTicks,'guest time must advance');
  const pause = await page.evaluate(()=>window.__host.adapter.request('validationSetCorePaused',{paused:true}));
  assert.equal(pause.paused,true);
  const paused1=await page.evaluate(()=>window.__host.adapter.request('validationReadCoreProgress'));
  await new Promise(resolve=>setTimeout(resolve,200));
  const paused2=await page.evaluate(()=>window.__host.adapter.request('validationReadCoreProgress'));
  assert.equal(paused1.coreTicks,paused2.coreTicks,'pausing must stop guest execution');
  const resume=await page.evaluate(()=>window.__host.adapter.request('validationSetCorePaused',{paused:false}));
  assert.equal(resume.paused,false);
  await page.waitForFunction(async ticks=>(await window.__host.adapter.request('validationReadCoreProgress')).coreTicks>ticks,{timeout:10000},paused2.coreTicks);
  assert.deepEqual(errors,[]);
  console.log('PASS: real Dolphin boots an original 16 MiB homebrew disc, executes guest PowerPC code, advances time, and pauses/resumes. No graphics/gameplay benchmark.');
} finally {
  await browser?.close(); await new Promise(done=>server.close(done)); await rm(temp,{recursive:true,force:true});
}

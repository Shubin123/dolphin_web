// Desktop WebKit with mobile emulation checks compatibility, not device FPS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { webkit, devices } from 'playwright';
import { makeHomebrewDisc } from './helpers/homebrew-disc.mjs';
const root = resolve('web');
const server = createServer(async (request,response) => {
  try {
    const file=resolve(root,decodeURIComponent(new URL(request.url,'http://localhost').pathname).slice(1)||'index.html');
    if (!file.startsWith(root+sep)) { response.writeHead(403).end(); return; }
    const body=await readFile(file);
    response.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm'})[extname(file)]||'application/octet-stream'});
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const temp=await mkdtemp(join(tmpdir(),'dolphin-webkit-'));
let browser;
try {
  const file=join(temp,'Dolphin CPU homebrew.iso');await writeFile(file,makeHomebrewDisc());
  const context=await webkit.launchPersistentContext(join(temp,'profile'),{...devices['iPhone 13']});
  browser=context;
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.message)});
  // No isolation headers: exercise the actual GitHub Pages service-worker path.
  const url=`http://127.0.0.1:${server.address().port}/?video=software&cpu=dual`;
  page.on('console', message => { if(message.type()==='error') console.log('CONSOLE',message.text()); });
  await page.goto(url);
  console.log('WebKit first navigation',await page.evaluate(()=>({isolated:crossOriginIsolated,sw:typeof navigator.serviceWorker,alerts:document.querySelector('[role=alert]')?.textContent})));
  await page.waitForFunction(()=>window.__host && crossOriginIsolated && typeof SharedArrayBuffer==='function',null,{timeout:90000});
  console.log('Pages isolation ready');
  assert(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),'Pages isolation requires a controlling worker');
  await page.locator('#romInput').setInputFiles(file);
  await page.waitForFunction(()=>window.__host.game.coreBoot?.accepted,null,{timeout:90000});
  await page.waitForFunction(async()=>{
    const s=await window.__host.adapter.request('validationReadCoreProgress');
    return (s.ppcPc>>>0)>=0x8000310c && (s.ppcPc>>>0)<=0x80003114 && s.coreTicks>0;
  },null,{timeout:90000});
  console.log('Native homebrew executing');
  const waitInput=predicate=>page.waitForFunction(async source=>{
    const s=await window.__host.adapter.request('validationReadWebInput');
    return new Function('s',`return (${source})(s)`)(s);
  },predicate.toString(),{timeout:15000});
  const pointer=async(selector,type,id=41,x=0.5,y=0.5)=>page.locator(selector).evaluate((element,{type,id,x,y})=>{
    const box=element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,clientX:box.left+box.width*x,clientY:box.top+box.height*y}));
  },{type,id,x,y});
  assert(await page.locator('.touch-controls').isVisible(),'mobile controls must be visible');
  const bounds=await page.locator('#screen').boundingBox();
  console.log('Portrait canvas',bounds,await page.evaluate(()=>({innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})));
  assert(bounds.x>=0 && bounds.x+bounds.width<=390+1,'portrait canvas must fit the viewport');
  // A real touchscreen tap, then held multi-pointer sequences.
  await page.locator('[data-touch-button="A"]').tap();
  await pointer('[data-touch-button="A"]','pointerdown',41);
  await pointer('[data-touch-button="A"]','pointerdown',42);
  await waitInput(s=>s.wiiA===1 && (s.buttons&0x100)!==0);
  await pointer('[data-touch-button="A"]','pointerup',41);
  await waitInput(s=>s.wiiA===1);
  await pointer('[data-touch-button="A"]','pointercancel',42);
  await waitInput(s=>s.wiiA===0);
  await pointer('[data-touch-button="L"]','pointerdown');
  await waitInput(s=>s.nunchukC===1 && s.wiiHome===0);
  await pointer('[data-touch-stick="main"]','pointerdown',43,0.95,0.5);
  await waitInput(s=>s.stickX>200 && s.nunchukC===1);
  await pointer('[data-touch-stick="pointer"]','pointerdown',44,0.5,0.05);
  await waitInput(s=>s.cStickY>200);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await waitInput(s=>s.mask===0 && s.stickX===128 && s.cStickY===128);
  await pointer('#screen','pointerdown',45,0.8,0.2);
  await waitInput(s=>s.wiiA===1 && s.cStickX>180 && s.cStickY>180);
  await pointer('#screen','pointerup',45);
  await waitInput(s=>s.wiiA===0 && s.cStickX===128);
  await pointer('[data-touch-button="WII_HOME"]','pointerdown');
  await waitInput(s=>s.wiiHome===1 && s.nunchukC===0);
  await pointer('[data-touch-button="WII_HOME"]','pointercancel');
  await waitInput(s=>s.wiiHome===0);
  // A down/up pair in one task must stay latched across native input polling.
  const latched=await page.locator('[data-touch-button="B"]').evaluate(async element=>{
    for (const type of ['pointerdown','pointerup']) element.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:90}));
    return window.__host.adapter.request('validationReadWebInput');
  });
  assert.equal(latched.wiiB,1,'short touch must reach native Wii input');
  await waitInput(s=>s.wiiB===0);
  assert.equal((await page.evaluate(()=>window.__host.adapter.request('validationSetCorePaused',{paused:true}))).paused,true);
  const saved=await page.evaluate(()=>window.__host.saveState());
  assert.equal(saved.saved,true,saved.error);
  const loaded=await page.evaluate(()=>window.__host.loadState());
  assert.equal(loaded.loaded,true,loaded.error);
  // Exercise the older Safari writer API with the real browser filesystem.
  await page.evaluate(()=>{ FileSystemFileHandle.prototype.createWritable=undefined; });
  await page.locator('#libraryFiles').setInputFiles(file);
  await page.waitForFunction(()=>document.querySelector('#libraryReadyCount')?.textContent==='(1)',null,{timeout:60000});
  console.log('Cache status',await page.locator('#libraryStatus').textContent(),await page.evaluate(()=>({getDirectory:typeof navigator.storage.getDirectory})));
  // Keep the context: the cached image and save must survive a Pages reload.
  await page.reload();await page.waitForFunction(()=>window.__host && crossOriginIsolated && document.querySelector('.library-section')?.dataset.ready==='true',null,{timeout:90000});
  console.log('Reload cache status',await page.locator('#libraryStatus').textContent(),await page.locator('#libraryReadyCount').textContent());
  await page.locator('#librarySource').selectOption('local');
  await page.locator('#libraryRows').getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>window.__host.game.coreBoot?.accepted,null,{timeout:90000});
  const persisted=await page.evaluate(()=>window.__host.loadState());
  assert.equal(persisted.loaded,true,persisted.error);
  await page.setViewportSize({width:844,height:390});
  assert(await page.locator('.touch-controls').isVisible(),'landscape touch controls must remain available');
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile-emulated WebKit booted real Dolphin through Pages isolation, executed guest code, consumed touch buttons/analog/pointer input, and replayed a cached image and restored IndexedDB save slots across reload. Physical iOS performance remains untested.');
} finally { await browser?.close();await new Promise(done=>server.close(done));await rm(temp,{recursive:true,force:true}); }

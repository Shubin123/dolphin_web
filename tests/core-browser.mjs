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
  const testUrl = new URL(process.env.DOLPHIN_URL || `http://127.0.0.1:${server.address().port}/`);
  testUrl.searchParams.set('video', 'software');
  testUrl.searchParams.set('presenter', '2d');
  testUrl.searchParams.set('cpu', 'dual');
  await page.goto(testUrl.href);
  // Pages reloads once when its isolation worker takes control. Do not import
  // a disc into the initial document while that reload is still pending.
  await page.waitForFunction(()=>crossOriginIsolated && window.__host && document.querySelector('#romInput'),{timeout:60000});
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
  // DOM -> SharedArrayBuffer -> native GameCube mapping and emulated Wii Remote.
  // Focus after clicking transport buttons previously swallowed all keyboard input.
  const nativeInput = () => page.evaluate(()=>window.__host.adapter.request('validationReadWebInput'));
  await page.focus('#saveButton');
  await page.keyboard.down('x');
  console.log('Pressed input diagnostic',await nativeInput());
  await page.waitForFunction(async()=>{
    const state=await window.__host.adapter.request('validationReadWebInput');
    return state.available && (state.buttons & 0x100) && state.wiiA === 1;
  },{timeout:10000});
  const pressed=await nativeInput();
  assert(pressed.generation>0,'native core must consume a published input generation');
  await page.keyboard.up('x');
  await page.waitForFunction(async()=>{
    const state=await window.__host.adapter.request('validationReadWebInput');
    return state.mask===0 && state.buttons===0 && state.wiiA===0;
  },{timeout:10000});
  await page.focus('#librarySearch');
  await page.keyboard.type('x');
  assert.equal((await nativeInput()).buttons,0,'typing in a search field must not press native A');
  await page.$eval('#librarySearch',el=>el.blur());
  await page.keyboard.down('w');
  await page.waitForFunction(async()=> (await window.__host.adapter.request('validationReadWebInput')).stickY===224,{timeout:10000});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(async()=> (await window.__host.adapter.request('validationReadWebInput')).stickY===128,{timeout:10000});
  await page.keyboard.up('w');
  await page.keyboard.down('q');
  await page.waitForFunction(async()=>{const s=await window.__host.adapter.request('validationReadWebInput');return s.nunchukC===1&&s.wiiHome===0;},{timeout:10000});
  await page.keyboard.up('q');await page.keyboard.down('h');
  await page.waitForFunction(async()=>{const s=await window.__host.adapter.request('validationReadWebInput');return s.nunchukC===0&&s.wiiHome===1;},{timeout:10000});
  await page.keyboard.up('h');
  await page.waitForFunction(async()=> (await window.__host.adapter.request('validationReadWebInput')).wiiHome===0,{timeout:10000});
  // Real native state also covers touch, mouse axes and gamepad lifecycle.
  await page.$eval('[data-touch-button="B"]',el=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:71,pointerType:'touch'})));
  await page.waitForFunction(async()=> (await window.__host.adapter.request('validationReadWebInput')).wiiB===1,{timeout:10000});
  await page.$eval('[data-touch-button="B"]',el=>el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:71,pointerType:'touch'})));
  await page.waitForFunction(async()=> (await window.__host.adapter.request('validationReadWebInput')).wiiB===0,{timeout:10000});
  await page.select('#mouseMode','cstick');
  const screen=await page.$('#screen');await screen.scrollIntoView();const box=await screen.boundingBox();
  await page.mouse.move(box.x+box.width*0.75,box.y+box.height*0.25);await page.mouse.down();
  await page.waitForFunction(async()=>{
    const state=await window.__host.adapter.request('validationReadWebInput');return state.wiiA===1&&state.cStickX>160&&state.cStickY>160;
  },{timeout:10000});
  await page.mouse.up();
  await page.waitForFunction(async()=>{
    const state=await window.__host.adapter.request('validationReadWebInput');return state.wiiA===0&&state.cStickX===128&&state.cStickY===128;
  },{timeout:10000});
  await page.evaluate(()=>{
    window.__nativeTestPads=[{index:0,id:'Native E2E controller',mapping:'standard',connected:true,axes:[0.8,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===0,value:i===0?1:0}))}];
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__nativeTestPads});
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  await page.waitForFunction(async()=>{
    const state=await window.__host.adapter.request('validationReadWebInput');return state.wiiA===1&&state.stickX>180;
  },{timeout:10000});
  await page.select('#controllerSelect','off');
  await page.waitForFunction(async()=>{
    const state=await window.__host.adapter.request('validationReadWebInput');return state.wiiA===0&&state.stickX===128;
  },{timeout:10000});
  await page.select('#controllerSelect','auto');
  await page.waitForFunction(async()=> (await window.__host.adapter.request('validationReadWebInput')).wiiA===1,{timeout:10000});
  await page.evaluate(()=>{window.__nativeTestPads=[];window.dispatchEvent(new Event('gamepaddisconnected'));});
  await page.waitForFunction(async()=>{
    const state=await window.__host.adapter.request('validationReadWebInput');return state.mask===0&&state.wiiA===0&&state.stickX===128;
  },{timeout:10000});
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
  console.log('PASS: real Dolphin boots homebrew, executes PowerPC code, pauses/resumes, and consumes keyboard input through native GameCube and Wii Remote mappings. No graphics/gameplay benchmark.');
} finally {
  await browser?.close(); await new Promise(done=>server.close(done)); await rm(temp,{recursive:true,force:true});
}

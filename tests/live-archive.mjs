// Live integration smoke: fetch metadata and only a disc header, then cancel.
// No disc image is downloaded in full, stored, or published by this test.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true,args:process.env.CI ? ['--no-sandbox'] : [],
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.DOLPHIN_URL || 'https://shubin123.github.io/dolphin_web/');
  await page.waitForFunction(()=>crossOriginIsolated,{timeout:60000});
  const result = await page.evaluate(async()=>{
    const metadata=await fetch('https://archive.org/metadata/Wii_ISO',{credentials:'omit',signal:AbortSignal.timeout(20000)});
    if(!metadata.ok) throw new Error(`Metadata HTTP ${metadata.status}`);
    const json=await metadata.json();const files=json.files.filter(file=>file.name.endsWith('.iso'));
    const file=files[0];
    const response=await fetch(`https://archive.org/cors/Wii_ISO/${file.name.split('/').map(encodeURIComponent).join('/')}`,{credentials:'omit',signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new Error(`Stream HTTP ${response.status}`);
    const reader=response.body.getReader();const header=new Uint8Array(256);let loaded=0;
    try {
      while(loaded<256) {
        const {done,value}=await reader.read();if(done)break;
        const count=Math.min(value.length,256-loaded);header.set(value.subarray(0,count),loaded);loaded+=count;
      }
    } finally { await reader.cancel(); }
    return {metadata:metadata.status,isoCount:files.length,stream:response.status,bytes:loaded,discId:new TextDecoder().decode(header.subarray(0,6)),wiiMagic:[...header.subarray(0x18,0x1c)].map(value=>value.toString(16).padStart(2,'0')).join('')};
  });
  assert.equal(result.bytes,256);assert(result.isoCount>0);assert.equal(result.wiiMagic,'5d1c9ea3');
  console.log('PASS: live Pages isolation, Archive metadata and CORS-readable Wii ISO header.',result);
} finally { await browser.close(); }

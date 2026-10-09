import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {safePath,verifyPackages,verifyInventory} from '../tools/package-contract.mjs';
test('frontend and backend inventories are disjoint and match the deployed core',()=>{
 const {backend,frontend}=verifyPackages(resolve('web'));assert(backend.files.length>50);assert(frontend.files.some(file=>file.path==='src/app.js'));assert(!backend.files.some(file=>file.path==='src/app.js'));
});
test('package verification rejects asset drift and unsafe paths',()=>{
 for(const path of ['/etc/passwd','../app.js','a\\b','a//b','./a'])assert.throws(()=>safePath(path));
 const dir=mkdtempSync(resolve(tmpdir(),'frontend-drift-'));
 try{
  writeFileSync(resolve(dir,'backend-runtime.json'),JSON.stringify({schemaVersion:1,files:[{path:'input.js',size:6,sha256:'0'.repeat(64)}]}));
  writeFileSync(resolve(dir,'input.js'),'edited');assert.throws(()=>verifyInventory(dir,'backend-runtime.json'),/Asset drift/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

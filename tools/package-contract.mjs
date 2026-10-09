import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function safePath(path){if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='..'||part==='.'))throw new Error(`Unsafe asset path: ${path}`);}
export function verifyInventory(root,name){
 const manifest=JSON.parse(readFileSync(resolve(root,name)));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files))throw new Error(`Invalid inventory: ${name}`);
 const seen=new Set();
 for(const record of manifest.files){safePath(record.path);if(seen.has(record.path))throw new Error('Duplicate package asset');seen.add(record.path);const bytes=readFileSync(resolve(root,record.path));if(bytes.length!==record.size||hash(bytes)!==record.sha256)throw new Error(`Asset drift: ${record.path}`);}
 return manifest;
}
export function verifyPackages(web){
 const backend=verifyInventory(web,'backend-runtime.json');const frontend=verifyInventory(web,'frontend-build.json');
 if(backend.coreId!==frontend.coreId)throw new Error('Frontend was built against a different backend');
 const paths=new Set(backend.files.map(file=>file.path));
 if(backend.sourceDownload){safePath(backend.sourceDownload);if(!paths.has(backend.sourceDownload))throw new Error('Source archive is missing from backend inventory');}
 for(const file of frontend.files)if(paths.has(file.path))throw new Error(`Frontend/backend ownership overlap: ${file.path}`);
 const wasm=readFileSync(resolve(web,'cores/dolphin/dolphin-core-upstream.wasm'));
 if(!WebAssembly.validate(wasm)||backend.coreId!==`sha256:${hash(wasm)}`)throw new Error('Invalid WASM identity');
 const build=JSON.parse(readFileSync(resolve(web,'cores/dolphin/dolphin-core-upstream.build.json')));
 if(build.coreId!==backend.coreId)throw new Error('Stale core build record');
 const abi=JSON.parse(readFileSync(resolve(web,'provenance/dolphin-core-abi-v1.json')));
 if(abi.coreId!==backend.coreId)throw new Error('Stale ABI record');
 return {backend,frontend};
}

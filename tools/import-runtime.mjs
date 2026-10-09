import {readFileSync,existsSync,cpSync,mkdirSync,rmSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyInventory,safePath,hash} from './package-contract.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(process.argv[2] || '');
if(!process.argv[2])throw new Error('Supply an extracted backend runtime artifact directory');
const incoming=verifyInventory(source,'backend-runtime.json');
const wasm=readFileSync(resolve(source,'cores/dolphin/dolphin-core-upstream.wasm'));
if(!WebAssembly.validate(wasm)||incoming.coreId!==`sha256:${hash(wasm)}`)throw new Error('Invalid incoming core');
const web=resolve(root,'web');
const frontend=existsSync(resolve(web,'frontend-build.json'))?JSON.parse(readFileSync(resolve(web,'frontend-build.json'))):null;
const ui=new Set(frontend?.files.map(file=>file.path)||[]);
for(const file of incoming.files)if(ui.has(file.path))throw new Error(`Backend artifact overlaps frontend: ${file.path}`);
const previous=existsSync(resolve(web,'backend-runtime.json'))?JSON.parse(readFileSync(resolve(web,'backend-runtime.json'))):null;
const paths=new Set(incoming.files.map(file=>file.path));
for(const file of previous?.files||[]){safePath(file.path);if(!paths.has(file.path)&&!ui.has(file.path))rmSync(resolve(web,file.path),{force:true});}
for(const file of incoming.files){mkdirSync(dirname(resolve(web,file.path)),{recursive:true});cpSync(resolve(source,file.path),resolve(web,file.path));}
cpSync(resolve(source,'backend-runtime.json'),resolve(web,'backend-runtime.json'));
execFileSync(process.execPath,[resolve(root,'tools/build.mjs')],{cwd:root,stdio:'inherit'});

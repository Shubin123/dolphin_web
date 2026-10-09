// Frontend UI is owned here; engine assets come only from the backend package.
import {cpSync,mkdirSync,readdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safePath,verifyInventory,verifyPackages} from './package-contract.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const web=resolve(root,'web');
function walk(dir,prefix='') {
 return readdirSync(resolve(dir,prefix),{withFileTypes:true}).flatMap(entry=>{
  const path=prefix?`${prefix}/${entry.name}`:entry.name;
  if(entry.isSymbolicLink())throw new Error('Frontend source symlinks are unsupported');
  return entry.isDirectory()?walk(dir,path):[path];
 }).sort();
}
const backend=verifyInventory(web,'backend-runtime.json');
const backendFiles=new Set(backend.files.map(file=>file.path));
const files=walk(resolve(root,'app'));
const previous=existsSync(resolve(web,'frontend-build.json'))?JSON.parse(readFileSync(resolve(web,'frontend-build.json'))):null;
for(const file of previous?.files||[]){safePath(file.path);if(!files.includes(file.path)&&!backendFiles.has(file.path))rmSync(resolve(web,file.path),{force:true});}
for(const path of files){
 if(backendFiles.has(path))throw new Error(`Frontend source overlaps backend runtime: ${path}`);
 mkdirSync(dirname(resolve(web,path)),{recursive:true});cpSync(resolve(root,'app',path),resolve(web,path));
}
writeFileSync(resolve(web,'frontend-build.json'),JSON.stringify({schemaVersion:1,coreId:backend.coreId,files:files.map(path=>{const bytes=readFileSync(resolve(web,path));return {path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}})},null,2)+'\n');
console.log(`Built frontend UI (${files.length} files) with ${backend.coreId}`);

verifyPackages(web);

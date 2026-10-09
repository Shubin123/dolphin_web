// Scheduled Pages builds consume only a successful build of current backend main.
// Fail closed on stale evidence rather than deploying an older/newer mixed core.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const repo=process.env.DOLPHIN_BACKEND_REPO || 'Shubin123/dolphin_emscripten';
const gh=args=>execFileSync('gh',args,{encoding:'utf8'}).trim();
const head=JSON.parse(gh(['api',`repos/${repo}/commits/main`])).sha;
const runs=JSON.parse(gh(['api',`repos/${repo}/actions/workflows/runtime.yml/runs?branch=main&status=success&per_page=20`])).workflow_runs;
const run=runs.find(run=>run.head_sha===head && run.event!=='pull_request');
if(!run)throw new Error('Current backend main has no successful runtime build yet; retain deployed frontend and retry after backend CI passes.');
const dir=mkdtempSync(join(tmpdir(),'backend-runtime-'));
try {
 gh(['run','download',String(run.id),'--repo',repo,'--name','dolphin-browser-runtime','--dir',dir]);
 execFileSync(process.execPath,[resolve('tools/import-runtime.mjs'),dir],{stdio:'inherit'});
 console.log(`Imported backend ${head}, workflow run ${run.id}`);
}finally{rmSync(dir,{recursive:true,force:true});}

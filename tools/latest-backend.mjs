// Scheduled Pages builds consume only a successful build of current backend main.
// Fail closed on stale evidence rather than deploying an older/newer mixed core.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {waitForBackendRuntime} from './backend-runtime-readiness.mjs';
const repo=process.env.DOLPHIN_BACKEND_REPO || 'Shubin123/dolphin_emscripten';
const gh=args=>execFileSync('gh',args,{encoding:'utf8'}).trim();
const {head,run}=await waitForBackendRuntime({
 readHead:()=>JSON.parse(gh(['api',`repos/${repo}/commits/main`])).sha,
 readRuns:()=>JSON.parse(gh(['api',`repos/${repo}/actions/workflows/runtime.yml/runs?branch=main&per_page=20`])).workflow_runs,
 readBuildStatus:run=>{
  try {
   const {jobs}=JSON.parse(gh(['api',`repos/${repo}/actions/runs/${run.id}/jobs`]));
   return jobs.filter(job=>job.status==='in_progress').map(job=>{
    const step=job.steps?.find(step=>step.status==='in_progress');
    return step ? `${job.name}: ${step.name}` : job.name;
   }).join('; ');
  } catch { return ''; } // Progress details must not change the readiness gate.
 },
 onProgress:console.log
});
const dir=mkdtempSync(join(tmpdir(),'backend-runtime-'));
try {
 gh(['run','download',String(run.id),'--repo',repo,'--name','dolphin-browser-runtime','--dir',dir]);
 execFileSync(process.execPath,[resolve('tools/import-runtime.mjs'),dir],{stdio:'inherit'});
 console.log(`Imported backend ${head}, workflow run ${run.id}`);
}finally{rmSync(dir,{recursive:true,force:true});}

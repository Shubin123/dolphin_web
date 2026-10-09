import {watch} from 'node:fs';
import {spawn} from 'node:child_process';
let timer;let running=false;let pending=false;
function build(){if(running){pending=true;return;}running=true;pending=false;const child=spawn(process.execPath,['tools/build.mjs'],{stdio:'inherit'});child.on('exit',code=>{running=false;if(code)console.error(`Frontend build failed (${code})`);if(pending)build();});}
watch('app',{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(build,150);});build();
console.log('Watching frontend UI source.');

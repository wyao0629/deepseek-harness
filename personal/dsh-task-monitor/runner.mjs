import {spawn} from 'node:child_process';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {read,save} from './monitor.mjs';

const dir=process.argv[2],job=await read(join(dir,'spec.json'));
const log=await open(join(dir,'output.log'),'a',0o600);
// Jobs load project credentials explicitly; DSH model credentials are not inherited.
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C.UTF-8'};
const child=spawn('/bin/bash',['-lc',job.command],{cwd:job.cwd,env,stdio:['ignore',log.fd,log.fd],detached:true});
let requested;
const stop=state=>{requested??=state;try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}};
const cancel=()=>stop('cancelled');process.on('SIGTERM',cancel);
const timer=setTimeout(()=>stop('timed_out'),job.timeoutSeconds*1000);
let killTimer;
const hardStop=setInterval(()=>{if(requested&&!killTimer)killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}},5000);},250);
const result=await new Promise(resolve=>{
  child.once('error',e=>resolve({state:'failed',reason:e.message}));
  child.once('close',(code,signal)=>resolve({state:requested??(code===0?'succeeded':'failed'),exitCode:code,signal}));
});
clearTimeout(timer);clearInterval(hardStop);clearTimeout(killTimer);process.off('SIGTERM',cancel);
await log.close();await save(join(dir,'result.json'),{...result,finishedAt:Date.now()});

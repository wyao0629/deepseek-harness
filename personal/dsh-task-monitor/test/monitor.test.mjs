import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Monitor,save,received,queued,receiptId} from '../monitor.mjs';
import vm from 'node:vm';
const fixture=async()=>{const root=await mkdtemp(join(tmpdir(),'dsh-monitor-'));const calls=[];return {root,calls,m:new Monitor(root,{interval:10,exec:async(...args)=>{calls.push(args);return {stdout:'active\n'}}})}};
test('launches argv without shell expansion and persists session identity',async()=>{
 const {root,calls,m}=await fixture();const job=await m.start({sessionId:'s',command:'echo "$VALUE"',cwd:root});
 assert.equal(calls[0][0],'/usr/bin/sudo');assert(!calls[0][1].includes(job.command));
 assert.equal((await m.jobs('s'))[0].command,job.command);assert.equal((await m.jobs('other')).length,0);
});
test('wait performs no model action and only releases for a terminal result',async()=>{
 const {root,m}=await fixture(),job=await m.start({sessionId:'s',command:'true',cwd:root});let released=false;
 const wait=m.wait(job,new AbortController().signal).then(r=>{released=true;return r});
 await new Promise(r=>setTimeout(r,35));assert.equal(released,false);
 await save(join(m.path(job.id),'result.json'),{state:'succeeded',exitCode:0});assert.equal((await wait).state,'succeeded');
});
test('aborting wait leaves the durable job running',async()=>{
 const {root,m}=await fixture(),job=await m.start({sessionId:'s',command:'true',cwd:root}),abort=new AbortController();
 const promise=m.wait(job,abort.signal);abort.abort();await assert.rejects(promise);assert.equal((await m.status(job)).state,'running');
});
test('restart discovers durable terminal result without relaunch',async()=>{
 const {root,m}=await fixture(),job=await m.start({sessionId:'s',command:'true',cwd:root});
 await save(join(m.path(job.id),'result.json'),{state:'failed',exitCode:7});
 const recovered=new Monitor(root,{exec:()=>{throw Error('must not relaunch')}});assert.equal((await recovered.status((await recovered.jobs('s'))[0])).exitCode,7);
});
test('receipt distinguishes committed notifications from historical queue splices',()=>{
 const job={id:'test'};
 assert(received({session:{snapshotEvents:()=>[{type:'user/message',data:{id:receiptId(job)}}]}},job));
 assert(!received({session:{snapshotEvents:()=>[{type:'agent/inbox/spliced',data:{inserted:[{id:receiptId(job)}]}}]}},job));
 assert(queued({inbox:{nextTurn:[{id:receiptId(job)}],nextStep:[]}},job));
});
test('real plugin pre-step blocks model continuation, then injects one result',async()=>{
 const {root,m}=await fixture(),job=await m.start({sessionId:'s',command:'true',cwd:root});
 let hook;const tools=[];const effects=[];
 const source=(await readFile(new URL('../index.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/export /g,'');
 const context={Monitor,read:async p=>{try{return JSON.parse(await readFile(p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}},save,received,queued,receiptId,homedir:()=>root,join,defineTool:x=>x,AbortController,AbortSignal,setInterval,clearInterval};
 vm.createContext(context);vm.runInContext(source+';globalThis.install=apply',context);
 context.install({systemPrompt:{context:()=>()=>{}},tools:{register:t=>{tools.push(t);return()=>{}}},effect:fn=>effects.push(fn()),on:(_n,fn)=>{hook=fn},sessionController:{resolveAgent:async()=>({})},logger:{warn:()=>{}}},{root,interval:10});
 let requests=0;const agent={session:{id:'s',snapshotEvents:()=>[]}};
 const promise=hook({agent,messages:[],signal:new AbortController().signal},async()=>{requests++;return {kind:'enter',messages:[]}});
 await new Promise(r=>setTimeout(r,35));assert.equal(requests,0);
 await save(join(m.path(job.id),'result.json'),{state:'succeeded',exitCode:0});const result=await promise;
 assert.equal(requests,1);assert.equal(result.messages[0].id,receiptId(job));
 for(const release of effects)await release?.();
});

test('usage guidance is contributed once through durable runtime context and disposed',async()=>{
 const {root}=await fixture();const contexts=[];const releases=[];let removed=0;
 const source=(await readFile(new URL('../index.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/export /g,'');
 const context={Monitor,read:async()=>null,save,received,queued,receiptId,homedir:()=>root,join,defineTool:x=>x,AbortController,AbortSignal,setInterval,clearInterval};
 vm.createContext(context);vm.runInContext(source+';globalThis.install=apply',context);
 context.install({systemPrompt:{context:c=>{contexts.push(c);return()=>{removed++}}},tools:{register:()=>()=>{}},effect:fn=>releases.push(fn()),on:()=>{},sessionController:{resolveAgent:async()=>({})},logger:{warn:()=>{}}},{root});
 assert.equal(contexts.length,1);assert.equal(contexts[0].name,'task-monitor:usage');
 for(const text of ['补数','task_monitor_start','task_monitor_status','task_monitor_cancel','不代表完成','退出码 0'])assert(contexts[0].text.includes(text));
 for(const release of releases)await release?.();assert.equal(removed,1);
});

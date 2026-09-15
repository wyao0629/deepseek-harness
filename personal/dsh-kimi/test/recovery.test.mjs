import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {KimiRuntime} from '../lib/host.mjs';

test('a native answer that finished after a DSH failure is recovered once without repeating the user prompt',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'kimi-recovery-'));
  try {
    const binding={sessionId:'dsh-test',nativeId:'kimi-test',cwd:directory,provider:'test',model:'test'};
    const events=[{type:'kimi/binding',data:binding},{type:'kimi/run',data:{promptId:'p',status:'failed'}}];
    const session={id:binding.sessionId,snapshotEvents:()=>events,append:(type,data)=>{
      assert.deepEqual(data,JSON.parse(JSON.stringify(data)));
      events.push({type,data});
    }};
    const agent={session,status:'idle',phase:{kind:'idle',lastTurn:1},runMaintenance:async f=>f()};
    const runtime=new KimiRuntime({sessionController:{resolveAgent:async()=>({agent})},sessions:{flush:async()=>{}}},{});
    runtime.directory=directory;
    await mkdir(join(directory,'bindings'));
    await writeFile(join(directory,'bindings','dsh-test.json'),JSON.stringify(binding));
    runtime.native.cliActive=async()=>false;
    runtime.native.call=async()=>({busy:false});
    runtime.native.refreshExternal=async()=>true;
    runtime.native.userContent=async()=>[{type:'text',text:'original task'}];
    runtime.native.transcript=async()=>({turns:[{turnId:'t',triggerPromptId:'p',state:'completed',steps:[{frames:[{kind:'text',role:'assistant',text:'Recovered answer'}]}]}]});
    await runtime.sync();
    await runtime.sync();
    assert.equal(events.filter(e=>e.type==='assistant/message').length,1);
    assert.equal(events.filter(e=>e.type==='user/message').length,0);
    assert.equal(events.findLast(e=>e.type==='kimi/run').data.status,'completed');
    assert.equal(agent.phase.lastTurn,2);
  } finally {await rm(directory,{recursive:true,force:true});}
});

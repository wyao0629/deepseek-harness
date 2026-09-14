import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { CodexAppServer, CodexLlmAdapter } from '../vendor/codex-adapter.mjs';
import { startBridge } from '../lib/bridge.mjs';
import { encodeRoute } from '../lib/route.mjs';
import { threadRoute } from '../lib/host.mjs';

const testRoot = process.env.DSH_CODEX_TEST_ROOT ?? join(process.cwd(), '功能测试', 'dsh-codex', 'fixtures');
await mkdir(testRoot, { recursive: true });
const cwd = await mkdtemp(join(testRoot, 'native-'));
const home = join(cwd, 'codex-home'); await mkdir(home);
let calls=0, toolObserved=false, reviewing=false;
const ctx={llm:{resolveModelInfo:async()=>({}),async *stream(options){
  calls++; assert.equal(options.provider,'fixture-provider'); assert.equal(options.model,'fixture-non-gpt');
  const result=options.messages.flatMap(m=>m.content).find(b=>b.type==='tool-result' && JSON.stringify(b).includes('DSH_NATIVE_TOOL_OK'));
  if(result) toolObserved=true;
  if(calls===1){
    const tool=options.tools.find(t=>/exec_command$/.test(t.name));
    if(!tool) throw Error('Missing native exec_command: '+options.tools.map(t=>t.name).join(','));
    yield {type:'block-end',index:0,block:{type:'tool-call',id:'native_test_call',name:tool.name,arguments:JSON.stringify({cmd:'printf DSH_NATIVE_TOOL_OK',max_output_tokens:100})}};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }else{
    yield {type:'text-delta',index:0,text:reviewing ? JSON.stringify({findings:[],overall_correctness:'patch is correct',overall_explanation:'Fixture has no issues.',overall_confidence_score:1}) : toolObserved?'NATIVE_CODEX_OK':'NO_TOOL_RESULT'};
    yield {type:'finish',reason:{kind:'stop'}};
  }
}}};
const bridge=await startBridge(ctx,{port:0,token:'fixture-token'});
const port=bridge.address().port;
let child=spawn((process.env.CODEX_BIN ?? 'codex'),['app-server','--listen','stdio://'],{cwd,env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});
let errors='';child.stderr.on('data',b=>errors+=b.toString());
let server=new CodexAppServer(child.stdout,child.stdin);
const signal=AbortSignal.timeout(45000);
try{
  await server.initialize(signal);
  const route=threadRoute(encodeRoute('fixture-provider','fixture-non-gpt'),'fixture-non-gpt',port,'fixture-token');
  const tid=await server.startThread(cwd,'fixture-non-gpt',signal,false,route);
  let terminal;
  for await(const event of server.runTurn({threadId:tid,input:[{type:'text',text:'Run the shell command printf DSH_NATIVE_TOOL_OK, then summarize.',text_elements:[]}],model:'fixture-non-gpt',cwd,approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}},async()=>({decision:'decline'}),signal)){
    if(event.type==='turn-completed')terminal=event.turn;
  }
  assert.equal(terminal?.status,'completed',JSON.stringify(terminal));assert.ok(toolObserved);
  server.close(); child.kill();
  await new Promise(r=>child.once('exit',r));
  child=spawn((process.env.CODEX_BIN ?? 'codex'),['app-server','--listen','stdio://'],{cwd,env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',b=>errors+=b.toString());
  server=new CodexAppServer(child.stdout,child.stdin);
  await server.initialize(signal);
  await server.resumeThread(tid,signal,route);
  for await (const event of server.runTurn({threadId:tid,input:[{type:'text',text:'Confirm the previous tool result is still in context.',text_elements:[]}],model:'fixture-non-gpt',cwd,approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}},async()=>({decision:'decline'}),signal)) {
    if(event.type==='turn-completed') assert.equal(event.turn.status,'completed');
  }
  const read=await server.request('thread/read',{threadId:tid,includeTurns:true},signal);
  assert.equal(read.thread.id,tid);assert.ok(read.thread.turns.length>0);
  const events=[];
  const session={id:'fixture-dsh-session',header:{cwd},snapshotEvents:()=>events.slice(),append(type,data,opts){
    assert.equal(opts?.ignorable,true,'External events must survive DSH persistence reads');
    events.push({type,data,seq:events.length,time:Date.now(),ignorable:true});
  }};
  const adapter=new CodexLlmAdapter({sessions:{get:()=>session},agents:{get:()=>undefined},attachments:{},sandboxPolicy:{resolve:()=>({mode:"danger-full-access",workspaceRoot:cwd})},approval:{effectivePolicy:()=>"never"}},{get:async()=>server},{commandOutputLimitBytes:262144});
  for await(const chunk of adapter.stream({provider:'codex',model:'fixture-non-gpt',selectedProvider:'fixture-provider',codexRoute:route,sessionId:session.id,
    messages:[{id:'fixture-message',role:'user',source:{kind:'user'},content:[{type:'text',text:'Reply NATIVE_CODEX_OK'}]}],signal})) {
    if(chunk.type==='finish') assert.equal(chunk.reason.kind,'stop');
  }
  assert.ok(events.some(e=>e.type==='codex/thread-bound'));
  assert.ok(events.some(e=>e.type==='codex/turn'&&e.data.status==='completed'));
  reviewing = true;
  let reviewStatus;
  for await (const event of server.runTurn({ threadId: tid, target: { type: 'uncommittedChanges' }, delivery: 'inline' }, async () => ({decision:'decline'}), signal, 'review/start')) {
    if (event.type === 'turn-completed') reviewStatus = event.turn.status;
  }
  assert.equal(reviewStatus, 'completed');
  console.log(JSON.stringify({nativeReviewCompleted:true,nativeThread:tid,persisted:true,restartedAndResumed:true,turnCount:read.thread.turns.length,providerCalls:calls,nativeToolExecuted:toolObserved,testHome:home}));
}catch(e){console.error(e.message);console.error(errors.slice(-3000));process.exitCode=1}
finally{server.close();child.kill();bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}

import { KimiRuntime } from '../lib/host.mjs';
import { encodeRoute } from '../../dsh-codex/lib/route.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const cwd = '/home/harness/workspace/功能测试/dsh-kimi/native-smoke';
await mkdir(cwd, { recursive: true });
const events = [];
const session = { id: randomUUID(), header: { cwd }, snapshotEvents: () => events, append: (type, data) => events.push({ type, data }) };
const agent = { session, status: 'running' };
let calls = 0;
let questions = 0;
const ctx = { logger: console, sessions: {}, agents: { get: () => agent },
  userQuestions: { ask: async ({ questions: items }) => { questions++; return { answers: items.map(q => ({ id: q.id, selected: [], custom: 'KIMI_FREE_ANSWER' })) }; } },
  sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) }, approval: { effectivePolicy: () => 'never' },
  llm: { resolveModelInfo: async () => ({ name: 'Native protocol fixture', context: { contextWindow: 131072 }, inputModalities: ['text', 'image'] }),
    async *stream(options) {
      calls++;
      await writeFile(cwd + '/model-request.json', JSON.stringify({tools:options.tools.map(t=>t.name),messages:options.messages}));
      if (process.env.TEST_QUESTION === '1' && calls === 1) {
        assert.ok(options.tools.some(t => t.name === 'AskUserQuestion'));
        yield { type: 'block-start', index: 0, blockType: 'tool-call', id: 'native-question-test', name: 'AskUserQuestion' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'native-question-test', name: 'AskUserQuestion', arguments: JSON.stringify({ questions: [{ question: 'Which ETL name?', header: 'ETL', options: [{label:'Alpha',description:''},{label:'Beta',description:''}], multi_select:false }] }) } };
        yield { type:'finish',reason:{kind:'tool-calls'} }; return;
      }
      if (process.env.TEST_QUESTION === '1' && calls === 2) assert.match(JSON.stringify(options.messages), /KIMI_FREE_ANSWER/);
      if (process.env.TEST_SWARM === '1' && calls === 1) {
        assert.ok(options.tools.some(t=>t.name==='AgentSwarm'));
        yield { type:'block-start',index:0,blockType:'tool-call',id:'native-swarm-test',name:'AgentSwarm' };
        yield { type:'block-end',index:0,block:{type:'tool-call',id:'native-swarm-test',name:'AgentSwarm',arguments:JSON.stringify({description:'Native swarm acceptance',prompt_template:'Reply with the item: {{item}}',items:['alpha','beta'],subagent_type:'explore'})} };
        yield { type:'finish',reason:{kind:'tool-calls'} }; return;
      }
      yield { type:'block-start',index:0,blockType:'text' };
      yield { type:'text-delta',index:0,text:'KIMI_NATIVE_READY' };
      yield { type:'block-end',index:0,block:{type:'text',text:'KIMI_NATIVE_READY'} };
      yield { type:'finish',reason:{kind:'stop'} };
    } }, attachments: {},
};
const runtime = new KimiRuntime(ctx, { baseUrl:'http://127.0.0.1:18793',tokenFile:'/home/harness/.kimi-code/server.token',bridgePort:18795,requestTimeoutMs:30000,pollMs:500 });
runtime.ready = runtime.start();
try {
  await runtime.ready; clearInterval(runtime.timer);
  const chunks=[];
  for await (const chunk of runtime.run({provider:'kimi',model:encodeRoute('fixture','kimi-fixture'),sessionId:session.id,messages:[{role:'user',source:{kind:'user'},content:[{type:'text',text:'Reply KIMI_NATIVE_READY'}]}],signal:AbortSignal.timeout(90000)})) chunks.push(chunk);
  console.log(JSON.stringify({calls,chunks,nativeId:events.findLast(e=>e.type==='kimi/binding')?.data.nativeId,eventTypes:[...new Set(events.filter(e=>e.type==='kimi/event').map(e=>e.data.frame.type))]}));
  await writeFile(cwd+'/events.json',JSON.stringify(events));
  assert.ok(chunks.some(c=>c.type==='text-delta' && c.text.includes('KIMI_NATIVE_READY')));
  if(process.env.TEST_SWARM==='1') assert.ok(calls>=4, `Expected parent + two native children + parent continuation; got ${calls}`);
  if(process.env.TEST_QUESTION==='1') assert.equal(questions,1,'Native question must wait for and consume the DSH answer');
  if(process.env.TEST_CLI==='1') {
    const nativeId=events.findLast(e=>e.type==='kimi/binding').data.nativeId;
    const result=await promisify(execFile)('/opt/kimi-code/bin/kimi',['--session',nativeId,'-p','CLI_KIMI_BACKFLOW'],{cwd,timeout:45000});
    const messages=await runtime.native.messages(nativeId);
    await writeFile(cwd+'/cli-check.json',JSON.stringify({stdout:result.stdout,stderr:result.stderr,messages}));
    assert.ok(messages.some(m=>m.content.some(c=>c.text?.includes('CLI_KIMI_BACKFLOW'))),'Native web backend must observe CLI continuation');
    assert.equal(await runtime.native.refreshExternal(nativeId), true);
    const transcript = await runtime.native.transcript(nativeId);
    assert.ok(transcript.turns.some(turn => turn.prompt?.includes('CLI_KIMI_BACKFLOW')), 'Native execution cache must reload CLI history, not only the message projection');
    console.log('CLI_BACKFLOW_PASSED');
  }
} finally { await runtime.stop(); }

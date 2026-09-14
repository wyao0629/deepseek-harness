import test from 'node:test';
import assert from 'node:assert/strict';
import {KimiRuntime} from '../lib/host.mjs';
import {encodeRoute} from '../../dsh-codex/lib/route.mjs';

test('native connection failure records a terminal state and releases the execution owner',async()=>{
  const events=[];
  const agent={session:{id:'test-session',append:(type,data)=>events.push({type,data})}};
  const runtime=new KimiRuntime({agents:{get:()=>agent}},{});
  runtime.bind=async()=>({nativeId:'native-test'});
  runtime.native.call=async()=>({usage:{}});
  runtime.native.subscribe=async()=>{throw Error('connection closed')};
  await assert.rejects(async()=>{for await(const chunk of runtime.run({model:encodeRoute('test','model'),sessionId:agent.session.id,messages:[]})) void chunk},/connection closed/);
  assert.equal(events.at(-1).data.status,'failed');
  assert.equal(events.at(-1).data.error,'connection closed');
  assert.equal(runtime.busy.size,0);
  assert.equal(runtime.running.size,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { KimiRuntime } from '../lib/host.mjs';

test('DSH never-ask approves tools while native user questions still wait for an answer', async () => {
  const sent = []; let asks = 0;
  const runtime = new KimiRuntime({
    approval: { effectivePolicy: () => 'never' },
    userQuestions: { ask: async () => { asks++; return {answers:[{id:'q1',custom:'User choice'}]}; } },
  }, {});
  runtime.native.call = async (path, body) => {
    if (body) { sent.push({path,body}); return {}; }
    if (path.includes('/approvals?')) return {items:[{approval_id:'a1',tool_name:'Bash',action:'execute'}]};
    if (path.includes('/questions?')) return {items:[{question_id:'question',questions:[{id:'q1',question:'Which task?',options:[]}]}]};
    throw new Error(path);
  };
  await runtime.interactions({session:{append(){}}},{nativeId:'test'},new AbortController().signal);
  assert.equal(asks, 1);
  assert.deepEqual(sent[0].body, {decision:'approved'});
  assert.deepEqual(sent[1].body.answers.q1, {kind:'other',text:'User choice'});
});

test('DSH interactive approval can reject a native tool', async () => {
  const sent=[];
  const runtime = new KimiRuntime({approval:{effectivePolicy:()=> 'on-request'},userQuestions:{ask:async()=>({answers:[{selected:['拒绝']}]})}},{});
  runtime.native.call=async(path,body)=> {
    if(body) { sent.push(body);return {}; }
    return {items:path.includes('/approvals?')?[{approval_id:'a1',tool_name:'Bash',action:'execute'}]:[]};
  };
  await runtime.interactions({session:{}},{nativeId:'test'},new AbortController().signal);
  assert.deepEqual(sent,[{decision:'rejected'}]);
});

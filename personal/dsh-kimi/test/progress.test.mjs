import test from 'node:test';
import assert from 'node:assert/strict';
import { progressTurn } from '../lib/progress.mjs';
test('progress omits repeated transcript bodies while preserving tool and swarm status', () => {
  const turn = {turnId:'t',state:'running',prompt:'p'.repeat(1000000),steps:[{frames:[
    {kind:'text',text:'a'.repeat(1000000)},
    {kind:'tool',frameId:'f',name:'AgentSwarm',state:'running',input:'i'.repeat(1000000),agentRefs:[{agentId:'child'}]},
  ]}]};
  const result = progressTurn(turn);
  assert.ok(JSON.stringify(result).length < 1000);
  assert.equal(result.steps[0].frames[0].name,'AgentSwarm');
  assert.equal(result.steps[0].frames[0].agentRefs[0].agentId,'child');
  assert.equal(turn.prompt.length,1000000);
  assert.equal(progressTurn({...turn,state:'completed'}).state,'completed');
});

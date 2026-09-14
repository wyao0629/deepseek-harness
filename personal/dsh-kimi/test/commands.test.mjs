import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePrompt, commandHelp} from '../lib/commands.mjs';

test('swarm task becomes a native prompt with mode and preserved attachments',()=>{
  const image={type:'image',source:{kind:'path',path:'/tmp/test.png'}};
  assert.deepEqual(nativePrompt([{type:'text',text:'/swarm 检查 ETL\n返回结果'},image]),{
    swarm_mode:true,content:[{type:'text',text:'检查 ETL\n返回结果'},image],
  });
});
test('ordinary prompts remain unchanged and goals use native goal objective',()=>{
  const content=[{type:'text',text:'调查 ETL'}];
  assert.deepEqual(nativePrompt(content),{content});
  assert.deepEqual(nativePrompt([{type:'text',text:'/goal 修复 ETL'}]),{content:[{type:'text',text:'修复 ETL'}],goal_objective:'修复 ETL'});
});
test('menu command help is Chinese and status needs no fake argument',()=>{
  for(const [description] of Object.values(commandHelp)) assert.match(description,/[\u4e00-\u9fff]/);
  assert.equal(commandHelp.status[1],'');
});

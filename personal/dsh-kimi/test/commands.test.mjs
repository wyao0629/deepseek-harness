import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePrompt, nativeSubmission, commandHelp, skillCommands} from '../lib/commands.mjs';

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

test('native built-in and dotted skill names retain their CLI spelling',()=>{
  const skills=[{name:'update-config',source:'builtin',type:'inline'},{name:'sub-skill.review',source:'builtin',type:'inline'},{name:'etl',source:'project',type:'prompt'}];
  assert.deepEqual(skillCommands(skills).map(s=>s.name),['update-config','sub-skill.review','skill:etl','etl']);
  const file={type:'file',file_id:'attachment'};
  assert.deepEqual(nativePrompt([{type:'text',text:'/sub-skill.review 检查调度'},file],skills),{content:[{type:'text',text:'检查调度'},file],skills:[{name:'sub-skill.review',args:'检查调度'}]});
  assert.deepEqual(nativePrompt([{type:'text',text:'/skill:update-config 检查配置'}],skills),{content:[{type:'text',text:'检查配置'}],skills:[{name:'update-config',args:'检查配置'}]});
  assert.equal(nativePrompt([{type:'text',text:'/update-config'}],skills).content[0].text,'执行技能 update-config');
  const request=nativePrompt([{type:'text',text:'/update-config'}],skills);
  assert.equal('prompt_id' in nativeSubmission('owned-id',request),false);
  assert.equal(nativeSubmission('owned-id',{content:[{type:'text',text:'hello'}]}).prompt_id,'owned-id');
});

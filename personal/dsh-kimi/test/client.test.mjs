import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('native activity shows Chinese summary and keeps internal identifiers inside diagnostics',()=>{
  let panel,definition;
  const jsx=(type,props)=>({type,...props});
  vm.runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:entry=>{
    entry.factory(()=>({jsx,jsxs:jsx})).apply({uiConversation:{events:{register:d=>definition=d}},slots:{inject:(_,f)=>f(),register:(_,p)=>panel=p}});
  }}}});
  let state={nativeId:'session-private-id',status:'running',frames:[]};
  state=definition.update({state},{event:{type:'kimi/run',data:{status:'failed',error:'进度写入失败'}}});
  const view=panel({node:{data:state}});
  assert.equal(view.type,'section');
  const summary=JSON.stringify(view.children[0]);
  assert.match(summary,/执行失败/);
  assert.doesNotMatch(summary,/session-private-id|native subagents/);
  assert.equal(view.children[1].role,'alert');
  assert.equal(view.children.at(-1).type,'details');
  assert.equal(view.children.at(-1).open,undefined);
  assert.match(JSON.stringify(view.children.at(-1)),/session-private-id/);
});

function renderer() {
 let panel, definition;
 const jsx=(type,props)=>({type,...props});
 vm.runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:entry=>{
  entry.factory(()=>({jsx,jsxs:jsx})).apply({uiConversation:{events:{register:d=>definition=d}},slots:{inject:(_,f)=>f(),register:(_,p)=>panel=p}});
 }}}});
 return {panel,definition};
}
test('interleaved agents keep separate thinking, output, steps and a unique live count',()=>{
 const {panel,definition}=renderer();let state={nativeId:'n',status:'running',frames:[],agents:{}};
 const send=(type,agentId,p={})=>{state=definition.update({state},{event:{type:'kimi/event',data:{frame:{type,payload:{agentId,...p}}}}});};
 for(const id of ['A','B','A']) send('agent.created',id);
 for(const id of ['A','B']) {send('turn.started',id,{turnId:0,prompt:'Task '+id});send('turn.step.started',id,{turnId:0,stepId:'s1'});}
 send('thinking.delta','A',{turnId:0,delta:'thought A'});
 send('thinking.delta','B',{turnId:0,delta:'thought B'});
 send('assistant.delta','main',{turnId:0,delta:'main only'});
 send('assistant.delta','B',{turnId:0,delta:'answer B'});
 send('assistant.delta','A',{turnId:0,delta:'answer A'});
 send('turn.step.started','A',{turnId:0,stepId:'s2'});
 send('assistant.delta','A',{turnId:0,delta:'next A'});
 send('turn.ended','A',{turnId:0,reason:'completed'});
 assert.equal(Object.keys(state.agents).length,2);
 assert.equal(state.agents.A.turns['0'].steps.s1.thinking,'thought A');
 assert.equal(state.agents.B.turns['0'].steps.s1.text,'answer B');
 assert.equal(state.agents.A.turns['0'].steps.s2.text,'next A');
 const view=panel({node:{data:state}});const rendered=JSON.stringify(view);
 assert.match(rendered,/已派出 2 个子 Agent/);
 assert.match(rendered,/执行中 1 · 已完成 1/);
 const list=view.children.find(c=>c?.['data-kimi-agent-list']);
 assert.doesNotMatch(JSON.stringify(list.children[1]),/answer B|thought B|main only/);
 assert.doesNotMatch(JSON.stringify(list.children[2]),/answer A|thought A|main only/);
 assert.ok(state.frames.every(f=>!JSON.stringify(f).includes('thought')));
});
test('authoritative child transcript replaces streamed text and restores independent reasoning',()=>{
 const {definition}=renderer();let state={frames:[],agents:{}};
 state=definition.update({state},{event:{type:'kimi/event',data:{frame:{type:'assistant.delta',payload:{agentId:'a',turnId:0,delta:'partial'}}}}});
 const data={agentId:'a',turns:[{turnId:'t0',state:'completed',prompt:'task',steps:[{stepId:'s',frames:[{kind:'thinking',text:'private thought'},{kind:'text',role:'assistant',text:'full answer'}]}]}]};
 for(let i=0;i<2;i++) state=definition.update({state},{event:{type:'kimi/agent-transcript',data}});
 assert.equal(Object.keys(state.agents.a.turns).length,1);
 assert.equal(state.agents.a.turns.t0.steps.s.text,'full answer');
 assert.equal(state.agents.a.turns.t0.steps.s.thinking,'private thought');
 assert.equal(state.agents.a.status,'completed');
});

test('completed cluster stays outside the earlier folded process range',()=>{
 const {definition}=renderer();
 const state=definition.update({state:{frames:[],agents:{}}},{event:{seq:90,type:'kimi/run',data:{status:'completed'}}});
 const node=definition.buildViewNode({state,start:{event:{seq:10},location:{kind:'turn',turn:{end:{seq:100}}}},key:'k',id:'p'});
 assert.equal(node.anchorSeq,100);
});

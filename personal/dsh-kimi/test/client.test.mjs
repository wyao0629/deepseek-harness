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
  assert.doesNotMatch(summary,/session-private-id|native subagents|0 个/);
  assert.equal(view.children[1].role,'alert');
  assert.equal(view.children.at(-1).type,'details');
  assert.equal(view.children.at(-1).open,undefined);
  assert.match(JSON.stringify(view.children.at(-1)),/session-private-id/);
});

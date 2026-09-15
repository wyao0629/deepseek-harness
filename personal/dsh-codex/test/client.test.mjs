import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Codex collaboration deduplicates tool phases and isolates each receiving agent',()=>{
 const defs=[],panels={};const jsx=(type,props)=>({type,...props});
 vm.runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:e=>e.factory(()=>({jsx,jsxs:jsx})).apply({uiConversation:{events:{register:d=>defs.push(d)}},slots:{inject:(_,f)=>f(),register:(r,p)=>panels[r.key]=p}})}}});
 const definition=defs.find(d=>d.kind==='codex-run');let state={status:'completed',items:[],approvals:[]};
 const item={itemId:'spawn1',kind:'collabAgentToolCall',phase:'started',detail:JSON.stringify({receiverThreadIds:['a','b'],agentsStates:{a:{status:'running'},b:{status:'running'}},prompt:'task'})};
 state=definition.update({state},{event:{type:'codex/item',data:item}});
 state=definition.update({state},{event:{type:'codex/item',data:{...item,phase:'completed',detail:JSON.stringify({receiverThreadIds:['a','b'],agentsStates:{a:{status:'completed',message:'ALPHA'},b:{status:'completed',message:'BETA'}}})}}});
 assert.equal(state.items.length,1);
 const view=panels['codex-run']({node:{data:state}});
 assert.match(JSON.stringify(view.children[0]),/已派出 2 个子 Agent/);
 assert.match(JSON.stringify(view.children[1][0]),/ALPHA/);
 assert.doesNotMatch(JSON.stringify(view.children[1][0]),/BETA/);
 assert.match(JSON.stringify(view.children[1][1]),/BETA/);
});

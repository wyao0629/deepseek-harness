import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('bundled plugin declares nested RPC dependency and copies paginated Markdown', async () => {
 let plugin, copied, closed=false
 const actions=[]; const calls=[]; const effects=[]
 const event=(seq,type,text)=>({type:'event',event:{seq,type,data:type==='user/message'?{content:[{type:'text',text}]}:{message:{content:[{type:'text',text}]}}}})
 const sandbox={URL,AbortController,AbortSignal,Blob,console,
  window:{location:{href:'https://example.test/?token=hidden'},__ModuleLoader__:{load:entry=>{plugin=entry.factory()}}},
  navigator:{clipboard:{write:async items=>{copied=await (await items[0].data['text/plain']).text()}}},
  ClipboardItem:class {constructor(data){this.data=data}},
 }
 vm.runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),sandbox)
 const session={async *follow(request){calls.push(request);try{yield {type:'snapshot',cursor:9,records:[event(8,'assistant/message','```sql\nselect 1;\n```')],hasMore:true}}finally{closed=true}},async page(request){calls.push(request);return {ok:true,value:{records:[event(2,'user/message','用户问题')],hasMore:false}}}}
 const remote=new Proxy({}, {get(_,key){if(!plugin.inject.includes('remote.'+key))throw new Error(`cannot get property "remote.${key}" without inject`);return session}})
 plugin.apply({effect:fn=>effects.push(fn()),remote,sessions:{list:{getSnapshot:()=>({byId:{clicked:{title:'验收',cwd:'/test'}}})}},uiWorkspace:{registerSessionMenuAction:a=>{actions.push(a);return ()=>{}}}})
 await actions.find(a=>a.id.endsWith('.markdown')).run('clicked')
 assert(closed);assert.equal(calls.length,2);assert.equal(calls[0].address.sessionId,'clicked')
 assert(copied.includes('## 用户'));assert(copied.includes('select 1;'));assert(!copied.includes('hidden'))
 assert(copied.indexOf('用户问题')<copied.indexOf('select 1'))
 for(const dispose of effects)dispose?.()
})

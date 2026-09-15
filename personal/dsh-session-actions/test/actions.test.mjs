import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionLink, markdown, readConversation } from '../lib/actions.mjs'
const record = (seq, type, content) => ({type:'event',event:{seq,type,data:type==='assistant/message'?{message:{content}}:{content}}})
test('link targets clicked session and strips credentials', () => {
 const link=sessionLink('https://example.test:8443/?token=SECRET#private','session-one')
 assert.equal(link,'https://example.test:8443/?dshSession=session-one')
})
test('markdown orders pages, deduplicates and excludes thoughts and tools', () => {
 const a=record(4,'assistant/message',[{type:'thinking',text:'private'},{type:'text',text:'```sql\nselect 1;\n```'}])
 const out=markdown([a,record(2,'user/message',[{type:'text',text:'hello'}]),a,record(3,'tool/result',[{type:'text',text:'tool'}])],'Test','https://example.test')
 assert(out.indexOf('hello')<out.indexOf('select 1'))
 assert.equal(out.match(/select 1/g).length,1)
 assert(!out.includes('private')); assert(!out.includes('tool'))
})
test('reads all pages at the opening cut and closes follow', async () => {
 let closed=false; const requests=[]
 const remote={session:{async *follow(){try{yield {type:'snapshot',cursor:10,records:[record(8,'user/message',[])],hasMore:true}}finally{closed=true}},async page(r){requests.push(r);return {ok:true,value:{records:[record(1,'user/message',[])],hasMore:false}}}}}
 const result=await readConversation(remote,'clicked',new AbortController().signal)
 assert.equal(result.length,2);assert(closed);assert.equal(requests[0].throughSeq,10);assert.equal(requests[0].beforeSeq,8);assert.equal(requests[0].address.sessionId,'clicked')
})
test('pagination errors reject instead of copying incomplete history', async () => {
 const remote={session:{async *follow(){yield {type:'snapshot',cursor:10,records:[record(8,'user/message',[])],hasMore:true}},async page(){return {ok:false,error:{message:'offline'}}}}}
 await assert.rejects(readConversation(remote,'a',new AbortController().signal),/offline/)
})

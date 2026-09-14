window.__ModuleLoader__.load({ id: "dsh-kimi", factory: (require) => {
const { jsx, jsxs } = require('react/jsx-runtime');
const definition = {
 kind: 'kimi-native-event', target: 'chat',
 match: event => {
   if (event.type === 'kimi/run') return {id:event.data.promptId,role:event.data.status==='running'?'start':'update'};
   if (['kimi/event','kimi/transcript','kimi/progress'].includes(event.type)) return {id:event.data.promptId,role:'update'};
   if (event.type === 'kimi/imported-turn') return {id:event.data.nativeId+'/'+event.data.turnId,role:'start'};
   return null;
 },
 start: (_, match) => ({nativeId:match.event.data.nativeId,status:match.event.data.status??match.event.data.turn?.state,frames:[],turn:match.event.data.turn}),
 update: (context,match) => {
   const {type,data}=match.event;
   if(type==='kimi/run') return {...context.state,status:data.status};
   if(type==='kimi/transcript'||type==='kimi/progress') return {...context.state,turn:data.turn};
   const frame=data.frame;
   if(/(?:assistant|thinking|tool.call)\.delta$/.test(frame.type)) return context.state;
   return {...context.state,frames:[...context.state.frames,frame]};
 },
 buildViewNode: c => !c.start ? null : ({key:c.key,kind:'kimi-native-event',id:c.id,target:'chat',anchorSeq:c.start.event.seq,location:c.start.location,visibility:'visible',data:c.state}),
};
function Panel({node}) {
 const {nativeId,status,frames,turn}=node.data;
 const relevant=frames.filter(f=>/^(?:subagent\.|agent.created|tool\.|event\.(?:question|approval))/.test(f.type));
 const children=new Set(relevant.map(f=>f.payload?.agentId).filter(id=>id&&id!=='main'));
 const tools=(turn?.steps??[]).flatMap(step=>step.frames??[]).filter(frame=>frame.kind==='tool');
 for(const tool of tools) for(const agent of tool.agentRefs??[]) children.add(agent.agentId);
 return jsxs('details',{children:[
   jsx('summary',{children:`Kimi · ${status??'running'} · ${children.size} native subagents`}),
   jsx('code',{children:nativeId}),
   ...tools.map(tool=>jsxs('details',{children:[jsx('summary',{children:`${tool.name} · ${tool.state}`}),jsx('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'},children:JSON.stringify({input:tool.input,output:tool.output,error:tool.error,progress:tool.progress,agents:tool.agentRefs},null,2)})]},tool.frameId)),
   ...relevant.map((frame,i)=>jsxs('details',{children:[jsx('summary',{children:`${frame.payload?.agentId??'main'} · ${frame.type}`}),jsx('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'},children:JSON.stringify(frame.payload,null,2)})]},i)),
   turn?jsxs('details',{children:[jsx('summary',{children:'Native persisted transcript'}),jsx('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'},children:JSON.stringify(turn,null,2)})]}):null
 ]});
}
return { inject: ['uiConversation','slots'], apply(ctx) {
 ctx.uiConversation.events.register(definition);
 ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key:'kimi-native-event'},Panel));
}};
}});

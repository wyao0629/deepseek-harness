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
   if(type==='kimi/run') return {...context.state,status:data.status,error:data.error};
   if(type==='kimi/transcript'||type==='kimi/progress') return {...context.state,turn:data.turn};
   const frame=data.frame;
   if(!frame || /(?:assistant|thinking|tool.call)\.delta$/.test(frame.type)) return context.state;
   return {...context.state,frames:[...context.state.frames,frame]};
 },
 buildViewNode: c => !c.start ? null : ({key:c.key,kind:'kimi-native-event',id:c.id,target:'chat',anchorSeq:c.start.event.seq,location:c.start.location,visibility:'visible',data:c.state}),
};
function Panel({node}) {
 const {nativeId,status,frames,turn,error}=node.data;
 const labels = {running:'执行中',completed:'已完成',failed:'执行失败',cancelled:'已取消',aborted:'已取消',pending:'等待执行',success:'已完成',error:'失败'};
 const label = value => labels[value] ?? '处理中';
 const relevant=frames.filter(f=>/^(?:subagent\.|agent.created|tool\.|event\.(?:question|approval))/.test(f.type));
 const children=new Set(relevant.map(f=>f.payload?.agentId??f.payload?.agent_id).filter(id=>id&&id!=='main'));
 const tools=(turn?.steps??[]).flatMap(step=>step.frames??[]).filter(frame=>frame.kind==='tool');
 for(const tool of tools) for(const agent of tool.agentRefs??[]) if(agent.agentId&&agent.agentId!=='main') children.add(agent.agentId);
 const textStyle={whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:280,overflow:'auto',fontSize:'0.85em'};
 return jsxs('section',{'data-kimi-run':status,style:{fontSize:'0.9em',color:'inherit',border:'1px solid color-mix(in srgb, currentColor 14%, transparent)',borderRadius:12,padding:'10px 14px',margin:'8px 0'},children:[
   jsxs('div',{style:{display:'flex',gap:10,alignItems:'center'},children:[jsx('span',{style:{fontWeight:600},children:'Kimi'}),jsx('span',{style:{opacity:0.7},children:label(status??turn?.state??'running')}),children.size?jsx('span',{style:{opacity:0.7},children:`${children.size} 个协作智能体`}):null,tools.length?jsx('span',{style:{opacity:0.7},children:`${tools.length} 次工具调用`}):null]}),
   error?jsx('p',{role:'alert',style:{...textStyle,margin:'8px 0 0'},children:error}):null,
   tools.length?jsxs('details',{style:{marginTop:8},children:[jsx('summary',{style:{cursor:'pointer',opacity:0.75},children:'执行过程'}),...tools.map(tool=>jsxs('details',{style:{marginTop:6},children:[jsx('summary',{children:`${tool.name} · ${label(tool.state)}`}),jsx('pre',{style:textStyle,children:JSON.stringify({input:tool.input,output:tool.output,error:tool.error,agents:tool.agentRefs},null,2)})]},tool.frameId))]}):null,
   jsxs('details',{style:{marginTop:8,opacity:0.65},children:[jsx('summary',{style:{cursor:'pointer'},children:'诊断信息'}),jsx('p',{style:textStyle,children:`原生会话：${nativeId}`}),jsx('pre',{style:textStyle,children:JSON.stringify({status,events:relevant},null,2)})]})
 ]});
}
return { inject: ['uiConversation','slots'], apply(ctx) {
 ctx.uiConversation.events.register(definition);
 ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key:'kimi-native-event'},Panel));
}};
}});

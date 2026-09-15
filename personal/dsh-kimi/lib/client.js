window.__ModuleLoader__.load({ id: "dsh-kimi", factory: (require) => {
const { jsx, jsxs } = require('react/jsx-runtime');
// Each native agent owns its own timeline. Never concatenate different agents' text.
const agentId = frame => frame.payload?.agentId ?? frame.payload?.agent_id ?? frame.agent_id;
const emptyAgent = id => ({id,status:'pending',turns:{}});
function reduceAgent(agents, frame) {
 const id=agentId(frame), p=frame.payload??{};
 if(!id || id==='main') return agents;
 const previous=agents[id]??emptyAgent(id);
 const a={...previous,turns:{...previous.turns}};
 if(frame.type==='agent.status.updated' && p.phase?.kind) a.status=p.phase.kind;
 if(frame.type==='turn.started') a.status='running';
 if(frame.type==='turn.ended') a.status=p.reason??'completed';
 if(p.turnId!==undefined) {
  const key=String(p.turnId), t={...(a.turns[key]??{task:'',steps:{}})};
  t.steps={...t.steps};
  if(frame.type==='turn.started') t.task=p.prompt??'';
  if(frame.type==='turn.step.started') t.activeStep=p.stepId??String(p.step);
  const step=t.activeStep??'stream';
  if(frame.type==='assistant.delta'||frame.type==='thinking.delta') {
   const part={...(t.steps[step]??{text:'',thinking:''})};
   const field=frame.type==='assistant.delta'?'text':'thinking';
   part[field]+=typeof p.delta==='string'?p.delta:'';
   t.steps[step]=part;
  }
  a.turns[key]=t;
 }
 return {...agents,[id]:a};
}
function transcriptAgents(agents, turn) {
 let result={...agents};
 for(const step of turn?.steps??[]) for(const frame of step.frames??[]) {
  for(const ref of frame.agentRefs??[]) {
   if(ref.agentId&&ref.agentId!=='main') result[ref.agentId]??=emptyAgent(ref.agentId);
  }
 }
 return result;
}
function savedAgent(agents, data) {
 const a={...(agents[data.agentId]??emptyAgent(data.agentId)),turns:{}};
 for(const turn of data.turns??[]) {
  a.status=turn.state;
  a.turns[turn.turnId]={task:turn.prompt??'',steps:Object.fromEntries((turn.steps??[]).map(step=>[step.stepId,{
   text:(step.frames??[]).filter(f=>f.kind==='text'&&f.role==='assistant').map(f=>f.text??'').join(''),
   thinking:(step.frames??[]).filter(f=>f.kind==='thinking').map(f=>f.text??'').join(''),
  }]))};
 }
 return {...agents,[data.agentId]:a};
}
const definition = {
 kind: 'kimi-native-event', target: 'chat',
 match: event => {
   if (event.type === 'kimi/run') return {id:event.data.promptId,role:event.data.status==='running'?'start':'update'};
   if (['kimi/event','kimi/transcript','kimi/progress','kimi/agent-transcript'].includes(event.type)) return {id:event.data.promptId,role:'update'};
   if (event.type === 'kimi/imported-turn') return {id:event.data.nativeId+'/'+event.data.turnId,role:'start'};
   return null;
 },
 start: (_, match) => ({nativeId:match.event.data.nativeId,status:match.event.data.status??match.event.data.turn?.state,frames:[],agents:transcriptAgents({},match.event.data.turn),turn:match.event.data.turn}),
 update: (context,match) => {
   const {type,data}=match.event;
   if(type==='kimi/run') return {...context.state,status:data.status,error:data.error,...(data.status!=='running'?{finalSeq:match.event.seq}:{})};
   if(type==='kimi/transcript'||type==='kimi/progress') return {...context.state,turn:data.turn,agents:transcriptAgents(context.state.agents??{},data.turn)};
   if(type==='kimi/agent-transcript') return {...context.state,agents:savedAgent(context.state.agents??{},data)};
   const frame=data.frame;
   if(!frame) return context.state;
   const agents=reduceAgent(context.state.agents??{},frame);
   // Diagnostics keep event metadata, not duplicate prompts, context or token streams.
   const keep=/^(?:agent.created|turn.ended|event\.(?:question|approval))/.test(frame.type);
   const frames=keep?[...context.state.frames,{type:frame.type,agentId:agentId(frame),time:frame.timestamp}]:context.state.frames;
   return {...context.state,agents,frames};
 },
 buildViewNode: c => !c.start ? null : ({key:c.key,kind:'kimi-native-event',id:c.id,target:'chat',anchorSeq:c.start.location?.turn?.end?.seq??c.state.finalSeq??c.start.event.seq,location:c.start.location,visibility:'visible',data:c.state}),
};
function Panel({node}) {
 const {nativeId,status,frames,turn,error}=node.data;
 const agents=Object.values(node.data.agents??{});
 const labels = {running:'执行中',completed:'已完成',failed:'执行失败',cancelled:'已取消',aborted:'已取消',pending:'等待执行',success:'已完成',error:'失败',done:'已完成',idle:'等待',waiting:'等待',interrupted:'已取消'};
 const label = value => labels[value] ?? '处理中';
 const tools=(turn?.steps??[]).flatMap(step=>step.frames??[]).filter(frame=>frame.kind==='tool');
 const counts={completed:0,running:0,failed:0,pending:0};
 for(const a of agents) {
  if(['completed','done','success'].includes(a.status)) counts.completed++;
  else if(['failed','error','cancelled','aborted'].includes(a.status)) counts.failed++;
  else if(a.status==='running') counts.running++;
  else counts.pending++;
 }
 const textStyle={whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:280,overflow:'auto',fontSize:'0.85em'};
 return jsxs('section',{'data-kimi-run':status,style:{fontSize:'0.9em',color:'inherit',border:'1px solid color-mix(in srgb, currentColor 14%, transparent)',borderRadius:12,padding:'10px 14px',margin:'8px 0'},children:[
   jsxs('div',{style:{display:'flex',gap:10,alignItems:'center'},children:[jsx('span',{style:{fontWeight:600},children:'Kimi'}),jsx('span',{style:{opacity:0.7},children:label(status??turn?.state??'running')}),jsx('span',{'data-kimi-agent-count':agents.length,style:{opacity:0.7},children:`已派出 ${agents.length} 个子 Agent`}),tools.length?jsx('span',{style:{opacity:0.7},children:`${tools.length} 次工具调用`}):null]}),
   error?jsx('p',{role:'alert',style:{...textStyle,margin:'8px 0 0'},children:error}):null,
   agents.length?jsxs('div',{'data-kimi-agent-list':true,style:{marginTop:10},children:[
    jsx('div',{style:{opacity:0.7,marginBottom:8},children:`执行中 ${counts.running} · 已完成 ${counts.completed} · 失败/取消 ${counts.failed} · 等待 ${counts.pending}`}),
    ...agents.map((a,index)=>jsxs('details',{'data-kimi-agent':a.id,open:true,style:{borderTop:'1px solid color-mix(in srgb, currentColor 12%, transparent)',padding:'8px 0'},children:[
     jsx('summary',{style:{cursor:'pointer',fontWeight:600},children:`子 Agent ${index+1} · ${label(a.status)}`}),
     ...Object.values(a.turns).map((t,i)=>jsxs('div',{children:[
      t.task?jsxs('details',{children:[jsx('summary',{children:'任务说明'}),jsx('p',{style:textStyle,children:t.task.replace(/^<git-context[^>]*\/>\s*/,'')})]}):null,
      ...Object.values(t.steps).map((step,j)=>jsxs('div',{'data-kimi-agent-step':j,children:[
       step.thinking?jsxs('details',{children:[jsx('summary',{children:`思考 · 第 ${j+1} 步`}),jsx('p',{style:textStyle,children:step.thinking})]}):null,
       step.text?jsxs('div',{children:[jsx('small',{style:{opacity:0.6},children:`输出 · 第 ${j+1} 步`}),jsx('p',{style:{...textStyle,margin:'4px 0 10px'},children:step.text})]}):null,
      ]},j)),
     ]},i)),
     Object.keys(a.turns).length?null:jsx('p',{style:{opacity:0.6},children:'等待该子 Agent 的输出…'}),
    ]},a.id)),
   ]}):null,
   tools.length?jsxs('details',{style:{marginTop:8},children:[jsx('summary',{style:{cursor:'pointer',opacity:0.75},children:'执行过程'}),...tools.map(tool=>jsxs('details',{style:{marginTop:6},children:[jsx('summary',{children:`${tool.name} · ${label(tool.state)}`}),jsx('pre',{style:textStyle,children:JSON.stringify({input:tool.input,output:tool.output,error:tool.error,agents:tool.agentRefs},null,2)})]},tool.frameId))]}):null,
   jsxs('details',{style:{marginTop:8,opacity:0.65},children:[jsx('summary',{style:{cursor:'pointer'},children:'诊断信息'}),jsx('p',{style:textStyle,children:`原生会话：${nativeId}`}),jsx('pre',{style:textStyle,children:JSON.stringify({status,events:frames},null,2)})]})
 ]});
}
return { inject: ['uiConversation','slots'], apply(ctx) {
 ctx.uiConversation.events.register(definition);
 ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key:'kimi-native-event'},Panel));
}};
}});

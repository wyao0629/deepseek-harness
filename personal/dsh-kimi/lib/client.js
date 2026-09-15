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
 if(typeof p.model==='string') a.model=p.model;
 if(frame.type==='turn.started') {a.status='running';a.startedAt=p.time??Date.parse(frame.timestamp);}
 if(frame.type==='turn.ended') a.endedAt=p.time??Date.parse(frame.timestamp);
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
   if(ref.agentId&&ref.agentId!=='main') result[ref.agentId]={...(result[ref.agentId]??emptyAgent(ref.agentId)),...(frame.input?.subagent_type?{role:frame.input.subagent_type}:{})};
  }
 }
 return result;
}
function savedAgent(agents, data) {
 const a={...(agents[data.agentId]??emptyAgent(data.agentId)),turns:{}};
 for(const turn of data.turns??[]) {
  a.status=turn.state;
  if(turn.startedAt) a.startedAt=Date.parse(turn.startedAt);
  if(turn.endedAt) a.endedAt=Date.parse(turn.endedAt);
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
const treeStyles=`
.dsh-agent-tree{display:grid;grid-template-columns:minmax(150px, .8fr) minmax(0,2fr);gap:20px 48px;position:relative;padding:8px 0 20px;container-type:inline-size}
.dsh-agent-root,.dsh-agent-child{background:color-mix(in srgb,currentColor 5%,transparent);border:1px solid color-mix(in srgb,currentColor 7%,transparent);border-radius:18px;box-shadow:0 2px 4px #0002;min-width:0}
.dsh-agent-root{grid-column:1;align-self:center;padding:20px;position:relative}
.dsh-agent-root:after{content:'';position:absolute;height:2px;width:25px;background:color-mix(in srgb,currentColor 16%,transparent);left:100%;top:50%}
.dsh-agent-child{grid-column:2;position:relative}
.dsh-agent-child:before{content:'';position:absolute;left:-25px;top:-21px;height:calc(100% + 22px);border-left:2px solid color-mix(in srgb,currentColor 16%,transparent)}
.dsh-agent-child:nth-child(2):before{top:50%;height:calc(50% + 1px)}
.dsh-agent-child:last-child:before{height:calc(50% + 21px)}
.dsh-agent-child:after{content:'';position:absolute;left:-25px;top:50%;width:25px;border-top:2px solid color-mix(in srgb,currentColor 16%,transparent)}
.dsh-agent-summary{display:flex;align-items:center;gap:14px;padding:20px;cursor:pointer;list-style:none;min-height:92px}
.dsh-agent-summary::-webkit-details-marker{display:none}
.dsh-agent-icon{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:38px;height:38px;border-radius:50%;background:color-mix(in srgb,currentColor 10%,transparent);font-size:24px}
.dsh-agent-card-head{display:flex;align-items:center;gap:12px;font-size:1.05em}
.dsh-agent-heading{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1}
.dsh-agent-task{opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-agent-meta{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;opacity:.65;font-size:.85em;max-width:45%}
.dsh-agent-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}
.dsh-agent-dot{border:2px solid currentColor;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-size:10px}
.dsh-agent-dot.running{border-right-color:transparent;animation:dsh-agent-spin 1s linear infinite}
.dsh-agent-muted{opacity:.6;line-height:1.6}.dsh-agent-child>div,.dsh-agent-child>p{margin:0 20px 16px}
@keyframes dsh-agent-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dsh-agent-dot.running{animation:none}}
@container(max-width:620px){.dsh-agent-root{grid-column:1 / -1!important;grid-row:auto!important}.dsh-agent-child{grid-column:1 / -1;margin-left:22px}.dsh-agent-root:after{display:none}.dsh-agent-summary{flex-wrap:wrap;padding:14px}.dsh-agent-meta{max-width:100%;margin-left:52px}.dsh-agent-child:before{left:-14px}.dsh-agent-child:after{left:-14px;width:14px}}
`;
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
   jsxs('div',{style:{display:'flex',gap:10,alignItems:'center'},children:[jsx('span',{style:{fontWeight:600},children:'Kimi'}),jsx('span',{style:{opacity:0.7},children:label(status??turn?.state??'running')}),jsx('span',{'data-kimi-agent-count':agents.length,style:{opacity:0.7},children:`已派出 ${agents.length} 个子 Agent · 已完成 ${counts.completed}/${agents.length}`}),tools.length?jsx('span',{style:{opacity:0.7},children:`${tools.length} 次工具调用`}):null]}),
   error?jsx('p',{role:'alert',style:{...textStyle,margin:'8px 0 0'},children:error}):null,
   agents.length?jsxs('div',{'data-kimi-agent-list':true,className:'dsh-agent-tree',style:{marginTop:20},children:[
    jsxs('div',{className:'dsh-agent-root',style:{gridRow:`1 / span ${agents.length}`},children:[
     jsx('style',{children:treeStyles}),
     jsxs('div',{className:'dsh-agent-card-head',children:[jsx('span',{className:'dsh-agent-icon',children:'◎'}),jsx('strong',{children:'主 Agent'})]}),
     jsx('p',{className:'dsh-agent-muted',children:`${counts.running?'正在协调':'已派发'} ${agents.length} 个委派任务`}),
     jsx('small',{className:'dsh-agent-muted',children:`执行中 ${counts.running} · 已完成 ${counts.completed} · 失败/取消 ${counts.failed} · 等待 ${counts.pending}`})
    ]}),
    ...agents.map((a,index)=>jsxs('details',{'data-kimi-agent':a.id,className:'dsh-agent-child',children:[
     jsxs('summary',{className:'dsh-agent-summary',children:[
      jsx('span',{className:'dsh-agent-icon',children:jsxs('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,children:[jsx('rect',{x:4,y:7,width:16,height:13,rx:3}),jsx('path',{d:'M12 3v4M8 11v4m8-4v4M1 12h3m16 0h3'})]})}),
      jsxs('span',{className:'dsh-agent-heading',children:[jsx('strong',{children:a.role??`子 Agent ${index+1}`}),jsx('span',{className:'dsh-agent-task',children:(Object.values(a.turns)[0]?.task??'等待任务信息').replace(/^<git-context[^>]*\/>\s*/,'')})]}),
      jsxs('span',{className:'dsh-agent-meta',children:[a.model?jsx('span',{className:'dsh-agent-model',title:a.model,children:a.model.split('/').at(-1)}):null,jsx('span',{children:label(a.status)}),a.startedAt?jsx('span',{children:`${Math.max(0,Math.floor(((a.endedAt??Date.now())-a.startedAt)/1000))}s`}):null,jsx('span',{className:a.status==='running'?'dsh-agent-dot running':'dsh-agent-dot',children:a.status==='completed'?'✓':''})]})
     ]}),
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

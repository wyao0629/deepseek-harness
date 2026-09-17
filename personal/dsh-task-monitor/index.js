import {homedir} from 'node:os';
import {join} from 'node:path';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {Monitor,read,save,received,queued,receiptId} from './monitor.mjs';

export const inject=['tools','sessionController','sessions','systemPrompt'];
export const name='task-monitor';
export const MODEL_GUIDANCE = `【托管调度：默认执行方式】
用户要求实际启动调度、补数、补跑、批量采集、ETL 或数仓批处理时，默认使用 task_monitor_start；用户不必说出工具名。讨论方案、编辑代码、查询状态和短小的准备检查仍正常处理，不凭关键词启动任务。
先确认项目、日期范围、已有执行脚本、运行环境及是否已有相同任务。缺少必要信息时询问；已有授权无需重复询问。不要重复启动任务。先完成必要准备，再将实际命令和绝对 cwd 交给 task_monitor_start，显式加载项目环境并按业务设置 timeout_seconds。
启动成功返回 running 表示服务器已接管，不代表完成。下一次模型请求由插件暂停直到作业结束；不要调用 sleep、反复 tail/status、输出等待话术或另起轮询代理。需要串行依赖的步骤，在前一步成功并验收后再启动。
用户主动查询时使用 task_monitor_status；明确要求取消时使用 task_monitor_cancel(job_id)。界面停止按钮仅停止 Agent 等待，不会取消作业；正在等待时用户可先点停止再发取消指令。
收到插件完成通知后检查状态、必要日志和业务完整性，再汇报或继续后续步骤。退出码 0 不等于数据完整；失败、超时、中断应诊断，不盲目自动重跑。浏览器关闭不影响作业，DSH 重启可恢复通知；主机重启不自动重跑。
此能力适用于本会话通过工具登记的服务器任务；不能宣称已接管普通 Bash 后台任务或原生 CLI 内部轮询。用户的新指令优先于默认策略。`;
export function apply(ctx,config={}) {
  ctx.effect(()=>ctx.systemPrompt.context({name:'task-monitor:usage',order:650,text:MODEL_GUIDANCE}));
  const monitor=new Monitor(config.root??join(homedir(),'.dsh','task-monitor'),config);
  const lifetime=new AbortController();const waiting=new Set();let scanning=false;let scanFlight=Promise.resolve();const gates=new Set();
  const notice=(job,result)=>({id:receiptId(job),role:'user',source:{kind:'plugin',plugin:'dsh-task-monitor'},
    content:[{type:'text',text:'后台调度作业已结束，请根据结果继续处理。退出码仅表示进程结果，业务入库是否完整仍需验收。\n'+JSON.stringify(result)}]});
  const donePath=job=>join(monitor.path(job.id),'delivered.json');
  async function acknowledge(agent,job) {
    if(!await ctx.sessions.flush(agent.session))throw Error('完成通知尚未持久化');
    await save(donePath(job),{at:Date.now()});
  }
  async function pending(agent,claimed=[]) {
    const jobs=[];for(const job of await monitor.jobs(agent.session.id)) {
      if(await read(donePath(job)))continue;
      if(received(agent,job)){await acknowledge(agent,job);continue;}
      if(!queued(agent,job)&&!claimed.some(m=>m.id===receiptId(job)))jobs.push(job);
    }return jobs;
  }
  async function own(id,agent) {
    const job=await read(join(monitor.path(id),'spec.json'));
    if(!job||job.sessionId!==agent.session.id)throw Error('任务不存在或不属于当前会话');return job;
  }
  const output={schema:{type:'string'},render:(_args,text)=>[{type:'text',text}]};
  function tool(name,description,parameters,run,title) {
    ctx.effect(()=>ctx.tools.register(defineTool({name,description,parameters,output,
      execute:async(args,exec)=>JSON.stringify(await run(args,exec)),
      presentCall:args=>({card:'generic',title,kind:'other',rawInput:args})})));
  }
  tool('task_monitor_start','启动长期调度/ETL/爬虫命令并由服务器监控。必须用此工具代替 bash 后台运行加短期轮询。启动后当前会话会真正等待，无需 sleep、tail 或反复输出等待；完成、失败、超时才继续。DSH 重启不停止作业。',{
    command:{type:'string',required:true,description:'实际运行的命令；需要的环境文件请在命令中显式加载'},
    cwd:{type:'string',description:'绝对工作目录，默认当前工作区'},
    timeout_seconds:{type:'integer',description:'最长运行秒数，默认 86400，最多 604800'}
  },async(args,exec)=>{
    exec.signal?.throwIfAborted();
    const job=await monitor.start({sessionId:exec.agent.session.id,command:args.command,cwd:args.cwd??exec.agent.session.header.cwd,timeoutSeconds:args.timeout_seconds??86400});
    return {jobId:job.id,state:'running',logPath:join(monitor.path(job.id),'output.log'),message:'已交给服务器；下一次模型请求将在任务结束后继续。'};
  },'启动并托管调度任务');
  tool('task_monitor_status','查询当前会话的托管作业。运行期间无需重复调用，等待由插件完成。',{},async(_args,exec)=>Promise.all((await monitor.jobs(exec.agent.session.id)).map(job=>monitor.status(job))),'调度任务状态');
  tool('task_monitor_cancel','取消当前会话指定的托管作业。用户点击停止只停止 Agent 等待，不停止后台作业。',{job_id:{type:'string',required:true}},async(args,exec)=>monitor.cancel(await own(args.job_id,exec.agent)),'取消调度任务');
  // Wait before delegating to model-input hooks, not by returning a retry message to the model.
  ctx.on('agent/pre-step',async({agent,signal,messages},next)=>{
    const combined=AbortSignal.any([signal,lifetime.signal]);
    let finish;const gate=new Promise(resolve=>{finish=resolve});gates.add(gate);
    try {
      combined.throwIfAborted();
      const jobs=await pending(agent,messages);
      combined.throwIfAborted();
      // Interrupt an existing wait with Stop, then submit a new instruction to inspect/cancel.
      if(messages.some(m=>m.source?.kind==='user')||!jobs.length)return await next();
      waiting.add(agent.session.id);
      const notices=[];for(const job of jobs)notices.push(notice(job,await monitor.wait(job,combined)));
      combined.throwIfAborted();
      const decision=await next();
      combined.throwIfAborted();
      return decision.kind==='reject'?decision:{...decision,messages:[...decision.messages,...notices]};
    }finally{waiting.delete(agent.session.id);finish();gates.delete(gate);}
  },{prepend:true});
  async function scan() {
    if(scanning||lifetime.signal.aborted)return;scanning=true;
    try {
      for(const job of await monitor.jobs()) {
        if(lifetime.signal.aborted)break;
        if(waiting.has(job.sessionId)||await read(donePath(job)))continue;
        const result=await monitor.status(job);if(result.state==='running')continue;
        const {agent}=await ctx.sessionController.resolveAgent(job.sessionId);if(!agent)continue;
        if(received(agent,job)){await acknowledge(agent,job);continue;}
        if(lifetime.signal.aborted)break;
        if(agent.status==='idle') {
          if(queued(agent,job))agent.inbox.remove(receiptId(job));
          agent.followup(notice(job,result));
        }
      }
    }catch(e){if(!lifetime.signal.aborted)ctx.logger.warn('调度监控恢复检查失败：'+e.message);}
    finally{scanning=false;}
  }
  ctx.effect(()=>{const tick=()=>{if(!scanning)scanFlight=scan();};const timer=setInterval(tick,5000);tick();return async()=>{lifetime.abort();clearInterval(timer);await scanFlight;await Promise.allSettled([...gates]);};});
}

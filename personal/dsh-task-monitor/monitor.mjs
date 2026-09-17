import {mkdir,readFile,writeFile,rename,readdir,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
const exec = promisify(execFile);

/** Atomic publication, with no shell interpolation of task metadata. */
export async function save(path, value) {
  const temp=path+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path);
}
export async function read(path) {
  try {return JSON.parse(await readFile(path,'utf8'));} catch(e) {if(e.code==='ENOENT')return null;throw e;}
}

/** Durable jobs run outside the DSH service control group. */
export class Monitor {
  constructor(root, options={}) {this.root=root;this.interval=options.interval??5000;this.exec=options.exec??exec;this.uid=options.uid??'harness';}
  path(id) {if(!/^[a-f0-9-]{36}$/.test(id))throw Error('任务编号无效');return join(this.root,id);}
  async jobs(sessionId) {
    await mkdir(this.root,{recursive:true,mode:0o700});
    const jobs=[];
    for(const id of await readdir(this.root)) {
      if(!/^[a-f0-9-]{36}$/.test(id))continue;
      const job=await read(join(this.root,id,'spec.json'));
      if(job && (!sessionId||job.sessionId===sessionId)) jobs.push(job);
    }
    return jobs;
  }
  async start({sessionId,command,cwd,timeoutSeconds=86400}) {
    if(typeof command!=='string'||!command.trim()||command.length>65536)throw Error('任务命令为空或过长');
    if(!isAbsolute(cwd)||!(await stat(cwd)).isDirectory())throw Error('工作目录必须是存在的绝对目录');
    if(!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>604800)throw Error('超时须为 1—604800 秒');
    const id=randomUUID(),dir=this.path(id);await mkdir(dir,{recursive:true,mode:0o700});
    const job={id,sessionId,command,cwd,timeoutSeconds,createdAt:Date.now(),unit:'dsh-job-'+id};
    await save(join(dir,'spec.json'),job);
    try {
      await this.exec('/usr/bin/sudo',['-n','/usr/bin/systemd-run','--quiet','--collect','--unit='+job.unit,
        '--uid='+this.uid,'--property=KillMode=control-group','--property=TimeoutStopSec=10',
        '--property=RuntimeMaxSec='+(timeoutSeconds+30),process.execPath,
        new URL('./runner.mjs',import.meta.url).pathname,dir],{timeout:20000});
    } catch(e) {
      await save(join(dir,'result.json'),{state:'failed',reason:'作业启动失败',finishedAt:Date.now()});throw e;
    }
    return job;
  }
  async status(job) {
    const dir=this.path(job.id),result=await read(join(dir,'result.json'));
    if(result)return {...result,jobId:job.id,logPath:join(dir,'output.log')};
    if(Date.now()-job.createdAt>30000) {
      const {stdout}=await this.exec('/usr/bin/systemctl',['show',job.unit,'--property=ActiveState','--value'],{timeout:10000});
      if(!['active','activating','deactivating'].includes(stdout.trim())) {
        const result={state:'interrupted',reason:'作业服务已停止且未写入完成结果；不会自动重跑',finishedAt:Date.now()};
        await save(join(dir,'result.json'),result);return {...result,jobId:job.id,logPath:join(dir,'output.log')};
      }
    }
    return {state:'running',jobId:job.id,logPath:join(dir,'output.log'),elapsedSeconds:Math.floor((Date.now()-job.createdAt)/1000)};
  }
  async cancel(job) {
    const status=await this.status(job);if(status.state!=='running')return status;
    await this.exec('/usr/bin/sudo',['-n','/usr/bin/systemctl','stop',job.unit],{timeout:25000});
    if(!await read(join(this.path(job.id),'result.json')))
      await save(join(this.path(job.id),'result.json'),{state:'cancelled',finishedAt:Date.now()});
    return this.status(job);
  }
  async wait(job,signal) {
    for(;;) {signal?.throwIfAborted();const result=await this.status(job);signal?.throwIfAborted();if(result.state!=='running')return result;
      await delay(this.interval,undefined,{signal});}
  }
}

/** Stable notification identity is checked against durable session/inbox events on recovery. */
export function receiptId(job) {return 'task-monitor-'+job.id;}
export function received(agent,job) {
  const id=receiptId(job);
  return agent.session.snapshotEvents().some(e=>e.type==='user/message'&&e.data.id===id);
}

export function queued(agent,job) {return [...(agent.inbox?.nextTurn??[]),...(agent.inbox?.nextStep??[])].some(m=>m.id===receiptId(job));}

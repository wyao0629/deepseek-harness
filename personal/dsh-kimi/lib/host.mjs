import { progressTurn } from './progress.mjs';
import z from '@deepseek-ai/schemastery';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Native, promptContent, selectedQuestionAnswer, turnText, snapshotSuffix, transcriptThinking } from './native.mjs';
import { startBridge } from '../../dsh-codex/lib/bridge.mjs';
import { encodeRoute, decodeRoute } from '../../dsh-codex/lib/route.mjs';
import { dshHome } from '../../dsh-codex/lib/paths.mjs';
import { commandHelp, nativePrompt, nativeSubmission, aliases } from './commands.mjs';

export const name = 'dsh-kimi';
export const inject = ['llm', 'sessions', 'agents', 'sessionController', 'userQuestions', 'attachments', 'sandboxPolicy', 'approval'];
export const Config = z.object({
  baseUrl: z.string().default('http://127.0.0.1:18793'),
  tokenFile: z.string().default(join(homedir(), '.kimi-code', 'server.token')),
  bridgePort: z.number().default(18794), requestTimeoutMs: z.number().default(30000), pollMs: z.number().default(1500),
});
const latest = session => session.snapshotEvents().findLast(e => e.type === 'kimi/binding')?.data;
const log = (session, type, data) => session.append('kimi/' + type, data, { ignorable: true });
const textOf = content => content.filter(b => b.type === 'text').map(b => b.text).join('');

export class KimiRuntime {
  constructor(ctx, config) {
    this.ctx = ctx; this.config = config; this.native = new Native(config); this.busy = new Set();
    this.directory = join(dshHome(), 'dsh-kimi'); this.models = new Map(); this.running = new Set(); this.stopped = false;
    this.lifetime = new AbortController();
    this.catalogListeners = new Map();
    this.skillCatalogs = new Map();
    this.bindingLoads = new Map();
    this.pendingInteractions = new Map();
  }
  async start() {
    await mkdir(join(this.directory, 'bindings'), { recursive: true, mode: 0o700 });
    const tokenPath = join(this.directory, 'bridge-token');
    try { this.token = (await readFile(tokenPath, 'utf8')).trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.token = randomBytes(32).toString('hex'); await writeFile(tokenPath, this.token, { mode: 0o600, flag: 'wx' }); }
    const meta = await this.native.call('/api/v1/meta');
    if (!meta.features?.some(f => f.name === 'swarm' && f.state === 'Active')) throw new Error('Native Kimi server does not expose AgentSwarm');
    this.bridge = await startBridge(this.ctx, { port: this.config.bridgePort, token: this.token });
    this.timer = setInterval(() => this.tick(), this.config.pollMs); this.timer.unref();
  }
  async save(session, binding) {
    log(session, 'binding', binding);
    const path = join(this.directory, 'bindings', session.id + '.json');
    await writeFile(path + '.tmp', JSON.stringify(binding), { mode: 0o600 }); await rename(path + '.tmp', path);
  }
  async model(route, signal) {
    const key = encodeRoute(route.provider, route.model);
    if (this.models.has(key)) return this.models.get(key);
    const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal);
    const id = 'dsh-' + createHash('sha256').update(key).digest('hex').slice(0, 16);
    const model = { model: route.model, max_context_size: info.context?.contextWindow ?? 32768,
      display_name: info.name, capabilities: ['tool_use', ...(info.inputModalities?.includes('image') ? ['image_in'] : []), ...(info.reasoning ? ['thinking'] : [])],
      ...(info.reasoning?.efforts?.length ? { support_efforts: info.reasoning.efforts.map(e => typeof e === 'string' ? e : e.id) } : {}),
    };
    const body = { id, type: 'openai_responses', api_key: this.token, base_url: `http://127.0.0.1:${this.config.bridgePort}/route/${key}`, models: [model] };
    const providers = await this.native.call('/api/v1/providers');
    const entries = Array.isArray(providers) ? providers : providers.items ?? providers.providers ?? [];
    if (entries.some(p => p.id === id)) await this.native.call('/api/v1/providers/' + id, body, 'PUT');
    else await this.native.call('/api/v1/providers', body);
    const alias = id + '/' + route.model; this.models.set(key, alias); return alias;
  }
  async ensureBinding(agent) {
    if (this.bindingLoads.has(agent.session.id)) return this.bindingLoads.get(agent.session.id);
    const load = this.createBinding(agent);
    this.bindingLoads.set(agent.session.id,load);
    try { return await load; } finally { this.bindingLoads.delete(agent.session.id); }
  }
  async createBinding(agent) {
    const session = agent.session; let binding = latest(session);
    if (!binding || binding.sessionId !== session.id) {
      const native = binding ? await this.native.call(`/api/v1/sessions/${binding.nativeId}:fork`, {})
        : await this.native.call('/api/v1/sessions', { metadata: { cwd: session.header.cwd }, title: 'DSH · ' + session.id });
      binding = { sessionId: session.id, nativeId: native.id, cwd: session.header.cwd };
      await this.save(session, binding);
    }
    return binding;
  }
  async bind(agent, route, effort, signal) {
    const session = agent.session;
    let binding = await this.ensureBinding(agent);
    if (!await this.native.refreshExternal(binding.nativeId)) throw new Error('该会话仍由原生 Kimi CLI 或后台任务使用；请结束该轮并退出 CLI 后再从 DSH 接续。');
    const permissions = this.ctx.sandboxPolicy.resolve({ session });
    // The native REST server is not an OS filesystem sandbox. Never label unrestricted execution as workspace isolation.
    if (permissions.mode !== 'danger-full-access') throw new Error('Kimi native backend requires a filesystem-isolated worker for this DSH permission mode; execution was not started.');
    if ((await this.native.call(`/api/v1/sessions/${binding.nativeId}`)).busy) throw new Error('该 Kimi 会话正在原生端运行，请等待完成后再从 DSH 接续。');
    const alias = await this.model(route, signal);
    // Keep native questions interactive; native auto mode would answer them without the user.
    // Tool approval decisions are delegated to DSH below, including its never-ask policy.
    const agentConfig = { model: alias, permission_mode: 'manual', ...(effort ? { thinking: effort } : {}) };
    await this.native.call(`/api/v1/sessions/${binding.nativeId}/profile`, { agent_config: agentConfig });
    binding = { ...binding, provider: route.provider, model: route.model };
    await this.save(session, binding);
    await this.refreshCatalog(session.id,binding.nativeId);
    return binding;
  }
  async refreshCatalog(sessionId,nativeId) {
    const result=await this.native.call(`/api/v1/sessions/${nativeId}/skills`);
    const skills = result.items ?? result.skills ?? [];
    this.skillCatalogs.set(sessionId,skills);
    for(const callback of this.catalogListeners.get(sessionId) ?? []) callback(skills);
  }
  async interactions(agent, binding, signal) {
    const root = `/api/v1/sessions/${binding.nativeId}`;
    const approvals = await this.native.call(root + '/approvals?status=pending');
    for (const request of approvals.items) {
      if (this.ctx.approval.effectivePolicy(agent.session) === 'never') {
        await this.native.call(root + '/approvals/' + request.approval_id, {decision:'approved'});
        log(agent.session, 'approval', {nativeId:binding.nativeId,approvalId:request.approval_id,decision:'approved',policy:'never'});
        continue;
      }
      const answer = await this.ctx.userQuestions.ask({ agent, signal, questions: [{ id: request.approval_id, header: 'Kimi 权限',
        question: `${request.tool_name}: ${request.action}`, detail: JSON.stringify(request.tool_input_display),
        options: [{ label: '允许一次' }, { label: '本会话允许' }, { label: '拒绝' }] }] });
      const choice = answer.answers[0]?.selected[0];
      await this.native.call(root + '/approvals/' + request.approval_id, { decision: ['允许一次', '本会话允许'].includes(choice) ? 'approved' : 'rejected', ...(choice === '本会话允许' ? { scope: 'session' } : {}), ...(answer.answers[0]?.custom ? { feedback: answer.answers[0].custom } : {}) });
    }
    const questions = await this.native.call(root + '/questions?status=pending');
    for (const request of questions.items) {
      const answers = {};
      for (let offset = 0; offset < request.questions.length; offset += 3) {
        const batch = request.questions.slice(offset, offset + 3);
        const answer = await this.ctx.userQuestions.ask({ agent, signal, questions: batch.map(q => ({ id: q.id, question: q.question,
          ...(q.header ? { header: q.header } : {}), ...(q.body ? { detail: q.body } : {}), options: q.options.map(o => ({ label: o.label, ...(o.description ? { description: o.description } : {}) })), ...(q.multi_select ? { multiSelect: true } : {}) })) });
        for (const q of batch) answers[q.id] = selectedQuestionAnswer(q, answer.answers.find(a => a.id === q.id));
      }
      await this.native.call(root + '/questions/' + request.question_id, { answers, method: 'click' });
    }
  }
  async *run(options) {
    await this.ready;
    const route = decodeRoute(options.model);
    if (options.purpose !== undefined || !options.sessionId) { yield* this.ctx.llm.stream({ ...options, ...route }); return; }
    const agent = this.ctx.agents.get(options.sessionId);
    if (!agent) throw new Error('Kimi request has no live DSH agent');
    if (this.busy.has(agent.session.id)) throw new Error('Kimi session already running');
    this.busy.add(agent.session.id);
    let settled; const completion=new Promise(resolve=>{settled=resolve;});this.running.add(completion);
    const signal = AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]);
    let socket, binding, submitted = false, beforeUsage;
    const queue = []; let wake;
    const push = frame => { queue.push(frame); wake?.(); wake = undefined; };
    let promptId = randomUUID(); let output = '', reasoning = '', startedText = false, startedReasoning = false;
    let lastDelta = Date.now(), snapshotMode = false, progressHash;
    try {
      binding = await this.bind(agent, route, options.reasoningEffort, signal);
      beforeUsage=(await this.native.call(`/api/v1/sessions/${binding.nativeId}`)).usage;
      socket = await this.native.subscribe(binding.nativeId, push);
      const human = options.messages.findLast(m => m.role === 'user' && m.source?.kind === 'user');
      if (!human) throw new Error('No user input for Kimi');
      const request = nativePrompt(await promptContent(this.ctx, human), this.skillCatalogs.get(agent.session.id));
      const accepted = await this.native.call(`/api/v1/sessions/${binding.nativeId}/prompts`, nativeSubmission(promptId, request)); submitted = true;
      if (request.skills) promptId = accepted.prompt_id;
      log(agent.session, 'run', { nativeId: binding.nativeId, promptId, status: 'running' });
      let finished = false;
      while (!finished || queue.length) {
        signal.throwIfAborted();
        if (!finished && socket.readyState === 3) socket = await this.native.subscribe(binding.nativeId, push);
        while (queue.length) {
          const frame = queue.shift();
          if (!frame.session_id) continue;
          log(agent.session, 'event', { nativeId: binding.nativeId, promptId, frame });
          const p = frame.payload ?? {};
          if (/assistant\.delta$/.test(frame.type) && (!(p.agent_id ?? p.agentId) || (p.agent_id ?? p.agentId) === 'main')) {
            if (snapshotMode) continue;
            lastDelta = Date.now();
            const delta = p.delta ?? p.text ?? ''; if (typeof delta !== 'string') continue;
            if (!startedText) { yield { type: 'block-start', index: 0, blockType: 'text' }; startedText = true; }
            output += delta; yield { type: 'text-delta', index: 0, text: delta };
          } else if (/thinking\.delta$/.test(frame.type) && (!(p.agent_id ?? p.agentId) || (p.agent_id ?? p.agentId) === 'main')) {
            if (snapshotMode) continue;
            lastDelta = Date.now();
            const delta = p.delta ?? p.text ?? ''; if (typeof delta !== 'string') continue;
            if (!startedReasoning) { yield { type: 'block-start', index: 1, blockType: 'reasoning' }; startedReasoning = true; }
            reasoning += delta; yield { type: 'reasoning-delta', index: 1, text: delta };
          }
        }
        if (finished) break;
        await this.interactions(agent, binding, signal);
        const prompts = await this.native.call(`/api/v1/sessions/${binding.nativeId}/prompts`);
        finished = !prompts.active && !(prompts.queued?.length);
        if (snapshotMode || Date.now() - lastDelta > this.config.pollMs * 2) {
          const page = await this.native.call(`/api/v1/sessions/${binding.nativeId}/transcript?agent_id=main&page_size=1`);
          const turn = page.items.find(item => item.triggerPromptId === promptId);
          if (turn) {
            // Once recovering from persisted frames, keep one text authority for this turn.
            snapshotMode = true;
            const progress = progressTurn(turn);
            const hash = createHash('sha256').update(JSON.stringify(progress)).digest('hex');
            if (hash !== progressHash) { log(agent.session, 'progress', {nativeId:binding.nativeId,promptId,turn:progress}); progressHash = hash; }
            const text = snapshotSuffix(output, turnText(turn));
            const thought = snapshotSuffix(reasoning, transcriptThinking(turn));
            if (thought) {
              if (!startedReasoning) { yield {type:'block-start',index:1,blockType:'reasoning'}; startedReasoning=true; }
              reasoning += thought; yield {type:'reasoning-delta',index:1,text:thought};
            }
            if (text) {
              if (!startedText) { yield {type:'block-start',index:0,blockType:'text'}; startedText=true; }
              output += text; yield {type:'text-delta',index:0,text};
            }
          }
        }
        if (!finished) await Promise.race([delay(this.config.pollMs, undefined, { signal }), new Promise(resolve => { wake = resolve; })]);
      }
      const { turns } = await this.native.transcript(binding.nativeId, binding.nativePromptId ? {turnId:binding.nativeTurnId,promptId:binding.nativePromptId} : undefined);
      const current = turns.find(turn => turn.triggerPromptId === promptId);
      const answer = current ? turnText(current) : '';
      if (current) log(agent.session, 'transcript', { nativeId: binding.nativeId, promptId, turn: current });
      if (answer && answer.startsWith(output) && answer.length > output.length) {
        if (!startedText) { yield { type: 'block-start', index: 0, blockType: 'text' }; startedText = true; }
        const remainder = answer.slice(output.length); output = answer;
        yield { type: 'text-delta', index: 0, text: remainder };
      }
      if (startedReasoning) { yield { type: 'block-end', index: 1, block: { type: 'reasoning', text: reasoning } }; startedReasoning=false; }
      if (answer) output = answer;
      if (startedText) { yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }; startedText=false; }
      const state = await this.native.call(`/api/v1/sessions/${binding.nativeId}`);
      if(current?.usage) {
        const usage=current.usage;
        yield {type:'usage',usage:{inputTokens:usage.inputTokens??0,outputTokens:usage.outputTokens??0,cacheReadTokens:usage.cachedTokens??0}};
      } else if(state.usage && beforeUsage) {
        const delta=key=>Math.max(0,(state.usage[key]??0)-(beforeUsage[key]??0));
        const usage={inputTokens:delta('input_tokens'),outputTokens:delta('output_tokens'),cacheReadTokens:delta('cache_read_tokens'),cacheWriteTokens:delta('cache_creation_tokens')};
        if(Object.values(usage).some(value=>value>0)) yield {type:'usage',usage};
      }
      binding = { ...binding, ...(current ? { nativeTurnId: current.turnId, nativePromptId: current.triggerPromptId } : {}) };
      await this.save(agent.session, binding);
      log(agent.session, 'run', { nativeId: binding.nativeId, promptId, status: state.last_turn_reason ?? 'completed' });
      const failed = ['failed', 'cancelled', 'aborted'].includes(current?.state ?? state.last_turn_reason);
      yield { type: 'finish', reason: failed ? { kind: 'error', failure: { code: 'KIMI_NATIVE', message: `Native Kimi turn ${current?.state ?? state.last_turn_reason}; inspect the Kimi trace.` } } : { kind: 'stop' }, replayState: { response: { nativeId: binding.nativeId, promptId } } };
    } catch (error) {
      if (binding) log(agent.session, 'run', {nativeId:binding.nativeId,promptId,status:signal.aborted?'cancelled':'failed',error:error instanceof Error?error.message:String(error)});
      if (signal.aborted) throw error;
      if (startedReasoning) yield {type:'block-end',index:1,block:{type:'reasoning',text:reasoning}};
      if (startedText) yield {type:'block-end',index:0,block:{type:'text',text:output}};
      yield {type:'finish',reason:{kind:'error',failure:{code:'KIMI_BRIDGE',message:error instanceof Error?error.message:String(error)}}};
    } finally {
      if (signal.aborted && submitted && options.signal?.aborted) await this.native.call(`/api/v1/sessions/${binding.nativeId}:abort`, {}).catch(e => this.ctx.logger.warn(e.message));
      socket?.close(); this.busy.delete(agent.session.id);settled();this.running.delete(completion);
    }
  }
  tick() {
    if (this.stopped || this.scan) return;
    this.scan = this.sync().catch(e => this.ctx.logger.warn('Kimi sync: ' + e.message)).finally(() => { this.scan = undefined; });
  }
  async command(invocation, command) {
    await this.ready;
    command = aliases[command] ?? command;
    let raw = invocation.rawInput.trim();
    if (command === 'kimi') { const first = raw.indexOf(' '); command = first < 0 ? raw || 'help' : raw.slice(0, first); raw = first < 0 ? '' : raw.slice(first + 1).trim(); }
    if (command === 'help') return { kind: 'success', text: Object.entries(commandHelp).map(([name,[text]])=>`/${name} — ${text}`).join('\n') };
    if (command === 'version') return {kind:'success',text:JSON.stringify(await this.native.call('/api/v1/meta'),null,2)};
    if (command.startsWith('skill:') || (command === 'swarm' && raw && !['on','off'].includes(raw)) || (command === 'goal' && raw && !['status','pause','resume','cancel'].includes(raw))) {
      await this.ctx.sessionController.prompt({sessionId:invocation.agent.session.id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:`/${command} ${raw}`} ]},invocation.signal);
      return {kind:'success',text:'任务已提交到当前 Kimi 会话，执行结果将显示在对话中。'};
    }
    const binding = await this.ensureBinding(invocation.agent);
    const root = `/api/v1/sessions/${binding.nativeId}`;
    if (command === 'resume') return { kind: 'success', text: `服务器原生会话：${binding.nativeId}\ncd ${JSON.stringify(binding.cwd)} && /opt/kimi-code/bin/kimi --session ${binding.nativeId}` };
    return invocation.agent.runMaintenance(async () => {
      let result;
      if(command==='model' || command==='effort') {
        const [provider,model,effort]=command==='model'?raw.split(/\s+/):[binding.provider,binding.model,raw];
        if(!provider || !model) return {kind:'success',text:`当前模型：${binding.provider}/${binding.model}\n/model <provider> <model> [effort]`};
        const info=await this.ctx.llm.resolveModelInfo(provider,model,invocation.signal);
        if(effort && !(info.reasoning?.efforts??[]).some(e=>(typeof e==='string'?e:e.id)===effort)) return {kind:'error',text:'当前模型未声明此推理强度。'};
        result=await this.ctx.sessionController.selectModel({sessionId:invocation.agent.session.id,provider,model,...(effort?{reasoningEffort:effort}:{})});
        if(result.error) return {kind:'error',text:JSON.stringify(result.error)};
      } else if(command.startsWith('skill:')) {
        result=await this.native.call(root+'/skills/'+encodeURIComponent(command.slice(6))+':activate',{args:raw});
      } else if (command === 'status' || command === 'usage') result = await this.native.call(root + (command === 'status' ? '/status' : ''));
      else if (command === 'compact') {
        await this.native.call(root + ':compact', raw ? { instruction: raw } : {});
        result={state:'started',message:'Kimi 原生压缩已启动，完成后才会应用新上下文。'};
      }
      else if (['plan', 'swarm'].includes(command)) {
        if (raw && !['on', 'off'].includes(raw)) return { kind: 'error', text: `/${command} on|off` };
        const enabled = raw ? raw === 'on' : !(await this.native.call(root+'/status'))[command+'_mode'];
        result = await this.native.call(root + '/profile', { agent_config: { [command + '_mode']: enabled } });
      } else if (command === 'title') {
        if(raw.length>200) return {kind:'error',text:'标题不能超过 200 个字符。'};
        result = raw ? await this.native.call(root+'/profile',{title:raw}) : {title:(await this.native.call(root)).title};
      } else if (command === 'goal') {
        result = !raw || raw==='status' ? await this.native.call(root+'/goal') : await this.native.call(root+'/profile',{agent_config:{goal_control:raw}});
      } else if (command === 'tasks') result = await this.native.call(root + '/tasks');
      else if (command === 'skills') result = await this.native.call(root + '/skills');
      else if (command === 'mcp') result = await this.native.call('/api/v1/mcp/servers');
      else return { kind: 'error', text: `尚未适配的 Kimi 命令：${command}` };
      log(invocation.agent.session, 'control', { command, result });
      await this.ctx.sessions.flush(invocation.agent.session);
      return { kind: 'success', text: JSON.stringify(result, null, 2) };
    });
  }
  async sync() {
    for (const filename of await readdir(join(this.directory, 'bindings'))) {
      if (!filename.endsWith('.json')) continue;
      const disk = JSON.parse(await readFile(join(this.directory, 'bindings', filename), 'utf8'));
      if (this.busy.has(disk.sessionId)) continue;
      const resolved = await this.ctx.sessionController.resolveAgent(disk.sessionId); if (resolved.error) continue;
      const agent = resolved.agent; if (agent.status !== 'idle') continue;
      const binding = latest(agent.session); if (!binding || binding.nativeId !== disk.nativeId) continue;
      if (await this.native.cliActive(binding.nativeId)) continue;
      const state = await this.native.call(`/api/v1/sessions/${binding.nativeId}`);
      if (state.busy) {
        if (!this.pendingInteractions.has(binding.sessionId)) {
          const pending = this.interactions(agent, binding, this.lifetime.signal)
            .catch(error => { if (!this.lifetime.signal.aborted) this.ctx.logger.warn('Kimi interaction: ' + error.message); })
            .finally(() => this.pendingInteractions.delete(binding.sessionId));
          this.pendingInteractions.set(binding.sessionId, pending);
        }
        continue;
      }
      if (this.pendingInteractions.has(binding.sessionId)) continue;
      if (!await this.native.refreshExternal(binding.nativeId)) continue;
      const { turns } = await this.native.transcript(binding.nativeId, binding.nativePromptId ? {turnId:binding.nativeTurnId,promptId:binding.nativePromptId} : undefined);
      const ownEvents = agent.session.snapshotEvents();
      const ownPrompts = new Set(ownEvents.filter(e=>e.type==='kimi/run').map(e=>e.data.promptId));
      const failedPrompts = new Set(ownEvents.filter(e=>e.type==='kimi/run' && e.data.status==='failed').map(e=>e.data.promptId));
      const savedTranscripts = new Set(ownEvents.filter(e=>e.type==='kimi/transcript').map(e=>e.data.promptId));
      const imported = new Set(agent.session.snapshotEvents().filter(e=>e.type==='kimi/imported-turn').map(e=>e.data.nativeId + '/' + e.data.turn.triggerPromptId));
      const pending = turns.filter(t=>typeof t.triggerPromptId==='string' && ['completed','failed','cancelled'].includes(t.state) && (!ownPrompts.has(t.triggerPromptId) || (failedPrompts.has(t.triggerPromptId) && !savedTranscripts.has(t.triggerPromptId))) && !imported.has(binding.nativeId+'/'+t.triggerPromptId));
      if (!pending.length) continue;
      if (agent.phase?.kind !== 'idle' || !Number.isInteger(agent.phase.lastTurn)) throw new Error('Unsupported DSH maintenance cursor');
      await agent.runMaintenance(async () => {
        const session = agent.session; let number=agent.phase.lastTurn;
        for (const turn of pending) {
          const content = await this.native.userContent(binding.nativeId, turn, this.ctx.attachments);
          number++;
          session.append('turn/start', { turn:number }); session.append('step/start', { turn:number, step:1 });
          const prefix=`kimi-${binding.nativeId}-${turn.triggerPromptId}`;
          if(content.length && !ownPrompts.has(turn.triggerPromptId)) session.append('user/message',{id:prefix+'-user',role:'user',content,source:{kind:'user'}},{surfaceOp:'append'});
          const answer=turnText(turn);
          if(answer) session.append('assistant/message',{turn:number,step:1,message:{id:prefix+'-answer',role:'assistant',content:[{type:'text',text:answer}],source:{kind:'model',provider:'kimi',model:encodeRoute(binding.provider,binding.model)}},stream:[]},{surfaceOp:'append'});
          if (ownPrompts.has(turn.triggerPromptId)) {
            log(session,'transcript',{nativeId:binding.nativeId,promptId:turn.triggerPromptId,turn});
            log(session,'run',{nativeId:binding.nativeId,promptId:turn.triggerPromptId,status:turn.state,recovered:true});
          } else log(session,'imported-turn',{nativeId:binding.nativeId,turnId:turn.turnId,turn});
          session.append('step/end',{turn:number,step:1}); session.append('turn/end',{turn:number,reason:turn.state==='completed'?{kind:'completed'}:{kind:'aborted',reason:{kind:'legacy'}}});
        }
        await this.save(session, { ...binding, nativeTurnId:pending.at(-1).turnId, nativePromptId:pending.at(-1).triggerPromptId }); agent.phase.lastTurn = number;
        await this.ctx.sessions.flush(session);
      });
    }
  }
  async stop() { this.stopped = true; clearInterval(this.timer); this.lifetime.abort(); await Promise.allSettled([...this.running, ...this.pendingInteractions.values()]);await this.scan; if (this.bridge) await new Promise(resolve => this.bridge.close(resolve)); }
}

export function apply(ctx, config) {
  const runtime = new KimiRuntime(ctx, config);
  runtime.ready = runtime.start(); runtime.ready.catch(e => ctx.logger.error('Kimi startup: ' + e.message));
  ctx.provide('dshKimi', runtime);
  const resolveModel = async (_provider, id, signal) => ({ ...await ctx.llm.resolveModelInfo(decodeRoute(id).provider, decodeRoute(id).model, signal), provider: 'kimi', id });
  ctx.llm.registerAdapter(['kimi'], { providerInfo: () => ({id:'kimi',name:'Kimi'}), providerRetryPolicy: () => ({mode:'normal',maxRetries:0,retryableCodes:[],initialDelayMs:500,maxDelayMs:10000,jitterRatio:0.1}), listModels: async () => [], resolveModel, prepareCall: async (provider, id, signal) => ({ model: await resolveModel(provider, id, signal), stream: options => runtime.run(options) }), stream: options => runtime.run(options) });
  ctx.effect(function* () { yield async () => { await runtime.ready.catch(() => {}); await runtime.stop(); }; }, 'Kimi native bridge');
}

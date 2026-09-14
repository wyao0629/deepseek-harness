import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { CodexSupervisor, CodexLlmAdapter, latestBinding, permissionSettings, interactionHandler, visibleTranscript, transcriptHash } from '../vendor/codex-adapter.mjs';
import { encodeRoute } from './route.mjs';

const exec = promisify(execFile);
const last = (session, type) => [...session.snapshotEvents()].reverse().find(e => e.type === type)?.data;
const append = (session, type, data) => session.append(type, data, { ignorable: true });
const success = text => ({ kind: 'success', text });
export const commandHelp = `/codex status | compact | model <provider> <model> [effort] | effort <value>
/codex permissions [read-only|workspace-write|danger-full-access] [ask|never]
/codex network on|off · /codex add-dir <absolute path>
/codex plan on|off · /codex review [uncommitted|base <branch>|commit <sha>]
/codex diff · /codex skills · /codex mcp · /codex resume
Codex 预设中的 /compact、/status、/plan、/review、/diff 同样可用。
模型和权限也可使用 DSH 原有选择器；new/fork 等会话管理沿用 DSH 界面。`;

/** Commands operate on the bound native thread, never send slash text to a model. */
export function createControls(ctx, config, ready, routeFor, busy, persist) {
  const active = new Set();
  const lifetime = new AbortController();
  async function execute(invocation, action, args) {
    const { agent, signal } = invocation;
    const session = agent.session;
    let binding = latestBinding(session.snapshotEvents());
    if (action === 'help' || !action) return success(commandHelp);
    if (!binding) throw new Error('请先在 Codex 预设中发送一条消息，建立原生会话。');
    if (action === 'status' || action === 'resume') {
      const policy = permissionSettings(ctx, session, session.header.cwd);
      const usage = last(session, 'codex/context-usage');
      return success(action === 'resume' ? `服务器上的原生 session：${binding.threadId}\nnode <dsh-codex安装目录>/lib/resume.mjs ${binding.threadId}` :
        JSON.stringify({ threadId: binding.threadId, provider: binding.selectedProvider, model: binding.selectedModel, effort: binding.reasoningEffort ?? 'default', permissions: policy,
          nativeContext: usage ?? null, contextWindow: usage?.modelContextWindow ?? binding.contextWindow ?? null,
          lastCompaction: last(session, 'codex/compacted') ?? null }, null, 2));
    }
    if (busy.has(String(session.id)) || agent.status !== 'idle') throw new Error('请等待当前执行完成后再更改原生会话。');
    if (action === 'model' || action === 'effort') {
      const [provider, model, effort] = action === 'effort' ? [binding.selectedProvider, binding.selectedModel, args.trim()] : args.trim().split(/\s+/);
      if (!provider || !model || (action === 'effort' && !effort)) throw new Error('用法：/codex model <provider> <model> [effort] 或 /codex effort <value>');
      const info = await ctx.llm.resolveModelInfo(provider, model, signal);
      const efforts = (info.reasoning?.efforts ?? []).map(e => typeof e === 'string' ? e : e.id);
      if (effort && !efforts.includes(effort)) throw new Error(`该提供方支持的推理强度：${efforts.join(', ') || '无可配置档位'}`);
      const result = await ctx.sessionController.selectModel({ sessionId: session.id, provider, model, ...(effort ? { reasoningEffort: effort } : {}) });
      if (result.error) throw new Error(JSON.stringify(result.error));
      return success(`已选择 ${provider}/${model}${effort ? ' · ' + effort : ''}；下轮原生执行生效。`);
    }
    if (['permissions', 'network', 'add-dir', 'plan'].includes(action)) {
      return agent.runMaintenance(async () => {
        const settings = last(session, 'codex/settings') ?? {};
        if (action === 'permissions') {
          const [mode, approval] = args.trim().split(/\s+/);
          if (!['read-only', 'workspace-write', 'danger-full-access'].includes(mode) || (approval && !['ask', 'never'].includes(approval))) throw new Error('权限：read-only / workspace-write / danger-full-access，可附加 ask / never');
          session.append('sandbox/mode', { mode });
          if (approval) session.append('approval/policy', { policy: approval });
        } else if (action === 'add-dir') {
          if (!isAbsolute(args.trim())) throw new Error('请提供绝对路径。');
          append(session, 'codex/settings', { ...settings, writableRoots: [...new Set([...(settings.writableRoots ?? []), args.trim()])] });
        } else {
          const value = args.trim() || (action === 'plan' ? 'on' : '');
          if (!['on', 'off'].includes(value)) throw new Error('参数必须为 on 或 off');
          append(session, 'codex/settings', { ...settings, ...(action === 'network' ? { networkAccess: value === 'on' } : { collaborationMode: value === 'on' ? 'plan' : 'default' }) });
        }
        binding = { ...binding, permissions: permissionSettings(ctx, session, session.header.cwd) };
        append(session, 'codex/thread-bound', binding);
        await persist(binding);
        await ctx.sessions.flush(session);
        return success('已保存；下轮 Codex 执行生效。');
      });
    }
    if (action === 'diff' || action === 'review') {
      try { await exec('git', ['rev-parse', '--show-toplevel'], { cwd: session.header.cwd, signal }); }
      catch { throw new Error('当前工作区不是 Git 仓库；请在目标 Git 工作区使用 diff/review。'); }
    }
    if (action === 'diff') {
      const result = await exec('git', ['diff', 'HEAD', '--'], { cwd: session.header.cwd, signal, maxBuffer: 1024 * 1024 });
      return success(result.stdout || '没有已跟踪文件的差异。');
    }
    if (!['compact', 'review', 'skills', 'mcp'].includes(action)) throw new Error(commandHelp);
    return agent.runMaintenance(async () => {
      busy.add(String(session.id));
      const supervisor = new CodexSupervisor(ctx, { ...config, nativeArgs: binding.contextWindow ? ['-c', `model_context_window=${binding.contextWindow}`, '-c', `model_auto_compact_token_limit=${Math.floor(binding.contextWindow * 0.8)}`] : [] });
      try {
        const { port, token } = await ready;
        const route = routeFor(encodeRoute(binding.selectedProvider, binding.selectedModel), binding.selectedModel, port, token);
        if (binding.contextWindow) route.config.model_context_window = binding.contextWindow;
        const effective = permissionSettings(ctx, session, session.header.cwd);
        route.sandbox = effective.mode;
        route.approvalPolicy = effective.approvalPolicy;
        if (binding.reasoningEffort) route.config.model_reasoning_effort = binding.reasoningEffort;
        const server = await supervisor.get(session.header.cwd, signal);
        await server.resumeThread(binding.threadId, signal, route);
        if (action === 'skills' || action === 'mcp') {
          const value = await server.request(action === 'skills' ? 'skills/list' : 'mcpServerStatus/list', action === 'skills' ? { cwds: [session.header.cwd] } : {}, signal);
          return success(JSON.stringify(value, null, 2));
        }
        const policy = permissionSettings(ctx, session, session.header.cwd);
        const handler = interactionHandler({ session, agent, userQuestions: ctx.userQuestions, approvalPolicy: policy.approvalPolicy === 'never' ? 'never' : 'ask', maxBytes: config.commandOutputLimitBytes, signal });
        let target = { type: 'uncommittedChanges' };
        if (action === 'review' && args.trim()) {
          const [kind, value] = args.trim().split(/\s+/);
          if (kind === 'base' && value) target = { type: 'baseBranch', branch: value };
          else if (kind === 'commit' && value) target = { type: 'commit', sha: value };
          else if (kind !== 'uncommitted') throw new Error('用法：/review [uncommitted|base <branch>|commit <sha>]');
        }
        const request = { threadId: binding.threadId, ...(action === 'review' ? { target, delivery: 'inline' } : {}) };
        const adapter = new CodexLlmAdapter(ctx, supervisor, config);
        let text = '', turnId, status;
        for await (const chunk of adapter.projectRun(server.runTurn(request, handler, signal, action === 'compact' ? 'thread/compact/start' : 'review/start'), session, { model: binding.selectedModel })) {
          if (chunk.type === 'text-delta') text += chunk.text;
          if (chunk.type === 'finish') { turnId = chunk.replayState?.response?.turnId; status = chunk.replayState?.response?.status; }
        }
        if (status !== 'completed') throw new Error(`原生 ${action} 未完成：${status}`);
        if (action === 'compact') append(session, 'codex/compacted', { threadId: binding.threadId, turnId, time: Date.now() });
        // Command results are human-visible but do not duplicate native review/summary into model history.
        const transcript = visibleTranscript(session.deriveMessages());
        binding = { ...binding, ...(turnId ? { lastTurnId: turnId } : {}), transcriptCount: transcript.length, transcriptHash: transcriptHash(transcript) };
        append(session, 'codex/thread-bound', binding);
        await persist(binding);
        await ctx.sessions.flush(session);
        return success(action === 'compact' ? 'Codex 原生上下文已压缩；DSH 完整会话记录保留。' : text || 'Codex 审查已完成。');
      } finally { await supervisor.dispose(); busy.delete(String(session.id)); }
    });
  }
  return {
    execute(invocation, action, args = '') {
      const signal = invocation.signal ? AbortSignal.any([invocation.signal, lifetime.signal]) : lifetime.signal;
      const task = Promise.resolve().then(() => { signal.throwIfAborted(); return execute({ ...invocation, signal }, action, args); })
        .catch(error => ({ kind: 'error', text: error.message }));
      active.add(task);
      task.then(() => active.delete(task));
      return task;
    },
    async stop() { lifetime.abort(); await Promise.allSettled(active); },
  };
}

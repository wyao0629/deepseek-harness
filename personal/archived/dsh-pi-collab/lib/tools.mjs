import { defineTool } from '@deepseek-ai/dsh-tools';
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent';
import { Collaboration, roles } from './runtime.mjs';

export const name = 'dsh-pi-collab-tools';
export const inject = ['tools', 'subagents', 'jobs', 'llm'];
export function apply(ctx) {
  const children = new Map();
  const batches = new WeakMap();
  const service = new Collaboration({
    jobs: ctx.jobs, subagents: ctx.subagents,
    route: async (owner, args, signal) => {
      const baseline = parentAgentOptionsForDelegation(owner);
      if ((args.provider === undefined) !== (args.model === undefined)) throw new Error('provider 和 model 必须一起提供。');
      const options = { ...baseline };
      if (args.provider !== undefined) {
        options.provider = args.provider; options.model = args.model;
        if (options.provider !== baseline.provider || options.model !== baseline.model) delete options.reasoningEffort;
      }
      if (args.reasoning_effort !== undefined) options.reasoningEffort = args.reasoning_effort;
      await ctx.llm.resolveCallConfig(options, signal);
      return options;
    },
    emit: (owner, record) => {
      let seen = batches.get(owner);
      if (!seen) batches.set(owner, seen = new Set());
      if (!seen.has(record.batch)) {
        seen.add(record.batch);
        owner.session.append('pi-collab/batch', { batch: record.batch }, { ignorable: true });
      }
      owner.session.append('pi-collab/task', record, { ignorable: true });
      if (record.childId) {
        if (record.status === 'running') children.set(record.childId, { owner, id: record.id, batch: record.batch });
        else children.delete(record.childId);
      }
    },
  });
  ctx.on('session/event', (session, event) => {
    const task = children.get(session.id);
    if (!task || event.type !== 'assistant/message') return;
    // Persist each child's message once, in its own task area; never blend streams.
    task.owner.session.append('pi-collab/message', {
      id: task.id, batch: task.batch, childId: session.id, seq: event.seq,
      content: event.data.message.content,
    }, { ignorable: true });
  });
  const string = description => ({ type: 'string', description });
  const ids = { type: 'array', items: { type: 'string' }, description: 'Task 返回的任务 ID；省略时选择本会话全部协同任务。' };
  function register(name, description, parameters, execute) {
    ctx.tools.register(defineTool({ name, description, parameters,
      output: { schema: { type: 'json' }, render: (_, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => true,
      execute: (args, exec) => {
        if (!exec.agent) throw new Error('协同工具必须在 Agent 会话中执行。');
        return execute(exec.agent, args, exec.signal);
      },
    }));
  }
  register('TaskCatalog', '查看协同角色。Task 后台派发任务；TaskWait 等待并读取结果；TaskList 查看；TaskStop 停止。', {}, () => roles);
  register('Task', '后台启动独立子 Agent，立即返回任务 ID。可连续派发最多四个独立任务并行执行。子 Agent 只收到 task，不继承主会话历史；必须写明目标、路径、限制和验收方式。共享文件工作时划分文件归属。通过 TaskWait 汇总，后台结束也会通知主 Agent。', {
    agent: { ...string('角色：explorer、worker、code-reviewer 或 test-runner。'), required: true },
    task: { ...string('完整任务说明。'), required: true }, description: string('简短任务标题。'),
    provider: string('已配置的 DSH 提供方 ID，和 model 一起提供；默认继承当前模型。'),
    model: string('已配置的模型 ID。'), reasoning_effort: string('该模型支持的推理强度；默认继承兼容的当前设置。'),
  }, (owner, args, signal) => service.start(owner, args, signal));
  register('TaskList', '列出本会话协同任务、状态、子会话 ID 和模型。', {}, owner => service.list(owner));
  register('TaskWait', '等待协同任务并返回独立结果。all 等待全部；any 等待至少 minCompleted 个。超时仍在运行，不会终止任务。', {
    delegationIds: ids, mode: string('all 或 any，默认 all。'),
    minCompleted: { type: 'integer', description: 'any 模式最少完成数量，默认 1。' },
    timeoutSeconds: { type: 'number', description: '等待秒数 0–600，默认 30。' },
  }, (owner, args, signal) => service.wait(owner, args, signal));
  register('TaskStop', '请求停止指定子任务；省略 ID 时停止本会话全部协同任务。', { delegationIds: ids }, (owner, args) => service.stop(owner, args.delegationIds));
}

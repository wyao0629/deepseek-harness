// Independent task execution. DSH owns model routing, permissions and job wakeups.
export const roles = {
  explorer: '调研员：调查代码和资料，报告依据、路径与结论。不要修改文件。',
  worker: '执行员：完成分配的实现任务。只修改任务授权的范围，不撤销其他人的修改。',
  'code-reviewer': '审查员：审查正确性与回归风险，给出可定位的问题，不修改文件。',
  'test-runner': '测试员：执行任务指定的检查，报告结果和失败原因，不擅自扩大测试范围。',
};
const live = status => status === 'running' || status === 'stopping';
const clean = value => JSON.parse(JSON.stringify(value));

export class Collaboration {
  constructor({ jobs, subagents, route, maxConcurrent = 4, emit }) {
    Object.assign(this, { jobs, subagents, route, maxConcurrent, emit });
    this.owners = new WeakMap();
  }
  records(owner) {
    let records = this.owners.get(owner);
    if (!records) this.owners.set(owner, records = new Map());
    return records;
  }
  publish(owner, record) { this.emit(owner, clean(record)); }
  list(owner) {
    return [...this.records(owner).values()].filter(record => record.id).map(record => ({ ...record, ...this.jobs.get(record.id, owner) }));
  }
  async start(owner, args, signal) {
    if (!roles[args.agent]) throw new Error('未知角色，请先查看 TaskCatalog。');
    if (!args.task?.trim()) throw new Error('task 不能为空。');
    // Reserve before asynchronous route resolution, including simultaneous tool calls.
    const records = this.records(owner);
    if ([...records.values()].filter(r => r.status === 'starting' || live(r.status)).length >= this.maxConcurrent)
      throw new Error(`已达到 ${this.maxConcurrent} 个并行任务，请等待或停止现有任务。`);
    const reservation = Symbol();
    const batch = String(owner.session?.snapshotEvents().findLast(e => e.type === 'turn/start')?.seq ?? 0);
    const record = { batch, role: args.agent, task: args.task, label: args.description || args.task.slice(0, 64), status: 'starting', startedAt: Date.now() };
    records.set(reservation, record);
    try {
      const agentOptions = await this.route(owner, args, signal);
      signal?.throwIfAborted();
      Object.assign(record, { model: `${agentOptions.provider}/${agentOptions.model}`, status: 'running' });
      const id = this.jobs.start({
        kind: 'subagent', label: record.label, owner,
        run: () => {
          const controller = new AbortController();
          const done = Promise.resolve().then(async () => {
            let run;
            let outcome;
            try {
              run = await this.subagents.start('spawn', {
                parent: owner, signal: controller.signal, label: record.label,
                prompt: [{ type: 'text', text: args.task }], agentOptions, maxDepth: 1,
                persona: `${roles[args.agent]}\n你只有本条任务说明，没有主 Agent 的历史。完成后返回结果；不要向用户提问或再派发子 Agent。`,
              });
              record.childId = run.id;
              this.publish(owner, record);
              const result = await run.result;
              const output = result.output.filter(b => b.type === 'text').map(b => b.text).join('\n');
              outcome = { status: result.stopReason === 'completed' ? 'completed' : result.stopReason === 'aborted' ? 'killed' : 'failed', output, detail: result.diagnostic || result.stopReason };
            } catch (error) {
              outcome = { status: controller.signal.aborted ? 'killed' : 'failed', detail: String(error), output: '' };
            } finally {
              if (run) {
                try { await run.dispose(); }
                catch (error) { outcome = { status: 'failed', detail: `释放子会话失败：${error}`, output: outcome?.output || '' }; }
              }
            }
            Object.assign(record, outcome, { finishedAt: Date.now() });
            this.publish(owner, record);
            return outcome;
          });
          return { cancel: reason => controller.abort(reason || '用户停止任务'), done };
        },
      });
      records.delete(reservation);
      record.id = id;
      records.set(id, record);
      this.publish(owner, record);
      return clean(record);
    } catch (error) { records.delete(reservation); throw error; }
  }
  targets(owner, ids) {
    const records = this.records(owner);
    const selected = ids ?? [...records.keys()].filter(id => typeof id === 'string');
    return [...new Set(selected)].map(id => {
      if (!records.has(id)) throw new Error(`当前会话不存在协同任务：${id}`);
      return id;
    });
  }
  async wait(owner, { delegationIds, mode = 'all', minCompleted = 1, timeoutSeconds = 30 }, signal) {
    if (!['all', 'any'].includes(mode)) throw new Error('mode 必须为 all 或 any。');
    if (!Number.isInteger(minCompleted) || minCompleted < 1) throw new Error('minCompleted 必须为正整数。');
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 600) throw new Error('timeoutSeconds 范围为 0–600。');
    const ids = this.targets(owner, delegationIds);
    const needed = mode === 'all' ? ids.length : Math.min(minCompleted, ids.length);
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (true) {
      signal?.throwIfAborted();
      const snapshots = ids.map(id => this.jobs.get(id, owner));
      if (snapshots.filter(s => !live(s.status)).length >= needed || Date.now() >= deadline) break;
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.min(100, deadline - Date.now()));
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    return ids.map(id => {
      const snapshot = this.jobs.get(id, owner);
      return { ...this.records(owner).get(id), ...snapshot, ...(!live(snapshot.status) ? { output: this.jobs.read(id, owner).text } : {}) };
    });
  }
  stop(owner, ids) {
    return this.targets(owner, ids).map(id => ({ id, result: this.jobs.kill(id, owner, '用户停止协同任务') }));
  }
}

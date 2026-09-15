import { readFileSync } from 'node:fs';
import { deletionReason, fingerprint, validatePolicy } from './policy.mjs';

export const name = 'workspace-delete-guard';
export const inject = ['tools', 'userQuestions'];

// Optional injected reader keeps failure-path tests deterministic and file-free.
export function registerGuard(ctx, readPolicy) {
  const approved = new WeakMap();
  function audit(exec, decision, reason) {
    exec.agent?.session.append('workspace-guard/decision', {
      tool: exec.name, callId: exec.callId ?? '', decision, reason,
      inputHash: fingerprint(exec),
    }, { ignorable: true });
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!deletionReason(exec.name, exec.arguments)) return next();
    try {
      validatePolicy(readPolicy());
      if (!exec.agent || exec.signal.aborted) return { kind: 'deny', reason: '删除检查缺少有效会话，已暂停本次操作。' };
      const before = fingerprint(exec);
      const detail = JSON.stringify({ tool: exec.name, cwd: exec.agent.session.header.cwd, arguments: exec.arguments }, null, 2);
      // Never truncate approval scope: ask the agent to split an oversized call instead.
      if (detail.length > 12000) return { kind: 'deny', reason: '删除操作过大，请拆成目标明确的小操作后重试。' };
      const answer = await ctx.userQuestions.ask({
        agent: exec.agent, signal: exec.signal,
        questions: [{ id: 'workspace-delete', header: '删除授权',
          question: '是否允许这一次删除操作？授权仅适用于下面展示的完整工具调用。', detail,
          options: [{ label: '拒绝' }, { label: '允许本次操作' }] }],
      });
      const allowed = !exec.signal.aborted && answer.answers?.[0]?.selected?.[0] === '允许本次操作';
      if (!allowed || fingerprint(exec) !== before) {
        audit(exec, 'denied', 'not-authorized-or-changed');
        return { kind: 'deny', reason: '本次删除未获授权，或操作内容发生变化。' };
      }
      audit(exec, 'authorized', 'explicit-user-answer');
      approved.set(exec, before);
      return await next();
    } catch {
      approved.delete(exec);
      ctx.logger.warn('workspace-delete-guard: deletion check failed; operation denied');
      return { kind: 'deny', reason: '删除检查或授权服务异常，已暂停本次操作；普通开发操作不受影响。' };
    }
  });
  ctx.tools.guard(exec => {
    if (!deletionReason(exec.name, exec.arguments)) return undefined;
    try {
      validatePolicy(readPolicy());
      const expected = approved.get(exec);
      approved.delete(exec);
      if (expected && expected === fingerprint(exec) && !exec.signal.aborted) return undefined;
    } catch { /* A broken policy must never authorize a detected deletion. */ }
    return '删除操作未通过最终检查；请重新取得本次操作授权。';
  });
}

export function apply(ctx, config = {}) {
  const path = config.policyPath ?? new URL('../policy.json', import.meta.url);
  registerGuard(ctx, () => readFileSync(path, 'utf8'));
}

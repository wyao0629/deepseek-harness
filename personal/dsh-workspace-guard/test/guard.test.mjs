import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerGuard } from '../lib/index.mjs';
import { deletionReason } from '../lib/policy.mjs';

function setup({ policy = () => '{"version":1,"deleteApproval":"per-call"}', answer = '允许本次操作' } = {}) {
  const state = { questions: 0, body: 0, events: [] };
  const controller = new AbortController();
  const exec = { name: 'bash', arguments: { command: 'rm /tmp/example' }, callId: 'test', signal: controller.signal,
    agent: { session: { header: { cwd: '/test' }, append: (...args) => state.events.push(args) } } };
  const ctx = { on: (_, handler) => { state.pre = handler; }, tools: { guard: handler => { state.guard = handler; } },
    userQuestions: { ask: async () => { state.questions++; if (answer instanceof Error) throw answer; return { answers: [{ selected: [answer] }] }; } },
    logger: { warn() {} } };
  registerGuard(ctx, policy);
  state.run = async () => {
    const result = await state.pre(exec, async () => ({ kind: 'allow' }));
    if (result.kind === 'allow' && !state.guard(exec)) state.body++;
    return result;
  };
  return { state, exec, controller };
}

test('ordinary development continues when policy is unavailable', async () => {
  const { state, exec } = setup({ policy: () => { throw new Error('missing'); } });
  exec.arguments.command = 'git status';
  await state.run(); assert.equal(state.body, 1); assert.equal(state.questions, 0);
});
test('detected deletion fails closed on missing or malformed policy', async () => {
  for (const policy of [() => { throw new Error('missing'); }, () => '{', () => '{}']) {
    const { state } = setup({ policy }); await state.run(); assert.equal(state.body, 0); assert.equal(state.questions, 0);
  }
});
test('refusal and question failure cannot execute deletion', async () => {
  for (const answer of ['拒绝', new Error('offline')]) {
    const { state } = setup({ answer }); await state.run(); assert.equal(state.body, 0);
  }
});
test('explicit per-call approval executes once and does not persist', async () => {
  const { state, exec } = setup(); await state.run(); assert.equal(state.body, 1);
  assert.ok(state.guard(exec)); assert.equal(state.events.length, 1);
  await state.run(); assert.equal(state.questions, 2);
});
test('changed arguments and a skipped waterfall cannot bypass final guard', async () => {
  const { state, exec } = setup(); assert.ok(state.guard(exec));
  await state.pre(exec, async () => { exec.arguments.command = 'rm /tmp/other'; return { kind: 'allow' }; });
  assert.ok(state.guard(exec));
});
test('cancellation and policy failure after approval block execution', async () => {
  let valid = true;
  const { state, exec, controller } = setup({ policy: () => valid ? '{"version":1,"deleteApproval":"per-call"}' : '{}' });
  await state.pre(exec, async () => ({ kind: 'allow' })); valid = false; assert.ok(state.guard(exec));
  valid = true; await state.pre(exec, async () => ({ kind: 'allow' })); controller.abort(); assert.ok(state.guard(exec));
});
test('detector covers direct tools, patch deletes, shell cleanup and common script calls', () => {
  for (const command of ['sudo rm -rf x', 'find x -delete', 'git clean -fd', 'Remove-Item x', 'fs.rmSync("x")', 'shutil.rmtree("x")']) {
    assert.ok(deletionReason('bash', { command }), command);
  }
  assert.ok(deletionReason('delete_file', { path: 'x' }));
  assert.ok(deletionReason('apply_patch', { patch: '*** Delete File: x' }));
  assert.equal(deletionReason('read_file', { path: '/project/main.py' }), undefined);
  assert.equal(deletionReason('write_file', { path: '/project/README.md', content: 'Run rm -rf x to clean the fixture.' }), undefined);
});

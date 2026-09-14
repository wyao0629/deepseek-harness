import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askToolQuestions, interactionHandler, materializeInput, permissionSettings, visibleTranscript, CodexAppServer } from '../vendor/codex-adapter.mjs';

test('all questions survive batching and custom text follows native answers schema', async () => {
  const batches = [];
  const result = await askToolQuestions({ userQuestions: { async ask({ questions }) {
    batches.push(questions.length);
    return { answers: questions.map(q => ({ id: q.id, selected: ['choice'], custom: 'free answer' })) };
  } } }, { questions: Array.from({ length: 5 }, (_, i) => ({ id: String(i), question: 'Q' })) });
  assert.deepEqual(batches, [3, 2]);
  assert.equal(Object.keys(result.answers).length, 5);
  assert.deepEqual(result.answers['0'], { answers: ['choice', 'free answer'] });
});

test('permission defaults come from DSH; explicit network and roots remain separate', () => {
  const session = { snapshotEvents: () => [{ type: 'codex/settings', data: { networkAccess: true, writableRoots: ['/extra'] } }] };
  const ctx = { sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: '/work' }) }, approval: { effectivePolicy: () => 'never' } };
  assert.equal(permissionSettings(ctx, session, '/work').sandboxPolicy.type, 'readOnly');
  ctx.sandboxPolicy.resolve = () => ({ mode: 'workspace-write', workspaceRoot: '/work' });
  assert.deepEqual(permissionSettings(ctx, session, '/work').sandboxPolicy.writableRoots, ['/work', '/extra']);
  assert.equal(permissionSettings(ctx, session, '/work').approvalPolicy, 'never');
});

test('never approval rejects without a question; cancellation never becomes approval', async () => {
  let asked = 0;
  const context = { session: { append() {} }, userQuestions: { async ask() { asked++; return { answers: [] }; } }, approvalPolicy: 'never', maxBytes: 4096 };
  const denied = await interactionHandler(context)('item/commandExecution/requestApproval', { command: 'touch file' });
  assert.ok(['cancel', 'decline'].includes(denied.decision));
  assert.equal(asked, 0);
  context.approvalPolicy = 'ask';
  assert.equal((await interactionHandler(context)('item/commandExecution/requestApproval', { command: 'touch file' })).decision, 'cancel');
  assert.equal(asked, 1);
});

test('attachments use persistent paths and keep files in history hashing', async () => {
  const attachment = { name: 'data.csv', attachmentId: 'file' };
  const message = { role: 'user', source: { kind: 'user' }, content: [{ type: 'file', attachment }, { type: 'image', attachment: { name: 'screen.png' } }] };
  const ctx = { attachments: { fileHostPath: () => '/store/data.csv', imageHostPath: () => '/store/screen.png', readImage: async () => ({}) } };
  const input = await materializeInput(ctx, message);
  assert.match(input.items[0].text, /\/store\/data.csv/);
  assert.deepEqual(input.items[1], { type: 'localImage', path: '/store/screen.png' });
  await input.cleanup();
  assert.match(visibleTranscript([message])[0].text, /File: data.csv/);
});


test('late usage from resumed turn cannot capture a new compact operation', () => {
  const events = [];
  const active = { itemPhases: new Map(), queue: { push: e => events.push(e), end() {} } };
  const server = { active: new Map([['thread', active]]) };
  const notify = (method, params) => CodexAppServer.prototype.handleNotification.call(server, method, { threadId: 'thread', ...params });
  notify('thread/tokenUsage/updated', { turnId: 'old', tokenUsage: {} });
  assert.equal(active.turnId, undefined);
  notify('turn/started', { turn: { id: 'compact', status: 'inProgress' } });
  notify('turn/completed', { turn: { id: 'compact', status: 'completed' } });
  assert.deepEqual(events.map(e => e.type), ['turn-started', 'turn-completed']);
});


test('native remembered-command approval keeps the exact structured decision', async () => {
  const value = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['printf', 'fixture'] } };
  const reply = await interactionHandler({ session: { append() {} }, approvalPolicy: 'ask', maxBytes: 4096,
    userQuestions: { async ask({ questions }) { return { answers: [{ id: questions[0].id, selected: ['允许并保存此命令规则'] }] }; } },
  })('item/commandExecution/requestApproval', { availableDecisions: ['accept', value, 'cancel'] });
  assert.deepEqual(reply.decision, value);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseTurns, importTurns } from '../lib/sync.mjs';
import { latestBinding, visibleTranscript, transcriptHash } from '../vendor/codex-adapter.mjs';
const require = createRequire(process.env.DSH_PACKAGE_JSON ?? new URL('../../../apps/cli/package.json', import.meta.url));
const { Session } = require('@deepseek-ai/dsh-session');

function seed() {
  const session = Session.create('session-sync-fixture');
  session.append('codex/thread-bound', { sessionId: session.id, threadId: 'native-fixture', lastTurnId: 'original', selectedProvider: 'fixture', selectedModel: 'model', transcriptCount: 0, transcriptHash: transcriptHash([]) }, { ignorable: true });
  return session;
}
const completed = { id: 'cli-1', status: 'completed', answer: 'second code', items: [
  { type: 'UserMessage', id: 'user-1', content: [{ type: 'text', text: 'remember second code' }] },
  { type: 'CommandExecution', id: 'tool-1', command: ['printf', 'OK'], aggregated_output: 'OK', exit_code: 0 },
] };
test('CLI turn becomes durable DSH messages and tool trace, exactly once', () => {
  const session = seed();
  const turns = [{ id: 'original', status: 'completed' }, completed];
  assert.equal(importTurns(session, turns), 1);
  assert.deepEqual(visibleTranscript(session.deriveMessages()), [
    { role: 'user', text: 'remember second code' }, { role: 'assistant', text: 'second code' },
  ]);
  const before = session.snapshotEvents().length;
  assert.equal(importTurns(session, turns), 0);
  assert.equal(session.snapshotEvents().length, before);
  const restored = Session.create(session.id, session.snapshotEvents());
  assert.equal(importTurns(restored, turns), 0);
  assert.equal(latestBinding(restored.snapshotEvents()).transcriptHash, transcriptHash(visibleTranscript(restored.deriveMessages())));
  assert.ok(restored.snapshotEvents().some(e => e.type === 'codex/item' && e.data.detail === '"OK"'));
});
test('unfinished turn and missing boundary never become completed conversation', () => {
  assert.equal(importTurns(seed(), [{ id: 'original' }, { ...completed, status: 'running' }]), 0);
  assert.equal(importTurns(seed(), [completed]), 0);
});
test('parser uses native user events and ignores environment injection / partial last line', () => {
  const lines = [
    { type: 'response_item', payload: { role: 'user', content: [{ text: 'injected context' }] } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'cli-1' } },
    { type: 'event_msg', payload: { type: 'item_completed', turn_id: 'cli-1', item: completed.items[0] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'cli-1', last_agent_message: 'second code' } },
  ].map(JSON.stringify).join('\n') + '\n{"partial';
  const turns = parseTurns(lines);
  assert.equal(turns.length, 1); assert.equal(turns[0].items.length, 1);
  assert.equal(turns[0].answer, 'second code');
});

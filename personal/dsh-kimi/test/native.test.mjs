import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Native, selectedQuestionAnswer, promptContent, turnText, cliUsesSession, snapshotSuffix, transcriptThinking } from '../lib/native.mjs';

test('snapshot recovery does not duplicate replayed prefixes or splice conflicting text', () => {
  assert.equal(snapshotSuffix('hello', 'hello world'), ' world');
  assert.equal(snapshotSuffix('hello', 'hello'), '');
  assert.equal(snapshotSuffix('hello', 'hel'), '');
  assert.equal(snapshotSuffix('hello', 'different'), '');
  assert.equal(transcriptThinking({steps:[{frames:[{kind:'thinking',text:'reason'},{kind:'text',text:'answer'}]}]}), 'reason');
});

test('CLI ownership excludes the web daemon and unrelated explicit sessions', () => {
  assert.equal(cliUsesSession(['/opt/kimi-code/bin/kimi', 'web', '--no-open'], 'a'), false);
  assert.equal(cliUsesSession(['/opt/kimi-code/bin/kimi', '-r', 'a'], 'a'), true);
  assert.equal(cliUsesSession(['/opt/kimi-code/bin/kimi', '--session', 'b'], 'a'), false);
  assert.equal(cliUsesSession(['/opt/kimi-code/bin/kimi', '-S', 'b'], 'a'), false);
  assert.equal(cliUsesSession(['/opt/kimi-code/bin/kimi', '-c'], 'a'), true);
});

test('refreshes a stale idle native cache but leaves active CLI ownership alone', async () => {
  const native = new Native({}); const calls = [];
  native.cliActive = async () => true;
  native.call = async () => { throw new Error('must not touch active session'); };
  assert.equal(await native.refreshExternal('a'), false);
  native.cliActive = async () => false;
  native.call = async path => {
    calls.push(path);
    if (path.endsWith('/a')) return { busy: false };
    if (path.includes('/messages?')) return { items: [{ id: 'new', role: 'user', metadata: { origin: { kind: 'user' } } }] };
    if (path.includes('/transcript?')) return { items: [{ triggerPromptId: 'old' }] };
    return {};
  };
  assert.equal(await native.refreshExternal('a'), true);
  assert.deepEqual(calls.slice(-2), ['/api/v1/sessions/a:archive', '/api/v1/sessions/a:restore']);
});

test('questions preserve native option identifiers and free text', () => {
  const question = { options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] };
  assert.deepEqual(selectedQuestionAnswer(question, { selected: ['Beta'] }), { kind: 'single', option_id: 'b' });
  assert.deepEqual(selectedQuestionAnswer({ ...question, multi_select: true }, { selected: ['Alpha', 'Beta'] }), { kind: 'multi', option_ids: ['a', 'b'] });
  assert.deepEqual(selectedQuestionAnswer(question, { custom: ' My answer ' }), { kind: 'other', text: 'My answer' });
  assert.deepEqual(selectedQuestionAnswer(question, { selected: ['Alpha'], custom: 'Extra' }), { kind: 'multi_with_other', option_ids: ['a'], other_text: 'Extra' });
  assert.deepEqual(selectedQuestionAnswer(question), { kind: 'skipped' });
});

test('transcript pagination uses durable turns and excludes the committed boundary', async () => {
  const native = new Native({}); const paths = [];
  native.hydrateTurns = async () => {};
  native.call = async path => {
    paths.push(path);
    return paths.length === 1
      ? { items: [{ kind: 'turn', turnId: 't3', ordinal: 3 }], has_more: true }
      : { items: [{ kind: 'turn', turnId: 't1', ordinal: 1 }, { kind: 'turn', turnId: 't2', ordinal: 2 }], has_more: false };
  };
  assert.deepEqual((await native.transcript('session-test', 't1')).turns.map(t => t.turnId), ['t2', 't3']);
  assert.match(paths[1], /before_turn=t3/);
});

test('cold CLI turns recover answers by stable human prompt id, excluding injected prompts', async () => {
  const native = new Native({});
  const turns = [{ triggerPromptId: 'human-1', steps: [{ frames: [] }] }];
  native.call = async () => ({ items: [
    { id:'unstable-answer-index',role:'assistant',content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'CLI answer'}] },
    { id:'injected',role:'user',metadata:{origin:{kind:'injection'}},content:[{type:'text',text:'runtime reminder'}] },
    { id:'human-1',role:'user',metadata:{origin:{kind:'user'}},content:[{type:'text',text:'CLI prompt'}] },
  ],has_more:false });
  await native.hydrateTurns('session',turns);
  assert.equal(turnText(turns[0]),'CLI answer');
  assert.deepEqual(turns[0].userContent,[{type:'text',text:'CLI prompt'}]);
});

test('attachment inputs retain image bytes and a server-readable file path', async () => {
  const ctx = { attachments: { fileHostPath: async () => '/workspace/a b.csv', readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Uint8Array.from([1, 2, 3]) }) } };
  const result = await promptContent(ctx, { content: [{ type: 'text', text: 'Inspect' }, { type: 'file', attachment: {} }, { type: 'image', attachment: {} }] });
  assert.equal(result[1].text, 'Attached file: "/workspace/a b.csv"');
  assert.deepEqual(result[2].source, { kind: 'base64', media_type: 'image/png', data: 'AQID' });
  await assert.rejects(promptContent(ctx, { content: [{ type: 'audio' }] }), /unsupported/);
});

test('transcript answer excludes tools, user input and hidden reasoning', () => {
  assert.equal(turnText({ steps: [{ frames: [{ kind: 'thinking', text: 'private' }, { kind: 'text', role: 'user', text: 'input' }, { kind: 'text', role: 'assistant', text: 'answer' }] }] }), 'answer');
});

test('reverse image import admits native bytes into the durable DSH attachment store', async () => {
  const native = new Native({}); let saved;
  const content = await native.userContent('session', {userContent:[{type:'text',text:'image prompt'},{type:'image',name:'fixture.png',source:{kind:'base64',media_type:'image/png',data:'AQID'}}]}, {
    saveImage: async value => { saved=value;return {attachmentId:'saved-image'}; },
  });
  assert.deepEqual([...saved.data],[1,2,3]);
  assert.equal(saved.mediaType,'image/png');
  assert.deepEqual(content,[{type:'text',text:'image prompt'},{type:'image',attachment:{attachmentId:'saved-image'}}]);
});

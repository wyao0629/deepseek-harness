import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTools, mapInput, serveResponse, startBridge } from '../lib/bridge.mjs';
import { encodeRoute, decodeRoute } from '../lib/route.mjs';
import { apply } from '../lib/preset-route.mjs';

test('preserves exact non-GPT provider and model, including duplicate model ids', async () => {
  let handler, palettes = 0; const commands = [];
  apply({ commands: { useNativePalette() { palettes++; }, register(command) { commands.push(command.name); } }, on: (event, fn) => { handler = fn; } });
  assert.equal(palettes, 1);
  assert.ok(commands.includes('compact') && commands.includes('model') && commands.includes('permissions'));
  const result = await handler({}, async () => ({ provider: 'grok256', model: 'grok-4.6', reasoningEffort: 'high' }));
  assert.deepEqual(decodeRoute(result.model), { provider: 'grok256', model: 'grok-4.6' });
  assert.equal(result.reasoningEffort, 'high');
  assert.notEqual(encodeRoute('grok500', 'grok-4.6'), result.model);
  assert.throws(() => encodeRoute('codex', 'gpt-x'));
});
test('maps native tool call/result history without running tools in DSH', async () => {
  const route = { provider: 'test', model: 'other-model' };
  const messages = await mapInput({ input: [
    { type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{"command":"pwd"}' },
    { type: 'function_call_output', call_id: 'c1', output: '/test' },
    { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: '*** Begin Patch\n*** End Patch' },
  ] }, route);
  assert.equal(messages[1].content[0].toolCallId, 'c1');
  assert.equal(JSON.parse(messages[2].content[0].arguments).input, '*** Begin Patch\n*** End Patch');
});
test('preserves namespace and raw custom tool input', () => {
  const { tools, kinds } = mapTools([{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'shell', parameters: {} }] }, { type: 'custom', name: 'apply_patch' }]);
  assert.equal(tools[0].name, 'functions__shell');
  assert.equal(kinds.get('functions__shell').namespace, 'functions');
  assert.deepEqual(tools[1].parameters.required, ['input']);
  assert.throws(() => mapTools([{ type: 'web_search' }]));
});
test('emits live text and authoritative terminal response with tool call and usage', async () => {
  let seen; let data = '';
  const ctx = { llm: { resolveModelInfo: async () => ({}), async *stream(options) {
    seen = options;
    yield { type: 'text-delta', index: 0, text: 'working' };
    yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'abc', name: 'shell', arguments: '{"command":"pwd"}' } };
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 3 } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } } };
  const res = { writeHead: () => {}, write: s => { data += s; }, end: () => {} };
  await serveResponse(ctx, { provider: 'Grok_256', model: 'grok-4.6' }, { model: 'grok-4.6', instructions: 'Native Codex instructions', input: 'hello', tools: [{ type: 'function', name: 'shell', parameters: {} }] }, res, new AbortController().signal);
  assert.equal(seen.provider, 'Grok_256'); assert.equal(seen.model, 'grok-4.6');
  assert.equal(seen.system, 'Native Codex instructions');
  assert.equal(seen.sessionId, undefined); // No recursive outer Agent turn.
  assert.match(data, /response.output_text.delta/);
  const final = data.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6))).at(-1);
  assert.equal(final.type, 'response.completed');
  assert.equal(final.response.output[1].call_id, 'abc');
  assert.equal(final.response.usage.input_tokens, 8);
});
test('does not convert failed/unfinished provider streams into success', async () => {
  let data=''; const res={writeHead(){},write(s){data+=s},end(){}};
  await assert.rejects(serveResponse({llm:{resolveModelInfo:async()=>({}),async *stream(){yield {type:'finish',reason:{kind:'error',failure:{message:'test'}}}}}}, {provider:'test',model:'m'}, {model:'m',input:'x'},res));
  assert.match(data,/response.failed/);assert.doesNotMatch(data,/response.completed/);
});
test('loopback bridge requires authentication', async () => {
  const server=await startBridge({}, {port:0,token:'test-token'});
  try { const r=await fetch(`http://127.0.0.1:${server.address().port}/route/${encodeRoute('p','m')}/responses`,{method:'POST'});assert.equal(r.status,401); }
  finally {await new Promise(r=>server.close(r));}
});

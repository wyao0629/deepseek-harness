import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('one batch groups interleaved children without mixing reasoning or output', () => {
  let definition;
  const jsx = (type, props, key) => ({ type, props, key });
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => factory(() => ({ jsx, jsxs: jsx })).apply({
      uiConversation: { events: { register: d => definition = d } }, slots: { inject: () => {} },
    }) } },
  });
  const start = { type: 'pi-collab/batch', seq: 1, data: { batch: '1' } };
  let state = definition.start();
  assert.equal(definition.match(start).role, 'start');
  for (const event of [
    { type: 'pi-collab/task', data: { batch: '1', id: 'A', status: 'running' } },
    { type: 'pi-collab/task', data: { batch: '1', id: 'B', status: 'running' } },
    { type: 'pi-collab/message', data: { batch: '1', id: 'B', seq: 2, content: [{ type: 'reasoning', text: 'B thinks' }] } },
    { type: 'pi-collab/message', data: { batch: '1', id: 'A', seq: 2, content: [{ type: 'text', text: 'A output' }] } },
    { type: 'pi-collab/task', data: { batch: '1', id: 'B', status: 'completed' } },
  ]) {
    assert.equal(definition.match(event).role, 'update');
    state = definition.update({ state }, { event });
  }
  assert.equal(Object.keys(state.tasks).length, 2);
  assert.equal(state.messages.A[2][0].text, 'A output');
  assert.equal(state.messages.B[2][0].text, 'B thinks');
  assert.equal(definition.buildViewNode({ start: { event: start, location: { turn: { end: { seq: 99 } } } }, state }).anchorSeq, 99);
});

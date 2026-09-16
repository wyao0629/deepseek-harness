import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collaboration } from '../lib/runtime.mjs';
function fixture(maxConcurrent = 4) {
  const records = new Map(), runs = [], events = [];
  const jobs = {
    start({ run, owner }) {
      const id = `subagent-${records.size + 1}`, hooks = run();
      const record = { id, owner, status: 'running', hooks };
      records.set(id, record);
      hooks.done.then(result => Object.assign(record, result));
      return id;
    },
    get(id, owner) { const r = records.get(id); assert.equal(r.owner, owner); return { id, status: r.status }; },
    read(id, owner) { this.get(id, owner); return { text: records.get(id).output }; },
    kill(id, owner) { this.get(id, owner); records.get(id).hooks.cancel(); return 'requested'; },
  };
  const service = new Collaboration({ jobs, maxConcurrent, emit: (_, event) => events.push(event),
    route: async () => ({ provider: 'test', model: 'test' }),
    subagents: { start: async (_, request) => {
      let resolve;
      const run = { id: `child-${runs.length}`, request, disposed: false, result: new Promise(r => resolve = r), dispose: async () => { run.disposed = true; }, finish: text => resolve({ stopReason: 'completed', output: [{ type: 'text', text }] }) };
      request.signal.addEventListener('abort', () => resolve({ stopReason: 'aborted', output: [] }));
      runs.push(run); return run;
    } },
  });
  return { service, runs, events, owner: {} };
}
const task = text => ({ agent: 'explorer', task: text });
test('parallel tasks have independent context, results and disposal', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.service.start(f.owner, task('alpha')), f.service.start(f.owner, task('beta'))]);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(f.runs.map(r => r.request.prompt[0].text), ['alpha', 'beta']);
  f.runs[1].finish('B'); f.runs[0].finish('A');
  const result = await f.service.wait(f.owner, { delegationIds: [a.id, b.id] });
  assert.deepEqual(result.map(r => r.output), ['A', 'B']);
  assert.ok(f.runs.every(r => r.disposed));
});
test('timeout preserves running task; stop aborts only selected task', async () => {
  const f = fixture(); const a = await f.service.start(f.owner, task('a')); const b = await f.service.start(f.owner, task('b'));
  const pending = await f.service.wait(f.owner, { timeoutSeconds: 0 });
  assert.ok(pending.every(r => r.status === 'running'));
  f.service.stop(f.owner, [a.id]);
  const result = await f.service.wait(f.owner, { mode: 'any' });
  assert.equal(result.find(r => r.id === a.id).status, 'killed');
  assert.equal(result.find(r => r.id === b.id).status, 'running');
  f.runs[1].finish('B');
  await f.service.wait(f.owner, {});
});
test('concurrency reservation and owner boundary', async () => {
  const f = fixture(1);
  const result = await Promise.allSettled([f.service.start(f.owner, task('a')), f.service.start(f.owner, task('b'))]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.throws(() => f.service.stop({}, [result[0].value.id]), /不存在/);
  f.runs[0].finish('A');
  await f.service.wait(f.owner, {});
});
test('startup failure settles as failed and releases concurrency slot', async () => {
  const f = fixture(1);
  f.service.subagents.start = async () => { throw new Error('startup failed'); };
  await f.service.start(f.owner, task('a'));
  const result = await f.service.wait(f.owner, {});
  assert.equal(result[0].status, 'failed');
  assert.match(result[0].detail, /startup failed/);
  await f.service.start(f.owner, task('b'));
  await f.service.wait(f.owner, {});
});

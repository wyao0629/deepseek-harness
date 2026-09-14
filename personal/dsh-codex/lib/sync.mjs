import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { dshHome, codexHome } from './paths.mjs';
import { createHash } from 'node:crypto';
import { latestBinding, visibleTranscript, transcriptHash, projectItem } from '../vendor/codex-adapter.mjs';
import { encodeRoute } from './route.mjs';

// Read completed native turns, never infer human prompts from injected context.
export function parseTurns(text) {
  const turns = new Map();
  const reviewAliases = new Map();
  let activeReview;
  for (const line of text.split('\n').slice(0, -1)) {
    const row = JSON.parse(line);
    if (row.type !== 'event_msg') continue;
    const p = row.payload;
    if (p.type === 'item_completed' && p.item?.type === 'EnteredReviewMode') {
      activeReview = p.turn_id;
      turns.set(activeReview, { id: activeReview, items: [], status: 'running' });
    }
    if (p.type === 'task_started') {
      if (activeReview && activeReview !== p.turn_id) reviewAliases.set(p.turn_id, activeReview);
      else if (!turns.has(p.turn_id)) turns.set(p.turn_id, { id: p.turn_id, items: [], status: 'running' });
    }
    const turn = turns.get(reviewAliases.get(p.turn_id) ?? p.turn_id);
    if (!turn) continue;
    if (p.type === 'item_completed') { turn.items.push(p.item); if (p.item?.type === 'ExitedReviewMode') turn.answer = JSON.stringify(p.item.review_output); }
    if (p.type === 'task_complete') { turn.status = 'completed'; turn.answer = p.last_agent_message ?? turn.answer; if (p.turn_id === activeReview) activeReview = undefined; }
    if (p.type === 'turn_aborted') turn.status = 'interrupted';
  }
  return [...turns.values()];
}

export async function hydrateNativeImages(turns, attachments) {
  for (const turn of turns) for (const item of turn.items ?? []) {
    if (item.type !== 'UserMessage') continue;
    const content = [];
    for (const block of item.content ?? []) {
      const kind = block.type.toLowerCase().replaceAll('_', '');
      if (kind === 'text') content.push({ type: 'text', text: block.text });
      else if (kind === 'localimage' || kind === 'image') {
        let data, name, mediaType;
        if (kind === 'localimage') { data = await readFile(block.path); name = block.path.split(/[\\/]/).at(-1); }
        else if (/^data:image\/[^;]+;base64,/.test(block.url ?? '')) data = Buffer.from(block.url.split(',')[1], 'base64');
        if (data) {
          mediaType = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
            : data[0] === 255 && data[1] === 216 ? 'image/jpeg'
            : data.subarray(0, 3).toString() === 'GIF' ? 'image/gif'
            : data.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined;
          if (!mediaType) throw new Error('Unsupported native image bytes');
          content.push({ type: 'image', attachment: await attachments.saveImage({ data, mediaType, ...(name ? { name } : {}) }) });
        }
        else content.push({ type: 'text', text: '[Codex image: external URL, preview unavailable]' });
      }
    }
    item.dshContent = content;
  }
  return turns;
}

const textOf = item => (item.content ?? []).filter(x => x.type.toLowerCase() === 'text').map(x => x.text).join('\n');
const messageId = (thread, turn, item) => createHash('sha256').update(`${thread}/${turn}/${item}`).digest('hex');
const event = (session, type, data) => session.append(type, data, { ignorable: true });

export function importTurns(session, turns) {
  let binding = latestBinding(session.snapshotEvents());
  if (!binding?.lastTurnId) return 0;
  const boundary = turns.findIndex(t => t.id === binding.lastTurnId);
  if (boundary < 0) return 0; // Never guess across missing/rewritten native history.
  let count = 0;
  for (const turn of turns.slice(boundary + 1)) {
    if (turn.status === 'running') break;
    const events = session.snapshotEvents();
    const number = Math.max(0, ...events.filter(e => e.type === 'turn/start').map(e => e.data.turn)) + 1;
    const existingIds = new Set(session.deriveMessages().map(m => m.id));
    const userItems = turn.items.filter(i => i.type === 'UserMessage');
    if (!userItems.length && !turn.answer) {
      binding = { ...binding, lastTurnId: turn.id };
      event(session, 'codex/thread-bound', binding);
      if (turn.items.some(i => /compaction/i.test(i.type))) event(session, 'codex/compacted', { threadId: binding.threadId, turnId: turn.id, importedFrom: 'codex-cli' });
      count++;
      continue;
    }
    session.append('turn/start', { turn: number });
    session.append('step/start', { turn: number, step: 1 });
    for (const item of userItems) {
      const id = messageId(binding.threadId, turn.id, item.id);
      const text = textOf(item);
      const content = item.dshContent ?? [{ type: 'text', text }];
      if (content.length && !existingIds.has(id)) session.append('user/message', {
        id, role: 'user', source: { kind: 'user' }, content,
      }, { surfaceOp: 'append' });
    }
    event(session, 'codex/turn', { threadId: binding.threadId, turnId: turn.id, phase: 'started', status: 'inProgress', model: binding.selectedModel });
    for (const item of turn.items) {
      if (item.type === 'UserMessage' || item.type === 'AgentMessage') continue;
      const normalized = { ...item, type: item.type[0].toLowerCase() + item.type.slice(1), aggregatedOutput: item.aggregated_output, exitCode: item.exit_code };
      event(session, 'codex/item', projectItem(binding.threadId, turn.id, 'completed', normalized, 262144));
    }
    const answer = turn.answer ?? turn.items.filter(i => i.type === 'AgentMessage').map(textOf).join('\n\n');
    const id = messageId(binding.threadId, turn.id, 'answer');
    if (answer && !existingIds.has(id)) session.append('assistant/message', {
      turn: number, step: 1,
      message: { id, role: 'assistant', source: { kind: 'model', provider: 'codex', model: encodeRoute(binding.selectedProvider, binding.selectedModel),
        replayState: { response: { turnId: turn.id, status: turn.status } } }, content: [{ type: 'text', text: answer }] },
      stream: [], ...(turn.status !== 'completed' ? { interrupted: true } : {}),
    }, { surfaceOp: 'append' });
    event(session, 'codex/turn', { threadId: binding.threadId, turnId: turn.id, phase: 'completed', status: turn.status, model: binding.selectedModel });
    session.append('step/end', { turn: number, step: 1 });
    session.append('turn/end', { turn: number, reason: turn.status === 'completed' ? { kind: 'completed' } : { kind: 'aborted', reason: { kind: 'legacy' } } });
    const transcript = visibleTranscript(session.deriveMessages());
    binding = { ...binding, reason: 'resumed', lastTurnId: turn.id, transcriptCount: transcript.length, transcriptHash: transcriptHash(transcript), importedFrom: 'codex-cli' };
    event(session, 'codex/thread-bound', binding);
    count++;
  }
  return count;
}

async function findRollouts(root, wanted, found = new Map()) {
  for (const e of await readdir(root, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    const file = join(root, e.name);
    if (e.isDirectory()) await findRollouts(file, wanted, found);
    else for (const id of wanted) if (e.name.endsWith(`${id}.jsonl`)) found.set(id, file);
  }
  return found;
}

export function startSync(ctx, busy, config = {}) {
  let stopped = false, pending;
  const sizes = new Map();
  const root = join(dshHome(), 'dsh-codex', 'threads');
  async function scan() {
    const names = await readdir(root).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const bindings = await Promise.all(names.filter(n => n.endsWith('.json')).map(async n => JSON.parse(await readFile(join(root, n), 'utf8'))));
    const files = await findRollouts(join(codexHome(), 'sessions'), new Set(bindings.map(b => b.threadId)));
    for (const b of bindings) {
      if (stopped || busy.has(b.sessionId)) continue;
      const file = files.get(b.threadId); if (!file) continue;
      const info = await stat(file); const revision = `${info.size}/${info.mtimeMs}`;
      if (sizes.get(file) === revision) continue;
      let session = ctx.sessions.get(b.sessionId);
      if (!session) {
        const result = await ctx.sessionController.resolveAgent(b.sessionId);
        if (result.error) continue;
        session = result.agent.session;
      }
      if (busy.has(b.sessionId) || ctx.agents.get(b.sessionId)?.status === 'running') continue;
      const latest = latestBinding(session.snapshotEvents());
      if (latest?.threadId !== b.threadId || !latest.lastTurnId) continue;
      const turns = parseTurns(await readFile(file, 'utf8'));
      const boundary = turns.findIndex(t => t.id === latest.lastTurnId);
      if (boundary < 0) continue;
      await hydrateNativeImages(turns.slice(boundary + 1), ctx.attachments);
      const agent = ctx.agents.get(b.sessionId);
      if (!agent || agent.status !== 'idle') continue;
      // Hold the public maintenance reservation so queued DSH input cannot interleave.
      // DSH 0.1.5 keeps its turn cursor on phase; require that known shape before writing.
      if (agent.phase?.kind !== 'idle' || !Number.isInteger(agent.phase.lastTurn)) throw new Error('DSH loop cursor changed; native import requires compatibility review');
      const count = await agent.runMaintenance(async () => {
        const imported = importTurns(session, turns);
        if (imported) {
          agent.phase.lastTurn = Math.max(agent.phase.lastTurn, ...session.snapshotEvents().filter(e => e.type === 'turn/start').map(e => e.data.turn));
          await ctx.sessions.flush(session);
        }
        return imported;
      });
      if (count) ctx.logger.info(`dsh-codex: imported ${count} native turn(s) into ${b.sessionId}`);
      sizes.set(file, revision);
    }
  }
  function tick() {
    if (stopped) return;
    pending ??= scan().catch(e => ctx.logger.error('dsh-codex sync: ' + e.message)).finally(() => { pending = undefined; });
    return pending;
  }
  const timer = setInterval(tick, config.intervalMs ?? 2000); timer.unref?.();
  return { tick, async stop() { stopped = true; clearInterval(timer); await pending; } };
}

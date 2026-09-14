import { readFile, readdir, stat } from 'node:fs/promises';
import { basename } from 'node:path';

export function cliUsesSession(args, id) {
  if (basename(args[0] ?? '') !== 'kimi' || ['web', 'rc', 'remote'].includes(args[1])) return false;
  const position = args.findIndex(arg => ['--session', '-S', '-r'].includes(arg));
  return position < 0 || !args[position + 1] || args[position + 1] === id;
}

/** Persisted snapshots can replay an existing prefix; only emit unseen suffixes. */
export function snapshotSuffix(previous, current) {
  return typeof current === 'string' && current.startsWith(previous) ? current.slice(previous.length) : '';
}

export function transcriptThinking(turn) {
  return (turn.steps ?? []).flatMap(step => step.frames ?? []).filter(frame => frame.kind === 'thinking').map(frame => frame.text ?? '').join('');
}

/** The installed Kimi server's authenticated API is the execution authority. */
export class Native {
  constructor(config) { this.config = config; }
  async token() { return (await readFile(this.config.tokenFile, 'utf8')).trim(); }
  async cliActive(id) {
    if (process.platform !== 'linux') return false;
    for (const pid of await readdir('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        if ((await stat('/proc/' + pid)).uid !== process.getuid()) continue;
        const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
        if (cliUsesSession(args, id)) return true;
      } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
    }
    return false;
  }
  async refreshExternal(id) {
    if (await this.cliActive(id)) return false;
    const root = `/api/v1/sessions/${id}`;
    if ((await this.call(root)).busy) return false;
    const page = await this.call(root + '/messages?page_size=100');
    const user = page.items.find(message => message.role === 'user' && message.metadata?.origin?.kind === 'user');
    if (!user) return true;
    const transcript = await this.call(root + '/transcript?agent_id=main&page_size=1');
    if (transcript.items.some(turn => turn.triggerPromptId === user.id)) return true;
    // Kimi 0.42 does not reload a warm session after another CLI process writes it.
    // Its reversible archive/restore lifecycle closes only this idle session's cache.
    await this.call(root + ':archive', {});
    await this.call(root + ':restore', {});
    return true;
  }
  async call(path, body, method = body === undefined ? 'GET' : 'POST', signal) {
    const response = await fetch(this.config.baseUrl + path, {
      method, headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)]) : AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    if (response.status === 204) return;
    const result = await response.json();
    if (!response.ok || result.code !== 0) throw Object.assign(new Error(`Kimi ${result.code}: ${result.msg}`), { code: result.code, detail: result.data });
    return result.data;
  }
  async messages(id, after) {
    const all = []; let before;
    for (;;) {
      const query = new URLSearchParams({ page_size: '100', ...(before ? { before_id: before } : {}) });
      const page = await this.call(`/api/v1/sessions/${id}/messages?${query}`);
      const boundary = page.items.findIndex(item => item.id === after);
      all.push(...(boundary < 0 ? page.items : page.items.slice(0, boundary)));
      if (boundary >= 0 || !page.has_more || !page.items.length) break;
      before = page.items.at(-1).id;
    }
    return all.reverse();
  }
  async subscribe(id, onEvent) {
    const ws = new WebSocket(this.config.baseUrl.replace(/^http/, 'ws') + '/api/v1/ws', ['kimi-code.bearer.' + await this.token()]);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('Kimi event subscription timed out')); }, this.config.requestTimeoutMs);
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Kimi event connection failed')); }, { once: true });
      ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'subscribe', id: 'dsh-subscribe', payload: { session_ids: [id] } })));
      ws.addEventListener('message', ({ data }) => {
        let frame;
        try { frame = JSON.parse(data); } catch { ws.close(); clearTimeout(timer); reject(new Error('Malformed Kimi event')); return; }
        if (frame.type === 'ack' && frame.id === 'dsh-subscribe') {
          clearTimeout(timer); if (frame.code === 0) resolve(); else reject(new Error(frame.msg));
        } else onEvent(frame);
      });
    });
    return ws;
  }
  async transcript(id, after) {
    const turns = []; let before;
    for (;;) {
      const query = new URLSearchParams({ agent_id: 'main', page_size: '100', ...(before ? { before_turn: before } : {}) });
      const page = await this.call(`/api/v1/sessions/${id}/transcript?${query}`);
      const items = page.items.filter(item => item.kind === 'turn').sort((a,b) => a.ordinal - b.ordinal);
      const boundary = items.findIndex(item => typeof after === 'object'
        ? item.turnId === after?.turnId && item.triggerPromptId === after?.promptId
        : item.turnId === after);
      turns.unshift(...(boundary < 0 ? items : items.slice(boundary + 1)));
      if (boundary >= 0 || !page.has_more || !items.length) {
        if (turns.length) await this.hydrateTurns(id, turns);
        return { turns, attachments: page.attachments };
      }
      before = items[0].turnId;
    }
  }
  async hydrateTurns(id, turns) {
    const wanted = new Map(turns.map(turn => [turn.triggerPromptId, turn]));
    const messages = []; let before;
    for (;;) {
      const query = new URLSearchParams({page_size:'100', ...(before ? {before_id:before} : {})});
      const page = await this.call(`/api/v1/sessions/${id}/messages?${query}`);
      const boundary = page.items.findIndex(message => message.id === turns[0].triggerPromptId);
      messages.push(...(boundary < 0 ? page.items : page.items.slice(0,boundary+1)));
      if (boundary >= 0 || !page.has_more || !page.items.length) break;
      before = page.items.at(-1).id;
    }
    let turn;
    for (const message of messages.reverse()) {
      if (message.role === 'user' && message.metadata?.origin?.kind === 'user') {
        turn = wanted.get(message.id);
        if (turn) { turn.userContent = message.content; turn.assistantContent = []; }
      } else if (turn && message.role === 'assistant') turn.assistantContent.push(...message.content);
    }
  }
  async userContent(id, turn, attachments) {
    const content = [];
    for (const block of turn.userContent ?? [{type:'text',text:turn.prompt ?? ''}]) {
      if (block.type === 'text') { content.push(block); continue; }
      if (!['image','file'].includes(block.type)) throw new Error(`Unsupported native input: ${block.type}`);
      const source = block.source ?? (block.path ? {kind:'path',path:block.path} : {kind:'file',file_id:block.file_id});
      let data, mediaType = block.media_type;
      if (source.kind === 'base64') { data=Buffer.from(source.data,'base64');mediaType=source.media_type; }
      else if (source.kind === 'path') data=await readFile(source.path);
      else if (['file','session_media'].includes(source.kind)) {
        const response=await fetch(this.config.baseUrl+`/api/v1/sessions/${id}/media/${encodeURIComponent(source.file_id)}`,{headers:{Authorization:'Bearer '+await this.token()},signal:AbortSignal.timeout(this.config.requestTimeoutMs)});
        if(!response.ok) throw new Error(`Native attachment unavailable: ${response.status}`);
        data=Buffer.from(await response.arrayBuffer());mediaType=response.headers.get('content-type')?.split(';')[0];
      } else {
        content.push({type:'text',text:`[Native ${block.type}: ${source.url}; preview unavailable]`});continue;
      }
      const name=block.name ?? (source.path ? basename(source.path) : undefined);
      if(block.type==='file') content.push({type:'file',attachment:await attachments.saveFile({data,name:name??'native-file',...(mediaType?{mediaType}:{})})});
      else {
        mediaType ??= data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216?'image/jpeg':data.subarray(0,3).toString()==='GIF'?'image/gif':data.subarray(8,12).toString()==='WEBP'?'image/webp':undefined;
        if(!mediaType) throw new Error('Unsupported native image bytes');
        content.push({type:'image',attachment:await attachments.saveImage({data,mediaType,...(name?{name}:{})})});
      }
    }
    return content;
  }
}

export function turnText(turn) {
  if (turn.assistantContent) return turn.assistantContent.filter(block => block.type === 'text').map(block => block.text).join('\n\n');
  return (turn.steps ?? []).flatMap(step => step.frames ?? []).filter(frame => frame.kind === 'text' && frame.role === 'assistant').map(frame => frame.text).join('\n\n');
}

export function selectedQuestionAnswer(question, answer) {
  const picked = (answer?.selected ?? []).map(label => question.options.find(o => o.label === label)?.id).filter(Boolean);
  const other = answer?.custom?.trim();
  if (picked.length && other) return { kind: 'multi_with_other', option_ids: picked, other_text: other };
  if (other) return { kind: 'other', text: other };
  if (picked.length) return question.multi_select ? { kind: 'multi', option_ids: picked } : { kind: 'single', option_id: picked[0] };
  return { kind: 'skipped' };
}

export async function promptContent(ctx, message) {
  const content = [];
  for (const block of message.content) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'file') content.push({ type: 'text', text: `Attached file: ${JSON.stringify(await ctx.attachments.fileHostPath(block.attachment))}` });
    else if (block.type === 'image') {
      const image = await ctx.attachments.readImage(block.attachment);
      content.push({ type: 'image', source: { kind: 'base64', media_type: image.ref.mediaType, data: Buffer.from(image.data).toString('base64') } });
    } else throw new Error(`Kimi input type unsupported: ${block.type}`);
  }
  return content;
}

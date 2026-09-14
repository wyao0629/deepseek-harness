import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { decodeRoute } from './route.mjs';

const text = value => typeof value === 'string' ? value : JSON.stringify(value);
const message = (role, content, source) => ({ id: randomUUID(), role, content, source });

export function mapTools(tools = []) {
  const mapped = [], kinds = new Map();
  function add(tool, prefix = '') {
    if (tool.type === 'namespace') { for (const child of tool.tools ?? []) add(child, tool.name + '__'); return; }
    if (!['function', 'custom'].includes(tool.type)) throw new Error(`Codex tool type not supported by DSH bridge: ${tool.type}`);
    const name = prefix + tool.name;
    kinds.set(name, { type: tool.type, name: tool.name, namespace: prefix ? prefix.slice(0, -2) : undefined });
    mapped.push({ name, description: tool.description ?? '', parameters: tool.type === 'custom'
      ? { type: 'object', properties: { input: { type: 'string', description: 'Exact raw tool input, preserving all newlines and patch syntax.' } }, required: ['input'], additionalProperties: false }
      : tool.parameters ?? { type: 'object', properties: {} } });
  }
  for (const tool of tools) add(tool);
  return { tools: mapped, kinds };
}

export async function mapInput(body, route, attachments) {
  const messages = [];
  const modelSource = { kind: 'model', provider: route.provider, model: route.model };
  const items = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input ?? [];
  if (body.previous_response_id) throw new Error('Bridge requires full Codex input history, not previous_response_id');
  for (const item of items) {
    if (item.type === 'reasoning') {
      // Do not pass opaque provider reasoning across adapters. Visible summaries remain available.
      const summary = (item.summary ?? []).map(x => x.text ?? '').join('\n');
      if (summary) messages.push(message('assistant', [{ type: 'reasoning', text: summary }], modelSource));
    } else if (['function_call', 'custom_tool_call'].includes(item.type)) {
      messages.push(message('assistant', [{ type: 'tool-call', id: item.call_id,
        name: (item.namespace ? item.namespace + '__' : '') + item.name,
        arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : item.arguments }], modelSource));
    } else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      const content = typeof item.output === 'string' ? [{ type: 'text', text: item.output }] : await mapContent(item.output, attachments);
      messages.push(message('user', [{ type: 'tool-result', toolCallId: item.call_id, content }], { kind: 'tool', callId: item.call_id }));
    } else if (item.type === 'message' || item.role) {
      const role = item.role === 'developer' ? 'system' : item.role;
      if (!['system', 'user', 'assistant'].includes(role)) throw new Error(`Unsupported input role: ${role}`);
      messages.push(message(role, await mapContent(item.content, attachments), role === 'assistant' ? modelSource : role === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'dsh-codex' }));
    } else throw new Error(`Unsupported Codex input item: ${item.type}`);
  }
  return messages;
}
async function mapContent(content, attachments) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const result = [];
  for (const part of content ?? []) {
    if (['input_text', 'output_text', 'text'].includes(part.type)) result.push({ type: 'text', text: part.text });
    else if (part.type === 'input_image') {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/.exec(part.image_url ?? '');
      if (!match || !attachments) throw new Error('Only inline Codex images are supported; image was not silently dropped');
      result.push({ type: 'image', attachment: await attachments.saveImage({ data: Buffer.from(match[2], 'base64'), mediaType: match[1] }) });
    } else throw new Error(`Unsupported input content: ${part.type}`);
  }
  return result;
}

export async function serveResponse(ctx, route, body, res, signal) {
  const { tools, kinds } = mapTools(body.tools);
  const messages = await mapInput(body, route, ctx.attachments);
  if (body.model !== route.model) throw new Error('Codex model differs from selected DSH model');
  const id = 'resp_' + randomUUID().replaceAll('-', '');
  let sequence = 0, usage = {}, finish, reasoning = '', reasoningItem;
  const output = [], textItems = new Map();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  const emit = (type, data) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`); };
  const response = status => ({ id, object: 'response', created_at: Math.floor(Date.now()/1000), status, model: route.model, output, usage: {
    input_tokens: (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    output_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)),
    input_tokens_details: { cached_tokens: usage.cacheReadTokens ?? 0 }, output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 }
  } });
  emit('response.created', { response: response('in_progress') });
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
  try {
    const meta = await ctx.llm.resolveModelInfo(route.provider, route.model, signal);
    const effort = body.reasoning?.effort;
    const allowed = meta.reasoning?.efforts?.map(x => typeof x === 'string' ? x : x.id) ?? [];
    const options = { provider: route.provider, model: route.model, messages, tools, signal,
      ...(body.instructions ? { system: body.instructions } : {}),
      ...(effort && allowed.includes(effort) ? { reasoningEffort: effort } : {}),
      ...(body.max_output_tokens ? { maxTokens: body.max_output_tokens } : {}),
      ...(body.temperature === undefined ? {} : { temperature: body.temperature }) };
    for await (const chunk of ctx.llm.stream(options)) {
      if (chunk.type === 'text-delta') {
        let item = textItems.get(chunk.index);
        if (!item) {
          item = { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text: '', annotations: [] }] };
          textItems.set(chunk.index, item); output.push(item);
          emit('response.output_item.added', { output_index: output.indexOf(item), item });
          emit('response.content_part.added', { item_id: item.id, output_index: output.indexOf(item), content_index: 0, part: item.content[0] });
        }
        item.content[0].text += chunk.text;
        emit('response.output_text.delta', { item_id: item.id, output_index: output.indexOf(item), content_index: 0, delta: chunk.text });
      } else if (chunk.type === 'reasoning-delta') {
        if (!reasoningItem) {
          reasoningItem = { id: 'rs_' + randomUUID(), type: 'reasoning', summary: [{ type: 'summary_text', text: '' }] }; output.push(reasoningItem);
          emit('response.output_item.added', { output_index: output.indexOf(reasoningItem), item: reasoningItem });
          emit('response.reasoning_summary_part.added', { item_id: reasoningItem.id, output_index: output.indexOf(reasoningItem), summary_index: 0, part: reasoningItem.summary[0] });
        }
        reasoning += chunk.text; reasoningItem.summary[0].text = reasoning;
        emit('response.reasoning_summary_text.delta', { item_id: reasoningItem.id, output_index: output.indexOf(reasoningItem), summary_index: 0, delta: chunk.text });
      } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
        const call = chunk.block, spec = kinds.get(call.name);
        if (!spec) throw new Error(`Model returned unregistered tool: ${call.name}`);
        const item = { id: 'fc_' + randomUUID(), call_id: call.id, type: spec.type === 'custom' ? 'custom_tool_call' : 'function_call', name: spec.name,
          ...(spec.namespace ? { namespace: spec.namespace } : {}),
          ...(spec.type === 'custom' ? { input: JSON.parse(call.arguments).input } : { arguments: call.arguments }), status: 'completed' };
        if (spec.type === 'custom' && typeof item.input !== 'string') throw new Error('Custom tool input must be a string');
        output.push(item); emit('response.output_item.added', { output_index: output.indexOf(item), item });
      } else if (chunk.type === 'usage') usage = chunk.usage;
      else if (chunk.type === 'finish') finish = chunk.reason;
    }
    if (!finish || ['error', 'aborted'].includes(finish.kind)) throw new Error(finish?.failure?.message ?? 'Provider stream ended without terminal status');
    for (const item of output) {
      if (item.type === 'message') {
        item.status = 'completed';
        emit('response.output_text.done', { item_id: item.id, output_index: output.indexOf(item), content_index: 0, text: item.content[0].text });
      }
      emit('response.output_item.done', { output_index: output.indexOf(item), item });
    }
    emit(finish.kind === 'max-tokens' ? 'response.incomplete' : 'response.completed', { response: { ...response(finish.kind === 'max-tokens' ? 'incomplete' : 'completed'), ...(finish.kind === 'max-tokens' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) } });
  } catch (error) {
    // Provider error strings can contain URLs or headers; do not reflect them to arbitrary clients.
    emit('response.failed', { response: { ...response('failed'), error: { code: 'dsh_provider_error', message: 'DSH model request failed or used an unsupported protocol feature.' } } });
    ctx.logger?.warn?.('dsh-codex model bridge request failed');
    throw error;
  } finally { clearInterval(heartbeat); res.end(); }
}

export async function startBridge(ctx, { port = 18791, token }) {
  const server = http.createServer(async (req, res) => {
    const got = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + token);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) { res.writeHead(401); res.end(); return; }
    const match = /^\/route\/(dsh:[A-Za-z0-9_-]+)\/responses$/.exec(req.url ?? '');
    if (req.method !== 'POST' || !match) { res.writeHead(404); res.end(); return; }
    const abort = new AbortController(); res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      let size = 0; const chunks = [];
      for await (const b of req) { size += b.length; if (size > 32*1024*1024) throw new Error('Request exceeds 32 MiB'); chunks.push(b); }
      const route = decodeRoute(match[1]);
      await serveResponse(ctx, route, JSON.parse(Buffer.concat(chunks).toString()), res, abort.signal);
    } catch (error) { if (!res.headersSent) { const detail = /^(Unsupported |Only inline |Bridge requires |Codex model |Codex tool type )/.test(error?.message ?? '') ? error.message : 'Invalid or unsupported Codex bridge request'; res.writeHead(400); res.end(JSON.stringify({ error: { message: detail } })); } }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

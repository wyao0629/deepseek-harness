import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dshHome, codexHome } from './paths.mjs';
import { randomBytes } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { CodexLlmAdapter, CodexSupervisor } from '../vendor/codex-adapter.mjs';
import { decodeRoute } from './route.mjs';
import { startBridge } from './bridge.mjs';
import { startSync } from './sync.mjs';

export const name = 'dsh-codex';
export const inject = ['llm', 'subprocess', 'sessions', 'agents', 'userQuestions', 'attachments', 'sessionController'];
export const Config = z.object({
  bridgePort: z.number().default(18791),
  executablePath: z.string().default(process.env.CODEX_BIN ?? 'codex'),
  startupTimeoutMs: z.number().default(15000),
  shutdownGraceMs: z.number().default(3000),
  commandOutputLimitBytes: z.number().default(262144),
});

export function threadRoute(encoded, model, port, token) {
  return { model, modelProvider: 'dsh_bridge', config: {
    'model_providers.dsh_bridge': { name: 'DSH selected model', base_url: `http://127.0.0.1:${port}/route/${encoded}`, wire_api: 'responses',
      requires_openai_auth: false, http_headers: { Authorization: 'Bearer ' + token }, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0 },
    web_search: 'disabled', 'features.shell_tool': true,
  } };
}

export class DshCodexAdapter extends CodexLlmAdapter {
  constructor(ctx, supervisor, config, ready, busy = new Set()) { super(ctx, supervisor, config); this.ready = ready; this.busy = busy; }
  async prepareCall(provider, model, signal) {
    return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) };
  }
  async listModels() { return []; } // Keep model selection in the existing DSH providers.
  async resolveModel(_provider, id, signal) {
    const route = decodeRoute(id);
    const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal);
    return { ...info, provider: 'codex', id, name: info.name + ' · Codex' };
  }
  async *stream(options) {
    const route = decodeRoute(options.model);
    const { port, token } = await this.ready;
    const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, options.signal);
    const nativeRoute = threadRoute(options.model, route.model, port, token);
    if (Number.isSafeInteger(info.context?.contextWindow)) nativeRoute.config.model_context_window = info.context.contextWindow;
    const onThreadBound = async binding => {
      const dir = join(dshHome(), 'dsh-codex', 'threads');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, binding.threadId + '.json'), JSON.stringify({ ...binding, bridgePort: port }), { mode: 0o600 });
    };
    // A fresh native reader sees CLI changes persisted since the previous DSH turn.
    const supervisor = new CodexSupervisor(this.ctx, this.config);
    const adapter = new CodexLlmAdapter(this.ctx, supervisor, this.config);
    this.busy.add(options.sessionId);
    try {
      yield* adapter.stream({ ...options, onThreadBound, model: route.model, selectedProvider: route.provider,
        codexRoute: { ...nativeRoute, ...(options.system ? { developerInstructions: options.system } : {}) } });
    } finally { await supervisor.dispose(); this.busy.delete(options.sessionId); }
  }
}

export function apply(ctx, config) {
  let bridge;
  const ready = (async () => {
    const dir = join(dshHome(), 'dsh-codex');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'bridge-token');
    let token;
    try { token = (await readFile(file, 'utf8')).trim(); }
    catch (e) { if (e.code !== 'ENOENT') throw e; token = randomBytes(32).toString('hex'); await writeFile(file, token, { mode: 0o600, flag: 'wx' }); }
    bridge = await startBridge(ctx, { port: config.bridgePort, token });
    return { port: config.bridgePort, token };
  })();
  // Keep initialization rejection observed even before the first user turn.
  ready.catch(() => {});
  const busy = new Set();
  const sync = startSync(ctx, busy);
  const supervisor = new CodexSupervisor(ctx, config);
  ctx.llm.registerAdapter(['codex'], new DshCodexAdapter(ctx, supervisor, config, ready, busy));
  ctx.effect(function* () {
    yield async () => { await sync.stop(); await supervisor.dispose(); await ready.catch(() => {}); if (bridge) await new Promise(resolve => bridge.close(resolve)); };
  }, 'dsh-codex runtime');
}

import { encodeRoute, decodeRoute } from '../../dsh-codex/lib/route.mjs';
import { createScope } from '@deepseek-ai/dsh-scope';
export const name = 'dsh-kimi-preset-route';
export const inject = ['dshKimi', 'commands'];
export function apply(ctx) {
  ctx.commands.useNativePalette();
  for (const command of ['kimi', 'status', 'usage', 'compact', 'plan', 'swarm', 'tasks', 'skills', 'mcp', 'resume', 'model', 'effort']) {
    ctx.commands.register({ name: command, description: `Kimi · ${command}`, input: { hint: command === 'kimi' ? 'help / model / effort / status' : '参数' },
      handler: invocation => ctx.dshKimi.command(invocation, command) });
  }
  const runtime = ctx.dshKimi, scopes = new Map();
  function attach(agent) {
    if (scopes.has(agent.session.id)) return;
    const scope = createScope(ctx, agent), registrations = new Map();
    const update = skills => {
      for (const dispose of registrations.values()) dispose();
      registrations.clear();
      for (const skill of skills) {
        if (![undefined, 'prompt', 'inline', 'flow'].includes(skill.type)) continue;
        const name = 'skill:' + skill.name;
        if (!/^[a-z][a-z0-9_:-]*$/.test(name)) continue;
        registrations.set(name, scope.ctx.commands.register({ name, description: `Kimi · ${skill.description || skill.name}`, input: { hint: '参数' }, handler: i => runtime.command(i, name) }));
      }
    };
    if (!runtime.catalogListeners.has(agent.session.id)) runtime.catalogListeners.set(agent.session.id, new Set());
    runtime.catalogListeners.get(agent.session.id).add(update);
    scopes.set(agent.session.id, { scope, update });
  }
  ctx.effect(function* () { yield async () => {
    for (const [id, { scope, update }] of scopes) {
      runtime.catalogListeners.get(id)?.delete(update);
      await scope.dispose();
    }
  }; }, 'Kimi native skill commands');
  ctx.on('agent/request', async ({ agent }, next) => {
    attach(agent);
    const selected = await next();
    if (selected.provider === 'kimi') { decodeRoute(selected.model); return selected; }
    return { ...selected, provider: 'kimi', model: encodeRoute(selected.provider, selected.model) };
  }, true);
}

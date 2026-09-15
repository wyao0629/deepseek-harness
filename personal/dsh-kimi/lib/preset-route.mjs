import { encodeRoute, decodeRoute } from '../../dsh-codex/lib/route.mjs';
import { createScope } from '@deepseek-ai/dsh-scope';
import { commandHelp, aliases, skillCommands } from './commands.mjs';
export const name = 'dsh-kimi-preset-route';
export const inject = ['dshKimi', 'commands'];
export function apply(ctx) {
  ctx.commands.useNativePalette();
  for (const [command, [description, hint]] of Object.entries(commandHelp)) {
    ctx.commands.register({ name: command, definitionId: 'native-harness/kimi/' + command, description, ...(hint ? {input: { hint }} : {}),
      handler: invocation => ctx.dshKimi.command(invocation, command) });
  }
  for (const [alias, command] of Object.entries(aliases)) ctx.commands.register({name:alias,definitionId:'native-harness/kimi/'+alias,description:commandHelp[command][0],...(commandHelp[command][1]?{input:{hint:commandHelp[command][1]}}:{}),handler:i=>ctx.dshKimi.command(i,command)});
  const runtime = ctx.dshKimi, scopes = new Map();
  function attach(agent) {
    if (scopes.has(agent.session.id)) return;
    const scope = createScope(ctx, agent), registrations = new Map();
    const update = skills => {
      for (const dispose of registrations.values()) dispose();
      registrations.clear();
      for (const skill of skillCommands(skills)) {
        const {name,description}=skill;
        registrations.set(name, scope.ctx.commands.register({ name, definitionId: 'native-harness/kimi/' + name, description, input: { hint: '可选：任务要求' }, handler: i => runtime.command(i, 'skill:'+skill.skill) }));
      }
    };
    if (!runtime.catalogListeners.has(agent.session.id)) runtime.catalogListeners.set(agent.session.id, new Set());
    runtime.catalogListeners.get(agent.session.id).add(update);
    scopes.set(agent.session.id, { scope, update });
    update(runtime.skillCatalogs.get(agent.session.id) ?? []);
  }
  ctx.on('agent/created', ({agent}) => {
    attach(agent);
    void runtime.ready.then(()=>runtime.ensureBinding(agent)).then(binding=>runtime.refreshCatalog(agent.session.id,binding.nativeId)).catch(error=>ctx.logger.warn('Kimi 命令目录加载失败：'+error.message));
  });
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

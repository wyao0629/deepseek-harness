import { encodeRoute, decodeRoute } from './route.mjs';
import { commandDescriptions } from './command-descriptions.mjs';
export const name = 'dsh-codex-preset-route';
export const inject = ['commands', 'dshCodex'];
export function apply(ctx) {
  ctx.commands.useNativePalette();
  for (const [command, [description, hint]] of Object.entries(commandDescriptions)) {
    ctx.commands.register({ name: command, definitionId: 'native-harness/codex/' + command, description,
      ...(hint ? {input: {hint}} : {}),
      handler: invocation => {
        const raw = invocation.rawInput.trim();
        const [action, ...rest] = raw.split(/\s+/);
        if (command === 'help' || (command === 'codex' && (!action || action === 'help'))) return {kind:'success',text:Object.entries(commandDescriptions).map(([name,[description]])=>`/${name} — ${description}`).join('\n')};
        return ctx.dshCodex.execute(invocation, command === 'codex' ? action || 'help' : command, command === 'codex' ? rest.join(' ') : raw);
      },
    });
  }
  ctx.on('agent/request', async (_payload, next) => {
    const selected = await next();
    if (selected.provider === 'codex') {
      decodeRoute(selected.model);
      return selected;
    }
    return { ...selected, provider: 'codex', model: encodeRoute(selected.provider, selected.model) };
  }, true);
}

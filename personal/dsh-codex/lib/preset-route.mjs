import { encodeRoute, decodeRoute } from './route.mjs';
export const name = 'dsh-codex-preset-route';
export const inject = ['commands', 'dshCodex'];
export function apply(ctx) {
  for (const command of ['codex', 'compact', 'status', 'plan', 'review', 'diff']) {
    ctx.commands.register({ name: command, description: command === 'codex' ? 'Codex 原生命令（help 查看帮助）' : `Codex 原生 ${command}`,
      input: { hint: command === 'codex' ? 'help / status / compact / model / permissions' : '参数' },
      handler: invocation => {
        const raw = invocation.rawInput.trim();
        const [action, ...rest] = raw.split(/\s+/);
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

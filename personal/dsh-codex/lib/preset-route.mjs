import { encodeRoute, decodeRoute } from './route.mjs';
export const name = 'dsh-codex-preset-route';
export const inject = [];
export function apply(ctx) {
  ctx.on('agent/request', async (_payload, next) => {
    const selected = await next();
    if (selected.provider === 'codex') {
      decodeRoute(selected.model);
      return selected;
    }
    return { ...selected, provider: 'codex', model: encodeRoute(selected.provider, selected.model) };
  }, true);
}

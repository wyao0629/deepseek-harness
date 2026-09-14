export function encodeRoute(provider, model) {
  if (!provider || !model || provider === 'codex') throw new Error('请选择 DSH 中的实际模型提供方，不要选择 Codex 提供方。');
  return 'dsh:' + Buffer.from(JSON.stringify([provider, model])).toString('base64url');
}
export function decodeRoute(value) {
  if (!value?.startsWith('dsh:')) throw new Error('Codex 预设需要一个 DSH 模型选择，请重新选择模型。');
  let route;
  try { route = JSON.parse(Buffer.from(value.slice(4), 'base64url').toString()); } catch { throw new Error('Invalid DSH model route'); }
  if (!Array.isArray(route) || route.length !== 2 || route.some(x => typeof x !== 'string' || !x) || route[0] === 'codex') throw new Error('Invalid DSH model route');
  return { provider: route[0], model: route[1] };
}

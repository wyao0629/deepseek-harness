export async function waitForCommandCatalog(host, id, signal) {
  signal.throwIfAborted();
  if (host.commandCatalogs.has(id)) return;
  await new Promise((resolve, reject) => {
    if (!host.commandListeners.has(id)) host.commandListeners.set(id, new Set());
    const listeners = host.commandListeners.get(id);
    const clean = () => { clearTimeout(timer); listeners.delete(ready); signal.removeEventListener('abort', abort); };
    const ready = () => { clean(); resolve(); };
    const abort = () => { clean(); reject(signal.reason); };
    const timer = setTimeout(() => { clean(); reject(new Error('Grok 原生命令目录加载超时，请重试。')); }, 15000);
    listeners.add(ready);
    signal.addEventListener('abort', abort, {once:true});
    if (host.commandCatalogs.has(id)) ready();
    else if (signal.aborted) abort();
  });
}

import { GROK_PROVIDER, resolveGrokModelId } from './constants.js'
import { grokPresenterDefinitions } from './presenters.js'
import { createScope } from '@deepseek-ai/dsh-scope'
import { describeCommand, nativeCommandNames } from './command-descriptions.js'
import { waitForCommandCatalog } from './command-catalog.js'

export const name = 'grok-build-preset-route'
export const inject = ['tools', 'commands', 'dshGrokBuild']

export function apply(ctx, config = {}) {
  ctx.commands.useNativePalette()
  const host = ctx.dshGrokBuild
  const scopes = new Map()
  let stopped = false
  const lifetime = new AbortController()
  async function execute(invocation, name, args) {
    const id = await attach(invocation.agent)
    const catalog = host.commandCatalogs.get(id) ?? []
    if (!name || name === 'help') return { kind: 'success', text: catalog.map(c => `/${c.name} — ${describeCommand(c)}`).join('\n') || '原生命令目录正在初始化，请再次输入 /grok help。' }
    if (!catalog.some(c => c.name === name)) return { kind: 'error', text: `当前 Grok 未发布此命令：${name}` }
    return invocation.agent.runMaintenance(async () => {
      let text = ''
      for await (const update of host.streamTurn(invocation.agent, [{type:'text',text:`/${name}${args ? ' ' + args : ''}`}], invocation.signal)) {
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') text += update.content.text
      }
      return { kind: 'success', text: text || `/${name} 已执行` }
    })
  }
  async function attach(agent) {
    const id = await host.ensureAgentSession(agent)
    if (stopped) return id
    await waitForCommandCatalog(host, id, lifetime.signal)
    if (stopped) return id
    if (scopes.has(agent.session.id)) return id
    const scope = createScope(ctx, agent), registrations = new Map()
    const update = catalog => {
      if (stopped) return
      for (const dispose of registrations.values()) dispose()
      registrations.clear()
      for (const command of catalog) {
        if (!/^[a-z][a-z0-9_:-]*$/.test(command.name) || ['dsh','grok'].includes(command.name)) continue
        registrations.set(command.name, scope.ctx.commands.register({name:command.name, definitionId:'native-harness/grok/'+command.name, description:describeCommand(command),
          ...(command.input ? {input:{hint:'任务或参数；详见命令说明'}} : {}), handler: invocation => execute(invocation, command.name, invocation.rawInput.trim())}))
      }
    }
    if (!host.commandListeners.has(id)) host.commandListeners.set(id,new Set())
    host.commandListeners.get(id).add(update)
    scopes.set(agent.session.id,{scope,id,update})
    update(host.commandCatalogs.get(id) ?? [])
    return id
  }
  ctx.commands.register({name:'grok',definitionId:'native-harness/grok/grok',description:'Grok 原生命令',input:{hint:'help 或原生命令'},handler:invocation=>{
    const [name,...rest]=invocation.rawInput.trim().split(/\s+/)
    return execute(invocation,name,rest.join(' '))
  }})
  // These names are advertised by the installed Grok 1.0.30 ACP runtime. Keep
  // discovery available before its asynchronous catalog arrives; execution
  // still validates against the live native catalog above.
  for (const name of nativeCommandNames) ctx.commands.register({name,definitionId:'native-harness/grok/'+name,
    description:describeCommand({name}),...(['context','session-info'].includes(name)?{}:{input:{hint:'任务或参数；详见命令说明'}}),
    handler:invocation=>execute(invocation,name,invocation.rawInput.trim())})
  ctx.on('agent/created', ({agent}) => { void attach(agent).catch(error => ctx.logger.warn('Grok 命令目录初始化失败：'+error.message)) })
  ctx.effect(function* () { yield async () => {
    stopped=true
    lifetime.abort()
    for (const {scope,id,update} of scopes.values()) {
      host.commandListeners.get(id)?.delete(update)
      await scope.dispose()
    }
  } }, 'Grok native commands')
  // Prepend so this listener wraps DSH's model-selection waterfall.
  // Model selection runs later in registration order and would otherwise
  // overwrite the Grok Build provider with the UI picker (tokenshop/grok-4.6).
  ctx.on('agent/request', async ({agent}, next) => {
    await attach(agent)
    const upstream = await next()
    return {
      ...upstream,
      provider: GROK_PROVIDER,
      model: resolveGrokModelId(config.model ?? upstream.model),
    }
  }, true)
  for (const definition of grokPresenterDefinitions()) {
    ctx.effect(() => ctx.tools.register(definition), `dsh-grok-build: ${definition.name} presentation`)
  }
}

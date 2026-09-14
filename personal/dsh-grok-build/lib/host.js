import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionMapping } from './mapping.js'
import { DEFAULT_GROK_MODEL } from './constants.js'

function grokChildEnv(extra = {}) {
  const home = process.env.HOME || homedir()
  const path = [`${home}/.grok/bin`, process.env.PATH].filter(Boolean).join(':')
  const proxy = {}
  for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) {
    if (process.env[key]) proxy[key] = process.env[key]
  }
  return {
    HOME: home,
    USER: process.env.USER,
    PATH: path,
    LANG: process.env.LANG,
    TERM: 'dumb',
    GROK_DISABLE_AUTOUPDATER: '1',
    ...proxy,
    ...process.env.XAI_API_KEY ? { XAI_API_KEY: process.env.XAI_API_KEY } : {},
    ...extra,
  }
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function permissionOutcome(dshOutcome, options) {
  const list = Array.isArray(options) ? options : []
  if (dshOutcome === 'allowed-once') {
    const option = list.find((candidate) => candidate.kind === 'allow_once')
      ?? list.find((candidate) => candidate.kind === 'allow_always')
    return option === undefined
      ? { outcome: { outcome: 'cancelled' } }
      : { outcome: { outcome: 'selected', optionId: option.optionId } }
  }
  if (dshOutcome === 'rejected') {
    const option = list.find((candidate) => candidate.kind === 'reject_once')
      ?? list.find((candidate) => candidate.kind === 'reject_always')
    return option === undefined
      ? { outcome: { outcome: 'cancelled' } }
      : { outcome: { outcome: 'selected', optionId: option.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

function sessionHasFullAccess(session, sandboxPolicy) {
  const mode = sandboxPolicy?.overrideOf?.(session) ?? sandboxPolicy?.resolve?.({ session })?.mode
  return mode === 'danger-full-access'
}

class AcpProcess {
  constructor(child, makeClient, disposeGraceMs) {
    if (child.stdin === undefined || child.stdout === undefined) {
      throw new Error('dsh-grok-build: subprocess dropped a piped ACP stream')
    }
    this.child = child
    this.disposeGraceMs = disposeGraceMs
    this.disposal = undefined
    this.conn = new ClientSideConnection(
      makeClient,
      ndJsonStream(
        NodeWritable.toWeb(child.stdin),
        NodeReadable.toWeb(child.stdout),
      ),
    )
  }

  dispose() {
    return (this.disposal ??= (async () => {
      this.child.stdin?.end()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.disposeGraceMs)
      try {
        if (await this.child.waitForExit(controller.signal)) return
      } finally {
        clearTimeout(timer)
      }
      this.child.terminate()
      await this.child.waitForExit()
    })())
  }
}

export class AcpHost {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.mapping = new SessionMapping(config.stateFile)
    this.process = undefined
    this.starting = undefined
    this.turns = new Map()
    this.agents = new Map()
    this.boundGeneration = new Map()
    this.capabilities = undefined
    this.models = []
    this.commandCatalogs = new Map()
    this.commandListeners = new Map()
    this.currentModelId = DEFAULT_GROK_MODEL
    this.idleTimer = undefined
    this.generation = 0
    this.reconnections = new WeakMap()
  }

  bindAgent(localId, agent) {
    this.agents.set(String(localId), agent)
  }

  unbindAgent(localId) {
    this.agents.delete(String(localId))
    this.boundGeneration.delete(String(localId))
    if (this.turns.size === 0 && this.agents.size === 0) this.scheduleIdleDispose()
  }

  async ensureProcess() {
    if (this.process !== undefined) return this.process
    if (this.starting !== undefined) return this.starting
    this.starting = this.startProcess().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  async startProcess() {
    this.clearIdleDispose()
    const child = this.ctx.subprocess.spawn({
      argv: [this.config.command, ...this.config.args],
      cwd: process.cwd(),
      env: grokChildEnv(this.config.env),
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: this.config.disposeGraceMs,
    })
    const processHandle = new AcpProcess(child, () => ({
      sessionUpdate: (params) => this.handleUpdate(params),
      requestPermission: (params) => this.requestPermission(params),
      readTextFile: (params) => this.readTextFile(params),
      writeTextFile: (params) => this.writeTextFile(params),
      extMethod: async () => ({}),
      extNotification: async () => {},
    }), this.config.disposeGraceMs)
    try {
      const initialized = await processHandle.conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'dsh-grok-build', version: this.config.packageVersion },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      })
      this.capabilities = initialized.agentCapabilities
      this.ingestInitialize(initialized)
      const methods = initialized.authMethods ?? []
      const cached = methods.find((method) => method.id === 'cached_token') ?? methods[0]
      if (cached !== undefined) {
        try {
          await processHandle.conn.authenticate({ methodId: cached.id })
        } catch (error) {
          this.ctx.logger.warn(`dsh-grok-build: authenticate(${cached.id}) failed: ${errorText(error)}`)
        }
      }
      this.generation += 1
      this.process = processHandle
      child.done.catch(() => {}).finally(() => {
        if (this.process !== processHandle) return
        this.process = undefined
        this.capabilities = undefined
        this.boundGeneration.clear()
      })
      return processHandle
    } catch (error) {
      await processHandle.dispose()
      throw error
    }
  }

  ingestInitialize(initialized) {
    const meta = initialized._meta ?? {}
    const modelState = meta.modelState ?? {}
    if (typeof modelState.currentModelId === 'string') this.currentModelId = modelState.currentModelId
    if (Array.isArray(modelState.availableModels)) this.models = modelState.availableModels
  }

  ingestSession(session) {
    if (session === undefined || session === null) return
    if (typeof session.models?.currentModelId === 'string') this.currentModelId = session.models.currentModelId
    if (Array.isArray(session.models?.availableModels)) this.models = session.models.availableModels
  }

  async openSession(localId, cwd) {
    if (cwd === undefined || !isAbsolute(cwd)) throw new Error('Grok Build requires an absolute session cwd')
    const processHandle = await this.ensureProcess()
    const mapped = this.mapping.get(localId)
    const capabilities = this.capabilities ?? {}
    const sessionCaps = capabilities.sessionCapabilities ?? {}
    let remoteSessionId
    let session
    if (mapped !== undefined && sessionCaps.resume !== undefined) {
      try {
        session = await processHandle.conn.resumeSession({ sessionId: mapped, cwd, mcpServers: [] })
        remoteSessionId = mapped
      } catch (error) {
        this.ctx.logger.warn(`dsh-grok-build: resume ${mapped} failed: ${errorText(error)}`)
      }
    }
    if (remoteSessionId === undefined && mapped !== undefined && capabilities.loadSession) {
      try {
        session = await processHandle.conn.loadSession({ sessionId: mapped, cwd, mcpServers: [] })
        remoteSessionId = mapped
      } catch (error) {
        this.ctx.logger.warn(`dsh-grok-build: load ${mapped} failed: ${errorText(error)}`)
      }
    }
    if (remoteSessionId === undefined) {
      session = await processHandle.conn.newSession({
        cwd,
        mcpServers: [],
        _meta: this.config.yoloMode ? { yoloMode: true } : {},
      })
      remoteSessionId = session.sessionId
    }
    this.mapping.set(localId, remoteSessionId)
    this.boundGeneration.set(String(localId), this.generation)
    this.ingestSession(session)
    this.clearIdleDispose()
    return { processHandle, remoteSessionId, session }
  }

  async ensureAgentSession(agent) {
    const localId = String(agent.id)
    const mapped = this.mapping.get(localId)
    if (
      this.process !== undefined
      && mapped !== undefined
      && this.boundGeneration.get(localId) === this.generation
    ) {
      this.bindAgent(localId, agent)
      return mapped
    }
    const pending = this.reconnections.get(agent)
    if (pending !== undefined) return pending
    const reconnecting = this.openSession(localId, agent.session.header.cwd).then((opened) => {
      this.bindAgent(localId, agent)
      return opened.remoteSessionId
    }).finally(() => {
      this.reconnections.delete(agent)
    })
    this.reconnections.set(agent, reconnecting)
    return reconnecting
  }

  async *streamTurn(agent, prompt, signal) {
    const remoteSessionId = await this.ensureAgentSession(agent)
    const conn = this.process?.conn
    if (conn === undefined) throw new Error('Grok ACP is not running')
    const turn = {
      agent,
      events: [],
      waiters: [],
      done: false,
      error: undefined,
      response: undefined,
    }
    this.turns.set(remoteSessionId, turn)
    const onAbort = () => {
      void conn.cancel({ sessionId: remoteSessionId }).catch(() => {})
    }
    if (signal !== undefined) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const promptPromise = conn.prompt({ sessionId: remoteSessionId, prompt }).then((response) => {
      turn.response = response
      turn.done = true
      this.flushWaiters(turn)
      return response
    }, (error) => {
      turn.error = error
      turn.done = true
      this.flushWaiters(turn)
      throw error
    })
    try {
      yield* this.consume(turn)
      await promptPromise
      return turn.response
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
      this.turns.delete(remoteSessionId)
      if (this.turns.size === 0 && this.agents.size === 0) this.scheduleIdleDispose()
    }
  }

  async *consume(turn) {
    let index = 0
    while (true) {
      while (index < turn.events.length) {
        yield turn.events[index]
        index += 1
      }
      if (turn.error !== undefined) throw turn.error
      if (turn.done) return
      await new Promise((resolve) => {
        turn.waiters.push(resolve)
      })
    }
  }

  flushWaiters(turn) {
    const waiters = turn.waiters.splice(0)
    for (const waiter of waiters) waiter()
  }

  handleUpdate(params) {
    const update = params.update
    if (update?.sessionUpdate === 'available_commands_update') {
      this.commandCatalogs.set(params.sessionId, update.availableCommands ?? [])
      for (const listener of this.commandListeners.get(params.sessionId) ?? []) listener(update.availableCommands ?? [])
    }
    if (update?.sessionUpdate === 'config_option_update') this.ingestConfig(update)
    const turn = this.turns.get(params.sessionId)
    if (turn === undefined) return Promise.resolve()
    turn.events.push(update)
    this.flushWaiters(turn)
    return Promise.resolve()
  }

  ingestConfig(update) {
    const options = update.configOptions ?? update.options
    if (!Array.isArray(options)) return
    const selected = options.find((option) => option.category === 'model' && option.selected)
    if (typeof selected?.id === 'string') this.currentModelId = selected.id
  }

  async requestPermission(params) {
    const turn = this.turns.get(params.sessionId)
    const agent = turn?.agent
    if (agent === undefined) return { outcome: { outcome: 'cancelled' } }
    if (sessionHasFullAccess(agent.session, this.ctx.get('sandboxPolicy'))) {
      return permissionOutcome('allowed-once', params.options)
    }
    try {
      const outcome = await this.ctx.approval.request({
        agent,
        toolName: params.toolCall?.title || params.toolCall?.name || 'Grok Build',
        callId: ToolCallId(params.toolCall?.toolCallId ?? 'grok-permission'),
      })
      return permissionOutcome(outcome, params.options)
    } catch (error) {
      this.ctx.logger.warn(`dsh-grok-build: permission prompt failed: ${errorText(error)}`)
      return { outcome: { outcome: 'cancelled' } }
    }
  }

  async readTextFile(params) {
    const path = this.resolveFilePath(params.path, params.sessionId, 'read')
    const content = await readFile(path, 'utf8')
    if (params.line === undefined && params.limit === undefined) return { content }
    const lines = content.split('\n')
    const start = Math.max((params.line ?? 1) - 1, 0)
    const slice = params.limit === undefined ? lines.slice(start) : lines.slice(start, start + params.limit)
    return { content: slice.join('\n') }
  }

  async writeTextFile(params) {
    const path = this.resolveFilePath(params.path, params.sessionId, 'write')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, params.content ?? '', 'utf8')
    return {}
  }

  resolveFilePath(path, sessionId, operation) {
    const turn = this.turns.get(sessionId)
    const cwd = turn?.agent?.session?.header?.cwd
    if (typeof path !== 'string' || path.length === 0) throw new Error(`Grok Build ${operation} path is empty`)
    const resolved = isAbsolute(path) ? path : join(cwd ?? process.cwd(), path)
    const allowOutside = this.config.allowOutsideWorkspace
      || (turn?.agent !== undefined && sessionHasFullAccess(turn.agent.session, this.ctx.get('sandboxPolicy')))
    if (!allowOutside && cwd !== undefined) {
      const relative = resolved.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`) || resolved === cwd
      if (!relative) throw new Error(`Grok Build ${operation} path is outside the session workspace`)
    }
    return resolved
  }

  async setConfigOption(remoteSessionId, configId, value) {
    const conn = this.process?.conn
    if (conn === undefined) throw new Error('Grok ACP is not running')
    return conn.setSessionConfigOption({
      sessionId: remoteSessionId,
      configId,
      value: { value },
    })
  }

  scheduleIdleDispose() {
    this.clearIdleDispose()
    const idleMs = this.config.idleDisposeMs
    if (!idleMs || idleMs <= 0) return
    this.idleTimer = setTimeout(() => {
      if (this.turns.size === 0 && this.agents.size === 0) void this.disposeProcess()
    }, idleMs)
  }

  clearIdleDispose() {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  async disposeProcess() {
    const processHandle = this.process
    this.process = undefined
    this.capabilities = undefined
    this.boundGeneration.clear()
    if (processHandle !== undefined) await processHandle.dispose()
  }

  async dispose() {
    this.clearIdleDispose()
    this.turns.clear()
    this.agents.clear()
    await this.disposeProcess()
  }
}

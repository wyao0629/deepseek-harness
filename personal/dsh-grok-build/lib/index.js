import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { createGrokBuildAdapter } from './adapter.js'
import { GROK_PROVIDER } from './constants.js'
import { AcpHost } from './host.js'
import { ensureManagedPreset } from './preset-install.js'

const require = createRequire(import.meta.url)
const packageVersion = require('../package.json').version

export const name = 'llm-grok-build'
export const inject = [
  'llm',
  'agents',
  'agentPresets',
  'subprocess',
  'approval',
  'attachments',
  'sessionProjections',
]

export const Config = z.object({
  command: z.string().default(defaultGrokCommand()),
  args: z.array(z.string()).default(['agent', '--no-leader', 'stdio']),
  env: z.dict(z.string()).default({}),
  apiKeyEnv: z.string().default('XAI_API_KEY'),
  model: z.string().default('dsh-grok-46'),
  stateFile: z.string().default(dshHomePath('grok-build-sessions.json')),
  disposeGraceMs: z.number().default(6_000),
  idleDisposeMs: z.number().default(30_000),
  yoloMode: z.boolean().default(false),
  allowOutsideWorkspace: z.boolean().default(false),
})

function defaultGrokCommand() {
  const home = process.env.HOME || homedir()
  const bundled = join(home, '.grok', 'bin', 'grok')
  return existsSync(bundled) ? bundled : 'grok'
}

async function resolveCommand(subprocess, configured) {
  const candidates = []
  if (configured !== undefined && configured.length > 0) candidates.push(configured)
  candidates.push(join(homedir(), '.grok', 'bin', 'grok'), 'grok')
  const searched = []
  let lastError
  for (const candidate of candidates) {
    if (searched.includes(candidate)) continue
    searched.push(candidate)
    if (configured !== undefined && configured.length > 0 && configured === candidate && !isAbsolute(candidate)) {
      throw new Error(`Grok Build executable path must be absolute: ${candidate}`)
    }
    try {
      return await subprocess.resolveExecutable(candidate)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Grok Build executable not found. Searched: ${searched.join(', ')}`, { cause: lastError })
}

async function collectChildEnv(ctx, config) {
  const env = { ...config.env }
  const names = [config.apiKeyEnv, 'XAI_API_KEY', 'TOKENSHOP_API_KEY', 'GROK200K_API_KEY']
  const credentials = ctx.get('credentials')
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) continue
    if (env[name]) continue
    const fromProcess = process.env[name]
    if (typeof fromProcess === 'string' && fromProcess.length > 0) {
      env[name] = fromProcess
      continue
    }
    if (credentials === undefined) continue
    try {
      const resolved = await credentials.resolve(credentialRef(name))
      if (resolved?.value) env[name] = resolved.value
    } catch {
      // Missing or invalid credential names are optional.
    }
  }
  if (!env.XAI_API_KEY) {
    env.XAI_API_KEY = env[config.apiKeyEnv] ?? env.TOKENSHOP_API_KEY ?? env.GROK200K_API_KEY
    if (!env.XAI_API_KEY) delete env.XAI_API_KEY
  }
  return env
}

export async function apply(ctx, config) {
  try {
    await ensureManagedPreset()
  } catch (error) {
    if (error?.name !== 'ManagedPresetConflictError') throw error
    ctx.logger.warn(`dsh-grok-build: preserving user-modified preset at ${error.path}`)
  }

  const command = await resolveCommand(ctx.subprocess, config.command)
  const env = await collectChildEnv(ctx, config)
  const host = new AcpHost(ctx, {
    command,
    args: config.args,
    env,
    stateFile: config.stateFile,
    disposeGraceMs: config.disposeGraceMs,
    idleDisposeMs: config.idleDisposeMs,
    yoloMode: config.yoloMode,
    allowOutsideWorkspace: config.allowOutsideWorkspace,
    packageVersion,
  })

  ctx.provide('dshGrokBuild', host)

  ctx.llm.registerAdapter([GROK_PROVIDER], createGrokBuildAdapter(
    host,
    ctx.agents,
    ctx.attachments,
    ctx.sessionProjections,
    (agent) => ctx.agentPresets.composedPreset(agent.ctx),
  ))

  ctx.on('agent/disposed', ({ agent }) => {
    host.unbindAgent(agent.id)
  })

  ctx.effect(() => () => {
    void host.dispose()
  }, 'dsh-grok-build: acp host')
}

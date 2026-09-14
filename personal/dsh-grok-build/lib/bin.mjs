#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { ensureManagedPreset, removeManagedPreset, targetPresetDir } from './preset-install.js'

function defaultGrok() {
  const bundled = join(homedir(), '.grok', 'bin', 'grok')
  return existsSync(bundled) ? bundled : 'grok'
}

function probe(command) {
  return spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })
}

async function doctor() {
  const command = process.env.GROK_COMMAND || defaultGrok()
  const version = isAbsolute(command) || command === 'grok' ? probe(command) : { status: 1, stdout: '', stderr: 'non-absolute' }
  const ok = version.status === 0
  process.stdout.write(`${JSON.stringify({
    executable: {
      status: existsSync(command) || command === 'grok' ? (ok ? 'found' : 'error') : 'missing',
      path: command,
    },
    version: ok
      ? { status: 'ok', value: String(version.stdout || version.stderr).trim() }
      : { status: 'error', message: String(version.stderr || version.stdout || 'grok --version failed').trim() },
    preset: { path: targetPresetDir() },
  }, null, 2)}\n`)
  return ok ? 0 : 1
}

async function main() {
  const command = process.argv[2] ?? 'doctor'
  if (command === 'doctor') return doctor()
  if (command === 'install-preset') {
    process.stdout.write(`${await ensureManagedPreset()}\n`)
    return 0
  }
  if (command === 'remove-preset') {
    process.stdout.write(`${await removeManagedPreset()}\n`)
    return 0
  }
  process.stderr.write('Usage: dsh-grok-build [doctor | install-preset | remove-preset]\n')
  return 2
}

try {
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

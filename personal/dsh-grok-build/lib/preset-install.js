import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { GROK_PRESET_ID, PRESET_FINGERPRINT } from './constants.js'

const FILES = ['preset.yml', 'agent.cordis.yml']

export function sourcePresetDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'preset', GROK_PRESET_ID)
}

export function targetPresetDir() {
  return dshHomePath('.agent-presets', GROK_PRESET_ID)
}

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function managed(text) {
  return typeof text === 'string' && text.includes(PRESET_FINGERPRINT)
}

export async function ensureManagedPreset() {
  const sourceDir = sourcePresetDir()
  const targetDir = targetPresetDir()
  await mkdir(targetDir, { recursive: true })
  let changed = false
  for (const file of FILES) {
    const source = await readFile(join(sourceDir, file), 'utf8')
    const targetPath = join(targetDir, file)
    const current = await readIfPresent(targetPath)
    if (current === source) continue
    if (current !== undefined && !managed(current)) {
      throw Object.assign(new Error(`user-modified grok preset at ${targetPath}`), {
        name: 'ManagedPresetConflictError',
        path: targetPath,
      })
    }
    await writeFile(targetPath, source, { encoding: 'utf8', mode: 0o600 })
    changed = true
  }
  return changed ? 'installed' : 'unchanged'
}

export async function removeManagedPreset() {
  const targetDir = targetPresetDir()
  let removed = false
  for (const file of FILES) {
    const targetPath = join(targetDir, file)
    const current = await readIfPresent(targetPath)
    if (current === undefined) continue
    if (!managed(current)) {
      throw Object.assign(new Error(`refusing to delete user-modified grok preset at ${targetPath}`), {
        name: 'ManagedPresetConflictError',
        path: targetPath,
      })
    }
    const { unlink } = await import('node:fs/promises')
    await unlink(targetPath)
    removed = true
  }
  return removed ? 'removed' : 'absent'
}

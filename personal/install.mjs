import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { dshHome } from './dsh-codex/lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'personal', 'dsh-codex');

/** Write a preset, keeping one content-addressed copy of an overwritten file. */
export async function writePreset(file, content, backupDir) {
  let previous;
  try { previous = await readFile(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.equals(Buffer.from(content))) return;
  if (previous) {
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const hash = createHash('sha256').update(previous).digest('hex').slice(0, 12);
    await copyFile(file, join(backupDir, `${hash}-${file.split(/[\\/]/).at(-1)}`));
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, { mode: 0o600 });
}

/** Install the checkout's Codex bundle into a DSH profile without starting services. */
export async function install() {
  if (process.platform !== 'linux') throw new Error('This personal deployment entry targets Linux servers.');
  const profile = process.env.DSH_PROFILE ?? 'web';
  const installed = process.argv.includes('--installed');
  const cli = installed ? [process.env.DSH_BIN ?? 'dsh'] : [process.execPath, '--import', 'tsx/esm', join(root, 'apps/cli/src/bin.ts')];
  const env = { ...process.env, DSH_HOME: dshHome(), DSH_PACKAGE_JSON: process.env.DSH_PACKAGE_JSON ?? join(root, 'apps/cli/package.json') };
  if (installed && !process.env.DSH_PACKAGE_JSON) throw new Error('--installed requires DSH_PACKAGE_JSON pointing to the installed DSH package.json');
  const run = (argv, cwd = root) => {
    const result = spawnSync(argv[0], argv.slice(1), { cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Command failed: ${argv[0]} (${result.status})`);
  };
  run([process.env.CODEX_BIN ?? 'codex', '--version']);
  run(['npm', 'install', '--ignore-scripts', '--no-package-lock'], plugin);
  run([...cli, 'plugin', '--profile', profile, 'add', plugin]);
  run([process.execPath, join(plugin, 'scripts/install-compat.mjs')]);
  const presets = join(dshHome(), '.agent-presets', 'codex');
  const backups = join(dshHome(), 'backups', 'dsh-codex');
  await writePreset(join(presets, 'preset.yml'), 'name: Codex\norder: 20\n', backups);
  await writePreset(join(presets, 'agent.cordis.yml'), "- id: codex-route\n  name: 'dsh-codex/preset-route'\n", backups);
  run([...cli, '--profile', profile, '--dump-config']);
  console.log(`Installed dsh-codex into ${profile}. Start this checkout with pnpm dsh --profile ${profile}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await install();

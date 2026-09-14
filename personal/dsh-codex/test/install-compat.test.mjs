import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('installed-build compatibility is version checked, backed up once, and repeatable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-compat-'));
  try {
    const manifest = join(root, 'package.json');
    await writeFile(manifest, '{}');
    const version = JSON.parse(await readFile(new URL('../../../packages/interaction/commands/package.json', import.meta.url), 'utf8')).version;
    const paths = {};
    for (const name of ['session', 'commands']) {
      const dir = join(root, 'node_modules', '@deepseek-ai', 'dsh-' + name);
      await mkdir(join(dir, 'lib'), { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ version, main: 'lib/index.js' }));
      paths[name] = join(dir, 'lib', 'index.js');
    }
    const original = 'const surfaceMetadata = {\n};\n';
    await writeFile(paths.session, original);
    await writeFile(paths.commands, '// old registry\n');
    const script = fileURLToPath(new URL('../scripts/install-compat.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, DSH_PACKAGE_JSON: manifest, DSH_BACKUP_DIR: join(root, 'backups') } });
    const wrong = join(root, 'node_modules', '@deepseek-ai', 'dsh-commands', 'package.json');
    await writeFile(wrong, JSON.stringify({ version: '0.0.0', main: 'lib/index.js' }));
    assert.notEqual(run().status, 0);
    assert.equal(await readFile(paths.session, 'utf8'), original);
    await writeFile(wrong, JSON.stringify({ version, main: 'lib/index.js' }));
    const first = run(); assert.equal(first.status, 0, first.stderr);
    assert.match(await readFile(paths.commands, 'utf8'), /useNativePalette\(/);
    assert.match(await readFile(paths.session, 'utf8'), /ignorable === true/);
    const backups = await readdir(join(root, 'backups'));
    assert.equal(backups.length, 2);
    const second = run(); assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(await readdir(join(root, 'backups')), backups);
  } finally { await rm(root, { recursive: true, force: true }); }
});

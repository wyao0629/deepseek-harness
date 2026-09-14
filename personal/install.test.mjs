import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { writePreset } from './install.mjs';

test('preset updates preserve exactly one previous content and repeat without new backups', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-personal-install-'));
  try {
    const file = join(dir, 'preset', 'preset.yml'), backups = join(dir, 'backups');
    await writePreset(file, 'name: Original\n', backups);
    await writePreset(file, 'name: Codex\n', backups);
    const names = await readdir(backups);
    assert.equal(names.length, 1);
    assert.equal(await readFile(join(backups, names[0]), 'utf8'), 'name: Original\n');
    await writePreset(file, 'name: Codex\n', backups);
    assert.deepEqual(await readdir(backups), names);
    assert.equal(await readFile(file, 'utf8'), 'name: Codex\n');
  } finally { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); }
});

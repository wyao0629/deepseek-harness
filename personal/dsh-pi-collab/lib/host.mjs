import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
export const name = 'dsh-pi-collab';
export async function apply() {
  const target = dshHomePath('.agent-presets', 'pi-collab');
  await mkdir(target, { recursive: true });
  for (const file of ['agent.cordis.yml', 'preset.yml']) {
    const source = await readFile(fileURLToPath(new URL(`../preset/${file}`, import.meta.url)), 'utf8');
    let current;
    try { current = await readFile(join(target, file), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === undefined) await writeFile(join(target, file), source, { mode: 0o600 });
  }
}

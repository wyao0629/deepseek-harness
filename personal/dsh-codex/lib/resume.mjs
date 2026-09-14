import { readFile } from 'node:fs/promises';
import { dshHome, codexHome } from './paths.mjs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { encodeRoute } from './route.mjs';
import { threadRoute } from './host.mjs';
const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id ?? '')) {
  console.error('Usage: node lib/resume.mjs <native Codex thread ID>'); process.exit(2);
}
const dir = join(dshHome(), 'dsh-codex');
const binding = JSON.parse(await readFile(join(dir, 'threads', id + '.json'), 'utf8'));
const token = (await readFile(join(dir, 'bridge-token'), 'utf8')).trim();
const route = threadRoute(encodeRoute(binding.selectedProvider, binding.selectedModel), binding.selectedModel, binding.bridgePort, token);
const flags = ['-c', 'model_provider="dsh_bridge"', '-m', binding.selectedModel];
// Codex's -c accepts TOML. Serialize nested provider config using dotted keys.
for (const [key,value] of Object.entries(route.config)) {
  if (key === 'model_providers.dsh_bridge') {
    for (const [k,v] of Object.entries(value)) {
      if (k === 'http_headers') flags.push('-c', `${key}.http_headers.Authorization=${JSON.stringify(v.Authorization)}`);
      else flags.push('-c', `${key}.${k}=${JSON.stringify(v)}`);
    }
  } else flags.push('-c', `${key}=${JSON.stringify(value)}`);
}
const execMode = process.argv[3] === '--exec';
const args = execMode
  ? ['exec', 'resume', id, ...flags, '--skip-git-repo-check', process.argv[4] ?? '-']
  : ['resume', id, ...flags];
const child=spawn(process.env.CODEX_BIN ?? 'codex',args,{stdio:'inherit',env:process.env});
child.on('exit',(code)=>process.exit(code ?? 1));

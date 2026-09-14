import { readFile } from 'node:fs/promises';
import { dshHome } from './paths.mjs';
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
const policy = binding.permissions;
if (!policy) throw new Error('Resume this session in DSH once to synchronize its permissions before CLI use.');
flags.push('-c', `sandbox_mode=${JSON.stringify(policy.mode)}`, '-c', `approval_policy=${JSON.stringify(policy.approvalPolicy)}`);
if (binding.reasoningEffort) flags.push('-c', `model_reasoning_effort=${JSON.stringify(binding.reasoningEffort)}`);
if (binding.contextWindow) flags.push('-c', `model_context_window=${binding.contextWindow}`);
if (policy.sandboxPolicy?.type === 'workspaceWrite') {
  flags.push('-c', `sandbox_workspace_write.network_access=${policy.sandboxPolicy.networkAccess === true}`);
  flags.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(policy.sandboxPolicy.writableRoots)}`);
}

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
  ? ['exec', 'resume', id, ...flags, '--skip-git-repo-check', process.argv[4] ?? '-', ...process.argv.slice(5)]
  : ['resume', id, ...flags, ...process.argv.slice(3)];
const child=spawn(process.env.CODEX_BIN ?? 'codex',args,{stdio:'inherit',env:process.env,cwd:binding.cwd});
child.on('exit',(code)=>process.exit(code ?? 1));

// Apply the fork's compiled compatibility changes to a matching installed DSH.
// Run with write access to the selected DSH build; restart DSH afterwards.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dshHome } from '../lib/paths.mjs';
const require = createRequire(process.env.DSH_PACKAGE_JSON ?? fileURLToPath(new URL('../../../apps/cli/package.json', import.meta.url)));
const file = require.resolve('@deepseek-ai/dsh-session');
const source=await readFile(file,'utf8');
const marker='...(surfaceOpts?.ignorable === true ? { ignorable: true } : {}),';
const anchor='const surfaceMetadata = {\n';
if(!source.includes(marker) && source.split(anchor).length!==2) throw Error('DSH append implementation changed; inspect it before patching');
const commandsFile = require.resolve('@deepseek-ai/dsh-commands');
const builtCommands = fileURLToPath(new URL('../../../packages/interaction/commands/lib/index.js', import.meta.url));
const commandsSource = await readFile(commandsFile, 'utf8');
const commandsReplacement = await readFile(builtCommands, 'utf8');
const version = async file => JSON.parse(await readFile(join(dirname(file), '..', 'package.json'), 'utf8')).version;
if (await version(commandsFile) !== await version(builtCommands)) throw Error('Installed DSH commands version differs from this checkout; use a matching build.');
if (!commandsReplacement.includes('useNativePalette(')) throw Error('Build this checkout before installing native Harness menus.');
const backupDir=process.env.DSH_BACKUP_DIR ?? join(dshHome(),'backups','dsh-codex');
async function replace(target, name, previous, next) {
  if (previous === next) return;
  await mkdir(backupDir,{recursive:true,mode:0o700});
  try { await writeFile(join(backupDir,name+'-'+createHash('sha256').update(previous).digest('hex').slice(0,12)+'.js.gz'),gzipSync(previous),{flag:'wx',mode:0o600}); }
  catch(e) { if(e.code!=='EEXIST') throw e; }
  await writeFile(target, next);
}
await replace(file, 'dsh-session', source, source.includes(marker) ? source : source.replace(anchor,anchor+'            '+marker+'\n'));
await replace(commandsFile, 'dsh-commands', commandsSource, commandsReplacement);
console.log('DSH event metadata and native Harness menus are installed; restart DSH if it is running.');

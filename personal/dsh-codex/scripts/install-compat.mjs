// Apply only the missing public append option on DSH builds with this exact old implementation.
// Run with write access to the selected DSH build; restart DSH afterwards.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dshHome } from '../lib/paths.mjs';
const require = createRequire(process.env.DSH_PACKAGE_JSON ?? fileURLToPath(new URL('../../../apps/cli/package.json', import.meta.url)));
const file = require.resolve('@deepseek-ai/dsh-session');
const source=await readFile(file,'utf8');
const marker='...(surfaceOpts?.ignorable === true ? { ignorable: true } : {}),';
if(source.includes(marker)) { console.log('DSH event compatibility already installed'); process.exit(0); }
const anchor='const surfaceMetadata = {\n';
if(source.split(anchor).length!==2) throw Error('DSH append implementation changed; inspect it before patching');
const backupDir=process.env.DSH_BACKUP_DIR ?? join(dshHome(),'backups','dsh-codex');
await mkdir(backupDir,{recursive:true,mode:0o700});
try { await writeFile(join(backupDir,'dsh-session-'+createHash('sha256').update(source).digest('hex').slice(0,12)+'.js.gz'),gzipSync(source),{flag:'wx',mode:0o600}); }
catch(e) { if(e.code!=='EEXIST') throw e; }
await writeFile(file,source.replace(anchor,anchor+'            '+marker+'\n'));
console.log('Installed DSH append ignorable metadata support; restart DSH');

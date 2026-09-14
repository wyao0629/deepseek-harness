import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Resolve the DSH data directory for this process. */
export const dshHome = () => resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
/** Resolve native Codex persistence independently of DSH. */
export const codexHome = () => resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'));

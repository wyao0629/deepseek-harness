import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('./lib/actions.mjs',import.meta.url),'utf8').replace(/export (async )?function /g, '$1function ');
writeFileSync(new URL('./lib/client.js',import.meta.url), "window.__ModuleLoader__.load({id:'dsh-session-actions',factory:()=>{\n"+source+"\nreturn {inject:['uiWorkspace','sessions','remote','remote.session'],apply:applyActions};\n}});\n");

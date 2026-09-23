import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
await build({entryPoints:['runtime/openwiki-source.ts'],outfile:'generated/openwiki.mjs',bundle:true,platform:'node',nodePaths:[path.resolve('node_modules')],format:'esm',target:'node24',external:['minisearch','yaml'],legalComments:'eof'});
await mkdir('extension/lib/node',{recursive:true});
for (const worker of ['schema-worker','database-worker','code-analysis-worker']) await build({entryPoints:[`runtime/${worker}.mjs`],outfile:`extension/lib/node/${worker}.mjs`,bundle:true,platform:'node',format:'esm',target:'node24',external:['knex','knex-schema-inspector','typescript','jsonc-parser'],banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
await build({entryPoints:['runtime/service-entry.mjs'],outfile:'extension/lib/node/service-entry.mjs',bundle:true,platform:'node',nodePaths:[path.resolve('node_modules')],format:'esm',target:'node24',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},external:['@vscode/ripgrep','knex','knex-schema-inspector','@earendil-works/pi-agent-core','@earendil-works/pi-ai','playwright','pixelmatch','pngjs','minisearch'],legalComments:'eof'});
await build({entryPoints:['ui/Workbench.jsx'],outfile:'extension/lib/browser/workbench.js',bundle:true,platform:'browser',nodePaths:[path.resolve('node_modules')],format:'cjs',target:'chrome110',external:['react','react-dom','react-dom/client','react/jsx-runtime'],alias:{'@e2e/cx-design-system':path.resolve('node_modules/@e2e/cx-design-system')},define:{__APP_VERSION__:'"0.1.0"'},legalComments:'eof'});
await mkdir('extension/lib/browser/style',{recursive:true});
await copyFile('extension/src/browser/style.css','extension/lib/browser/style/style.css');
await copyFile('../../extensions/aipro-chat/design/agent-deck.css','extension/lib/browser/style/agent-deck.css');
// Reuse the complete shared Nubi cascade, including mascot frames and motion.
const shared=await Promise.all(['app','surfaces','code','interaction-forms','approval','deck-surfaces'].map(name=>readFile('../../extensions/aipro-chat/src/'+name+'.css','utf8')));
await writeFile('extension/lib/browser/style/nubi-shared.css',shared.join('\n'));

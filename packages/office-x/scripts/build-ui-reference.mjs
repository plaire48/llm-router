// Development-only reference renderer; no Workspace code enters the installer.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const workspace=resolve(process.argv[2]||'../llm_router');
const files=[resolve('node_modules/@e2e/cx-design-system/dist/styles.css'),resolve('node_modules/@e2e/cx-design-system/fonts/font.css'),...['extensions/aipro-chat/design/agent-deck.css','extensions/aipro-chat/src/app.css','packages/nubi-desktop/design/workspace-identity.css','packages/nubi-desktop/electron-app/ios-tokens.css','packages/nubi-desktop/design/workspace-typography.css','packages/nubi-desktop/design/workspace-density.css','packages/nubi-desktop/design/workspace-dialogs.css'].map(p=>resolve(workspace,p))];
await mkdir('verification/cx-audit',{recursive:true});const entry='verification/current-workspace-reference.css';
try{
 await writeFile(entry,files.map(file=>`@import ${JSON.stringify(file)};`).join('\n'));
 await build({entryPoints:[entry],outfile:'dist/ui/cx-audit/reference.css',bundle:true,loader:{'.woff2':'file'},assetNames:'fonts/[name]-[hash]'});
 await writeFile('verification/cx-audit/current-reference-sources.json',JSON.stringify({scope:'Current local Workspace CSS source, not live Electron',files:await Promise.all(files.map(async file=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})))},null,2)+'\n');
}finally{await rm(entry,{force:true});}
console.log('Workspace CSS fixture built. Run tests/modal-identity.browser.js against the local UI server.');

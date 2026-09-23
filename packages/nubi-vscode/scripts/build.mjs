import {createRequire} from 'node:module';
import {mkdir,copyFile,cp,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const desktop=path.resolve('../nubi-desktop'),require=createRequire(path.join(desktop,'package.json')),{build}=require('esbuild');
const compiled=spawnSync(process.execPath,['scripts/build-runtime.mjs'],{cwd:desktop,stdio:'inherit'});if(compiled.status!==0)throw Error('desktop_compile_failed');
await mkdir('dist',{recursive:true});await mkdir('media',{recursive:true});
for(const file of ['service-entry.mjs','code-analysis-worker.mjs','schema-worker.mjs','database-worker.mjs','computer-pointer.ps1'])await copyFile(path.join(desktop,'extension/lib/node',file),path.join('dist',file));
await copyFile(path.join(desktop,'generated/runtime-provenance.json'),'dist/runtime-provenance.json');
await build({entryPoints:['src/webview.jsx'],outfile:'media/app.js',bundle:true,format:'iife',platform:'browser',nodePaths:[path.join(desktop,'node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.join(desktop,'node_modules',name)])),'@e2e/cx-design-system/styles.css':path.join(desktop,'node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},assetNames:'fonts/[name]-[hash]',define:{__APP_VERSION__:'"0.1.0"','process.env.NODE_ENV':'"production"'},legalComments:'eof',metafile:true}).then(async result=>{
  if(Object.keys(result.metafile.inputs).some(p=>/nubi-a2a|@theia\//.test(p)))throw Error('host_dependency_leak');
  await writeFile('dist/ui-provenance.json',JSON.stringify({host:'vscode',sharedWorkbench:'nubi-desktop/ui/Workbench.jsx',sources:Object.keys(result.metafile.inputs).filter(p=>!p.includes('node_modules'))},null,2));
});
await cp('../../extensions/aipro-chat/public/icons','media/icons',{recursive:true});
await mkdir('licenses',{recursive:true});
await copyFile('../openwiki/LICENSE','licenses/OpenWiki-SDS-LICENSE');
await copyFile('../nubi-desktop/THIRD-PARTY-NOTICES.md','licenses/Desktop-THIRD-PARTY-NOTICES.md');
console.log('VS Code host and shared Nubi UI/runtime built.');

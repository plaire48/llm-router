import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {mkdir,cp,copyFile,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {prepareAppIcon} from './prepare-app-icon.mjs';
// npm tar extraction may strip the macOS PTY helper executable bit.
if(process.platform==='darwin'){const require=createRequire(import.meta.url);const entry=require.resolve('node-pty');await chmod(path.resolve(path.dirname(entry),'../prebuilds',process.platform+'-'+process.arch,'spawn-helper'),0o755);}
const out='electron-app/lib';await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await copyFile(await prepareAppIcon(),out+'/nubi-icon.png');
await build({entryPoints:['electron-app/main.cjs'],outfile:out+'/main.cjs',platform:'node',bundle:true,format:'cjs',target:'node24',external:['electron'],legalComments:'eof'});
await copyFile('electron-app/terminal-worker.cjs',out+'/terminal-worker.cjs');
await cp('extension/lib/node',out+'/backend',{recursive:true,filter:file=>!file.endsWith('.js')&&!file.endsWith('.cjs')&&!file.endsWith('.map')&&!file.endsWith('.d.ts')});await copyFile('electron-app/preload.cjs',out+'/preload.cjs');await copyFile('extension/src/node/git-askpass.cjs',out+'/git-askpass.cjs');
await build({...rendererBundleOptions(),outdir:out+'/frontend',minify:true}).then(async result=>{if(Object.keys(result.metafile.inputs).some(p=>p.includes('node_modules/@theia/')))throw Error('theia_in_active_bundle');await writeFile('generated/electron-bundle.json',JSON.stringify(result.metafile,null,2));});
await build({entryPoints:['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],outfile:out+'/frontend/chunks/editor.worker.js',bundle:true,format:'esm',platform:'browser',target:'chrome146',minify:true});
let html=await readFile('electron-app/index.html','utf8');
for(const asset of ['renderer.js','renderer.css']){
  const hash=createHash('sha256').update(await readFile(out+'/frontend/'+asset)).digest('hex').slice(0,16);
  html=html.replace(`./${asset}`,`./${asset}?v=${hash}`);
}
await writeFile(out+'/frontend/index.html',html);

await cp('../../extensions/aipro-chat/public/icons',out+'/frontend/icons',{recursive:true});
await cp('vendor/licenses',out+'/licenses',{recursive:true});

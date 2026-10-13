import {dependencyNotices} from './dependency-notices.mjs';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
const runtime=await build({metafile:true,entryPoints:['runtime-src/main.ts'], outfile:'dist/worker/main.cjs', bundle:true,
  platform:'node', target:'node22', format:'cjs', legalComments:'linked', sourcemap:false,loader:{'.md':'text'},
  define:{'import.meta.url':'__officeModuleUrl'},banner:{js:'const __officeModuleUrl = require("node:url").pathToFileURL(__filename).href;'},
  plugins:[{name:'nubi-wire-only',setup(b){b.onResolve({filter:/agent-runtime\.js$/},()=>({path:resolve('runtime-src/nubi-wire.mjs')}));}}]});
await mkdir('dist/licenses', {recursive:true});
await copyFile('node_modules/@e2e/cx-design-system/fonts/OFL.txt','dist/licenses/Noto-Sans-KR-OFL.txt');
await copyFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm','dist/worker/pdfium.wasm');
await build({entryPoints:['tools-src/genoffice-engine.ts'],outfile:'dist/cli/genoffice-engine.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',jsx:'automatic',external:['jsdom','electron','mermaid'],define:{'import.meta.url':'__engineModuleUrl'},banner:{js:'const __engineModuleUrl=require("node:url").pathToFileURL(__filename).href;'},loader:{'.css':'empty','.woff2':'empty','.woff':'empty','.ttf':'empty','.png':'empty','.svg':'empty','.md':'text'},plugins:[{name:'original-raw',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.replace(/\?raw$/,'')),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await (await import('node:fs/promises')).readFile(a.path,'utf8'),loader:'text'}));}}]});
await mkdir('dist/wasm',{recursive:true});
await copyFile('dist/worker/pdfium.wasm','dist/wasm/pdfium.wasm');
await (await import('./collect-engine-deps.mjs')).collectEngineDeps();
for (const [source, name] of [['vendor/genoffice/LICENSE','GenOffice-LICENSE.txt'],
  ['vendor/genoffice/NOTICE','GenOffice-NOTICE.txt'],
  ['licenses/office-ai-agent-Apache-2.0.txt','office-ai-agent-LICENSE.txt'],
  ['licenses/Newtonsoft.Json-MIT.txt','Newtonsoft.Json-MIT.txt'],
  ['licenses/WebView2-LICENSE.txt','WebView2-LICENSE.txt'],
  ['licenses/WebView2-NOTICE.txt','WebView2-NOTICE.txt'],
  ['THIRD-PARTY-NOTICES.md','THIRD-PARTY-NOTICES.md']]) {
  await copyFile(source, `dist/licenses/${name}`);
}


await mkdir('dist/ui/icons',{recursive:true});
await build({entryPoints:['ui/App.jsx'],outfile:'dist/ui/app.js',bundle:true,platform:'browser',target:'chrome110',format:'iife',minify:true,legalComments:'linked',loader:{'.woff2':'file','.woff':'file','.ttf':'file'},assetNames:'fonts/[name]-[hash]'});
await copyFile('ui/index.html','dist/ui/index.html');
await cp('vendor/nubi/extensions/aipro-chat/public/icons','dist/ui/icons',{recursive:true});
await copyFile('vendor/nubi/extensions/aipro-chat/public/icons/agent-128.png','dist/worker/auth-bird.png');
await copyFile('vendor/nubi/packages/openwiki/src/auth/aipro-callback-fonts.css','dist/worker/auth-fonts.css');

const modules=Object.keys(runtime.metafile.outputs['dist/worker/main.cjs'].inputs);
if(modules.some(name=>/pi-agent-core|\/agent-runtime\.js$/.test(name)))throw Error('A second agent engine entered the worker');
await mkdir('verification',{recursive:true});
await writeFile('verification/runtime-modules.json',JSON.stringify({agentEngine:'GenOffice AgentLoop',nubiRole:'UI and authenticated provider transport only',modules},null,2)+'\n');
await dependencyNotices();

console.log('Built GenOffice worker and Nubi WebView UI. Windows VSTO execution is not verified.');

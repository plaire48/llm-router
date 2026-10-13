import {cp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),source=join(root,'vendor/genoffice'),work=join(root,'companion/workspace');
await mkdir(work,{recursive:true});
await cp(source,work,{recursive:true,filter:path=>!path.split(/[\\/]/).some(p=>['node_modules','.git','dist','out','target','release'].includes(p))});
const changes=[];
async function patch(path,transform){const file=join(work,path),before=await readFile(file,'utf8'),after=transform(before);if(after===before)throw Error('Companion adaptation did not apply: '+path);await writeFile(file,after);changes.push({path,sourceSha256:createHash('sha256').update(before).digest('hex'),adaptedSha256:createHash('sha256').update(after).digest('hex')});}
function once(text,needle,value){if(text.split(needle).length!==2)throw Error('Upstream integration marker drift: '+needle.slice(0,70));return text.replace(needle,value);}
await mkdir(join(work,'nubi-glue'),{recursive:true});
const adapter=(await readFile('companion/src/provider-adapter.ts','utf8')).replace("../packages/ai-provider/src/stream","./stream").replace("../packages/ai-provider/src/chat","./chat").replace("../packages/ai-provider/src/index","./index");
await writeFile(join(work,'packages/ai-provider/src/nubi-adapter.ts'),adapter);
await patch('packages/ai-provider/package.json',s=>{const p=JSON.parse(s);p.exports['.']='./src/nubi-adapter.ts';return JSON.stringify(p,null,2)+'\n';});
await patch('apps/docs/src/main/docs-main.ts',s=>once(s,'    return settings\n  })','    return (globalThis as any).__nubiOfficeBridge?.decorateSettings(settings) ?? settings\n  })'));
await patch('packages/ai-search/src/media-tools.ts',s=>once(s,'  return resolveAiSettings(stored, defaultAiSettings())','  const settings=resolveAiSettings(stored, defaultAiSettings())\n  return (globalThis as any).__nubiOfficeBridge?.serviceSettings(settings) ?? settings'));
await patch('apps/docs/src/main/docs-main.ts',s=>once(s,"listCustomModelsForIpc(input))","((input as any)?.baseUrl==='http://nubi.workspace.local/v1' ? (globalThis as any).__nubiOfficeBridge.catalog() : listCustomModelsForIpc(input)))"));
// Install before the original modules register their handlers. The original AgentLoop and tools remain the executor.
await patch('apps/shell/src/main/index.ts',s=>'import {installNubiBridge} from "../../../../nubi-glue/nubi-main.cjs"\nif(process.env.GENOFFICE_USER_DATA)app.setPath("userData",process.env.GENOFFICE_USER_DATA)\ninstallNubiBridge()\n'+s);
await patch('apps/shell/src/main/index.ts',s=>once(s,"ipcMain.handle('ai:open-model-settings', () => {","ipcMain.handle('ai:open-model-settings', () => {\n  if((globalThis as any).__nubiOfficeBridge?.openModelForm())return"));
await patch('packages/ui/src/AiModelPicker.tsx',s=>once(once(s,'  const toggle = () => {','  const toggle = () => {\n    if(settings?.customEndpoint === "nubi-workspace") {void bridge.openModelSettings?.(); return;}'),'aria-haspopup="listbox"','aria-haspopup={settings?.customEndpoint === "nubi-workspace" ? "dialog" : "listbox"}'));
await patch('apps/shell/src/preload/index.ts',s=>'import "../../../../nubi-glue/nubi-preload.cjs"\n'+s);
await copyFile('companion/src/nubi-preload.cjs',join(work,'nubi-glue/nubi-preload.cjs'));
await patch('apps/shell/src/renderer/src/TabBar.tsx',s=>once(s,'      <div className="tab-bar-drag-spacer" />','      <div className="tab-bar-drag-spacer" />\n      <button className="tab-app-menu-btn nubi-connection-button" title="누비 계정과 모델" aria-label="누비 계정과 모델" onClick={()=>void (window as any).nubiOffice.openConnection()}>누비</button>'));
await cp('node_modules/@e2e/cx-design-system/fonts',join(work,'packages/ui/src/nubi-fonts'),{recursive:true});
const tokens=await readFile('companion/src/nubi-tokens.css','utf8');
await patch('packages/ui/src/tokens.css',s=>'@import "./nubi-fonts/font.css";\n'+s+'\n'+tokens);
await patch('apps/shell/src/renderer/src/tabbar.css',s=>s+'\n.nubi-connection-button{width:auto;min-width:48px;padding:0 10px;color:#3182F6;font-weight:650;font-family:var(--gs-font-sans);-webkit-app-region:no-drag;}\n');
await patch('apps/shell/package.json',s=>{const p=JSON.parse(s);p.productName='Nubi GenOffice';return JSON.stringify(p,null,2)+'\n';});
await patch('apps/shell/electron-builder.cjs',s=>once(once(once(s,"appId: 'com.genoffice.app'","appId: 'com.nubi.genoffice'"),"productName: 'GenOffice'","productName: 'Nubi GenOffice',\n  extraMetadata: {version: process.env.GENOFFICE_APP_VERSION}"),"'x86_64-pc-windows-gnu'","'x86_64-pc-windows-msvc'"));
// Prevent duplicate Rust builds: the packaging pass builds the explicit MSVC target.
await patch('apps/sheets/package.json',s=>{const p=JSON.parse(s);p.scripts.build='electron-vite build';return JSON.stringify(p,null,2)+'\n';});
await writeFile('companion/adaptations.json',JSON.stringify({commit:JSON.parse(await readFile('vendor/genoffice-source.json','utf8')).commit,changes},null,2)+'\n');
console.log('Prepared all six original GenOffice editors with separate Nubi adapters.');

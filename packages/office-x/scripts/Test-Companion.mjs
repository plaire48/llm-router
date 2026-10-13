import {mkdtemp,writeFile,readFile,cp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const { _electron }=await import(pathToFileURL(resolve('companion/workspace/node_modules/playwright-core/index.mjs')).href);
const exe=process.argv[2];if(!exe)throw Error('Installed companion executable required');
const work=await mkdtemp(join(tmpdir(),'nubi-companion-smoke-')),userData=join(work,'profile'),docs=join(work,'documents');await mkdir(userData);await mkdir(docs);
await writeFile(join(userData,'nubi-preferences.json'),JSON.stringify({preferred:false}));
await writeFile(join(userData,'app-settings.json'),JSON.stringify({onboardingSeen:true,language:'ko',defaultSaveDir:docs}));
for(const ext of ['docx','xlsx','pptx'])await cp('vendor/genoffice/apps/shell/build/shell-new/blank.'+ext,join(docs,'실행 검사.'+ext));
await writeFile(join(docs,'실행 검사.md'),'# 누비 문서\n\n핵심 **내용**입니다.');await writeFile(join(docs,'실행 검사.html'),'<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><h1>누비 문서</h1><p>편집과 저장 검사</p></body></html>');
let application;const observations=[],failures=[];
try{
 application=await _electron.launch({executablePath:resolve(exe),env:{...process.env,GENOFFICE_USER_DATA:userData},timeout:90000});
 const shell=await application.firstWindow();await shell.waitForFunction(()=>!!window.aiOffice&&!!window.aiOfficeTabs&&!!window.nubiOffice,{},{timeout:60000});
 await application.evaluate(({webContents})=>{globalThis.__nubiSmokeFailures=[];for(const wc of webContents.getAllWebContents())wc.on('render-process-gone',(_e,d)=>globalThis.__nubiSmokeFailures.push(d.reason));});
 for(const [ext,kind] of [['docx','docs'],['xlsx','sheets'],['pptx','slides'],['md','markdown'],['html','html']]){
  await shell.evaluate(path=>window.aiOffice.openPath(path),join(docs,'실행 검사.'+ext));
  await shell.waitForFunction(kind=>window.aiOfficeTabs.list().then(t=>t.some(x=>x.kind===kind&&x.active)),kind,{timeout:90000});
  let row;
  for(let attempt=0;attempt<90;attempt++){
   row=await application.evaluate(async({webContents},kind)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('/modules/'+kind+'/renderer/'));if(!wc)return null;try{return await wc.executeJavaScript('({url:location.href,ready:document.readyState,text:document.body?.innerText?.slice(0,500),accent:getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),font:getComputedStyle(document.body).fontFamily})');}catch{return null;}},kind);
   if(row?.ready==='complete'&&row.text?.trim().length>5)break;await new Promise(r=>setTimeout(r,1000));
  }
  if(!row||row.ready!=='complete'||!row.text?.trim())throw Error('Editor renderer did not load: '+kind);if(row.accent.toUpperCase()!=='#3182F6')throw Error('Editor accent mismatch: '+kind+' '+row.accent);observations.push({kind,ready:row.ready,accent:row.accent,font:row.font});
 }
 await shell.evaluate(()=>window.aiOffice.newPdf());await shell.waitForFunction(()=>window.aiOfficeTabs.list().then(t=>t.some(x=>x.kind==='pdf'&&x.active)),{},{timeout:90000});
 const pdf=await application.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('/modules/pdf/renderer/'));return wc?await wc.executeJavaScript('({ready:document.readyState,text:document.body?.innerText?.slice(0,500)})'):null;});if(!pdf)throw Error('PDF renderer missing');observations.push({kind:'pdf',ready:pdf.ready});
 const opening=application.waitForEvent('window',{timeout:20000});await shell.evaluate(()=>window.nubiOffice.openConnection());const connection=await opening;await connection.waitForURL('**/connection.html',{timeout:20000});await connection.getByText('사용할 모델을 연결하세요',{exact:true}).waitFor({timeout:30000});for(const name of ['AI Pro','ChatGPT','FabriX','Claude'])await connection.getByRole('button',{name,exact:true}).waitFor();
 const account=await connection.evaluate(()=>window.nubiOffice.status());if(account.connected)throw Error('Unexpected real account in disposable smoke profile');
 const bridges={docs:'desktop',sheets:'desktopApi',slides:'slidesApi',pdf:'pdfApi',html:'htmlApi',markdown:'markdownApi'};
 await application.evaluate(async({webContents},bridges)=>{for(const [kind,name] of Object.entries(bridges)){const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('/modules/'+kind+'/renderer/'));if(!wc)throw Error('Missing editor bridge '+kind);await wc.executeJavaScript(`window[${JSON.stringify(name)}].onAiSettingsChanged(()=>window.__nubiSmokeSettingsChanged=true)`);}},bridges);
 await connection.evaluate(()=>window.nubiOffice.command('preferred',true));
 const shared=await application.evaluate(async({webContents},bridges)=>{const rows=[];for(const [kind,name] of Object.entries(bridges)){const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('/modules/'+kind+'/renderer/'));const settings=await wc.executeJavaScript(`window[${JSON.stringify(name)}].getAiSettings()`);const changed=await wc.executeJavaScript('window.__nubiSmokeSettingsChanged===true');if(settings.customEndpoint!=='nubi-workspace'||!changed)throw Error('Shared model settings not delivered: '+kind);rows.push(kind);}return rows;},bridges);
 await application.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('/modules/docs/renderer/'));await wc.executeJavaScript('window.desktop.openAiModelSettings()');});
 await connection.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor();await connection.getByRole('radio',{name:'Claude',exact:true}).waitFor();await connection.getByRole('button',{name:'취소',exact:true}).click();
 observations.push({kind:'nubi-connection',providers:4,accountConnected:false,sharedVault:true,sharedModelSettings:shared,workflowModelForm:true});failures.push(...await application.evaluate(()=>globalThis.__nubiSmokeFailures));if(failures.length)throw Error('Renderer crash: '+failures.join(','));
 await writeFile('verification/companion-runtime.json',JSON.stringify({passed:true,platform:process.platform,editors:observations,liveModelVerified:false,realOfficeVerified:false},null,2));
 console.log(JSON.stringify({passed:true,editors:observations.map(o=>o.kind),liveModelVerified:false}));
}finally{if(application)await application.close();await rm(work,{recursive:true,force:true});}

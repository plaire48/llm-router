import {_electron} from 'playwright';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-electron-')),root=path.join(dir,'quality-project');
await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'app.txt'),'release verification\n');await writeFile(path.join(root,'openwiki','overview.md'),'# Release verification\n\nOpenWiki-SDS source evidence.\n');
for(const args of [['init','-b','main'],['add','.'],['-c','user.name=Nubi QA','-c','user.email=qa@localhost','commit','-m','fixture']])execFileSync('git',args,{cwd:root,stdio:'pipe'});
const installed=process.env.NUBI_TEST_EXECUTABLE;
const app=await _electron.launch({...(installed?{executablePath:installed}:{}),args:[...(installed?[]:[path.resolve('electron-app')]),root,'--hostname=127.0.0.1','--port=0'],env:{...process.env,THEIA_CONFIG_DIR:path.join(dir,'ide'),NUBI_STORAGE_ROOT:path.join(dir,'state'),NUBI_DEBUG:'1'},timeout:90000});
const errors=[];app.process().stderr.on('data',d=>errors.push(String(d)));app.process().stdout.on('data',d=>errors.push(String(d)));
app.on('window',p=>p.on('console',msg=>errors.push(msg.type()+': '+msg.text())));
try{
 const page=await app.firstWindow({timeout:90000});await page.getByRole('button',{name:'Yes, I trust the authors',exact:true}).click({timeout:45000});await page.getByRole('button',{name:'프로젝트 자료',exact:true}).waitFor({timeout:45000}).catch(async error=>{await page.screenshot({path:'verification/electron-failure.png'});errors.push(await page.locator('body').innerText());throw error;});
 await page.getByRole('button',{name:'프로젝트 자료',exact:true}).click();
 await page.getByRole('button',{name:'작업 이력',exact:true}).waitFor();
 const facts=await app.evaluate(({app})=>({packaged:app.isPackaged,name:app.getName(),version:app.getVersion(),node:process.versions.node,electron:process.versions.electron,provenance:JSON.parse(process.getBuiltinModule('node:fs').readFileSync(process.getBuiltinModule('node:path').join(app.getAppPath(),'lib/runtime-provenance.json'),'utf8'))}));
 assert.equal(facts.provenance.openwiki.name,'openwiki-sds');
 assert.equal(facts.name,'누비 workspace');assert.equal(facts.version,JSON.parse(await readFile('package.json','utf8')).version);
 if(installed)assert.equal(facts.packaged,true);
 await mkdir('verification',{recursive:true});await page.screenshot({path:'verification/electron-release.png'});
 // Reach the actual compiled worker over IPC, including SQLite and OpenWiki-SDS.
 const receipt=await app.evaluate(async({app},root)=>{
   const {fork}=process.getBuiltinModule('node:child_process');const path=process.getBuiltinModule('node:path');
   const worker=fork(path.join(app.getAppPath(),'lib/backend/service-entry.mjs'),[],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NUBI_STORAGE_ROOT:path.join(root,'..','worker-state')}});
   let next=0;const pending=new Map();worker.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
   const invoke=(method,args)=>new Promise((resolve,reject)=>{const id=String(++next),timer=setTimeout(()=>reject(Error('worker_timeout_'+method)),30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});worker.send({id,method,args});});
   try{
     await invoke('open',{root});const read=await invoke('read',{path:'app.txt'});const wiki=await invoke('wikiQuery',{query:'Release verification'});
     const json=JSON.stringify({contract:'nubi-voc-v1',sourceUrl:'https://jira.example/browse/QA-1',key:'QA-1',title:'로그인 검증',updatedAt:'2026-09-23T00:00:00Z',body:'확인🐦'.repeat(8000)});
     const saved=await invoke('importVoc',{json}),duplicate=await invoke('importVoc',{json}),found=await invoke('queryVoc',{query:'로그인'});
     let cursor={id:saved.id},text='',pages=0;
     do{const part=await invoke('readVoc',cursor);text+=part.content;if(++pages>30)throw Error('voc_cursor_did_not_advance');if(part.content.length>16000||!part.content.isWellFormed())throw Error('voc_invalid_chunk');if(part.nextStart===null)break;if(part.nextOffset===0)text+='\n';cursor={id:saved.id,start:part.nextStart,offset:part.nextOffset};}while(true);
     const actual=process.getBuiltinModule('node:fs').readFileSync(path.join(root,saved.path),'utf8');
     return {content:read.content,wiki:wiki.results.length,voc:{imported:!!saved.id,duplicate:duplicate.noChange,found:found.results.some(v=>v.id===saved.id),exactRead:text===actual,pages}};
   }finally{worker.disconnect();}
 },root);
 assert.match(receipt.content,/release verification/);assert(receipt.wiki>0);
 // The OpenWiki update runner is a separate folder beside the worker, loaded only when an update runs (1.1.0).
 // A child of the app imports it, as the worker does when an update runs.
 const probe=path.join(dir,'update-runner-probe.mjs');
 await writeFile(probe,"import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';\nconst folder=process.argv[2],loaded=await import(pathToFileURL(path.join(folder,'index.mjs')).href);\nprocess.send({exports:['runNativeRepositoryGeneration','NubiOpenWikiModel','syncBundledSkills'].filter(name=>typeof loaded[name]==='function'),skills:fs.readdirSync(path.join(folder,'openwiki','skills')).sort()});\n");
 const updateRunner=await app.evaluate(async({app},probe)=>{
   const {fork}=process.getBuiltinModule('node:child_process'),path=process.getBuiltinModule('node:path');
   const child=fork(probe,[path.join(app.getAppPath(),'lib/backend/openwiki-update')],{stdio:['ignore','pipe','pipe','ipc']});
   let stderr='';child.stderr.on('data',d=>stderr+=d);
   try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('update_runner_timeout')),60000);child.on('message',value=>{clearTimeout(timer);resolve(value);});child.on('exit',code=>{clearTimeout(timer);reject(Error('update_runner_exit_'+code+': '+stderr.slice(-500)));});});}
   finally{child.kill();}
 },probe);
 assert.deepEqual(updateRunner.exports,['runNativeRepositoryGeneration','NubiOpenWikiModel','syncBundledSkills']);assert.ok(updateRunner.skills.length>0);
 assert.deepEqual({...receipt.voc,pages:undefined},{imported:true,duplicate:true,found:true,exactRead:true,pages:undefined});assert(receipt.voc.pages>1);
 // "프로젝트 열기" reaches the folder dialog of the platform. Theia disables workspace:open in Windows and Linux
 // Electron, so the button failed there up to 1.1.0. The native dialog is replaced in the main process and cancelled.
 await app.evaluate(({dialog})=>{globalThis.nubiDialogs=[];dialog.showOpenDialog=async(...args)=>{const options=args.find(value=>Array.isArray(value?.properties))||{};globalThis.nubiDialogs.push(options.properties||[]);return {canceled:true,filePaths:[]};};});
 // The project library opened above is a modal panel over the sidebar.
 await page.keyboard.press('Escape');await page.locator('.cx-panel-backdrop').waitFor({state:'detached',timeout:10000});
 await page.getByRole('button',{name:'프로젝트 열기',exact:true}).click();
 let dialogs=[];for(let wait=0;wait<50&&!dialogs.length;wait++){await page.waitForTimeout(100);dialogs=await app.evaluate(()=>globalThis.nubiDialogs);}
 const openError=await page.locator('.nubi-error').innerText().catch(()=>'');
 assert.equal(dialogs.length,1,'project folder dialog did not open: '+openError);assert.ok(dialogs[0].includes('openDirectory'));assert.ok(!dialogs[0].includes('openFile'));
 assert.equal(await page.locator('.nubi-error').count(),0,openError);
 const openProject={dialog:'folder',properties:dialogs[0]};
 const result={passed:true,platform:process.platform,...facts,receipt,updateRunner,openProject,scope:'Electron launch, UI, compiled worker IPC, SQLite, source read, OpenWiki-SDS retrieval, loading of the OpenWiki update runner and the project folder dialog. No live model or company app.'};
 await writeFile('verification/electron-release.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await app.close();await writeFile('verification/electron-release-stderr.log',errors.join(''));}

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
 const page=await app.firstWindow({timeout:90000});await page.getByRole('button',{name:'Yes, I trust the authors',exact:true}).click({timeout:45000});await page.getByRole('button',{name:'소스와 Wiki 살펴보기',exact:true}).waitFor({timeout:45000}).catch(async error=>{await page.screenshot({path:'verification/electron-failure.png'});errors.push(await page.locator('body').innerText());throw error;});
 await page.getByRole('button',{name:'소스와 Wiki 살펴보기',exact:true}).click();
 await page.getByRole('button',{name:'작업 이력',exact:true}).waitFor();
 const facts=await app.evaluate(({app})=>({packaged:app.isPackaged,node:process.versions.node,electron:process.versions.electron,provenance:JSON.parse(process.getBuiltinModule('node:fs').readFileSync(process.getBuiltinModule('node:path').join(app.getAppPath(),'lib/runtime-provenance.json'),'utf8'))}));
 assert.equal(facts.provenance.openwiki.name,'openwiki-sds');
 if(installed)assert.equal(facts.packaged,true);
 await mkdir('verification',{recursive:true});await page.screenshot({path:'verification/electron-release.png'});
 // Reach the actual compiled worker over IPC, including SQLite and OpenWiki-SDS.
 const receipt=await app.evaluate(async({app},root)=>{
   const {fork}=process.getBuiltinModule('node:child_process');const path=process.getBuiltinModule('node:path');
   const worker=fork(path.join(app.getAppPath(),'lib/backend/service-entry.mjs'),[],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NUBI_STORAGE_ROOT:path.join(root,'..','worker-state')}});
   let next=0;const pending=new Map();worker.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
   const invoke=(method,args)=>new Promise((resolve,reject)=>{const id=String(++next),timer=setTimeout(()=>reject(Error('worker_timeout_'+method)),30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});worker.send({id,method,args});});
   try{await invoke('open',{root});const read=await invoke('read',{path:'app.txt'});const wiki=await invoke('wikiQuery',{query:'Release verification'});return {content:read.content,wiki:wiki.results.length};}finally{worker.disconnect();}
 },root);
 assert.match(receipt.content,/release verification/);assert(receipt.wiki>0);
 const result={passed:true,platform:process.platform,...facts,receipt,scope:'Electron launch, UI, compiled worker IPC, SQLite, source read and OpenWiki-SDS retrieval. No live model or company app.'};
 await writeFile('verification/electron-release.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await app.close();await writeFile('verification/electron-release-stderr.log',errors.join(''));}

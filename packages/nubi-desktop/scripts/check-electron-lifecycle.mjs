// The lifecycle of the real Electron host (2026-10-05): the worker restarts after it is killed, a second start leaves the first window running,
// and the window comes back at its last bounds. Run from the package dir after scripts/build-electron.mjs:
// node scripts/check-electron-lifecycle.mjs. The single-instance lock is per userData: close the running Workspace first.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-lifecycle-check-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state');
await mkdir(root);await mkdir(storage);
const git=args=>execFileSync('git',['-C',root,...args]);git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
await writeFile(path.join(root,'example.js'),'export const value = 1;\n');git(['add','.']);git(['commit','-m','Initial fixture']);
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const env={...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined};
const launch=()=>electron.launch({executablePath:require('electron'),args:['electron-app'],env});
const result={};
// Startup connection guidance is shown for disconnected mail on every launch.
async function dismissStartup(page){await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');}
{
  const first=await launch();
  try{const page=await first.firstWindow();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});await new Promise(resolve=>setTimeout(resolve,1500));
    result.promptOnFreshStore=await page.getByText('메일을 연결해 주세요').count();assert.equal(result.promptOnFreshStore,1,'disconnected mail has startup guidance');await page.keyboard.press('Escape');}
  finally{await first.close();}
  const {DatabaseSync}=await import('node:sqlite');await mkdir(path.join(storage,'personal-mail'),{recursive:true});
  const db=new DatabaseSync(path.join(storage,'personal-mail','workspace.db'));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records VALUES ('setting:auto-wiki','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value;");db.close();
  const second=await launch();
  try{const page=await second.firstWindow();await page.getByText('메일을 연결해 주세요').waitFor({timeout:30000});result.promptWithSummariesOn=true;await page.keyboard.press('Escape');}
  finally{await second.close();}
}
const app=await launch();
try{
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
  await dismissStartup(page);
  // The renderer opens the last project itself; openCurrent returns that project once it is open.
  await page.waitForFunction(()=>document.querySelector('button[aria-label="파일"]')?.disabled===false,null,{timeout:60000});
  const overview=await page.evaluate(()=>window.nubi.request('overview',{}));assert.equal(overview?.root,root,JSON.stringify(overview));
  // 1. The worker is killed: a child of the Electron process this check started.
  const mainPid=app.process().pid;
  const children=execFileSync('pgrep',['-P',String(mainPid)]).toString().trim().split('\n').filter(Boolean);
  const worker=children.find(pid=>{try{return execFileSync('ps',['-o','command=','-p',pid]).toString().includes('service-entry.mjs');}catch{return false;}});
  assert.ok(worker,'the worker is a child of the main process');
  await page.evaluate(()=>{window.__hostEvents=[];window.nubi.onHostEvent(event=>window.__hostEvents.push(event));});
  process.kill(Number(worker),'SIGKILL');
  await page.waitForFunction(()=>window.__hostEvents.some(event=>event.type==='worker_restarted'),null,{timeout:20000});
  // The renderer tells the user (renderer.jsx onHostEvent → toast).
  await page.getByText('누비 실행기를 다시 시작했어요').waitFor({timeout:5000});result.restartToast=true;
  const after=await page.evaluate(()=>window.nubi.request('overview',{}));assert.equal(after.root,root,'the project is open in the new worker');
  result.hostEvents=await page.evaluate(()=>window.__hostEvents.map(event=>event.type));
  const fault=JSON.parse(await readFile(path.join(storage,'last-host-fault.json'),'utf8'));assert.equal(fault.component,'worker');assert.equal(fault.reason,'killed');result.fault=fault;
  const children2=execFileSync('pgrep',['-P',String(mainPid)]).toString().trim().split('\n').filter(Boolean);
  result.workerPids=[worker,children2.find(pid=>{try{return execFileSync('ps',['-o','command=','-p',pid]).toString().includes('service-entry.mjs');}catch{return false;}})];
  assert.notEqual(result.workerPids[0],result.workerPids[1]);
  // 2. A second start leaves at once; the first still answers.
  const second=spawn(require('electron'),['electron-app'],{env,stdio:'ignore'});
  result.secondInstanceExit=await new Promise(resolve=>{const timer=setTimeout(()=>{second.kill();resolve('timeout');},20000);second.on('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(result.secondInstanceExit,0);
  assert.equal((await page.evaluate(()=>window.nubi.request('overview',{}))).root,root,'the first instance still answers');
  // 3. The window is moved and resized, closed, and comes back there.
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setBounds({x:60,y:80,width:1000,height:700});});
  await new Promise(resolve=>setTimeout(resolve,900));
}finally{await app.close();}
result.saved=JSON.parse(await readFile(path.join(storage,'window-state.json'),'utf8'));assert.equal(result.saved.width,1000);assert.equal(result.saved.height,700);
const again=await launch();
try{
  const page=await again.firstWindow();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
  result.bounds=await again.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  assert.equal(result.bounds.width,1000);assert.equal(result.bounds.height,700);assert.equal(result.bounds.x,60);
  result.workerLog=(await readFile(path.join(storage,'worker.log'),'utf8').catch(()=>'')).length;
}finally{await again.close();}
// 6. A last project whose folder is gone: the start screen opens and the stale pointer is cleared (2026-10-07).
{
  await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:path.join(temporary,'gone-project')}));
  const app=await launch();
  try{const page=await app.firstWindow();await dismissStartup(page);await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor();await page.screenshot({path:'verification/lifecycle-missing-project.png'});await writeFile('verification/lifecycle-missing-project.txt',await page.locator('body').innerText());assert.equal(await page.getByRole('button',{name:'파일',exact:true}).isDisabled(),true,'missing project leaves file tools disabled');/* without a model the start screen is the provider chooser */result.missingProjectStartScreen=true;
    await new Promise(resolve=>setTimeout(resolve,500));result.stalePointerCleared=await readFile(path.join(storage,'last-project.json'),'utf8').then(()=>false,()=>true);assert.equal(result.stalePointerCleared,true,'the stale pointer is removed');}
  finally{await app.close();}
}
// 7. A busy local web port: the window still loads and the fault is recorded (2026-10-07; the app hung before).
{
  const {createServer}=await import('node:net');const blocker=createServer();await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));const port=blocker.address().port;
  await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));await rm(path.join(storage,'last-host-fault.json'),{force:true});
  const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...env,NUBI_WEB_PORT:String(port)}});
  try{const page=await app.firstWindow();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
    const fault=JSON.parse(await readFile(path.join(storage,'last-host-fault.json'),'utf8'));assert.equal(fault.component,'web-host');assert.equal(fault.reason,'launch-failed');result.busyWebPort={windowLoaded:true,fault:fault.reason};}
  finally{await app.close();await new Promise(resolve=>blocker.close(resolve));}
}
await rm(temporary,{recursive:true,force:true});
console.log(JSON.stringify(result));

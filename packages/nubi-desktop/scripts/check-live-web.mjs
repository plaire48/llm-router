// The local web Workspace (docs/LIVE-WORKSPACE-2026-10-01.md): the real Electron host serves its own frontend over a
// loopback port with a capability-bound bridge, and a browser drives the same project. Revived on 2026-10-07 with the
// selectors of the Electron shell check: file editor and save, Git patch and commit history, source search, terminal,
// provider status, A2A disabled, the browser pane kept in the app, and the saved file after a reload.
// Run from the package dir after scripts/build-electron.mjs: node scripts/check-live-web.mjs (port 4322).
import {_electron as electron,chromium} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),PORT=4322,temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-live-web-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state');
await mkdir(root);await mkdir(storage);
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
await writeFile(path.join(root,'example.js'),'export const value = 1;\n');git(['add','.']);git(['commit','-m','Initial fixture']);
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_WEB_PORT:String(PORT),NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
const stage=name=>{console.log('stage',checks.length,name);checks.push(name);};
const request=(method,args={})=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
const openFile=async()=>{await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('tree',{name:'폴더의 파일 목록'}).getByRole('treeitem',{name:'example.js',exact:true}).dblclick();await page.getByRole('tab',{name:/example\.js/}).waitFor();await page.locator('.monaco-editor').first().waitFor();};
const tool=async name=>{const add=page.getByRole('button',{name:'새 탭',exact:true});if(!await add.isVisible().catch(()=>false))await page.getByRole('button',{name:'파일',exact:true}).click();/* one press reaches the tree from the search pane too (2026-10-07) */await add.waitFor({timeout:5000});await add.click();await page.getByRole('menuitem',{name,exact:true}).click();};
try{
  await app.firstWindow();
  await page.goto(`http://127.0.0.1:${PORT}/`);await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
  const startup=page.getByText('메일을 연결해 주세요');if(await startup.count()){await page.keyboard.press('Escape');await startup.waitFor({state:'hidden',timeout:5000});}
  assert.deepEqual(await page.evaluate(()=>Object.keys(window.nubi)),['request'],'the browser bridge carries only request');
  stage('the real Electron host serves the Workspace to a browser');
  await openFile();await page.locator('.desktop-editor .inputarea').first().focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('export const value = 2;\n');await page.getByRole('button',{name:'파일 저장',exact:true}).click();await page.locator('.desktop-dirty').waitFor({state:'detached'});
  assert.equal((await request('read',{path:'example.js',full:true})).content,'export const value = 2;\n');stage('file editor and save through the bridge');
  await page.getByRole('button',{name:'Git 변경',exact:true}).click();await page.locator('.desktop-list').getByRole('button',{name:'example.js'}).click();await page.waitForFunction(()=>/value\s*=\s*2/.test(document.querySelector('.desktop-list .desktop-change-diff .desktop-git-diff')?.textContent||''));stage('Git patch');
  await page.getByRole('button',{name:'커밋 이력 보기'}).click();await page.getByRole('button',{name:/Initial fixture/}).click();await page.waitForFunction(()=>document.querySelector('.desktop-git-history')?.textContent.includes('Initial fixture'));await page.getByRole('region',{name:'커밋 변경 파일',exact:true}).getByRole('button',{name:/example.js/}).click();await page.locator('.desktop-git-file').getByText('example.js',{exact:true}).waitFor();stage('commit history');
  await page.keyboard.press('ControlOrMeta+Shift+P');await page.locator('.desktop-list').getByRole('button',{name:'검색',exact:true}).click();await page.getByRole('textbox',{name:'내용 검색'}).fill('value');await page.getByRole('button',{name:'검색',exact:true}).click();await page.locator('.desktop-list').getByRole('button',{name:/example\.js:1/}).waitFor();stage('source search');
  await tool('터미널');await page.locator('.nubi-feedback-toast').filter({hasText:'대화형 터미널은 누비 앱에서 열어 주세요.'}).waitFor();assert.equal(await page.locator('.desktop-terminal').count(),0);stage('web preview explains the app-only interactive terminal without mounting a broken pane');
  const provider=await request('provider',{action:'status'});assert.equal(provider.connected,false);assert.equal(provider.models.length,0);stage('a disconnected provider fakes no model');
  assert.equal((await request('collaboration',{})).__nubiError,'method_invalid');assert.equal((await request('browser',{})).__nubiError,'browser_desktop_only');stage('A2A disabled and the browser pane stays in the app');
  await page.reload();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});await openFile();await page.waitForFunction(()=>/value\s*=\s*2/.test(document.querySelector('.desktop-editor')?.textContent||''));/* Monaco draws spaces as no-break spaces */assert.equal((await request('read',{path:'example.js',full:true})).content,'export const value = 2;\n');stage('a reload keeps the project and the saved file');
  await mkdir('verification/live-web',{recursive:true});await page.screenshot({path:'verification/live-web/file.png'});assert.deepEqual(errors,[]);
  await writeFile('verification/live-web/result.json',JSON.stringify({platform:process.platform,checks,errors,boundary:'Actual Electron worker serving a headless Chrome over loopback with a temporary Git project. No provider login.'},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await mkdir('verification/live-web',{recursive:true});await page.screenshot({path:'verification/live-web/failure.png'}).catch(()=>{});console.log('page errors:',JSON.stringify(errors));console.log('failure:',error.message.split('\n').slice(0,6).join(' | '));throw error;}
finally{const bounded=(promise,ms)=>Promise.race([promise.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,ms).unref())]);await bounded(browser.close(),10000);await bounded(app.close(),15000);try{app.process().kill('SIGKILL');}catch{}await rm(temporary,{recursive:true,force:true});}

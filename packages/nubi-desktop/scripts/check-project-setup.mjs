// A folder outside a Git repository in the actual Theia app (user decision 2026-09-30): the setup card shows
// the exact commands, one approval creates the repository and the folder opens. Run after `npm run build`.
import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-setup-ui-'))),root=path.join(temp,'plain-folder');
await mkdir(root);await writeFile(path.join(root,'README.md'),'# Plain folder\n');
const env={...process.env,THEIA_CONFIG_DIR:path.join(temp,'theia'),NUBI_STORAGE_ROOT:path.join(temp,'state'),GIT_CONFIG_GLOBAL:path.join(temp,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1'};
await writeFile(env.GIT_CONFIG_GLOBAL,'');
const backend=spawn(process.execPath,['browser-app/lib/backend/main.js',root,'--hostname=127.0.0.1','--port=4333'],{env,stdio:['ignore','pipe','pipe']});
let logs='';backend.stdout.on('data',d=>logs+=d);backend.stderr.on('data',d=>logs+=d);
let browser;const checks=[],errors=[];
try{
  for(let attempt=0;attempt<100;attempt++){try{if((await fetch('http://127.0.0.1:4333')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
  const p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4333');await p.getByRole('button',{name:'Yes, I trust the authors'}).click();
  const card=p.getByRole('region',{name:'프로젝트 준비'});await card.waitFor({timeout:45000});await p.locator('.theia-preload').waitFor({state:'hidden'});
  await card.getByText('Git 저장소가 아닌 폴더예요',{exact:true}).waitFor();await card.getByText(root,{exact:true}).waitFor();
  assert.match(await card.locator('pre').innerText(),/^git init\n.*commit --allow-empty/s);
  assert.equal(await p.locator('.nubi-error').count(),0,'a setup is offered, not an error');
  checks.push('a folder outside a repository shows the exact setup commands instead of an error');
  assert.equal(await card.evaluate(e=>e.scrollWidth<=e.clientWidth),true);await p.screenshot({path:'verification/ui-project-setup.png'});
  await card.getByRole('button',{name:'승인하고 저장소 만들기',exact:true}).click();
  await card.waitFor({state:'detached',timeout:30000});await p.locator('.nubi-project-label').filter({hasText:'plain-folder'}).waitFor();
  assert.match(execFileSync('git',['-C',root,'log','-1','--format=%an|%s'],{env}).toString(),/^누비 workspace\|누비 workspace 시작/);
  assert.equal(execFileSync('git',['-C',root,'status','--porcelain'],{env}).toString().trim(),'?? README.md','no file was committed');
  checks.push('one approval creates the repository with an empty first commit and opens the folder');
  assert.deepEqual(errors,[]);checks.push('no uncaught browser errors');
  console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){console.error(logs.slice(-4000));throw error;}
finally{await browser?.close();backend.kill();await rm(temp,{recursive:true,force:true}).catch(()=>{});}

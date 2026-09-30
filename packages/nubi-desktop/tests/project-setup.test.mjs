// User decision of 2026-09-30: when a folder cannot open because Git is missing or the folder is not a
// repository, the host prepares the fix, shows the exact command and runs it after one approval. When it
// fails, the model proposes another command for approval. The project then opens and prepares its environment.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {git} from '../runtime/files.mjs';
import {gitInstallPlan,gitCandidates,findGit,runSetupCommand,initializeRepository,suggestionPlan,SETUP_IDENTITY} from '../runtime/project-setup.mjs';

async function place(t){
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-setup-')));
  // The user's global Git settings must not decide the identity of a test commit.
  const saved={GIT_CONFIG_GLOBAL:process.env.GIT_CONFIG_GLOBAL,GIT_CONFIG_NOSYSTEM:process.env.GIT_CONFIG_NOSYSTEM};
  await writeFile(path.join(directory,'gitconfig'),'');process.env.GIT_CONFIG_GLOBAL=path.join(directory,'gitconfig');process.env.GIT_CONFIG_NOSYSTEM='1';
  const service=new ProjectService({storageRoot:path.join(directory,'state')});
  t.after(async()=>{try{service.dispose();}catch{/* Never opened. */}service.store?.close();for(const [key,value] of Object.entries(saved))value===undefined?delete process.env[key]:process.env[key]=value;await rm(directory,{recursive:true,force:true});});
  const folder=path.join(directory,'plain');await mkdir(folder);await writeFile(path.join(folder,'README.md'),'# Plain\n');
  return {directory,service,folder};
}

test('Windows installs Git for the current user, without administrator rights',()=>{
  const plan=gitInstallPlan('win32');
  assert.equal(plan.profile,'powershell');assert.match(plan.command,/^winget install --id Git\.Git -e --source winget --scope user /);
  assert.match(plan.effects,/관리자 권한은 쓰지 않습니다/);
  assert.equal(gitInstallPlan('darwin').command,'xcode-select --install');
  assert.equal(gitInstallPlan('linux').command,null,'no prepared command: the user installs it');
  assert.ok(gitCandidates({LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local',ProgramFiles:'C:\\Program Files'},'win32').includes('C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd\\git.exe'));
});

test('a Git installed while the app runs is found and added to its PATH',async()=>{
  const env={PATH:'C:\\Windows',LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'},installed='C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd\\git.exe';
  const run=async file=>{if(file===installed)return {stdout:'git version 2.53.0.windows.1\n'};throw Object.assign(new Error('missing'),{code:'ENOENT'});};
  const found=await findGit({env,platform:'win32',run,exists:async file=>file===installed});
  assert.deepEqual(found,{available:true,version:'git version 2.53.0.windows.1',added:'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd'});
  assert.equal(env.PATH,'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd;C:\\Windows');
  assert.deepEqual(await findGit({env:{PATH:''},platform:'win32',run,exists:async()=>false}),{available:false,version:null,added:null});
});

test('a setup command reports its exit and output, never throwing on failure',async()=>{
  const plan={kind:'install_git',profile:'powershell',command:'winget install --id Git.Git'};
  const calls=[];const ok=await runSetupCommand(plan,{run:async(file,args)=>{calls.push([file,args]);return {stdout:'installed',stderr:''};}});
  assert.deepEqual(ok,{exitCode:0,output:'installed'});assert.deepEqual(calls[0],['powershell.exe',['-NoProfile','-NonInteractive','-Command','winget install --id Git.Git']]);
  const failed=await runSetupCommand(plan,{run:async()=>{throw Object.assign(new Error('exit 1'),{code:1,stdout:'',stderr:'No package found'});}});
  assert.deepEqual(failed,{exitCode:1,error:'setup_failed',output:'No package found'});
  const missing=await runSetupCommand(plan,{run:async()=>{throw Object.assign(new Error('spawn'),{code:'ENOENT'});}});
  assert.equal(missing.error,'shell_unavailable');
  await assert.rejects(runSetupCommand({kind:'init_repository',profile:'git',command:'git init'}),/setup_plan_invalid/);
});

test('a new repository gets an empty first commit, written by the user when Git knows them',async t=>{
  const {folder}=await place(t);
  assert.deepEqual(await initializeRepository(folder),{identity:false});
  assert.equal((await git(folder,['log','-1','--format=%an <%ae>|%s'])).trim(),`${SETUP_IDENTITY.name} <${SETUP_IDENTITY.email}>|누비 workspace 시작`);
  assert.equal((await git(folder,['status','--porcelain'])).trim(),'?? README.md','no file is committed');
  const other=path.join(path.dirname(folder),'known');await mkdir(other);await git(other,['init','-q']);
  await git(other,['config','user.name','Kim']);await git(other,['config','user.email','kim@example.invalid']);
  assert.deepEqual(await initializeRepository(other),{identity:true});
  assert.equal((await git(other,['log','-1','--format=%an'])).trim(),'Kim');
});

test('a folder outside a repository opens after the approved repository setup',async t=>{
  const {service,folder}=await place(t);
  await assert.rejects(service.open(folder),{message:'not_git_repository'});
  const setup=await service.invoke('setupStatus');
  assert.equal(setup.root,folder);assert.equal(setup.reason,'not_git_repository');assert.equal(setup.plan.kind,'init_repository');
  assert.match(setup.plan.command,/^git init\n/);assert.match(setup.plan.effects,/"누비 workspace"/,'the stand-in author is disclosed');
  await assert.rejects(service.invoke('setupRun',{id:'someone-else'}),{message:'setup_plan_changed'});
  const done=await service.invoke('setupRun',{id:setup.plan.id});
  assert.equal(done.environment,true);assert.equal(done.opened.name,'plain');
  assert.equal(await service.invoke('setupStatus'),null,'nothing waits after the project opened');
});

test('a failed install is recorded, the model proposes another command, and Git found afterwards opens the folder',async t=>{
  const {service,folder}=await place(t);await git(folder,['init','-q']);
  await git(folder,['-c','user.name=T','-c','user.email=t@example.invalid','commit','--allow-empty','-q','-m','start']);
  // Git missing: the check sees no Git until the second command ran.
  let installed=false;const ran=[];
  service.setupTools={run:async plan=>{ran.push(plan.command);if(ran.length===2)installed=true;return ran.length===1?{exitCode:1,error:'setup_failed',output:'winget: No package found matching input criteria.'}:{exitCode:0,output:'done'};},findGit:async()=>({available:installed,version:installed?'git version 2.53.0':null})};
  const saved=process.env.PATH;process.env.PATH=path.join(folder,'no-bin');
  let setup;
  try{await assert.rejects(service.open(folder),{message:'git_unavailable'});setup=await service.invoke('setupStatus');}
  finally{process.env.PATH=saved;}
  assert.equal(setup.plan.kind,'install_git');assert.equal(setup.plan.source,'prepared');
  await assert.rejects(service.invoke('setupSuggest'),{message:'setup_plan_changed'},'the model is asked only after a failure');
  const first=await service.invoke('setupRun',{id:setup.plan.id});
  assert.equal(first.setup.attempts.length,1);assert.match(first.setup.attempts[0].output,/No package found/);
  const asked=[];
  service.providers={status:()=>({connected:true}),dispose(){},async complete(messages){asked.push(messages);return {content:JSON.stringify({explanation:'winget 원본에 패키지가 없습니다. 공식 설치 파일을 받아 현재 사용자에게 설치합니다.',command:'Invoke-WebRequest https://github.com/git-for-windows/git/releases/latest -OutFile git.exe',needsAdmin:false}),calls:[]};}};
  const suggested=await service.invoke('setupSuggest');
  assert.equal(suggested.plan.source,'model');assert.match(suggested.plan.command,/git-for-windows/);assert.notEqual(suggested.plan.id,setup.plan.id);
  assert.match(JSON.parse(asked[0][1].content).tried[0].output,/No package found/,'the model reads the failure');
  await assert.rejects(service.invoke('setupRun',{id:setup.plan.id}),{message:'setup_plan_changed'},'the first approval does not run the new command');
  const opened=await service.invoke('setupRun',{id:suggested.plan.id});
  assert.equal(opened.environment,true);assert.equal(opened.git,'git version 2.53.0');assert.equal(opened.opened.name,'plain');
  assert.deepEqual(ran,[setup.plan.command,suggested.plan.command]);
});

test('a model suggestion is JSON with an explanation; an empty command means the user installs it',()=>{
  const plan=suggestionPlan('```json\n{"explanation":"설명","command":"winget install Git.Git","needsAdmin":true}\n```','win32');
  assert.deepEqual({...plan},{kind:'install_git',profile:'powershell',source:'model',command:'winget install Git.Git',effects:'설명',needsAdmin:true});
  assert.equal(suggestionPlan('{"explanation":"안전한 방법이 없습니다.","command":""}','win32').command,null);
  assert.throws(()=>suggestionPlan('not json'),/setup_suggestion_invalid/);
  assert.throws(()=>suggestionPlan('{"explanation":"","command":"x"}'),/setup_suggestion_invalid/);
});

test('after the user installed Git themselves the folder opens again on request',async t=>{
  const {service,folder}=await place(t);
  await assert.rejects(service.invoke('setupRetry'),{message:'setup_plan_changed'},'nothing to retry');
  await assert.rejects(service.open(folder),{message:'not_git_repository'});
  await git(folder,['init','-q']);await git(folder,['-c','user.name=T','-c','user.email=t@example.invalid','commit','--allow-empty','-q','-m','start']);
  let looked=0;service.setupTools={...service.setupTools,findGit:async()=>{looked++;return {available:true,version:'git version 2.53.0'};}};
  const opened=await service.invoke('setupRetry');
  assert.equal(looked,1,'a new Git is looked for first');assert.equal(opened.opened.name,'plain');assert.equal(opened.environment,true);
});

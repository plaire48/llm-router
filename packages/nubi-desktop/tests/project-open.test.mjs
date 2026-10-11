import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {gitOpenFailure} from '../runtime/files.mjs';
import {remoteAddress} from '../ui/remote-address.mjs';

// "프로젝트 열기" said only "처리하지 못했어요. 입력과 연결 상태를 확인해 주세요." (user report 2026-09-30).
// Each reason a folder cannot be opened now has its own code and message.
test('a folder that cannot be opened as a project names the reason',async t=>{
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-open-')));
  const service=new ProjectService({storageRoot:path.join(directory,'state')});
  t.after(async()=>{try{service.dispose();}catch{/* Never opened. */}service.store?.close();await rm(directory,{recursive:true,force:true});});
  const plain=path.join(directory,'plain');await mkdir(plain);
  // A folder outside a repository opens as it is (user decision 2026-10-01): Git is optional, and so is a Git install.
  assert.equal((await service.open(plain)).branch,'Git 없음');
  await assert.rejects(service.open(path.join(directory,'missing')),{message:'project_path_missing'});
  const saved=process.env.PATH;process.env.PATH=path.join(directory,'no-bin');
  try{assert.equal((await service.open(plain)).branch,'Git 없음','without Git the folder still opens');}finally{process.env.PATH=saved;}
});

test('git failures map to what the user can do',()=>{
  assert.equal(gitOpenFailure({code:'ENOENT'}),'git_unavailable');
  assert.equal(gitOpenFailure({code:128,stderr:"fatal: detected dubious ownership in repository at 'C:/work/app'"}),'git_unsafe_directory');
  assert.equal(gitOpenFailure({code:128,stderr:'fatal: not a git repository (or any of the parent directories): .git'}),'not_git_repository');
  assert.equal(gitOpenFailure({killed:true,signal:'SIGTERM'}),'git_timeout');
});

test('프로젝트 열기 uses the folder dialog of the Electron host, and every open failure has a message',async()=>{
  // The Electron main process owns the OS folder dialog (electron-app/main.cjs); the renderer only asks for chooseFolder.
  const main=await readFile(new URL('../electron-app/main.cjs',import.meta.url),'utf8');
  assert.match(main,/method==='chooseFolder'/);assert.match(main,/choose\(\['openDirectory'\],'프로젝트 폴더 열기'\)/);
  const workbench=await readFile(new URL('../ui/Workbench.jsx',import.meta.url),'utf8');
  for(const code of ['project_picker_unavailable','project_path_missing','project_path_denied','not_git_repository','git_unavailable','git_unsafe_directory','git_timeout','workspace_untrusted'])
    assert.match(workbench,new RegExp('\\b'+code+":'"),code);
  assert.doesNotMatch(workbench,/입력과 연결 상태를 확인해 주세요/);
});

// The start card (user decision 2026-09-30) explains a malformed Git address before anything is cloned.
test('the start card takes the Git addresses VS Code clones and no address with a password',()=>{
  for(const ok of ['https://github.com/owner/repo.git','http://git.example.internal/team/app.git','ssh://git@example.com/owner/repo.git','git@github.com:owner/repo.git','git://example.com/repo.git'])assert.equal(remoteAddress(ok),true,ok);
  for(const bad of ['','github.com/owner/repo','https://user:secret@example.com/repo.git','ftp://example.com/repo','file:///C:/repo','https://example.com/a repo.git'])assert.equal(remoteAddress(bad),false,bad);
});

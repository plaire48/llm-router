import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {gitOpenFailure} from '../runtime/files.mjs';

// "프로젝트 열기" said only "처리하지 못했어요. 입력과 연결 상태를 확인해 주세요." (user report 2026-09-30).
// Each reason a folder cannot be opened now has its own code and message.
test('a folder that cannot be opened as a project names the reason',async t=>{
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-open-')));
  const service=new ProjectService({storageRoot:path.join(directory,'state')});
  t.after(async()=>{try{service.dispose();}catch{/* Never opened. */}service.store?.close();await rm(directory,{recursive:true,force:true});});
  const plain=path.join(directory,'plain');await mkdir(plain);
  await assert.rejects(service.open(plain),{message:'not_git_repository'});
  await assert.rejects(service.open(path.join(directory,'missing')),{message:'project_path_missing'});
  const saved=process.env.PATH;process.env.PATH=path.join(directory,'no-bin');
  try{await assert.rejects(service.open(plain),{message:'git_unavailable'});}finally{process.env.PATH=saved;}
});

test('git failures map to what the user can do',()=>{
  assert.equal(gitOpenFailure({code:'ENOENT'}),'git_unavailable');
  assert.equal(gitOpenFailure({code:128,stderr:"fatal: detected dubious ownership in repository at 'C:/work/app'"}),'git_unsafe_directory');
  assert.equal(gitOpenFailure({code:128,stderr:'fatal: not a git repository (or any of the parent directories): .git'}),'not_git_repository');
  assert.equal(gitOpenFailure({killed:true,signal:'SIGTERM'}),'git_timeout');
});

test('프로젝트 열기 uses the folder command every platform enables, and every open failure has a message',async()=>{
  const widget=await readFile(new URL('../extension/src/browser/nubi-widget.tsx',import.meta.url),'utf8');
  assert.match(widget,/executeCommand\(WorkspaceCommands\.OPEN_FOLDER\.id\)/);
  assert.doesNotMatch(widget,/'workspace:open'/);
  // Theia registers workspace:open only for macOS and the browser; the folder command is enabled everywhere.
  const theia=await readFile(new URL('../node_modules/@theia/workspace/lib/browser/workspace-frontend-contribution.js',import.meta.url),'utf8');
  assert.match(theia,/registerCommand\(workspace_commands_1\.WorkspaceCommands\.OPEN_FOLDER, \{\s*isEnabled: \(\) => true/);
  const workbench=await readFile(new URL('../ui/Workbench.jsx',import.meta.url),'utf8');
  for(const code of ['project_picker_unavailable','project_path_missing','project_path_denied','not_git_repository','git_unavailable','git_unsafe_directory','git_timeout','workspace_untrusted'])
    assert.match(workbench,new RegExp('\\b'+code+":'"),code);
  assert.doesNotMatch(workbench,/입력과 연결 상태를 확인해 주세요/);
});

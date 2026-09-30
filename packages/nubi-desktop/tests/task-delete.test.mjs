import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,realpath,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';

const run=promisify(execFile);
async function project(t){
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-delete-')));
  const root=path.join(directory,'repo');await mkdir(root);
  const git=(...args)=>run('git',['-C',root,...args]);
  await git('init','-q');await writeFile(path.join(root,'a.txt'),'a\n');await git('add','.');
  await git('-c','user.name=fixture','-c','user.email=fixture@localhost','commit','-qm','init');
  const service=new ProjectService({storageRoot:path.join(directory,'state')});await service.open(root);
  t.after(async()=>{service.dispose();service.store?.close();await rm(directory,{recursive:true,force:true});});
  return {service,root};
}

// The trash icon deletes a conversation (user decision 2026-09-30).
test('deleting a conversation removes its task and every record made for it, and nothing of another',async t=>{
  const {service}=await project(t);
  const keep=await service.createTask({request:'남길 대화'}),gone=await service.createTask({request:'지울 대화'});
  for(const [key,value] of [['proposal:p1',{id:'p1',taskId:gone.id,state:'proposed'}],['proposal:p2',{id:'p2',taskId:keep.id,state:'proposed'}],
    [`context:${gone.id}`,{summary:'fixture'}],[`reconciliation:${gone.id}`,{state:'done'}],[`analysis-history:${gone.id}:run`,{kind:'roles'}],[`analysis-history:${keep.id}:run`,{kind:'roles'}],
    ['computer-action:a1',{id:'a1',taskId:gone.id}],['computer-image:a1',{before:'fixture'}],['computer-image:a2',{before:'fixture'}]])service.store.set(key,value);
  assert.deepEqual(await service.invoke('deleteTask',{taskId:gone.id}),{deleted:gone.id});
  assert.deepEqual(service.state().tasks.map(task=>task.id),[keep.id]);
  for(const key of ['proposal:p1',`context:${gone.id}`,`reconciliation:${gone.id}`,`analysis-history:${gone.id}:run`,'computer-action:a1','computer-image:a1'])assert.equal(service.store.get(key),null,key);
  for(const key of [`task:${keep.id}`,'proposal:p2',`analysis-history:${keep.id}:run`,'computer-image:a2'])assert.notEqual(service.store.get(key),null,key);
  await assert.rejects(service.invoke('deleteTask',{taskId:gone.id}),{message:'task_missing'});
});

test('a running conversation, or one with a running command, is not deleted',async t=>{
  const {service}=await project(t);
  const task=await service.createTask({request:'실행 중인 대화'});
  service.store.set('task:'+task.id,{...service.task(task.id),state:'running'});
  await assert.rejects(service.invoke('deleteTask',{taskId:task.id}),{message:'agent_busy'});
  service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});
  service.store.set('process:fixture',{id:'fixture',taskId:task.id,state:'running'});
  await assert.rejects(service.invoke('deleteTask',{taskId:task.id}),{message:'process_running'});
  assert.notEqual(service.store.get('task:'+task.id),null);
});

test('a conversation with its own worktree takes the worktree with it',async t=>{
  const {service,root}=await project(t);
  const task=await service.createTask({request:'작업 공간이 있는 대화'});
  const {workspace}=await service.invoke('createWorktree',{taskId:task.id});await stat(workspace);
  await service.invoke('deleteTask',{taskId:task.id});
  await assert.rejects(stat(workspace));
  assert.doesNotMatch((await run('git',['-C',root,'worktree','list','--porcelain'])).stdout,new RegExp(path.basename(workspace)));
});

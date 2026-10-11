import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures.mjs';
import {inspectWorkspaceChanges} from '../runtime/workspace-changes.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';

installAgent(ProjectService);

test('Git inspection shows bounded current changes without exposing private paths or writing files', async t => {
  const {service,root,directory} = await fixture(t);
  const changed = 'human edit\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n';
  await writeFile(path.join(root,'app.txt'),changed);
  await writeFile(path.join(root,'new.ts'),'export const value = 1;\n');
  await writeFile(path.join(root,'.env'),'PRIVATE_TOKEN=secret\n');
  await writeFile(path.join(directory,'outside.txt'),'outside\n');
  await symlink(path.join(directory,'outside.txt'),path.join(root,'outside-link.txt'));
  const task = await service.createTask({request:'Inspect existing work before editing'});

  const overview = await inspectWorkspaceChanges(service,{taskId:task.id});
  assert.equal(overview.dirty,true);
  assert.equal(overview.scope,'task_workspace');
  assert.deepEqual(overview.entries.map(entry=>entry.path).sort(),['app.txt','new.ts','outside-link.txt']);
  assert.equal(overview.excludedCount,1);
  assert.doesNotMatch(JSON.stringify(overview),/PRIVATE_TOKEN|\.env/);
  const detail = await inspectWorkspaceChanges(service,{taskId:task.id,path:'app.txt'});
  assert.equal(detail.state,'modified');
  assert.match(detail.patch,/\+human edit/);
  assert.equal(detail.patchTruncated,false);
  assert.equal(detail.after,changed,'the current text accompanies the patch for the inline diff');assert.equal(detail.binary,false);assert.ok(typeof detail.before==='string'&&detail.before!==changed,'the HEAD text accompanies the patch');
  assert.equal((await inspectWorkspaceChanges(service,{taskId:task.id,path:'new.ts'})).state,'untracked');
  assert.equal((await inspectWorkspaceChanges(service,{taskId:task.id,path:'new.ts'})).patch,null);
  await assert.rejects(inspectWorkspaceChanges(service,{taskId:task.id,path:'.env'}),/path_scope/);
  await assert.rejects(inspectWorkspaceChanges(service,{taskId:task.id,path:'../outside.txt'}),/path_scope/);
  await assert.rejects(inspectWorkspaceChanges(service,{taskId:task.id,path:'outside-link.txt'}),/path_scope/);
  assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),changed);
});

test('large diff is explicitly incomplete and exact-file status never expands to a directory', async t => {
  const {service,root} = await fixture(t),task = await service.createTask({request:'Review a large change'});
  await writeFile(path.join(root,'app.txt'),'changed\n'.repeat(6000));
  const detail = await inspectWorkspaceChanges(service,{taskId:task.id,path:'app.txt'});
  assert.equal(detail.patchTruncated,true);
  assert.ok(detail.patchBytes>24000);
  assert.equal(detail.patch.isWellFormed(),true);
  assert.match(detail.instruction,/Only the first part/);
  await assert.rejects(inspectWorkspaceChanges(service,{taskId:task.id,path:'openwiki'}),/path_scope/);
});

test('Pi can inspect pre-existing Git changes through a read-only tool before suggesting a code edit', async t => {
  const {service,root} = await fixture(t),changed = 'human edit\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n';
  await writeFile(path.join(root,'app.txt'),changed);
  let turn=0;
  const call=(name,args)=>({content:'',calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    if(turn++===0)return call('inspect_workspace_changes',{});
    if(turn===2){assert.equal(result.entries.some(entry=>entry.path==='app.txt'),true);return call('inspect_workspace_changes',{path:'app.txt'});}
    assert.equal(result.state,'modified');assert.match(result.patch,/\+human edit/);
    return {content:'기존 수정을 확인했습니다. 현재 파일을 읽고 범위를 정해야 합니다.',calls:[]};
  }};
  const task=await service.createTask({request:'Check the worktree before editing'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');
  assert.equal(turn,3);
  assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),changed);
  assert.equal(service.state().proposals.length,0);
});

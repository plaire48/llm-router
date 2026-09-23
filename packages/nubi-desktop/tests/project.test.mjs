import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {git,hash} from '../runtime/files.mjs';

import {fixture} from './fixtures.mjs';
test('source scope excludes secrets, traversal, and escaped symlinks',async t=>{
  const {service,root,directory}=await fixture(t);await writeFile(path.join(root,'.env'),'SECRET=private');await writeFile(path.join(directory,'outside.txt'),'outside');await symlink(path.join(directory,'outside.txt'),path.join(root,'escape.txt'));
  for(const file of ['.env','../outside.txt','escape.txt'])await assert.rejects(service.read({path:file}),/path_scope/);
  assert.equal((await service.search({query:'welcome'})).results[0].path,'openwiki/home.md');
  assert.equal((await service.wikiQuery({query:'welcome'})).results[0].freshness,'unverified');
  await assert.rejects(service.invoke('constructor'),/method_invalid/);
});
test('stale proposals fail closed and three-way merge preserves independent human edits',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Improve first line'}),before=await service.read({path:'app.txt',full:true});
  const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:before.content.replace('first','AI first')});
  await writeFile(path.join(root,'app.txt'),before.content.replace('last','Human last'));
  await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/source_stale/);
  const merged=await service.mergeProposal({proposalId:proposal.id});assert.equal(merged.conflicted,false);assert.match(merged.proposal.content,/AI first/);assert.match(merged.proposal.content,/Human last/);
  assert.doesNotMatch(await readFile(path.join(root,'app.txt'),'utf8'),/AI first/);
  await writeFile(path.join(root,'app.txt'),before.content.replace('first','Human first'));
  assert.equal(service.store.get('proposal:'+proposal.id).state,'superseded');
  assert.equal((await service.mergeProposal({proposalId:merged.proposal.id})).conflicted,true);
});
test('application receipt requires actual disk content and survives reopening',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Change a file',criteria:['Changed text visible']});
  const before=await service.read({path:'app.txt',full:true});const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:'new content\n'});
  await assert.rejects(service.confirmProposal({proposalId:proposal.id}),/write_unconfirmed/);
  await writeFile(path.join(root,'app.txt'),proposal.content);await service.confirmProposal({proposalId:proposal.id});
  service.store.close();service.root=null;await service.open(root);
  assert.equal(service.state().proposals[0].state,'applied');assert.equal(service.task(task.id).criteria[0].state,'unknown');
  assert.equal((await service.prepareProposal({proposalId:proposal.id})).alreadyApplied,true);
});
test('HEAD worktree and requirements retain original dirty source and reject escaping spec directories',async t=>{
  const {service,root,directory}=await fixture(t),task=await service.createTask({request:'Change welcome',criteria:['Welcome visible']});
  await writeFile(path.join(root,'app.txt'),'human draft');const isolated=await service.createWorktree({taskId:task.id});
  assert.match(await readFile(path.join(isolated.workspace,'app.txt'),'utf8'),/^first/);assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),'human draft');
  const spec=await service.exportRequirement({taskId:task.id});assert.match(await readFile(path.join(root,spec.path),'utf8'),/Welcome visible/);assert.equal((await service.exportRequirement({taskId:task.id})).path,spec.path);
  await rm(path.join(root,'openspec'),{recursive:true});await symlink(directory,path.join(root,'openspec'));
  const second=await service.createTask({request:'Second'});await assert.rejects(service.exportRequirement({taskId:second.id}),/path_scope/);
});
test('owned Bash process records actual output, exit and cancellation without replay',async t=>{
  if(process.platform==='win32')return t.skip('Bash fixture; Windows execution is separately measured');
  const {service}=await fixture(t),task=await service.createTask({request:'Run'});
  const finished=await service.run({taskId:task.id,script:'printf "verified output"',profile:'bash'});
  while(service.processes.active.has(finished.id))await new Promise(r=>setTimeout(r,30));
  assert.equal(service.processes.poll(finished.id).output,'verified output');assert.equal(service.processes.poll(finished.id).exitCode,0);
  const long=await service.run({taskId:task.id,script:'sleep 30',profile:'bash'});service.processes.stop(long.id);
  while(service.processes.active.has(long.id))await new Promise(r=>setTimeout(r,30));
  assert.equal(service.processes.poll(long.id).state,'cancelled');assert.equal(service.processes.active.size,0);
});

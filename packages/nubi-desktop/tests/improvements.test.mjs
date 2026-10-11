import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {Store} from '../runtime/store.mjs';
import {SourceObservations,replaceObserved} from '../runtime/source-edits.mjs';
import {git} from '../runtime/files.mjs';
import {READ_LINES} from '../runtime/read-room.mjs';

test('narrow edits preserve unread CRLF lines and reject ambiguous, unseen, overlapping or stale replacements',async t=>{
  const {service,root}=await fixture(t),content=Array.from({length:450},(_,i)=>`line-${i+1}`).join('\r\n');
  await writeFile(path.join(root,'app.txt'),content);
  const task=await service.createTask({request:'Change line 350'}),seen=new SourceObservations();
  const window=await service.read({path:'app.txt',taskId:task.id,start:300,end:399});seen.observe(window);
  assert.equal(window.truncated,true);assert.equal(window.nextStart,400);
  const file=await service.read({path:'app.txt',full:true});
  assert.throws(()=>seen.require(file),/source_read_required/);
  const edit=(oldText,newText='changed')=>replaceObserved(file,file.hash,[{oldText,newText}],seen);
  assert.throws(()=>edit('line-20\r\n'),/source_read_required/);
  assert.throws(()=>edit('line-3'),/edit_text_ambiguous/);
  assert.throws(()=>replaceObserved(file,file.hash,[{oldText:'line-350',newText:'a'},{oldText:'line-350\r\nline-351',newText:'b'}],seen),/edits_overlap/);
  const next=edit('line-350\r\n','improved-350\r\n');
  assert.equal(next,content.replace('line-350\r\n','improved-350\r\n'));
  const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:file.hash,content:next});
  assert.deepEqual(proposal.stats,{state:'counted',added:1,removed:1});
  assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),content);
  await writeFile(path.join(root,'app.txt'),content+'human');
  assert.throws(()=>replaceObserved({...file,hash:'changed'},file.hash,[{oldText:'line-350',newText:'x'}],seen),/source_stale/);
  await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/source_stale/);
});

test('whole-file replacement requires complete current-run coverage, including continuation reads',async t=>{
  // Longer than two reads of READ_LINES (200 lines before the user decision of 2026-09-30 on large windows).
  const {service,root}=await fixture(t);await writeFile(path.join(root,'app.txt'),Array.from({length:2*READ_LINES+50},(_,i)=>'row '+i).join('\n'));
  const seen=new SourceObservations(),file=await service.read({path:'app.txt',full:true});
  seen.observe(await service.read({path:'app.txt'}));assert.throws(()=>seen.require(file),/source_read_required/);
  const second=await service.read({path:'app.txt',start:READ_LINES+1});assert.equal(second.end,2*READ_LINES);assert.equal(second.nextStart,2*READ_LINES+1);seen.observe(second);
  seen.observe(await service.read({path:'app.txt',start:2*READ_LINES+1}));assert.doesNotThrow(()=>seen.require(file));
  assert.throws(()=>new SourceObservations().require(file),/source_read_required/);
  await writeFile(path.join(root,'legacy.txt'),Buffer.from([0xff,0xfe,0x61]));
  await assert.rejects(service.read({path:'legacy.txt'}),/file_encoding/);
});

test('another execution owner cannot rewrite running state; an OS-released lock permits crash recovery',async t=>{
  const {service,root,directory}=await fixture(t),task=await service.createTask({request:'Keep task'});
  service.store.set('task:'+task.id,{...task,state:'running'});
  const other=new ProjectService({storageRoot:path.join(directory,'state')});
  await assert.rejects(other.open(root),/project_locked/);
  assert.equal(other.root,undefined);assert.equal(service.task(task.id).state,'running');
  const storeDirectory=service.store.directory;service.store.close();
  const child=spawn(process.execPath,['--input-type=module','-e',`import {Store} from ${JSON.stringify(new URL('../runtime/store.mjs',import.meta.url).href)};const store=new Store(${JSON.stringify(storeDirectory)});console.log('owned');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await once(child.stdout,'data');assert.throws(()=>new Store(storeDirectory),/project_locked/);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  await service.open(root);assert.equal(service.task(task.id).state,'interrupted');assert.equal(service.processes.active.size,0);
});

test('Git Wiki records retain human versions, no-op when unchanged, and expose source drift without passing criteria',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Knowledge fixture request',criteria:['Welcome verified']});
  const file=await service.read({path:'app.txt',full:true});
  await service.propose({taskId:task.id,path:'app.txt',expectedHash:file.hash,content:file.content.replace('first','improved')});
  service.store.set('process:fixture',{id:'fixture',taskId:task.id,profile:'bash',state:'completed',exitCode:0,startedAt:'2026-09-23',script:'SECRET_COMMAND',output:'SECRET_OUTPUT'});
  const first=await service.recordKnowledge({taskId:task.id}),saved=await readFile(path.join(root,first.path),'utf8');
  assert.match(saved,/Knowledge fixture request/);assert.match(saved,/미확인/);assert.doesNotMatch(saved,/SECRET_/);
  assert.equal((await service.recordKnowledge({taskId:task.id})).noChange,true);
  assert.equal((await service.knowledgeStatus({taskId:task.id})).state,'matching');
  await writeFile(path.join(root,first.path),saved+'\nHuman explanation\n');
  assert.equal((await service.knowledgeStatus({taskId:task.id})).state,'edited');
  const second=await service.recordKnowledge({taskId:task.id});assert.equal(second.revision,2);assert.notEqual(first.path,second.path);
  assert.match(await readFile(path.join(root,first.path),'utf8'),/Human explanation/);
  await writeFile(path.join(root,'app.txt'),file.content+'human change');
  const status=await service.knowledgeStatus({taskId:task.id});assert.equal(status.state,'outdated');assert.equal(status.sources[0].state,'changed');
  const third=await service.recordKnowledge({taskId:task.id});assert.equal(third.revision,3);assert.match(await readFile(path.join(root,third.path),'utf8'),/기준 이후 변경/);
  assert.match(await git(root,['status','--short','--untracked-files=all']),/nubi-evidence/);
  assert.ok((await service.wikiQuery({query:'Knowledge fixture request'})).results.length>0);
  assert.equal(service.task(task.id).criteria[0].state,'unknown');
  service.store.close();await service.open(root);assert.equal((await service.knowledgeStatus({taskId:task.id})).record.revision,3);
});

test('Wiki publication refuses an escaping directory and leaves outside files untouched',async t=>{
  const {service,root,directory}=await fixture(t),task=await service.createTask({request:'Record'});
  await rm(path.join(root,'openwiki'),{recursive:true});await symlink(directory,path.join(root,'openwiki'));
  await assert.rejects(service.recordKnowledge({taskId:task.id}),/path_scope/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {prepareSetupAction} from '../runtime/setup-actions.mjs';
import {SourceObservations} from '../runtime/source-edits.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);
const wait=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('state did not settle');};
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const spec=ref=>({title:'로컬 실행 준비',kind:'configure',profile:'bash',script:"printf 'once\n' >> setup-result.txt",reason:'프로젝트 실행 결과를 확인합니다.',effects:'현재 프로젝트에 확인 파일을 만듭니다.',verification:'파일 내용이 once 한 줄인지 확인합니다.',references:[{path:ref.path,hash:ref.hash}]});
async function prepare(service,taskId){const source=await service.read({taskId,path:'app.txt'}),observations=new SourceObservations();observations.observe(source);return prepareSetupAction(service,taskId,spec(source),observations);}

test('setup proposal does not execute; exact approval executes once despite concurrent delivery',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Prepare local environment'}),action=await prepare(service,task.id);
  assert.equal(service.store.list('process:').length,0);await assert.rejects(access(path.join(root,'setup-result.txt')));
  await assert.rejects(service.decideSetupAction({id:action.id,fingerprint:'old',decision:'approve'}),/setup_changed/);
  const args={id:action.id,fingerprint:action.fingerprint,decision:'approve'};
  await Promise.all([service.decideSetupAction(args),service.decideSetupAction(args)]);
  await wait(()=>!service.processes.active.size);await service.decideSetupAction(args);
  assert.equal(await readFile(path.join(root,'setup-result.txt'),'utf8'),'once\n');
  const processes=service.store.list('process:');assert.equal(processes.length,1);assert.equal(processes[0].setupActionId,action.id);
  assert.equal(service.state().setupActions[0].state,'started');
});

test('changed source invalidates pending approval without executing',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Build'}),action=await prepare(service,task.id);
  await writeFile(path.join(root,'app.txt'),'changed configuration');
  await assert.rejects(service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'}),/setup_changed/);
  assert.equal(service.state().setupActions[0].state,'stale');assert.equal(service.store.list('process:').length,0);
});

test('a question answer is not approval; pending questions and cancelled tasks block execution',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'Choose an environment'}),action=await prepare(service,task.id),args={id:action.id,fingerprint:action.fingerprint,decision:'approve'};
  service.store.set('task:'+task.id,{...task,state:'waiting_input',question:{id:'q'}});
  await assert.rejects(service.decideSetupAction(args),/agent_busy/);
  await assert.rejects(service.run({taskId:task.id,script:'echo bypass',profile:'bash'}),/question_pending/);
  service.store.set('task:'+task.id,{...task,state:'cancelled'});await assert.rejects(service.decideSetupAction(args),/setup_cancelled/);
  assert.equal(service.store.list('process:').length,0);
});

test('rejected actions remain rejected on duplicate proposals and approvals',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'Prepare'}),action=await prepare(service,task.id),args={id:action.id,fingerprint:action.fingerprint};
  await service.decideSetupAction({...args,decision:'reject'});
  assert.equal((await prepare(service,task.id)).state,'rejected');assert.equal((await service.decideSetupAction({...args,decision:'approve'})).state,'rejected');
  assert.equal(service.store.list('process:').length,0);
});

test('source references must be observed in this run and unknown arguments are rejected',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'Prepare'}),source=await service.read({path:'app.txt'});
  await assert.rejects(prepareSetupAction(service,task.id,spec(source),new SourceObservations()),/source_read_required/);
  await assert.rejects(prepareSetupAction(service,task.id,{...spec(source),approved:true},new SourceObservations()),/setup_invalid/);
});

test('restart preserves uncertain execution and does not replay an approved action',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Prepare'}),action=await prepare(service,task.id);
  service.store.set('setup-action:'+action.id,{...action,state:'starting'});service.dispose();service.store.close();await service.open(root);
  const current=await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  assert.equal(current.state,'attention');assert.equal(service.store.list('process:').length,0);
});

test('Pi prepares observed commands; explicit host approval runs them and feeds real output back',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Prepare and verify',criteria:['Do not assume success']});let round=0,sawReceipt=false;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
    if(++round===1)return call('read_source',{path:'app.txt'});
    if(round===2)return call('propose_setup_action',spec(JSON.parse(messages.findLast(m=>m.role==='tool').content)));
    if(round>=4){sawReceipt=true;assert.match(JSON.stringify(messages),/completed/);return {content:'실행 기록을 확인했습니다. 완료 조건은 별도 검증합니다.',calls:[]};}
    return {content:'준비한 명령을 승인해 주세요.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.store.list('process:').length,0);const action=service.state().setupActions[0];assert.ok(action);
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  await wait(()=>sawReceipt&&!service.agent.running);
  assert.equal(await readFile(path.join(root,'setup-result.txt'),'utf8'),'once\n');assert.equal(service.task(task.id).criteria[0].state,'unknown');
});

// The command suite found fixes proposed without their check (2026-09-30, E2 and E3): the agent proposes the fix and
// then the command that checks it; the host holds the command until the fix is applied and then runs it, even when
// the command names the fixed file among its references.
test('a command proposed after a fix of the same run waits for the fix, then runs on it',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'app.txt의 첫 줄을 고치고 확인 명령을 돌려 줘.'});let round=0,hash;
  const plan={summary:'첫 줄 수정',requirements:[{id:'R1',text:'첫 줄을 FIRST로 바꾼다'}],targets:[{path:'app.txt',reason:'첫 줄',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'첫 줄 확인'}],assumptions:[]};
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
    const result=JSON.parse(messages.findLast(m=>m.role==='tool')?.content||'null');
    switch(++round){
      case 1:return call('read_source',{path:'app.txt'});
      case 2:hash=result.hash;return call('record_change_plan',plan);
      case 3:return call('propose_patch',{path:'app.txt',expectedHash:hash,edits:[{oldText:'first\n',newText:'FIRST\n'}],reason:'요청 반영'});
      case 4:return call('propose_setup_action',{...spec({path:'app.txt',hash}),kind:'verify',script:"head -1 app.txt > check-result.txt"});
      default:return {content:'수정안과 확인 명령을 준비했습니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const [proposal]=service.state().proposals,[action]=service.state().setupActions;
  assert.equal(proposal.state,'proposed');assert.deepEqual(action.afterProposals,[proposal.id]);
  const approve=()=>service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  await assert.rejects(approve(),/setup_waiting_for_proposals/);
  assert.equal(service.state().setupActions[0].state,'proposed');assert.equal(service.store.list('process:').length,0);
  const prepared=await service.prepareProposal({proposalId:proposal.id});await writeFile(path.join(root,'app.txt'),prepared.content);await service.confirmProposal({proposalId:proposal.id});
  await approve();await wait(()=>!service.processes.active.size&&!service.agent.running);
  assert.equal(await readFile(path.join(root,'check-result.txt'),'utf8'),'FIRST\n');
  assert.equal(service.state().setupActions[0].state,'started');
});

test('a changed reference that no applied proposal of the task explains still stops the command',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Build'}),action=await prepare(service,task.id);
  const other=await service.createTask({request:'Other'}),source=await service.read({taskId:other.id,path:'app.txt'});
  const proposal=await service.propose({taskId:other.id,path:'app.txt',expectedHash:source.hash,content:'changed by another task\n',reason:'다른 작업'});
  await writeFile(path.join(root,'app.txt'),'changed by another task\n');await service.confirmProposal({proposalId:proposal.id});
  await assert.rejects(service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'}),/setup_changed/);
  assert.equal(service.store.list('process:').length,0);
});

// Found by review (2026-09-30): an older proposal of the same file could never be applied and held the command
// for good, and the same command proposed again after a fix came back without its hold.
test('a newer proposal of a file supersedes the older one, so a command waits only for what can be applied',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'app.txt를 고치고 확인해 줘.'});
  const source=await service.read({taskId:task.id,path:'app.txt'});
  service.agent={running:true,taskId:task.id,runId:'run-1'};
  const older=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'FIRST\n',reason:'첫 제안'});
  const newer=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'FIRST\nsecond\n',reason:'고친 제안'});
  assert.equal(service.store.get('proposal:'+older.id).state,'superseded');assert.equal(service.store.get('proposal:'+newer.id).state,'proposed');
  const observations=new SourceObservations();observations.observe(source);
  const action=await prepareSetupAction(service,task.id,spec(source),observations);service.agent=null;
  assert.deepEqual(action.afterProposals,[newer.id]);
  const prepared=await service.prepareProposal({proposalId:newer.id});await writeFile(path.join(root,'app.txt'),prepared.content);await service.confirmProposal({proposalId:newer.id});
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  await wait(()=>!service.processes.active.size);
  assert.equal(service.state().setupActions[0].state,'started');
});

test('the same command proposed again keeps waiting for the new fix; after its run finished it may run again',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'확인 명령'});
  const source=await service.read({taskId:task.id,path:'app.txt'}),observations=new SourceObservations();observations.observe(source);
  const first=await prepareSetupAction(service,task.id,spec(source),observations);
  assert.equal(first.afterProposals,undefined);
  service.agent={running:true,taskId:task.id,runId:'run-2'};
  const fix=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'fixed\n',reason:'수정'});
  const again=await prepareSetupAction(service,task.id,spec(source),observations);service.agent=null;
  assert.equal(again.id,first.id,'the open card stays');assert.deepEqual(again.afterProposals,[fix.id]);
  await assert.rejects(service.decideSetupAction({id:first.id,fingerprint:first.fingerprint,decision:'approve'}),/setup_waiting_for_proposals/);
  // Not waiting: the run of the first one finishes, then the same command is a new card.
  service.store.set('setup-action:'+first.id,{...service.store.get('setup-action:'+first.id),afterProposals:[]});
  await service.decideSetupAction({id:first.id,fingerprint:first.fingerprint,decision:'approve'});await wait(()=>!service.processes.active.size);
  const rerun=await prepareSetupAction(service,task.id,spec(source),observations);
  assert.notEqual(rerun.id,first.id);assert.equal(rerun.state,'proposed');
  // An uncertain one is never offered again.
  service.store.set('setup-action:'+rerun.id,{...rerun,state:'attention'});
  assert.equal((await prepareSetupAction(service,task.id,spec(source),observations)).id,rerun.id);
  assert.equal(await readFile(path.join(root,'setup-result.txt'),'utf8'),'once\n');
});

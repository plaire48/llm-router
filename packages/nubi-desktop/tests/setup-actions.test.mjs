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

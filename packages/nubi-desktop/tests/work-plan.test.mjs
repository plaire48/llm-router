import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture,fixturePlan} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WORK_PLAN_PROMPT,workPlanSteps} from '../runtime/work-plan.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const reply=content=>({content,calls:[]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const steps=[{text:'현재 문구 확인',expected_outcome:'app.txt의 첫 줄을 확인한다',status:'in_progress'},{text:'확인 결과 설명',expected_outcome:'변경 없이 관찰한 문구를 설명한다',status:'pending'}];

test('Pi obtains and persists a task-specific plan before the first source tool; revisions remain plans, not passes',async t=>{
  const {service,root}=await fixture(t,{scriptedPlanning:true});let plans=0,round=0,reads=0,task;
  const read=service.read.bind(service);service.read=async args=>{reads++;assert.equal(service.task(task.id).workPlan.steps[0].text,steps[0].text);return read(args);};
  service.providers={status,dispose(){},complete:async(messages,tools)=>{
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){plans++;assert.equal(reads,0);assert.deepEqual(tools.map(tool=>tool.function.name),['update_plan']);assert.match(JSON.stringify(messages),/변경 금지/);return reply(JSON.stringify({intent:{goal:'첫 줄 확인',constraints:['변경 금지'],outcomes:['현재 첫 줄 설명'],workflowIds:['source-change'],skillPaths:[]},steps}));}
    round++;if(round===1)return call('read_source',{path:'app.txt'});
    if(round===2)return call('update_plan',{steps:steps.map((s,i)=>({...s,status:i===1?'in_progress':'pending'}))});
    return reply('첫 줄은 first입니다. 파일을 변경하지 않았습니다.');
  }};
  task=await service.createTask({request:'app.txt 첫 줄 확인',criteria:['변경 금지']});await service.startAgent({taskId:task.id});await service.agent.promise;
  const saved=service.task(task.id);assert.equal(saved.state,'review');assert.equal(plans,1);assert.equal(reads,1);assert.equal(saved.workPlan.revision,2);assert.equal(saved.workPlan.steps[1].status,'in_progress');assert.equal(saved.criteria[0].state,'unknown');
  assert.equal(saved.trace.find(e=>e.status==='done'&&e.tool!=='recover_model').tool,'update_plan');
  assert.equal(saved.trace.find(e=>e.tool==='recover_model').label,'작업 계획 준비');
  service.store.close();await service.open(root);assert.equal(service.task(task.id).workPlan.revision,2);
});

test('invalid automatic plan is repaired once and no project tool is dispatched',async t=>{
  const {service}=await fixture(t,{scriptedPlanning:true});let plans=0,reads=0;
  service.read=async()=>{reads++;throw Error('must not execute');};
  service.providers={status,dispose(){},complete:async messages=>{if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){plans++;return reply('{}');}return call('read_source',{path:'app.txt'});}};
  const task=await service.createTask({request:'파일 확인'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(plans,2);assert.equal(reads,0);assert.equal(service.task(task.id).state,'paused');assert.equal(service.task(task.id).error,'work_plan_invalid');
});

test('cancellation while planning never dispatches the pending tool',async t=>{
  const {service}=await fixture(t,{scriptedPlanning:true});let started;const wait=new Promise(resolve=>{started=resolve;});let reads=0;
  service.read=async()=>{reads++;};
  service.providers={status,dispose(){},complete:async(messages,tools,signal)=>{if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}return call('read_source',{path:'app.txt'});}};
  const task=await service.createTask({request:'읽기'});await service.startAgent({taskId:task.id});await wait;await service.stopAgent({taskId:task.id});assert.equal(reads,0);assert.equal(service.task(task.id).state,'cancelled');
});

test('ordinary conversation and missing-choice questions do not fabricate a work plan',async t=>{
  for(const question of [false,true]){
    const {service}=await fixture(t,{scriptedPlanning:true});let plans=0;
    service.providers={status,dispose(){},complete:async messages=>{if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){plans++;return fixturePlan(messages);}return question?call('ask_user',{question:'어느 문서를 말하나요?'}):reply('안녕하세요.');}};
    const task=await service.createTask({request:question?'그 문서를 바꿔줘':'안녕'});await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(plans,0);assert.equal(service.task(task.id).workPlan,undefined);
  }
});

test('a answered clarification replans the same task with preserved original criteria and answer',async t=>{
  const {service}=await fixture(t,{scriptedPlanning:true});let plans=0,round=0;
  service.providers={status,dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){plans++;if(plans===2)assert.match(JSON.stringify(messages),/선택한 문구만/);assert.match(JSON.stringify(messages),/파일 보존/);return fixturePlan(messages);}
    round++;if(round===1||round===3)return call('read_source',{path:'app.txt'});
    if(round===2)return call('ask_user',{question:'어느 범위에 적용할까요?'});
    return reply('확인한 범위를 유지합니다.');
  }};
  const task=await service.createTask({request:'문구 확인',criteria:['파일 보존']});await service.startAgent({taskId:task.id});await service.agent.promise;const oldRun=service.task(task.id).workPlan.runId;
  await service.answerAgent({taskId:task.id,answer:'선택한 문구만'});await service.agent.promise;
  assert.equal(plans,2);assert.equal(service.task(task.id).id,task.id);assert.notEqual(service.task(task.id).workPlan.runId,oldRun);assert.equal(service.task(task.id).criteria[0].state,'unknown');
});

test('plan schema refuses fabricated completed steps, duplicate labels and multiple current steps',()=>{
  for(const invalid of [[{...steps[0],status:'completed'}],[steps[0],steps[0]],[steps[0],{...steps[1],status:'in_progress'}]])assert.throws(()=>workPlanSteps({steps:invalid}),/work_plan_invalid/);
});

test('agent invokes existing localhost comparison and stores actual captures without a UI mode selection',async t=>{
  const {service}=await fixture(t);const server=createServer((req,res)=>res.writeHead(200,{'content-type':'text/html'}).end('<h1>'+req.url+'</h1>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;let round=0;
  service.providers={status,dispose(){},complete:async messages=>{if(++round===1)return call('compare_local_pages',{beforeUrl:base+'/before',afterUrl:base+'/after'});const value=JSON.parse(messages.findLast(m=>m.role==='tool').content);assert.equal(value.state,'captured');assert.equal(value.sourceAssociation,'unverified');assert.equal(value.beforeImage,undefined);return reply('두 화면을 캡처했습니다. 기능 검증은 별도입니다.');}};
  const task=await service.createTask({request:base+'/before 와 '+base+'/after 화면 비교'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(service.state().comparisons.length,1);const stored=await service.comparison({id:service.state().comparisons[0].id});assert.match(stored.afterImage,/^data:image\/png;base64,/);
});

test('invented comparison URLs return actionable feedback before any capture is issued',async t=>{
  const {service}=await fixture(t);let round=0,captures=0;service.compare=async()=>{captures++;throw Error('unexpected');};
  service.providers={status,dispose(){},complete:async messages=>{if(++round===1)return call('compare_local_pages',{beforeUrl:'http://localhost:9991/',afterUrl:'http://localhost:9992/'});assert.match(messages.findLast(m=>m.role==='tool').content,/preview_source_required/);return reply('실행 주소를 먼저 확인해야 합니다.');}};
  const task=await service.createTask({request:'로컬 화면 비교'});await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(captures,0);assert.equal(service.task(task.id).state,'review');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {SourceObservations} from '../runtime/source-edits.mjs';
import {recordChangePlan,requirePlannedEdit} from '../runtime/change-plan.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {makeQuestion} from '../../../extensions/aipro-chat/user-question.js';
installAgent(ProjectService);
const input=()=>({summary:'Update observed text',requirements:[{id:'R1',text:'Required result',criterionId:'AC-1'}],targets:[{path:'app.txt',reason:'Observed behavior',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'Assert expected stored content'}],assumptions:[]});

test('plans require observed current sources, every acceptance criterion, and explicit checks; scope drift blocks edit',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Improve content',criteria:['Expected result']}),seen=new SourceObservations();
  await assert.rejects(recordChangePlan(service,task,input(),seen,'run1'),/source_read_required/);
  const file=await service.read({path:'app.txt'});seen.observe(file);
  const invalid=input();delete invalid.requirements[0].criterionId;await assert.rejects(recordChangePlan(service,task,invalid,seen,'run1'),/plan_criteria_missing/);
  const missingCheck=input();missingCheck.checks[0].requirementId='invented';await assert.rejects(recordChangePlan(service,task,missingCheck,seen,'run1'),/plan_invalid/);
  const plan=await recordChangePlan(service,task,input(),seen,'run1');assert.equal(plan.checks[0].state,'not_run');assert.deepEqual(plan.impact.unmapped,['app.txt']);
  assert.doesNotThrow(()=>requirePlannedEdit(task,'app.txt',file.hash,'run1'));
  assert.throws(()=>requirePlannedEdit(task,'other.txt',file.hash,'run1'),/change_scope_unplanned/);
  assert.throws(()=>requirePlannedEdit(task,'app.txt','changed','run1'),/change_plan_stale/);
  assert.throws(()=>requirePlannedEdit(task,'app.txt',file.hash,'run2'),/change_plan_required/);
  await writeFile(path.join(root,'app.txt'),'human');await assert.rejects(recordChangePlan(service,task,input(),seen,'run1'),/source_read_required/);
});

test('HITL draft and grounded choices survive reopen; answer resumes the same goal once and preserves criteria',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'원래 목표 유지',criteria:['원래 완료 조건']}),question=makeQuestion('어느 범위에 적용할까요?',[],[],{choices:[{label:'현재 화면',description:'선택한 화면만 변경'},{label:'모든 화면',description:'공통 동작 변경'}]});
  service.store.set('task:'+task.id,{...task,state:'waiting_input',question});
  await service.saveQuestionDraft({taskId:task.id,questionId:question.id,draft:'현재 화면에서 확인 후 확대'});
  service.store.close();await service.open(root);assert.equal(service.task(task.id).question.draft,'현재 화면에서 확인 후 확대');
  await assert.rejects(service.answerAgent({taskId:task.id,choice:{questionId:question.id,optionId:'option-1'}}),/provider_missing/);
  assert.equal(service.task(task.id).state,'waiting_input');
  let calls=0;service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){calls++;assert.match(JSON.stringify(messages),/현재 화면/);assert.match(JSON.stringify(messages),/원래目标|원래 목표/);return {content:'범위를 확인했습니다. 검증은 아직 진행하지 않았습니다.',calls:[]};}};
  await assert.rejects(service.startAgent({taskId:task.id,answer:'bypass'}),/question_pending/);
  await assert.rejects(service.answerAgent({taskId:task.id,choice:{questionId:'old-question',optionId:'option-1'}}),/question_changed/);
  await service.answerAgent({taskId:task.id,choice:{questionId:question.id,optionId:'option-1'}});await service.agent.promise;
  assert.equal(calls,1);assert.equal(service.task(task.id).questionHistory[0].answer.text,'현재 화면');assert.equal(service.task(task.id).criteria[0].state,'unknown');assert.equal(service.task(task.id).request,'원래 목표 유지');
  await assert.rejects(service.answerAgent({taskId:task.id,choice:{questionId:question.id,text:'duplicate'}}),/question_changed/);
});

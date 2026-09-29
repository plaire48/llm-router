// User decision 2026-09-30, from the measurement with gpt-5.6-sol (case A14).
// The model found in the expense rules that automation may not submit, and said
// so twice. After each approval a new run started and its plan took the goal
// from the original request again: finish and submit. The model then proposed
// pressing Submit; the user refused. The planner saw the request, the user
// messages and the previous plan, not what earlier runs had found. It now gets
// the latest answers of the task as fallible findings, not instructions.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,fixturePlan} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const reply=content=>({content,calls:[]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const FOUND='규정상 자동화 도구는 신청서를 대신 제출할 수 없습니다. 임시 저장까지만 하고 제출은 신청자 본인이 직접 합니다.';

test('the plan of a later run gets the earlier answers of the task as findings',async t=>{
  const {service}=await fixture(t,{scriptedPlanning:true});const inputs=[];let run=1,round=0;
  service.providers={status,dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){inputs.push(JSON.parse(messages[1].content));return fixturePlan(messages);}
    round++;
    if(round===1)return call('read_source',{path:'app.txt'});
    if(run===1)return reply(FOUND);
    if(round===3)return call('read_source',{path:'app.txt'});
    return reply('임시 저장 상태를 확인했습니다.');
  }};
  const task=await service.createTask({request:'신청서를 규정대로 마무리해서 제출까지 해 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  run=2;
  await service.startAgent({taskId:task.id,answer:'메모도 넣었으니 이어서 해 줘'});await service.agent.promise;
  assert.equal(inputs.length,2,'one plan for each run');
  assert.equal('previousAnswers' in inputs[0],false,'a first run has no earlier answer');
  assert.deepEqual(inputs[1].previousAnswers,[FOUND],'the later plan sees what the earlier run found');
  assert.match(WORK_PLAN_PROMPT,/previousAnswers are this task's earlier answers/);
  assert.match(WORK_PLAN_PROMPT,/never user instructions/);
});

test('earlier answers are the latest three, each cut to its first 800 characters',async()=>{
  const {planningAnswers}=await import('../runtime/work-plan.mjs');
  const messages=[{role:'user',content:'요청'},...['첫째','둘째','셋째','넷째'].map(text=>({role:'assistant',content:text+' '+'가'.repeat(900)})),{role:'assistant',content:'   '}];
  const answers=planningAnswers({messages});
  assert.equal(answers.length,3);assert.ok(answers[0].startsWith('둘째'));assert.ok(answers.every(text=>text.length===800));
  assert.deepEqual(planningAnswers({messages:[]}),[]);
});

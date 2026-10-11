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
  // E5 (S27, 2026-10-01): "할인 검사만" became "no other command" and "one test command", and the corrected command was never proposed.
  assert.match(WORK_PLAN_PROMPT,/never add one they did not set, such as a single command or no corrected command; "only X" limits the work to X, not the commands that carry it out/);
});

// Three answers of 800 characters before the user decision of 2026-09-30 on large windows.
test('earlier answers are the latest five, each cut to its first 4,000 characters',async()=>{
  const {planningAnswers,ANSWERS,ANSWER}=await import('../runtime/work-plan.mjs');
  assert.deepEqual([ANSWERS,ANSWER],[5,4000]);
  const messages=[{role:'user',content:'요청'},...['첫째','둘째','셋째','넷째','다섯째','여섯째','일곱째'].map(text=>({role:'assistant',content:text+' '+'가'.repeat(4200)})),{role:'assistant',content:'   '}];
  const answers=planningAnswers({messages});
  assert.equal(answers.length,5);assert.ok(answers[0].startsWith('셋째'));assert.ok(answers.every(text=>text.length===4000));
  assert.deepEqual(planningAnswers({messages:[]}),[]);
});

// Five answers of 4,000 characters do not fit the plan input of a small window (case L1 at 22,000 tokens, found
// when the answers grew for large windows): a small window takes three of 800, and only the newest that fit.
test('the plan takes the newest earlier answers that fit its input',async()=>{
  const {prepareWorkPlan}=await import('../runtime/work-plan.mjs');
  const messages=[{role:'user',content:'요청'},...['첫째','둘째','셋째','넷째','다섯째'].map(text=>({role:'assistant',content:text+' '+'자세한 설명입니다. '.repeat(600)}))];
  const seen=[];
  const invoke=async wire=>{seen.push(JSON.parse(wire[1].content).previousAnswers||[]);return {content:JSON.stringify({intent:{goal:'목표',constraints:[],outcomes:['결과'],workflowIds:[],skillPaths:[]},steps:[{text:'확인',expected_outcome:'확인됨',status:'in_progress'}]}),calls:[]};};
  const plan=model=>prepareWorkPlan({task:{request:'요청',criteria:[],messages},history:[],model,invoke,signal:new AbortController().signal,capabilities:{workflows:[],skills:[]}});
  await plan({contextLength:272000});
  assert.equal(seen[0].length,5);assert.ok(seen[0][4].startsWith('다섯째'));assert.ok(seen[0].every(text=>text.length===4000));
  await plan({contextLength:22000});
  assert.ok(seen[1].length>=1&&seen[1].length<=3,'answers in a small window: '+seen[1].length);
  assert.ok(seen[1].at(-1).startsWith('다섯째'),'the newest first');assert.ok(seen[1].every(text=>text.length<=800));
});

// E5 (S27, 2026-10-01): the run that read the failed command planned from the request alone and made running that
// command again its only goal. The planner of such a run sees the command, how it ended and a wrong command.
test('a run that reads an ended command plans from it, and a wrong command keeps the result the user asked for',async()=>{
  const {prepareWorkPlan}=await import('../runtime/work-plan.mjs');
  const capabilities={workflows:[{id:'knowledge'}],skills:[]},task={request:'npm run test:discount 로 할인 검사만 돌려서 결과를 알려 줘.',criteria:[],questionHistory:[]};
  const plan={intent:{goal:'할인 검사 결과를 알린다',constraints:['코드를 고치지 않는다'],outcomes:['할인 검사 결과'],workflowIds:[],skillPaths:[]},steps:[{text:'고친 명령 제안',expected_outcome:'할인 검사 결과',status:'in_progress'}]};
  const recovery={script:'npm run test:discount',state:'failed',exitCode:1,commandProblem:{kind:'missing_script',detail:'test:discount'}};
  let seen;
  await prepareWorkPlan({task,history:[],recovery,model:{contextLength:200000},capabilities,signal:new AbortController().signal,invoke:async messages=>{seen=JSON.parse(messages[1].content);return {content:JSON.stringify(plan),calls:[]};}});
  assert.deepEqual(seen.recovery,recovery);
  await prepareWorkPlan({task,history:[],model:{contextLength:200000},capabilities,signal:new AbortController().signal,invoke:async messages=>{seen=JSON.parse(messages[1].content);return {content:JSON.stringify(plan),calls:[]};}});
  assert.equal('recovery' in seen,false,'an ordinary run has none');
  assert.match(WORK_PLAN_PROMPT,/When it names a commandProblem, the command was wrong and its work has not run, so keep the result the user asked for as the goal and plan the corrected command/);
});

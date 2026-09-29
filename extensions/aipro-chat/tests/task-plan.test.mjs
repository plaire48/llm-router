import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPlan, normalizePlan, taskProgress, updateTaskPlan, planDifference} from '../task-plan.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {taskReceipt, pauseTask} from '../context-state.js';

const plan = [{text: '신청 조건 확인', status: 'in_progress'}, {text: '요청 내용 확인', status: 'pending'}];
const tools = browserTools({}, BUILTIN_SKILLS[0]);
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const base = () => ({messages: [{role: 'user', content: '신청 조건을 확인해줘'}], signal: new AbortController().signal, tools, harness: true});

test('three steps close only after outcome review and exact persistence, before final answer review', async () => {
  const steps = [...plan, {text: '출처와 결과 정리', status: 'pending'}], order = [];
  let round = 0, saved;
  const result = await runAgent({...base(), resumePlan: steps,
    complete: async () => ++round === 1 ? {calls:[call('read_page')]} : {content:'조건과 출처입니다.'},
    execute: async (name, args) => {order.push(name);if(name==='update_plan'){saved=JSON.parse(JSON.stringify(args.steps));return {ok:true,plan:saved};}return {ok:true,text:'확인한 조건과 출처'};},
    reviewGoal: async ({phase,stepOutcomes,answer}) => {order.push(phase||'final');assert.equal(answer,'조건과 출처입니다.');if(phase==='plan_step'){assert.equal(stepOutcomes.length,1);assert.equal(stepOutcomes[0].text,steps[order.filter(x=>x==='plan_step').length-1].text);assert(stepOutcomes.every(s=>s.expected_outcome));}else assert(saved.every(s=>s.status==='completed'));return {status:'complete'};}});
  assert.equal(result.content,'조건과 출처입니다.');
  assert.deepEqual(order,['read_page','plan_step','update_plan','plan_step','update_plan','plan_step','update_plan','final']);
  assert.equal(taskProgress({plan:saved,status:'done',goalReview:{status:'complete'}}).plan.filter(s=>s.status==='completed').length,3);
});

test('failed plan persistence suppresses the answer and never reaches final review', async () => {
  for (const receipt of [{error:'storage_failed'},{ok:true,plan:plan.map(s=>({...s,status:'completed'})).slice(0,1)}]) {
    let round=0;
    await assert.rejects(runAgent({...base(),resumePlan:plan,
      complete:async()=>++round===1?{calls:[call('read_page')]}:{content:'완료'},
      execute:async name=>name==='update_plan'?receipt:{ok:true,text:'관찰'},
      reviewGoal:async ({phase})=>{assert.equal(phase,'plan_step');return {status:'complete'};}}),error=>error.message==='plan_failed'&&error.suppressPartial);
  }
});

test('a blocked remaining step preserves counts and waits without a false final answer', async () => {
  let round=0;
  const result=await runAgent({...base(),resumePlan:[{...plan[0],status:'completed'},plan[1]],
    complete:async()=>++round===1?{calls:[call('read_page')]}:{content:'완료'},
    execute:async name=>{assert.notEqual(name,'update_plan');return name==='ask_user'?{requiresUserInput:true}:{ok:true,text:'관찰'};},
    reviewGoal:async ({phase,stepOutcomes})=>{assert.equal(phase,'plan_step');assert.equal(stepOutcomes.length,1);return {status:'blocked',next_step:'필수 사용자 선택을 확인하세요.',checks:[]};}});
  assert.equal(result.awaitingUser,true);
});

test('plan revisions distinguish changed scope, criteria, order and real progress without losing prior steps', () => {
  let task = updateTaskPlan({status:'running'}, plan, undefined, 1);
  assert.equal(task.planUpdates.length, 1);
  assert.equal(updateTaskPlan(task, plan, 'Repeated explanation', 2), task);
  const next = [{...plan[0],status:'completed'}, {text:'서류별 신청 요건 확인',status:'in_progress',expected_outcome:'필수 서류와 적용 조건 확인'}];
  task = updateTaskPlan(task, next, '신청 화면에서 추가 서류 조건을 확인했습니다.', 3);
  const diff = planDifference(task.planUpdates.at(-1).before, next);
  assert.equal(diff.added[0].text, next[1].text);assert.equal(diff.removed[0].text,plan[1].text);
  assert.equal(diff.completed[0].text,plan[0].text);
  assert.equal(taskProgress(task).updates.at(-1).reason,'신청 화면에서 추가 서류 조건을 확인했습니다.');
  assert.equal(planDifference(next, [...next].reverse()).reordered, true);
  assert.equal(planDifference(next, next.map(s=>({...s,status:'pending'}))).revised, false);
  assert.equal(planDifference(next, next.map(s=>({...s,expected_outcome:'현재 화면에 보이는 결과 확인'}))).criteria.length,2);
  assert.equal(updateTaskPlan(task, [], 'invalid'), null);
});

test('plan history is bounded, serializable, redacted and preserved through pauses and completion review', () => {
  let task = {status:'running'};
  for(let n=0;n<12;n++)task=updateTaskPlan(task,[{text:`확인 단계 ${n}`,status:'in_progress'}], 'Bearer SECRET', n);
  assert.equal(task.planUpdates.length,8);assert.equal(task.planUpdates[0].revision,5);
  const restored=JSON.parse(JSON.stringify(task));
  assert(!JSON.stringify(taskProgress(restored)).includes('SECRET'));
  assert.deepEqual(taskProgress({...restored,status:'paused'}).updates,taskProgress(restored).updates);
  assert.equal(taskProgress({...restored,status:'done'}).status,'paused');
  assert.equal(taskProgress({...restored,status:'done',goalReview:{status:'complete'}}).plan[0].status,'in_progress');
  assert.equal(taskProgress({...restored,status:'done',goalReview:{status:'complete'}}).status,'paused');
});

test('planning can ask the missing requirement before any proposed action', async () => {
  const question = {question: '어느 팀을 선택할까요?', choices: [{label: '개발팀'}, {label: '디자인팀'}]};
  const executed = [];
  const result = await runAgent({...base(), preparePlan: async () => ({question}),
    complete: async () => ({calls: [call('read_page'), call('fill_form', {fields: [{field_id: 'guess', value: 'guess'}]})]}),
    execute: async (name, args) => {executed.push(name); assert.deepEqual(args, question); return {requiresUserInput: true};}});
  assert.deepEqual(executed, ['ask_user']); assert.equal(result.awaitingUser, true);
});

test('missing model plan is prepared and saved before any real tool and is linked to its trace', async () => {
  const order = [], trace = []; let round = 0;
  await runAgent({...base(), preparePlan: async () => {order.push('prepare'); return plan;}, onStep: step => trace.push(step),
    complete: async () => ++round === 1 ? {calls: [call('read_page')]} : {content: '확인했습니다.'},
    execute: async (name, args) => {order.push(name); return name === 'update_plan' ? {ok: true, plan: args.steps} : {ok: true, frames: []};}});
  assert.deepEqual(order, ['prepare', 'update_plan', 'read_page']);
  assert.equal(trace.find(step => step.tool === 'read_page').planStep, plan[0].text);
});

test('an initial plan supplied after a tool is moved before it without a second planner request', async () => {
  const order = []; let round = 0;
  await runAgent({...base(), preparePlan: async () => assert.fail('Plan already supplied'),
    complete: async () => ++round === 1 ? {calls: [call('read_page'), call('update_plan', {steps: plan.map(step => ({...step, status: 'completed'}))})]} : {content: '확인했습니다.'},
    execute: async (name, args) => {order.push(name); if (name === 'update_plan') {assert.equal(args.steps[0].status, 'in_progress'); assert.equal(args.steps[1].status, 'pending');} return {ok: true, plan: args.steps};}});
  assert.deepEqual(order, ['update_plan', 'read_page']);
});

test('planning failure or cancellation never dispatches the proposed page action', async () => {
  for (const cancel of [false, true]) {
    const options = base(), controller = new AbortController();
    await assert.rejects(runAgent({...options, signal: controller.signal,
      preparePlan: async () => {if (cancel) {controller.abort(); return plan;} throw new Error('plan_failed');},
      complete: async () => ({calls: [call('read_page')]}), execute: () => assert.fail('No action before plan')}), cancel ? /cancelled/ : /plan_failed/);
  }
});

test('ordinary conversation and questions do not invent a task plan or perform page work', async () => {
  for (const question of [false, true]) {
    await runAgent({...base(), preparePlan: () => assert.fail('No task yet'),
      complete: async () => question ? {calls: [call('read_page'), call('ask_user', {question: '어느 페이지인가요?'})]} : {content: '안녕하세요.'},
      execute: async name => {assert.equal(name, 'ask_user'); return {requiresUserInput: true};}});
  }
});

test('failed plan persistence blocks all dependent calls and a resumed plan keeps its current step', async () => {
  let round = 0; const executed = [];
  await runAgent({...base(), preparePlan: async () => plan,
    complete: async () => ++round === 1 ? {calls: [call('read_page')]} : {content: '저장 실패'},
    execute: async name => {executed.push(name); return {error: 'storage_failed'};}});
  assert.deepEqual(executed, ['update_plan']);
  round = 0;
  const trace = [], resumed = [{...plan[0], status: 'completed'}, {...plan[1], status: 'in_progress'}];
  await runAgent({...base(), resumePlan: resumed, preparePlan: () => assert.fail('Keep resumed plan'), onStep: step => trace.push(step),
    complete: async () => ++round === 1 ? {calls: [call('read_page')]} : {content: '완료'}, execute: async () => ({ok: true})});
  assert.equal(trace[0].planStep, plan[1].text);
});

test('completion requires review while pause and questions retain unfinished steps without false checkmarks', () => {
  let task = {status: 'running', plan, steps: []};
  task = taskReceipt(task, 'read_page', 'start');
  assert.equal(task.steps[0].planStep, plan[0].text);
  assert.equal(taskProgress(pauseTask(task)).status, 'paused');
  assert.equal(taskProgress({...task, status: 'awaiting_user'}).plan[1].status, 'pending');
  const premature = {...task, plan: plan.map(step => ({...step, status: 'completed'}))};
  assert.equal(taskProgress(premature).plan.at(-1).status, 'completed');
  assert.equal(taskProgress({...premature, status: 'done'}).status, 'paused');
  assert.equal(taskProgress({...task, status: 'done', goalReview: {status: 'complete'}}).status, 'paused');
  assert.equal(taskProgress({...premature, status: 'done', goalReview: {status: 'complete'}}).status, 'done');
  assert.equal(task.plan[0].status, 'in_progress');
  assert.equal(normalizePlan([{text: ' ', status: 'pending'}]), null);
  assert.deepEqual(initialPlan(plan), plan);
});

test('public action labels follow execution and never change operation arguments or duplicate-write protection', async () => {
  const trace = [], actions = []; let round = 0;
  await runAgent({...base(), resumePlan: plan, onStep: step => trace.push(step), complete: async messages => {
    round++;
    if (round < 3) return {content: round === 1 ? '제목 입력란을 확인했습니다. 초안을 반영하겠습니다.' : '', reasoning: 'PRIVATE_REASONING', calls: [call('fill_form', {fields: [{field_id: 'observed', value: '교육'}], progress: round === 1 ? '교육 제목 입력' : '다른 설명으로 중복 시도'})]};
    if (round === 3) {assert.equal(JSON.parse(messages.at(-1).content).error, 'action_already_handled'); return {calls: [call('verify_page', {checks: [{kind: 'text_present', expected: '교육'}], progress: '입력한 제목 확인'})]};}
    return {content: '확인했습니다.'};
  }, execute: async (name, args) => {assert(!Object.hasOwn(args, 'progress')); actions.push(name); return {ok: true, verified: true, applied: 1};}});
  assert.deepEqual(actions, ['fill_form', 'verify_page']);
  assert.equal(trace.find(step => step.tool === 'progress_note').content, '제목 입력란을 확인했습니다. 초안을 반영하겠습니다.');
  assert(!JSON.stringify(trace).includes('PRIVATE_REASONING'));
  assert.deepEqual(trace.filter(step => step.label === '교육 제목 입력').map(step => step.status), ['running', 'done']);
});

test('a report submitted alongside plan closure reaches step review without extra browser rereads',async()=>{
  const initial=[{text:'자료 확인',expected_outcome:'출처에서 두 값을 읽음',status:'in_progress'}, {text:'결과 정리',expected_outcome:'두 값의 합계와 출처를 답변에 포함',status:'pending'}];
  const draft='첫째 5명, 둘째 9명으로 총 14명입니다. 출처: https://example.test/list';
  let round=0,reads=0,stepReviews=0,finalReviews=0;
  const result=await runAgent({...base(),resumePlan:initial,
    complete:async()=>{round++;assert(round<=3);return round===1?{calls:[call('read_page')]}:round===2?{content:draft,calls:[call('update_plan',{steps:initial.map(s=>({...s,status:'completed'}))})]}:{content:draft};},
    execute:async(name,args)=>{if(name==='read_page'){reads++;return {ok:true,text:'첫째 5명 둘째 9명',url:'https://example.test/list'};}assert.equal(name,'update_plan');return {ok:true,plan:args.steps};},
    reviewGoal:async({phase,answer,evidence})=>{assert.equal(answer,draft);assert(evidence.some(e=>e.tool==='read_page'));if(phase==='plan_step')stepReviews++;else finalReviews++;return {status:'complete'};}});
  assert.equal(result.content,draft);assert.equal(reads,1);assert.equal(stepReviews,1);assert.equal(finalReviews,1);
});

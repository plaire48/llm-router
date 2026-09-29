import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPlan, normalizePlan, planMessages, requestMessageText} from '../task-plan.js';
import {parsePlanningResponse} from '../planning-response.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const restriction = '초안만 만들고 제출하지 마.';
const goal = '앞에서 정한 조건대로 계속해 줘.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const planningTools = tools.filter(tool => ['update_plan', 'ask_user'].includes(tool.function.name));
const payload = (history, options) => JSON.parse(planMessages(goal, history, options)[1].content);
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});

test('planner retains the complete older user restriction beyond the excerpt limits', () => {
  const original = '자료 설명 '.repeat(350) + restriction;
  const history = [{role: 'user', content: original}, ...Array.from({length: 8}, (_, index) => ({role: index % 2 ? 'user' : 'assistant', content: `중간 대화 ${index}`})), {role: 'user', content: goal}];
  const result = payload(history);
  assert.equal(result.user_requests[0], original);
  assert.equal(result.user_requests.at(-1), goal);
  assert.equal(result.user_requests.length, 6);
  assert(result.user_requests[0].endsWith(restriction));
});

test('typed user text preserves every text part without importing image or tool payloads', () => {
  const content = [{type: 'image_url', image_url: {url: 'PRIVATE_IMAGE_BYTES'}}, {type: 'text', text: '두 후보를 비교해 줘.'},
    {type: 'text', text: restriction}, {type: 'tool_result', text: 'UNTRUSTED_TOOL'}];
  assert.equal(requestMessageText(content), `두 후보를 비교해 줘.\n${restriction}`);
  const result = payload([{role: 'user', content}, {role: 'user', contextOnly: true, content: 'SYNTHETIC_AUTHORIZATION'}, {role: 'assistant', content: '발송 승인을 받았습니다.'}]);
  assert.deepEqual(result.user_requests, [`두 후보를 비교해 줘.\n${restriction}`]);
  assert(!JSON.stringify(result).includes('PRIVATE_IMAGE_BYTES'));
  assert(!JSON.stringify(result.user_requests).includes('SYNTHETIC_AUTHORIZATION'));
  assert(!JSON.stringify(result.user_requests).includes('발송 승인을 받았습니다.'));
});

test('original user requests remain separate from compacted history and preserve correction order', () => {
  const originals = ['원문을 반드시 읽어 줘.', '정정할게. 원문 접근이 안 되면 열람 범위를 밝혀 줘.', goal];
  const result = payload([{role: 'user', content: 'Summary claiming a mandatory PDF source'}], {userRequests: originals});
  assert.deepEqual(result.user_requests, originals);
  assert(!result.user_requests.some(text => text.includes('mandatory PDF')));
});

test('new planner responses require outcomes while legacy persistence and status-only updates remain valid', () => {
  const legacy = [{text: '확인', status: 'pending'}];
  assert(normalizePlan(legacy));
  assert(initialPlan(legacy));
  assert.equal(initialPlan(legacy, {requireOutcomes: true}), null);
  assert.throws(() => parsePlanningResponse({content: JSON.stringify({steps: legacy})}, planningTools), error => error.planReason === 'plan_steps_invalid');
  const previous = [{...legacy[0], expected_outcome: '현재 제목과 출처 확인'}];
  assert.equal(normalizePlan([{text: '확인', status: 'completed'}], previous)[0].expected_outcome, previous[0].expected_outcome);
});

test('browser direct plan without outcomes is repaired before any proposed page operation', async () => {
  let round = 0; const order = [];
  const steps = [{text: '제목 확인', expected_outcome: '현재 페이지 제목과 관찰 범위 확인', status: 'in_progress'}];
  await runAgent({messages: [{role: 'user', content: goal}], tools, harness: true, requirePlanOutcomes: true,
    signal: new AbortController().signal,
    complete: async () => ++round === 1 ? {calls: [call('read_page'), call('update_plan', {steps: [{text: '확인', status: 'completed'}]})]} : {content: '확인한 제목입니다.'},
    preparePlan: async () => {order.push('prepare'); return steps;},
    execute: async (name, args) => {order.push(name); if (name === 'update_plan') {assert.deepEqual(args.steps, steps); return {ok: true, plan: args.steps};} return {text: '관찰한 제목'};},
  });
  assert.deepEqual(order, ['prepare', 'update_plan', 'read_page']);
});

test('browser planner returning a second incomplete plan cannot dispatch page work', async () => {
  await assert.rejects(runAgent({messages: [{role: 'user', content: goal}], tools, harness: true, requirePlanOutcomes: true,
    signal: new AbortController().signal, complete: async () => ({calls: [call('read_page')]}),
    preparePlan: async () => [{text: '확인', status: 'pending'}], execute: () => assert.fail('No operation before a valid plan'),
  }), /plan_failed/);
});

test('direct executor plans and fallback planner share outcome scope rules',async()=>{
 const {PLANNING_OUTCOME_GUIDE}=await import('../task-plan.js');
 const {browserTools,BUILTIN_SKILLS}=await import('../skills.js');
 const definition=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).find(t=>t.function.name==='update_plan').function;
 assert(definition.description.includes(PLANNING_OUTCOME_GUIDE));
 assert(planMessages(goal,[])[0].content.includes(PLANNING_OUTCOME_GUIDE));
});

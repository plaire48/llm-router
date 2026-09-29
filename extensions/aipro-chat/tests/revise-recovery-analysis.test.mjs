import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'), 'QWEN3.8-27B-FP8-256K');
const goal = '최신 경기 후보를 확인하고 다른 출처와 비교해 줘. 자료가 없으면 확인한 범위와 미확인 출처를 밝혀 줘.';
const plan = [{text: '경기 후보 확인', expected_outcome: '현재 화면의 경기 식별 또는 확인한 범위와 미확인 사항 기록', status: 'in_progress'},
  {text: '다른 출처 비교', expected_outcome: '다른 출처를 읽고 결과와 미확인 사항 비교', status: 'pending'}];
const closing = plan.map((step, index) => ({...step, status: index ? 'in_progress' : 'completed'}));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const page = text => ({frames: [{frame: 0, url: 'https://example.org/sports', text}]});
const revise = () => ({status: 'revise', checks: [{requirement: '경기 식별', status: 'unknown', evidence_ids: []}], next_step: '경기 이름을 구체적으로 읽고 나머지 출처를 계속 확인하세요.'});
const base = () => ({messages: [{role: 'user', content: goal}], goal, tools, modelId: 'selected-model', harness: true,
  resumePlan: plan, signal: new AbortController().signal});
function advice(wire, childTools) {
  assert.deepEqual(childTools.map(tool => tool.function.name), ['read_analysis_evidence']);
  const brief = JSON.parse(wire[1].content);
  assert.match(wire[0].content, /Compare the failed tool input/);
  assert.match(brief.task, /미확인 출처/);
  assert.match(brief.task, /경기 이름을 구체적으로/);
  assert.equal(brief.evidence.length, 1);
  assert(brief.evidence_reads.length);
  return {content: JSON.stringify({status: 'complete', summary: '경기 이름의 구체적인 확인이 필요합니다.',
    findings: [{text: '현재 스포츠 화면은 읽었지만 경기 이름을 확인하지 못했습니다.', evidence_ids: brief.evidence.map(item => item.evidence_id)}],
    uncertainties: [], next_step: 'read_page로 경기 이름을 구체적으로 읽으세요.'})};
}

test('three rejected plan proposals get isolated advice before the leader reads missing evidence and completes the first step', async () => {
  let rounds = 0, reviews = 0, children = 0, reads = 0;
  const executed = [], trace = [];
  const result = await runAgent({...base(), onStep: step => trace.push(step),
    complete: async wire => {
      if (++rounds === 1) return call('read_page');
      if (rounds <= 4) return call('update_plan', {steps: closing});
      if (rounds === 5) {
        assert(JSON.stringify(wire).includes('Delegated analysis returned.'));
        return call('read_page', {query: '경기 이름'});
      }
      if (rounds === 6) return call('update_plan', {steps: closing});
      return {content: '경기 후보와 확인 범위를 읽었습니다.'};
    }, execute: async (name, args) => {
      executed.push(name);
      if (name === 'read_page') return page(++reads === 1 ? '대한민국 펜싱 스포츠 화면' : '대한민국 펜싱 김선수 대 이선수 경기');
      assert.equal(name, 'update_plan'); assert.deepEqual(args.steps, executed.filter(tool=>tool==='update_plan').length === 1 ? closing : plan.map(step=>({...step,status:'completed'})));
      return {ok: true, plan: args.steps};
    }, reviewGoal: async ({phase}) => phase !== 'plan_step' || ++reviews > 3 ? {status: 'complete'} : revise(),
    completeAnalysis: async (wire, childTools) => {children++; return advice(wire, childTools);}});
  assert.equal(children, 1); assert.equal(reviews, 5);
  assert.deepEqual(executed, ['read_page', 'read_page', 'update_plan', 'update_plan']);
  assert.equal(result.awaitingUser, undefined);
  assert(trace.some(step => step.tool === 'analysis_recovery' && step.analysis?.delivered));
});

test('the same plan and unchanged evidence receive only one repair assignment before an honest technical pause', async () => {
  let rounds = 0, children = 0; const questions = [];
  const result = await runAgent({...base(), complete: async () => ++rounds === 1 ? call('read_page') : call('update_plan', {steps: closing}),
    execute: async (name, args) => {
      if (name === 'read_page') return page('대한민국 펜싱 스포츠 화면');
      assert.equal(name, 'ask_user'); questions.push(args); return {requiresUserInput: true};
    }, reviewGoal: async () => revise(), completeAnalysis: async (wire, childTools) => {children++; return advice(wire, childTools);}});
  assert.equal(children, 1); assert.equal(result.awaitingUser, true);
  assert.equal(questions.length, 1); assert.match(questions[0].question, /같은 단계 결과를 검증하지 못했습니다/);
  assert.deepEqual(questions[0].choices.map(item => item.label), ['다시 확인', '중지']);
});

test('a blocked review immediately asks the actual user decision without a recovery analyst', async () => {
  let rounds = 0, children = 0; const questions = [];
  const result = await runAgent({...base(), complete: async () => ++rounds === 1 ? call('read_page') : call('update_plan', {steps: closing}),
    execute: async (name, args) => name === 'read_page' ? page('두 동명이인 경기') : (questions.push(args), {requiresUserInput: true}),
    reviewGoal: async () => ({status: 'blocked', checks: [{requirement: '선수 구분', status: 'unknown', evidence_ids: []}], next_step: '두 선수 중 어느 선수를 말씀하셨나요?'}),
    completeAnalysis: async () => {children++; assert.fail('Essential user information must not be guessed');}});
  assert.equal(children, 0); assert.equal(result.awaitingUser, true);
  assert.equal(questions[0].question, '두 선수 중 어느 선수를 말씀하셨나요?');
});

test('an uncertain action cannot bypass verification by launching plan recovery', async () => {
  let children = 0, reviews = 0; const executed = [];
  const result = await runAgent({...base(), resumeUncertainAction: true,
    complete: async (_wire, active) => active.length === 1 && active[0].function.name === 'ask_user'
      ? call('ask_user', {question: '앞선 동작의 현재 결과를 확인해 주세요.'}) : call('update_plan', {steps: closing}),
    execute: async name => {executed.push(name); return {requiresUserInput: true};},
    reviewGoal: async () => {reviews++; return revise();}, completeAnalysis: async () => {children++; assert.fail('No recovery bypass of an uncertain write');}});
  assert.equal(children, 0); assert.equal(reviews, 0); assert.deepEqual(executed, ['ask_user']); assert.equal(result.awaitingUser, true);
});

test('user steering cancels a queued plan-repair child before its obsolete advice is delivered', async () => {
  let rounds = 0, queued = false, changed = false, aborted = 0, start;
  const started = new Promise(resolve => {start = resolve;});
  const result = await runAgent({...base(), onStep: step => {if (step.tool === 'analysis_recovery' && step.status === 'queued') queued = true;},
    takeInput: async () => {if (!queued || changed) return null; await started; changed = true; return {text: '추가 비교를 중지하고 현재 화면만 설명해줘'};},
    complete: async wire => {
      if (++rounds === 1) return call('read_page');
      if (rounds <= 4) return call('update_plan', {steps: closing});
      assert(changed); assert(!JSON.stringify(wire).includes('Delegated analysis returned.'));
      if(rounds===5)return call('update_plan',{steps:[{text:'현재 화면 설명',status:'in_progress',expected_outcome:'현재 관찰 범위만 설명'}],explanation:'사용자가 추가 비교를 중지했습니다.'});
      return {content: '현재 화면만 설명합니다.'};
    }, execute: async (name,args) => {if(name==='update_plan'){assert(changed);return {ok:true,plan:args.steps};}assert.equal(name, 'read_page'); return page('대한민국 펜싱 스포츠 화면');},
    reviewGoal: async ({phase,stepOutcomes}) => {if(changed&&phase==='plan_step')assert.equal(stepOutcomes[0].text,'현재 화면 설명');return phase === 'plan_step' && !changed ? revise() : {status: 'complete'};},
    completeAnalysis: async (_wire, _tools, {signal}) => {
      start(); await new Promise((_, reject) => signal.addEventListener('abort', () => {aborted++; reject(Error('cancelled'));}, {once: true}));
    }});
  assert.equal(aborted, 1); assert.equal(result.content, '현재 화면만 설명합니다.');
});

test('without an analysis connection repeated revise proposals pause without inventing missing requirements', async () => {
  let rounds = 0; const questions = [];
  const result = await runAgent({...base(), complete: async () => ++rounds === 1 ? call('read_page') : call('update_plan', {steps: closing}),
    execute: async (name, args) => name === 'read_page' ? page('대한민국 펜싱 스포츠 화면') : (questions.push(args), {requiresUserInput: true}),
    reviewGoal: async () => revise()});
  assert.equal(result.awaitingUser, true); assert.match(questions[0].question, /검증하지 못했습니다/);
});

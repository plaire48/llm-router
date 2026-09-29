import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const goal = '검색 결과의 기사 한 건을 열어 제목과 본문에 있는 경기 결과를 알려줘. 제출하거나 계정을 변경하지 마.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const plan = [{text: '기사 본문 열기', status: 'in_progress', expected_outcome: '실제 기사 본문과 제목이 관찰됨'}];
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const search = {url: 'https://example.test/search', frames: [{frame: 0, url: 'https://example.test/search', text: '기사 후보 링크와 검색 결과', elements: [{ref: 'article-link', role: 'link', name: '펜싱 기사', href: 'https://example.test/article?id=17'}]}]};
const article = {url: 'https://example.test/article?id=17', frames: [{frame: 0, url: 'https://example.test/article?id=17', text: '펜싱 기사 본문. 대한민국 단체전 은메달.'}]};
const failure = observation => ({ok: false, verified: false, error: 'verification_failed', checks: [{kind: 'url_is', passed: false, reason: 'url_query_mismatch'}, {kind: 'text_present', passed: false}], observation});
const checks = [{kind: 'url_is', expected: article.url}, {kind: 'text_present', expected: '기사 본문'}];
const base = () => ({goal, messages: [{role: 'user', content: goal}], tools, harness: true, resumePlan: plan, signal: new AbortController().signal});

function advice(wire, selected) {
  assert.deepEqual(selected.map(tool => tool.function.name), ['read_analysis_evidence']);
  const brief = JSON.parse(wire[1].content);
  assert.match(brief.task, /Browser action issuance/);
  assert.match(brief.task, /제출하거나 계정을 변경하지 마/);
  assert.match(brief.constraints, /Do not browse, act/);
  assert.equal(brief.evidence.length, 2); assert.equal(brief.evidence_reads.length, 2);
  assert(brief.evidence_reads.some(read => JSON.stringify(read).includes('url_query_mismatch')));
  assert(brief.evidence_reads.some(read => JSON.stringify(read).includes('article?id=17')));
  return {content: JSON.stringify({status: 'complete', summary: '클릭 영수증은 있지만 현재 화면은 검색 결과입니다.',
    findings: [{text: '기사 링크를 클릭한 뒤에도 원문 URL과 본문 확인이 실패했습니다.', evidence_ids: brief.evidence.map(item => item.evidence_id)}],
    uncertainties: [], next_step: '관찰한 기사 링크 목적지를 새로 확인해 이동한 뒤 본문을 읽고 원래 조건을 검증하세요.'})};
}

async function fixture({recover = true, childFailure = false, noAnalyst = false, cancel = false, steering = false} = {}) {
  const controller = new AbortController(), executed = [], events = [], questions = [], briefs = [];
  let rounds = 0, children = 0, navigated = false, verified = false, reviews = 0, queued = false, changed = false, aborted = false, childStart;
  const started = new Promise(resolve => {childStart = resolve;});
  const options = {...base(), signal: controller.signal, onStep: event => {events.push(event); if (event.tool === 'analysis_recovery' && event.status === 'queued') queued = true;},
    takeInput: steering ? async () => {if (!queued || changed) return null; await started; changed = true; return {text: '경기 결과와 제목을 그대로 확인하되 발행일도 확인해줘.'};} : undefined,
    complete: async wire => {
      assert(++rounds < 18, 'worker IDs, DOM changes and candidate wording cannot renew technical recovery');
      if (rounds === 1) return call('browser_snapshot');
      if (rounds === 2) return call('click_element', {ref: 'article-link'});
      if (rounds === 3) return call('verify_page', {checks});
      if (children && !navigated && (!steering || children > 1)) {
        assert(JSON.stringify(wire).includes('Delegated analysis returned.'));
        return call('navigate_page', {url: article.url, new_tab: 'no'});
      }
      if (navigated && !verified && recover) return call('verify_page', {checks});
      if (navigated && !recover && rounds === 8) return call('verify_page', {checks});
      if (verified && rounds < 13 && !executed.includes('update_plan')) return call('update_plan', {steps: plan.map(step => ({...step, status: 'completed'}))});
      return {content: verified ? '기사 본문에서 대한민국 단체전 은메달을 확인했습니다.' : `본문 확인 전 후보 표현 ${rounds}`};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'browser_snapshot') return structuredClone(search);
      if (name === 'click_element') return {ok: true, actionIssued: true, observation: structuredClone(search),
        actionTargetReceipt: {dataKind: 'click_target_dispatch', status: 'observed', actionIssued: true, target: {role: 'link', href: article.url}}};
      if (name === 'navigate_page') {navigated = true; return {ok: true, observation: recover ? structuredClone(article) : {...structuredClone(search), frames: [{frame: 0, text: '동적으로 변경된 검색 결과와 새 worker 표기'}]}};}
      if (name === 'verify_page') {
        if (navigated && recover) {verified = true; return {ok: true, verified: true, checks: checks.map(check => ({kind: check.kind, passed: true})), observation: structuredClone(article)};}
        return failure(structuredClone(search));
      }
      if (name === 'update_plan') {assert(verified); return {ok: true, plan: args.steps};}
      assert.equal(name, 'ask_user'); questions.push(args); return {requiresUserInput: true};
    },
    reviewGoal: async ({phase, evidence}) => {
      reviews++; assert(verified, 'worker advice and dispatch cannot pass a plan or final gate');
      assert(evidence.some(item => item.tool === 'verify_page' && item.result.verified));
      return {status: 'complete'};
    }};
  if (!noAnalyst) options.completeAnalysis = async (wire, selected, {signal}) => {
    children++; briefs.push(JSON.parse(wire[1].content));
    if (cancel) {controller.abort(); throw Error('cancelled');}
    if (childFailure) throw Error('analysis_unavailable');
    if (steering && children === 1) {
      childStart(); await new Promise((_, reject) => signal.addEventListener('abort', () => {aborted = true; reject(Error('cancelled'));}, {once: true}));
    }
    if (steering) assert.match(JSON.parse(wire[1].content).task, /Actual user correction:.*발행일/);
    return advice(wire, selected);
  };
  const run = () => runAgent(options);
  return {run, executed, events, questions, briefs, state: () => ({rounds, children, reviews, verified, aborted, changed})};
}

test('exhausted browser verification gets one frozen diagnosis before actual navigation/check and first-step completion', async () => {
  const f = await fixture(); const result = await f.run();
  assert.equal(result.awaitingUser, undefined); assert.match(result.content, /은메달/);
  assert.deepEqual(f.executed, ['browser_snapshot', 'click_element', 'verify_page', 'navigate_page', 'verify_page', 'update_plan']);
  assert.equal(f.state().children, 1); assert.equal(f.state().reviews, 2);
  assert(f.events.some(event => event.tool === 'analysis_recovery' && event.analysis?.delivered));
});

test('changed DOM and worker advice cannot renew one diagnosis or clear verification debt', async () => {
  const f = await fixture({recover: false}); const result = await f.run();
  assert(result.awaitingUser); assert.equal(result.content, ''); assert.equal(f.state().children, 1); assert.equal(f.state().reviews, 0);
  assert(!f.executed.includes('update_plan')); assert.equal(f.questions.length, 1);
  assert.match(f.questions[0].question, /현재 결과를 검증하지 못했습니다/);
  assert.deepEqual(f.questions[0].choices.map(choice => choice.label), ['다시 확인', '중지']);
});

test('without an analyst connection the host asks a technical retry choice without asking the goal again', async () => {
  const f = await fixture({noAnalyst: true}); const result = await f.run();
  assert(result.awaitingUser); assert.equal(f.state().children, 0); assert.equal(f.state().reviews, 0);
  assert.deepEqual(f.questions[0].choices.map(choice => choice.label), ['다시 확인', '중지']);
  assert.deepEqual(f.executed, ['browser_snapshot', 'click_element', 'verify_page', 'ask_user']);
});

test('failed recovery delivery preserves the unverified work and offers one technical retry or stop', async () => {
  const f = await fixture({childFailure: true}); const result = await f.run();
  assert(result.awaitingUser); assert.equal(f.state().children, 1); assert.equal(f.state().reviews, 0);
  assert.deepEqual(f.executed, ['browser_snapshot', 'click_element', 'verify_page', 'ask_user']);
  assert.match(f.questions[0].question, /검증과 복구 분석/);
  assert.deepEqual(f.questions[0].choices.map(choice => choice.label), ['다시 확인', '중지']);
});

test('user cancellation during verification diagnosis never navigates, replays or asks a question', async () => {
  const f = await fixture({cancel: true}); await assert.rejects(f.run(), /cancelled/);
  assert.deepEqual(f.executed, ['browser_snapshot', 'click_element', 'verify_page']); assert.equal(f.questions.length, 0);
});

test('uncertain writes remain in their existing reconciliation path without a verification analyst', async () => {
  let children = 0; const executed = [];
  const result = await runAgent({...base(), resumeUncertainAction: true,
    complete: async (_wire, active) => active.length === 1 ? call('ask_user', {question: '앞선 미확정 동작의 현재 결과를 확인해 주세요.'}) : {content: '완료 선언 금지'},
    execute: async name => {executed.push(name); return {requiresUserInput: true};},
    completeAnalysis: async () => {children++; assert.fail('Unknown write is not an agent-retrievable missing article');}});
  assert(result.awaitingUser); assert.equal(children, 0); assert.deepEqual(executed, ['ask_user']);
});

for (const name of ['ask_user', 'request_approval']) test(`actual ${name} waits immediately without autonomous verification recovery`, async () => {
  let children = 0; const executed = [];
  const result = await runAgent({...base(), resumeVerification: true,
    complete: async () => name === 'ask_user' ? call(name, {question: '어느 기사인가요?'}) : call(name, {ref: 'save-button'}),
    execute: async tool => {executed.push(tool); return {requiresUserInput: true};},
    completeAnalysis: async () => {children++; assert.fail('Explicit user choice and consent stay pending');}});
  assert(result.awaitingUser); assert.equal(children, 0); assert.deepEqual(executed, [name]);
});

test('real user steering cancels obsolete diagnosis and the next revision preserves original and changed requirements', async () => {
  const f = await fixture({steering: true}); const result = await f.run();
  assert(f.state().changed); assert(f.state().aborted); assert.equal(f.state().children, 2);
  assert.match(f.briefs[1].task, /제출하거나 계정을 변경하지 마/);
  assert.match(f.briefs[1].task, /발행일도 확인/);
  assert.equal(result.awaitingUser, undefined); assert(f.state().verified);
});

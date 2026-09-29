import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewScopeMessages, parseReviewScope, requestReviewScope, planScopeApproved, scopeCorrectionMessages, REVIEW_SCOPE_PROMPT} from '../review-scope.js';
import {completeChat} from '../src/api.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {goalReviewPayload} from './fixtures/goal-review.mjs';
import {planCompletion} from './fixtures/task-plan.mjs';
import {createReviewExecution, projectReviewExecution} from '../review-execution.js';

const review = {status: 'revise', checks: [{requirement: '상위 1·2위 결과의 순위 확인', status: 'unknown', evidence_ids: []}], next_step: '상위 1·2위의 순위를 확인하세요.'};
const input = overrides => reviewScopeMessages({goal: '일반 결과 2개를 알려줘.', userHistory: ['광고를 제외해 줘.'], phase: 'final',
  answer: '일반 결과 A와 B입니다.', review, inputBudget: 16000, ...overrides});
const response = value => ({content: JSON.stringify(value), finishReason: 'stop'});
const repair = () => ({decision: 'repair_scope', correctionTarget: 'unknown', issues: [{target: 0, kind: 'new_rank', source: 'user', quote: '결과 2개', review_quote: '상위 1·2위'}]});

test('scope audit retains the same host dispatch evidence without creating an action verdict', () => {
  const ledger = createReviewExecution({taskStartObserved: true});
  ledger.record('navigate_page'); ledger.record('read_page');
  const executionEvidence = [{id: 9, tool: 'execution_receipt', usable: true, result: projectReviewExecution(ledger.snapshot())}];
  const scoped = input({executionEvidence});
  const wire = JSON.parse(scoped.messages[1].content);
  assert.deepEqual(wire.executionEvidence, executionEvidence);
  assert.deepEqual(wire.reviewTargets.find(item => item.target === 0).reviewAnchors, wire.review.checks[0].requirement.map(anchor => anchor.id));
  assert.deepEqual(wire.reviewTargets.find(item => item.target === 'next_step').reviewAnchors, wire.review.next_step.map(anchor => anchor.id));
  assert.deepEqual(wire.executionEvidence[0].result.absenceCertificates, ['no_click_input_or_script_tool_dispatched']);
  executionEvidence[0].result.calls[0].tool = 'fill_form';
  assert.equal(scoped.payload.executionEvidence[0].result.calls[0].tool, 'navigate_page');
  assert.equal(wire.executionEvidence[0].result.compliant, undefined);
  const resumed = createReviewExecution({taskStartObserved: false}); resumed.record('read_page');
  const unknown = input({executionEvidence: [{id: 9, tool: 'execution_receipt', usable: true, result: projectReviewExecution(resumed.snapshot())}]});
  assert.deepEqual(JSON.parse(unknown.messages[1].content).executionEvidence[0].result.absenceCertificates, []);
});

test('API scope auditor receives the exact execution receipt retained by the outcome reviewer', async t => {
  let verified = false;
  const testApi = await api(t, {audit: payload => {
    const receipt = testApi.reviews.at(-1).evidence.filter(item => item.tool === 'execution_receipt' && item.usable);
    assert(receipt.length > 0);
    assert.deepEqual(payload.executionEvidence, receipt);
    verified = true;
    return {decision: 'unknown', correctionTarget: 'unknown', issues: []};
  }});
  await testApi.run();
  assert(testApi.counts().audits > 0);
  assert.equal(verified, true);
});

test('scope audit validates exact original quote and actual target without approving a goal', () => {
  const scoped = input(); assert(scoped.messages[0].content.startsWith(REVIEW_SCOPE_PROMPT));
  assert.match(scoped.messages[0].content, /nubi_computer_time/);
  assert.deepEqual(parseReviewScope(response(repair()), scoped.payload), repair());
  for (const issue of [{...repair().issues[0], quote: '상위 2개'}, {...repair().issues[0], target: 3}, {...repair().issues[0], review_quote: '다른 조건'}]) {
    assert.throws(() => parseReviewScope(response({...repair(), issues: [issue]}), scoped.payload), /review_scope_failed/);
  }
  assert.throws(() => parseReviewScope(response({...repair(), status: 'complete'}), scoped.payload), /review_scope_failed/);
  assert.throws(() => parseReviewScope({...response(repair()), calls: [{}]}, scoped.payload), /review_scope_failed/);
  assert.throws(() => parseReviewScope({...response(repair()), finishReason: 'length'}, scoped.payload), /review_scope_failed/);
});

test('answer-only classification requires final revise and quoted candidate support for every nonmet check', () => {
  const scoped = input({answer: '과거 성남시청 소속입니다.', review: {...review, checks: [{requirement: '과거 소속 주장 근거', status: 'unknown', evidence_ids: []}]}});
  const answer = {decision: 'within_scope', correctionTarget: 'answer', issues: [{target: 0, kind: 'unsupported_answer_claim', source: 'answer', quote: '과거 성남시청 소속', review_quote: '과거 소속 주장'}]};
  assert.equal(parseReviewScope(response(answer), scoped.payload).correctionTarget, 'answer');
  for (const payload of [{...scoped.payload, phase: 'plan_step'}, {...scoped.payload, review: {...scoped.payload.review, status: 'blocked'}},
    {...scoped.payload, answer: '그런 주장은 하지 않았습니다.'}, {...scoped.payload, review: {...scoped.payload.review, checks: [...scoped.payload.review.checks, {requirement: '필수 소속 정보', status: 'unknown'}]}}]) {
    assert.throws(() => parseReviewScope(response(answer), payload), /review_scope_failed/);
  }
});

test('unclear action preconditions retain unknown and over-budget original text is never truncated', () => {
  assert.match(REVIEW_SCOPE_PROMPT, /required field.*target-safety.*approval/);
  assert.match(REVIEW_SCOPE_PROMPT, /candidate's unsupported claim legitimately requires proof or removal/);
  assert.deepEqual(parseReviewScope(response({decision: 'unknown', correctionTarget: 'unknown', issues: []}), input().payload),
    {decision: 'unknown', correctionTarget: 'unknown', issues: []});
  assert.throws(() => input({userHistory: ['literal request '.repeat(10000)], inputBudget: 2000}), error => error.scopeReason === 'scope_context_budget');
  const corrected = scopeCorrectionMessages({messages: [{role: 'system', content: 'Original rules'}, {role: 'user', content: 'Frozen source evidence'}]}, repair(), review);
  assert.equal(corrected[1].content, 'Frozen source evidence'); assert.match(corrected[0].content, /Do not automatically return complete/);
});

const skill = BUILTIN_SKILLS.find(item => item.id === 'browser-agent');
const tools = browserTools(null, skill, 'test', {autoConnect: true}).filter(tool => ['read_page', 'verify_page', 'ask_user'].includes(tool.function.name));
const call = name => ({content: '', tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: name === 'ask_user' ? JSON.stringify({question: '현재 결과로 계속 확인할까요?'}) : '{}'}}]});
const wireReply = message => new Response(JSON.stringify({choices: [{message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}}), {headers: {'Content-Type': 'application/json'}});

async function api(t, {audit, correctedComplete = true, cancel = false, auth = false, sameReview = false, history = [],
  goal = '일반 결과 2개를 알려줘.', initialReview, steering, correctedInvalid = false, rounds = 1} = {}) {
  const previous = {chrome: globalThis.chrome, fetch: globalThis.fetch}; t.after(() => Object.assign(globalThis, previous));
  const controller = new AbortController(), calls = [], stages = [], reviews = [], actions = [], metrics = [], diagnostics = [];
  let leader = 0, reviewCalls = 0, audits = 0, steered = false;
  globalThis.chrome = {runtime: {sendMessage: async () => ({ok: true})}, storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic-test-token', receivedAt: 1}})}}};
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    if (body.messages[0].content.startsWith(REVIEW_SCOPE_PROMPT)) {
      audits++; assert(!body.tools?.length); const wire = JSON.parse(body.messages[1].content);
      const decode = value => Array.isArray(value) ? value.length && value.every(part => typeof part?.id === 'string' && typeof part?.text === 'string') ? value.map(part => part.text).join('') : value.map(decode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)])) : value;
      const payload = decode(wire);
      assert(!payload.userHistory.some(value => /context_summary|GENERATED_SCOPE|ASSISTANT_SCOPE/.test(value)));
      if (cancel) {controller.abort(); throw Error('cancelled');}
      if (auth) return new Response('{}', {status: 401});
      const verdict = typeof audit === 'function' ? audit(payload, wire) : audit;
      return wireReply({content: typeof verdict === 'string' ? verdict : JSON.stringify(verdict || {decision: 'unknown', correctionTarget: 'unknown', issues: []})});
    }
    const payload = goalReviewPayload(body.messages);
    if (payload) {
      reviews.push(payload); reviewCalls++;
      const proof = payload.evidence.find(item => item.usable);
      if (reviewCalls > 1 && correctedInvalid) return wireReply({content: 'invalid correction JSON'});
      const value = reviewCalls > 1 && correctedComplete ? {status: 'complete', checks: [{requirement: '일반 결과 2개', status: 'met', evidence_ids: [proof.id]}], next_step: ''} : structuredClone(initialReview || review);
      if (sameReview) value.checks = [{requirement: '후보의 과거 소속 주장', status: 'unknown', evidence_ids: []}];
      return wireReply({content: JSON.stringify(value)});
    }
    if (++leader === 1) return wireReply(call('read_page'));
    // With several rounds each answer follows a fresh read, as a real lookup does.
    if (rounds > 1 && leader <= 2 * rounds && leader % 2 === 1) return wireReply(call('read_page'));
    if (leader > (rounds > 1 ? 2 * rounds : 2)) return wireReply(call('ask_user'));
    return wireReply({content: sameReview ? '과거 성남시청 소속입니다.' : leader === 2 ? '일반 결과 A와 B입니다.' : `일반 결과 A와 B입니다 (${leader}).`});
  };
  const run = () => completeChat({provider: 'aipro', modelId: 'test', model: {contextLength: 128000, maxInputTokens: 98304}, credentialReceivedAt: 1,
    skill, autoConnect: true, tools, messages: [...history, {role: 'user', content: goal}]}, controller.signal,
    undefined, undefined, undefined, undefined, async name => {actions.push(name); return name === 'read_page' ? {url: 'https://example.test/results', text: `일반 결과 A와 B, 원래 관찰한 출처${rounds > 1 ? ` ${actions.length}` : ''}`} : {requiresUserInput: true};}, event => stages.push(event), metric => metrics.push(metric), undefined, undefined,
    {takeInput: steering ? async () => {if (!actions.includes('read_page') || steered) return null; steered = true; return {text: steering};} : undefined,
      onAgentDiagnostic: event => diagnostics.push(event)});
  return {run, calls, stages, reviews, actions, metrics, diagnostics, counts: () => ({leader, reviewCalls, audits})};
}

test('API scope drift repairs only the reviewer once on identical evidence and independently revalidates completion', async t => {
  const testApi = await api(t, {audit: repair(), history: [{role: 'user', content: 'GENERATED_SCOPE', contextOnly: true}, {role: 'assistant', content: 'ASSISTANT_SCOPE'}]});
  assert.equal(await testApi.run(), '일반 결과 A와 B입니다.');
  assert.deepEqual(testApi.counts(), {leader: 2, reviewCalls: 2, audits: 1}); assert.deepEqual(testApi.actions, ['read_page']);
  assert.deepEqual(testApi.reviews[0], testApi.reviews[1]);
  assert(testApi.stages.some(event => event.label === '검토 범위 교정'));
  assert.equal(testApi.calls.filter(call => call.tools?.length).length, 2);
  assert.equal(testApi.metrics.filter(metric => metric.phase === 'report').length, 5);
  assert.equal(testApi.metrics.filter(metric => metric.phase === 'report' && metric.scope === 'review').length, 3);
  assert.deepEqual(testApi.diagnostics.find(event => event.phase === 'scope_review'), {kind: 'agent', phase: 'scope_review', scope: 'final', decision: 'repair_scope', correctionTarget: 'unknown', corrected: true});
});

test('common browser fixture routes a scope call separately from planning and outcome verdicts', () => {
  const control = planCompletion({messages: input().messages});
  assert(control.scopeAudit); assert(!Object.hasOwn(JSON.parse(JSON.stringify(control)), 'scopeAudit'));
  assert.deepEqual(JSON.parse(control.choices[0].message.content), {decision: 'unknown', correctionTarget: 'unknown', issues: []});
  assert.equal(goalReviewPayload(input().messages), null);
});

test('a corrected noncomplete review is preserved without recursive auditing or automatic promotion', async t => {
  const testApi = await api(t, {audit: repair(), correctedComplete: false});
  assert.equal(await testApi.run(), ''); assert.deepEqual(testApi.counts(), {leader: 3, reviewCalls: 2, audits: 1});
  assert.deepEqual(testApi.actions, ['read_page', 'ask_user']);
});

const executorReview = calls => {
  const feedback = calls.flatMap(call => call.messages).find(message => message.role === 'user' && message.content.startsWith('Independent requirement review found gaps.'));
  assert(feedback, 'the executor must receive the actual returned review');
  return JSON.parse(feedback.content.slice(feedback.content.indexOf('\n') + 1));
};

test('API returns validated answer-only classification to the executor without approving the answer', async t => {
  const audit = {decision: 'within_scope', correctionTarget: 'answer', issues: [{target: 0, kind: 'unsupported_answer_claim', source: 'answer', quote: '과거 성남시청 소속', review_quote: '후보의 과거 소속 주장'}]};
  const testApi = await api(t, {audit, sameReview: true});
  assert.equal(await testApi.run(), '');
  assert.equal(executorReview(testApi.calls).correctionTarget, 'answer');
  assert.equal(executorReview(testApi.calls).status, 'revise');
  assert.equal(testApi.diagnostics.find(event => event.phase === 'scope_review').correctionTarget, 'answer');
  assert.deepEqual(testApi.counts(), {leader: 3, reviewCalls: 1, audits: 1});
  assert.deepEqual(testApi.actions, ['read_page', 'ask_user']);
});

test('outcome reviewer cannot self-author answer-only classification when scope is unknown', async t => {
  const testApi = await api(t, {initialReview: {...review, correctionTarget: 'answer'}});
  await testApi.run(); assert(!Object.hasOwn(executorReview(testApi.calls), 'correctionTarget'));
});

test('actual steering and every literal text part remain user authority without generated context', async t => {
  const testApi = await api(t, {steering: '광고를 제외하고 제목만 간단하게 알려줘.',
    history: [{role: 'user', content: [{type: 'text', text: '첫 번째 실제 조건'}, {type: 'text', text: '두 번째 실제 조건'}]},
      {role: 'user', content: 'GENERATED_SCOPE', contextOnly: true}, {role: 'assistant', content: 'ASSISTANT_SCOPE'}],
    audit: payload => {
      assert.deepEqual(payload.userHistory, ['첫 번째 실제 조건', '두 번째 실제 조건', '일반 결과 2개를 알려줘.', '광고를 제외하고 제목만 간단하게 알려줘.']);
      assert.match(payload.goal, /사용자 변경 요청: 광고를 제외/);
      return {decision: 'unknown', correctionTarget: 'unknown', issues: []};
    }});
  await testApi.run(); assert.equal(testApi.counts().audits, 1);
});

test('read-only requested article navigation is scope-corrected on frozen evidence rather than forbidden as a write', async t => {
  const initialReview = {status: 'revise', checks: [{requirement: '읽기 전용이므로 기사 링크를 열지 않았는지 확인', status: 'unknown', evidence_ids: []}], next_step: '기사 링크를 열지 마세요.'};
  const testApi = await api(t, {goal: '기사 링크를 열어 제목을 알려줘. 읽기 전용으로 진행해.', initialReview,
    audit: payload => {
      assert.match(REVIEW_SCOPE_PROMPT, /Read-only research permits navigation, search input and opening information links/);
      assert.match(REVIEW_SCOPE_PROMPT, /explicit user prohibition on clicking or input/);
      assert.match(REVIEW_SCOPE_PROMPT, /approval bypass or replay of an uncertain action/);
      assert.equal(payload.goal, '기사 링크를 열어 제목을 알려줘. 읽기 전용으로 진행해.');
      return {decision: 'repair_scope', correctionTarget: 'unknown', issues: [{target: 0, kind: 'new_requirement', source: 'user', quote: '기사 링크를 열어', review_quote: '기사 링크를 열지 않았는지'}]};
    }});
  assert.equal(await testApi.run(), '일반 결과 A와 B입니다.');
  assert.deepEqual(testApi.reviews[0], testApi.reviews[1]);
  assert.deepEqual(testApi.counts(), {leader: 2, reviewCalls: 2, audits: 1});
  assert.deepEqual(testApi.actions, ['read_page']);
});

test('invalid corrected reviewer protocol retains the original gaps without automatic completion or a second scope repair', async t => {
  const testApi = await api(t, {audit: repair(), correctedInvalid: true});
  assert.equal(await testApi.run(), '');
  assert.deepEqual(executorReview(testApi.calls), review);
  assert.deepEqual(testApi.counts(), {leader: 3, reviewCalls: 2, audits: 1});
  assert(testApi.stages.some(event => event.label === '검토 범위 응답 미확인' && event.status === 'error'));
});

for (const audit of ['invalid JSON', {decision: 'unknown', correctionTarget: 'unknown', issues: []}]) test('unknown or malformed scope output preserves the original noncomplete verdict', async t => {
  const testApi = await api(t, {audit}); assert.equal(await testApi.run(), '');
  assert.equal(testApi.counts().reviewCalls, 1); assert.deepEqual(testApi.actions, ['read_page', 'ask_user']);
  if (typeof audit === 'string') assert(testApi.stages.some(event => event.tool === 'recover_model' && event.status === 'error'));
  else {
    assert(testApi.stages.some(event => event.label === '검토 범위 미확인' && event.status === 'done'));
    assert(!testApi.stages.some(event => event.tool === 'recover_model' && event.status === 'error'));
  }
});

for (const type of ['cancel', 'auth']) test(`scope auditor ${type} propagates immediately without replay or an executor question`, async t => {
  const testApi = await api(t, {[type]: true}); await assert.rejects(testApi.run(), /cancelled|unauthorized/);
  assert.deepEqual(testApi.actions, ['read_page']); assert.equal(testApi.counts().audits, 1);
  assert(testApi.stages.some(event => event.tool === 'recover_model' && event.status === (type === 'cancel' ? 'cancelled' : 'error')));
});

const anchorReply = wire => ({decision:'repair_scope',correctionTarget:'unknown',issues:[{
  target:0,kind:'new_rank',source_anchor:wire.goal[0].id,review_anchor:wire.review.checks[0].requirement[0].id,
}]});
const scopeWire = scoped => JSON.parse(scoped.messages[1].content);

test('host anchors preserve each full source once and reconstruct exact quotes rather than accepting model text',()=>{
  const goal='수량 2개, 순위 요구 없음. '+ '가'.repeat(225)+'🌐 끝. 원문 제한을 보존합니다.',
    scoped=input({goal}),wire=scopeWire(scoped),reply=anchorReply(wire);
  assert.equal(wire.goal.map(part=>part.text).join(''),goal);
  assert(wire.goal.every(part=>part.text.length<=240));
  assert(wire.goal.every(part=>!/[\uD800-\uDBFF]$/.test(part.text)));
  assert.equal(wire.userHistory[0].map(part=>part.text).join(''),'광고를 제외해 줘.');
  const parsed=parseReviewScope(response(reply),scoped.payload);
  assert.equal(parsed.issues[0].source,'user');
  assert.equal(parsed.issues[0].quote,wire.goal[0].text);
  assert.equal(parsed.issues[0].review_quote,review.checks[0].requirement);
  assert(!Object.hasOwn(parsed.issues[0],'source_anchor'));
  assert.equal(JSON.stringify(wire).split('원문 제한을 보존합니다.').length-1,1);
});

test('unknown, cross-audit, wrong-target and mixed source anchors are rejected with specific diagnostics',()=>{
  const scoped=input(),wire=scopeWire(scoped),fresh=scopeWire(input()),base=anchorReply(wire);
  for(const change of [
    r=>r.issues[0].source_anchor='unknown',
    r=>r.issues[0].source_anchor=fresh.goal[0].id,
    r=>r.issues[0].review_anchor=wire.review.next_step[0].id,
    r=>r.issues[0].source_anchor=wire.review.checks[0].requirement[0].id,
    r=>r.issues[0].review_anchor=wire.goal[0].id,
  ]) {const r=structuredClone(base);change(r);assert.throws(()=>parseReviewScope(response(r),scoped.payload),e=>e.scopeReason==='scope_anchor_invalid');}
  for(const extra of [{quote:'forged'},{source:'answer'},{review_quote:review.checks[0].requirement}]) {
    const r=structuredClone(base);Object.assign(r.issues[0],extra);
    assert.throws(()=>parseReviewScope(response(r),scoped.payload),e=>e.scopeReason==='scope_issue_invalid');
  }
});

test('incomplete, corrupted offsets and wrong-field anchors cannot become exact source quotes',()=>{
  for(const change of [a=>({...a,complete:false}),a=>({...a,text:a.text+'x'}),a=>({...a,start:-1}),a=>({...a,end:a.end-1}),a=>({...a,field:'answer'})]) {
    const scoped=input(),wire=scopeWire(scoped),id=wire.goal[0].id;
    scoped.payload.anchors.set(id,change(scoped.payload.anchors.get(id)));
    assert.throws(()=>parseReviewScope(response(anchorReply(wire)),scoped.payload),e=>e.scopeReason==='scope_anchor_invalid');
  }
});

test('source kinds derive from fixed fields and answer anchors cannot remove user requirements',()=>{
  const scoped=input({stepOutcomes:[{text:'결과 2개',expected_outcome:'두 결과의 제목과 링크'}]}),wire=scopeWire(scoped);
  const outcome=anchorReply(wire);outcome.issues[0].source_anchor=wire.stepOutcomes[0].expected_outcome[0].id;
  assert.equal(parseReviewScope(response(outcome),scoped.payload).issues[0].source,'outcome');
  const answer=anchorReply(wire);answer.issues[0].source_anchor=wire.answer[0].id;
  assert.throws(()=>parseReviewScope(response(answer),scoped.payload),e=>e.scopeReason==='scope_protocol_invalid');
  answer.decision='within_scope';answer.correctionTarget='answer';answer.issues[0].kind='unsupported_answer_claim';
  assert.equal(parseReviewScope(response(answer),scoped.payload).issues[0].source,'answer');
  answer.issues[0].source_anchor=wire.goal[0].id;
  assert.throws(()=>parseReviewScope(response(answer),scoped.payload),e=>e.scopeReason==='scope_answer_invalid');
});

test('legacy exact quotes remain valid and distinguish source, review, target and issue errors',()=>{
  const scoped=input();assert.deepEqual(parseReviewScope(response(repair()),scoped.payload),repair());
  for(const [extra,reason] of [[{quote:'not present'},'scope_source_quote_mismatch'],[{review_quote:'not present'},'scope_review_quote_mismatch'],[{target:99},'scope_target_invalid'],[{kind:'invented'},'scope_issue_invalid']]) {
    const r=repair();Object.assign(r.issues[0],extra);
    assert.throws(()=>parseReviewScope(response(r),scoped.payload),e=>e.scopeReason===reason);
  }
});

test('API anchors repair scope on the same original evidence without extra browser work or automatic completion',async t=>{
  const testApi=await api(t,{audit:(_payload,wire)=>anchorReply(wire)});
  assert.equal(await testApi.run(),'일반 결과 A와 B입니다.');
  assert.deepEqual(testApi.counts(),{leader:2,reviewCalls:2,audits:1});
  assert.deepEqual(testApi.reviews[0],testApi.reviews[1]);assert.deepEqual(testApi.actions,['read_page']);
  const correction=testApi.calls.find(call=>call.messages[0].content.includes('The scope auditor identified'));
  assert(correction);assert(correction.messages[0].content.includes('일반 결과 2개를 알려줘.'));
  assert(correction.messages[0].content.includes('Do not automatically return complete'));
});

test('API invalid anchors preserve gaps after one bounded protocol repair without hidden quote repair',async t=>{
  const testApi=await api(t,{audit:(_payload,wire)=>{const r=anchorReply(wire);r.issues[0].source_anchor='foreign';return r;}});
  assert.equal(await testApi.run(),'');assert.deepEqual(testApi.counts(),{leader:3,reviewCalls:1,audits:2});
  assert.equal(testApi.diagnostics.find(d=>d.phase==='scope_review').reason,'scope_anchor_invalid');
  assert.deepEqual(executorReview(testApi.calls),review);assert.deepEqual(testApi.actions,['read_page','ask_user']);
});


test('API repairs a foreign anchor against the same frozen payload before any replan or extra browser read',async t=>{
  let attempts=0;
  const testApi=await api(t,{audit:(_payload,wire)=>{const r=anchorReply(wire);if(++attempts===1)r.issues[0].review_anchor='foreign';return r;}});
  assert.equal(await testApi.run(),'일반 결과 A와 B입니다.');
  assert.deepEqual(testApi.counts(),{leader:2,reviewCalls:2,audits:2});
  assert.deepEqual(testApi.actions,['read_page']);
  const audits=testApi.calls.filter(call=>call.messages[0].content.startsWith(REVIEW_SCOPE_PROMPT));
  assert.deepEqual(audits[0].messages[1],audits[1].messages[1]);
  assert(audits[1].messages[0].content.includes('reviewTargets'));
  assert(testApi.stages.some(event=>event.label==='검토 형식 교정'));
});

test('plan scope protocol correction keeps the proposal bound and semantic rejection does not retry',async()=>{
  const proposed=[{text:'두 결과 확인',expected_outcome:'광고를 제외한 두 제목과 링크'}];
  const scoped=input({phase:'plan_scope',stepOutcomes:proposed,currentPlan:[{text:'순위 확인',expected_outcome:'첫째와 둘째 순위 확인'}]});
  let calls=0;const audit=await requestReviewScope(scoped,{inputBudget:16000,complete:async messages=>{
    calls++;
    if(calls===1)return response({decision:'repair_scope',correctionTarget:'external',issues:[{target:'plan0',kind:'new_rank',source_anchor:'foreign',review_anchor:'foreign'}]});
    assert.deepEqual(messages[1],scoped.messages[1]);
    return response({decision:'within_scope',correctionTarget:'external',issues:[]});
  }});
  assert.equal(calls,2);assert(planScopeApproved(audit,proposed));assert(!planScopeApproved(audit,[{text:'다른 목표'}]));
  calls=0;const rejected=await requestReviewScope(scoped,{inputBudget:16000,complete:async()=>{calls++;return response(repair());}});
  assert.equal(calls,1);assert(!planScopeApproved(rejected,proposed));
});

test('scope repair stays bounded, propagates cancellation/auth, and never converts invalid anchors into approval',async()=>{
  const scoped=input();let calls=0;
  await assert.rejects(requestReviewScope(scoped,{inputBudget:16000,complete:async()=>{calls++;return response({decision:'repair_scope',correctionTarget:'external',issues:[{target:0,kind:'new_rank',source_anchor:'foreign',review_anchor:'foreign'}]});}}),e=>e.scopeReason==='scope_anchor_invalid');
  assert.equal(calls,2);
  const controller=new AbortController();calls=0;
  await assert.rejects(requestReviewScope(scoped,{signal:controller.signal,inputBudget:16000,complete:async()=>{calls++;controller.abort();return response({});}}),/cancelled/);assert.equal(calls,1);
  calls=0;await assert.rejects(requestReviewScope(scoped,{inputBudget:16000,complete:async()=>{calls++;throw Error('unauthorized');}}),/unauthorized/);assert.equal(calls,1);
  calls=0;await assert.rejects(requestReviewScope(scoped,{inputBudget:1,complete:async()=>{calls++;return response({});}}),e=>e.scopeReason==='scope_context_budget');assert.equal(calls,1);
});

test('a verdict that leaves the review untouched drops its issue list instead of failing the audit',()=>{
  const scoped=input(),wire=scopeWire(scoped);
  const listed={decision:'within_scope',correctionTarget:'external',issues:[{target:'a9.99',kind:'invented',note:'MODEL_TEXT'}]};
  assert.deepEqual(parseReviewScope(response(listed),scoped.payload),{decision:'within_scope',correctionTarget:'external',issues:[]});
  const unsure={decision:'unknown',correctionTarget:'external',issues:anchorReply(wire).issues};
  assert.deepEqual(parseReviewScope(response(unsure),scoped.payload),{decision:'unknown',correctionTarget:'unknown',issues:[]});
  // repair_scope changes the review, so its citations stay strict.
  const weak=anchorReply(wire);weak.issues[0].kind='invented';
  assert.throws(()=>parseReviewScope(response(weak),scoped.payload),e=>e.scopeReason==='scope_issue_invalid');
});

test('a plan audit never turns a contradictory approval into plan approval',()=>{
  const proposed=[{text:'결과 2개',expected_outcome:'두 결과의 제목과 링크'}];
  const scoped=input({phase:'plan_scope',stepOutcomes:proposed});
  const listed={decision:'within_scope',correctionTarget:'external',issues:[{target:0,kind:'new_rank',source:'user',quote:'결과 2개',review_quote:'상위 1·2위'}]};
  assert.throws(()=>parseReviewScope(response(listed),scoped.payload),e=>e.scopeReason==='scope_protocol_invalid');
  assert.throws(()=>parseReviewScope(response({decision:'unknown',correctionTarget:'external',issues:[]}),scoped.payload),e=>e.scopeReason==='scope_protocol_invalid');
});

test('an audit may not ask a plan to drop the approval before a final action',()=>{
  const plan=[{text:'두 칸에 4 입력',expected_outcome:'현재값이 식별되고 두 칸이 각각 4'},{text:'최종 반영 승인 후 실행',expected_outcome:'사용자 승인 뒤 페이지의 최종 반영이 완료됨'}];
  const scoped=input({phase:'plan_scope',goal:'두 칸에 4를 넣고 최종 반영해 줘.',userHistory:[],stepOutcomes:plan,currentPlan:plan});
  const approvalOnly={decision:'repair_scope',correctionTarget:'external',issues:[{target:'plan1',kind:'new_requirement',source:'user',quote:'최종 반영해 줘',review_quote:'사용자 승인 뒤'}]};
  assert.deepEqual(parseReviewScope(response(approvalOnly),scoped.payload),{decision:'within_scope',correctionTarget:'external',issues:[]});
  const mixed={decision:'repair_scope',correctionTarget:'external',issues:[{target:'plan0',kind:'new_requirement',source:'user',quote:'두 칸에 4',review_quote:'현재값이 식별되고'},...approvalOnly.issues]};
  const kept=parseReviewScope(response(mixed),scoped.payload);
  assert.equal(kept.decision,'repair_scope');assert.deepEqual(kept.issues.map(issue=>issue.target),['plan0']);
});

test('an answer classification without citations is withdrawn after one repair and reports counts only',async()=>{
  const scoped=input();let calls=0;const repairs=[];
  const audit=await requestReviewScope(scoped,{inputBudget:16000,onRepair:reason=>repairs.push(reason),
    complete:async()=>{calls++;return response({decision:'within_scope',correctionTarget:'answer',issues:[]});}});
  assert.equal(calls,2);assert.deepEqual(repairs,['scope_answer_invalid']);
  assert.deepEqual(audit,{decision:'within_scope',correctionTarget:'external',issues:[]});
  assert.equal(audit.withdrawn,'scope_answer_invalid');
  assert.throws(()=>parseReviewScope(response({decision:'within_scope',correctionTarget:'answer',issues:[{target:'next_step',kind:'MODEL_TEXT',source:'answer',quote:'일반 결과',review_quote:'순위'}]}),scoped.payload),error=>{
    assert.deepEqual(error.scopeShape,{decision:'within_scope',correctionTarget:'answer',issues:1,kinds:['other'],targets:['next_step'],anchored:0,extraKeys:0,nonmet:1,cited:0});
    assert(!JSON.stringify(error.scopeShape).includes('MODEL_TEXT'));
    return true;
  });
  // A plan audit keeps failing: there the verdict would approve the plan.
  const plan=input({phase:'plan_scope',stepOutcomes:[{text:'결과 2개',expected_outcome:'두 결과의 제목과 링크'}]});
  await assert.rejects(requestReviewScope(plan,{inputBudget:16000,complete:async()=>response({decision:'within_scope',correctionTarget:'answer',issues:[]})}),
    error=>error.scopeReason==='scope_answer_invalid');
});

// A model that could not follow the audit's reply format failed it at every
// review, two calls each time, while a failed audit changes nothing.
test('after two failed audits in a row the run stops asking for the audit', async t => {
  const testApi = await api(t, {audit: 'not json', correctedComplete: false, rounds: 4});
  await testApi.run();
  const {reviewCalls, audits} = testApi.counts();
  assert(reviewCalls >= 3, JSON.stringify(testApi.counts()));
  const scope = testApi.diagnostics.filter(event => event.phase === 'scope_review');
  assert(scope.slice(0, 2).every(event => event.reason && event.reason !== 'scope_skipped'), JSON.stringify(scope));
  assert(scope.slice(2).every(event => event.reason === 'scope_skipped'), JSON.stringify(scope));
  assert.equal(scope.length, reviewCalls);
  assert(audits <= 4, `audits ${audits}`);
});

test('a successful audit starts the failure count again', async t => {
  let call = 0;
  const testApi = await api(t, {audit: () => (++call === 3 ? {decision: 'unknown', correctionTarget: 'unknown', issues: []} : 'not json'), correctedComplete: false, rounds: 4});
  await testApi.run();
  const reasons = testApi.diagnostics.filter(event => event.phase === 'scope_review').map(event => event.reason || 'ok');
  assert.equal(reasons.filter(reason => reason === 'scope_skipped').length <= Math.max(0, reasons.length - 3), true, JSON.stringify(reasons));
  // The first review's audit and its repair fail, the second review's audit succeeds.
  assert.notEqual(reasons[0], 'ok'); assert.equal(reasons[1], 'ok'); assert.notEqual(reasons[2], 'scope_skipped');
});

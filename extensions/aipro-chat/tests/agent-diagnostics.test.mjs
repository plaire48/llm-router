import test from 'node:test';
import assert from 'node:assert/strict';
import {agentDiagnostic, verificationDiagnostic} from '../completion-errors.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const base = () => ({messages: [{role: 'user', content: '제목 확인'}], tools, harness: true, signal: new AbortController().signal});
test('verification diagnostics distinguish a failed check without retaining its private values or model strings', () => {
  assert.deepEqual(verificationDiagnostic({checks:[
    {kind:'url_is',passed:false,expected:'PRIVATE_URL',reason:'PRIVATE_REASON',ref:'PRIVATE_REF'},
    {kind:'field_value',passed:false,reason:'check_target_incompatible',value:'PRIVATE_VALUE'},
    {kind:'text_present',passed:true,actual:'PRIVATE_TEXT'},
    {kind:'PRIVATE_KIND',passed:false},{kind:'url_is',passed:'unknown'}]}),[
    {kind:'url_is',passed:false},{kind:'field_value',passed:false,reason:'check_target_incompatible'},
    {kind:'text_present',passed:true}]);
  assert.deepEqual(verificationDiagnostic({}),[]);
});
test('session diagnostics keep typed outcomes and review counts without source, answer, credentials or reviewer text', () => {
  const value = agentDiagnostic({kind: 'agent', phase: 'review_result', scope: 'final', status: 'revise',
    checks: [{requirement: 'secret title', status: 'met', evidence_ids: [1]}, {status: 'unknown'}, {status: 'unmet'}], nextStep: 'secret query', token: 'secret'});
  assert.deepEqual(value, {phase: 'review_result', scope: 'final', status: 'revise', met: 1, unmet: 1, unknown: 1});
  assert.equal(agentDiagnostic({kind: 'agent', phase: 'review_result', scope: 'secret', status: 'complete'}), null);
  assert.deepEqual(agentDiagnostic({kind: 'agent', phase: 'run_result', outcome: 'failed', code: 'secret_token', verification: 'passed', finishReason: 'secret'}),
    {phase: 'run_result', outcome: 'failed', code: 'response_invalid', verification: 'not_run', finishReason: 'unknown'});
  assert.equal(agentDiagnostic({kind: 'agent', phase: 'tool_result', error: 'secret'}), null);
});
test('scope review diagnostics retain only fixed classifications and never original quoted user or answer text', () => {
  assert.deepEqual(agentDiagnostic({kind: 'agent', phase: 'scope_review', scope: 'final', decision: 'repair_scope', correctionTarget: 'unknown', corrected: true,
    issues: [{quote: 'PRIVATE_USER_TEXT'}], answer: 'PRIVATE_ANSWER', reason: 'PRIVATE_REASON'}),
    {phase: 'scope_review', scope: 'final', decision: 'repair_scope', correctionTarget: 'unknown', corrected: true});
  assert.deepEqual(agentDiagnostic({kind: 'agent', phase: 'scope_review', scope: 'plan_step', decision: 'unknown', correctionTarget: 'unknown', corrected: false, reason: 'scope_context_budget'}),
    {phase: 'scope_review', scope: 'plan_step', decision: 'unknown', correctionTarget: 'unknown', corrected: false, reason: 'scope_context_budget'});
  for (const patch of [{decision: 'complete'}, {scope: 'PRIVATE_SCOPE'}, {correctionTarget: 'PRIVATE_TARGET'}, {corrected: 'true'}]) {
    assert.equal(agentDiagnostic({kind: 'agent', phase: 'scope_review', scope: 'final', decision: 'within_scope', correctionTarget: 'answer', corrected: false, ...patch}), null);
  }
});
test('final review success and plain model termination remain distinct in recorded outcomes', async () => {
  for (const harness of [false, true]) {
    let round = 0; const records = [];
    await runAgent({...base(), harness, onDiagnostic: value => records.push(value),
      complete: async () => ++round === 1 ? call('read_page') : {content: '제목', finishReason: 'stop'}, execute: async () => ({text: '제목'}), reviewGoal: async () => ({status: 'complete'})});
    const result = records.findLast(value => value.phase === 'run_result');
    assert.equal(result.outcome, 'answer'); assert.equal(result.verification, harness ? 'passed' : 'not_run'); assert.equal(result.finishReason, 'stop');
  }
});
test('waiting for user and authentication failure are not recorded as task completion', async () => {
  const records = [];
  const waiting = await runAgent({...base(), onDiagnostic: value => records.push(value), complete: async () => call('ask_user', {question: '어떤 제목인가요?'}), execute: async () => ({requiresUserInput: true})});
  assert(waiting.awaitingUser); assert.equal(records.at(-1).outcome, 'waiting_user');
  await assert.rejects(runAgent({...base(), onDiagnostic: value => records.push(value), complete: async () => {throw Error('unauthorized');}}), /unauthorized/);
  assert.equal(records.at(-1).outcome, 'failed'); assert.equal(records.at(-1).code, 'unauthorized');
});
test('diagnostic failure cannot discard a valid answer and cancellation during diagnostics still wins', async () => {
  const result = await runAgent({...base(), harness: false, complete: async () => ({content: '응답'}), onDiagnostic: () => {throw Error('telemetry unavailable');}});
  assert.equal(result.content, '응답');
  const controller = new AbortController(), records = [];
  await assert.rejects(runAgent({...base(), signal: controller.signal, harness: false, complete: async () => ({content: '응답'}),
    onDiagnostic: value => {records.push(value); if (value.phase === 'run_result' && value.outcome === 'answer') controller.abort();}}), /cancelled/);
  assert.equal(records.at(-1).outcome, 'cancelled');
});

 test('scope anchor diagnostics preserve fixed failure categories without quoted source text', () => {
  for (const reason of ['scope_issue_invalid','scope_target_invalid','scope_anchor_invalid','scope_review_quote_mismatch','scope_source_quote_mismatch']) {
    const event = agentDiagnostic({kind:'agent',phase:'scope_review',scope:'final',decision:'unknown',correctionTarget:'unknown',corrected:false,reason,quote:'PRIVATE_SOURCE'});
    assert.equal(event.reason,reason);assert(!JSON.stringify(event).includes('PRIVATE_SOURCE'));
  }
});

test('scope audit shape keeps fixed categories and counts and drops model-authored values', () => {
  const event = agentDiagnostic({kind:'agent',phase:'scope_review',scope:'final',decision:'unknown',correctionTarget:'unknown',corrected:false,reason:'scope_answer_invalid',
    shape:{decision:'within_scope',correctionTarget:'answer',issues:2,kinds:['unsupported_answer_claim','PRIVATE_KIND','other'],targets:['check','PRIVATE_TARGET'],anchored:1,extraKeys:0,nonmet:2,cited:1,quote:'PRIVATE_SOURCE'}});
  assert.deepEqual(event.shape,{decision:'within_scope',correctionTarget:'answer',issues:2,kinds:['unsupported_answer_claim','other'],targets:['check'],anchored:1,extraKeys:0,nonmet:2,cited:1});
  assert(!JSON.stringify(event).includes('PRIVATE'));
  const withdrawn = agentDiagnostic({kind:'agent',phase:'scope_review',scope:'final',decision:'within_scope',correctionTarget:'external',corrected:false,withdrawn:'scope_answer_invalid'});
  assert.equal(withdrawn.withdrawn,'scope_answer_invalid');
  for (const shape of [{decision:'within_scope',correctionTarget:'answer',issues:'2',kinds:[],targets:[],anchored:0,extraKeys:0,nonmet:0,cited:0}, 'PRIVATE', null]) {
    const dropped = agentDiagnostic({kind:'agent',phase:'scope_review',scope:'final',decision:'unknown',correctionTarget:'unknown',corrected:false,reason:'scope_issue_invalid',shape,withdrawn:'PRIVATE'});
    assert.equal(dropped.shape,undefined);assert.equal(dropped.withdrawn,undefined);
  }
});

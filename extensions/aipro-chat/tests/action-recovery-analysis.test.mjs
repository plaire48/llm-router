import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionRecoveryAnalysis} from '../action-recovery-analysis.js';
import {runAgent} from '../agent-runtime.js';

const failure = {name: 'click_element', signature: 'observed-target', result: {error: 'script_obscured', actionIssued: false}, evidenceId: 'ev_2'};
test('only repeated targeting failures delegate once, without uncertain-write or active-child overlap', () => {
  const routing = createActionRecoveryAnalysis();
  assert.equal(routing.assignment(failure), null);
  const job = routing.assignment(failure);
  assert.equal(job.role, 'recovery'); assert.equal(job.effort, 'quick');
  assert.deepEqual(job.evidence_ids, ['ev_2']);
  routing.accepted(job);
  assert.equal(routing.assignment(failure), null);
  for (const flag of ['uncertain', 'waiting', 'active']) {
    routing.reset(); assert.equal(routing.assignment(failure), null);
    assert.equal(routing.assignment({...failure, [flag]: true}), null);
    assert.equal(routing.assignment(failure).role, 'recovery');
  }
  routing.reset();
  for (const error of ['action_outcome_unknown', 'cancelled', 'unauthorized', 'verification_failed']) {
    assert.equal(routing.assignment({...failure, result: {error}}), null);
    assert.equal(routing.assignment({...failure, result: {error}}), null);
  }
});

test('a verified result starts a new failure window while unchanged diagnoses are not relaunched', () => {
  const routing = createActionRecoveryAnalysis();
  routing.assignment(failure);
  routing.assignment({name: 'verify_page', result: {verified: true}});
  assert.equal(routing.assignment(failure), null);
  const job = routing.assignment(failure); assert(job); routing.accepted(job);
  assert.equal(routing.assignment(failure), null);
  assert.equal(routing.assignment({...failure, signature: 'different-target'}), null);
  assert(routing.assignment({...failure, signature: 'different-target'}));
});

test('repeated browser targeting failure starts a real isolated analyst and delivers advice without a child action', async () => {
  const trace = [], actions = []; let parent = 0, children = 0;
  const call = (name, args) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
  const tools = [{type: 'function', function: {name: 'read_page', parameters: {type: 'object', properties: {}}}},
    {type: 'function', function: {name: 'click_element', parameters: {type: 'object', properties: {ref: {type: 'string'}}, required: ['ref']}}}];
  const result = await runAgent({messages: [{role: 'user', content: '관찰한 메뉴를 열어줘'}], tools, modelId: 'selected-model', signal: new AbortController().signal,
    onStep: step => trace.push(step), complete: async wire => {
      if (++parent <= 2) return call('click_element', {ref: 'observed-target'});
      if (parent === 3) return {content: '가려진 메뉴를 확인하고 있습니다.'};
      assert(JSON.stringify(wire).includes('Delegated analysis returned.'));
      return {content: '현재 가림 요소를 먼저 확인해야 합니다.'};
    }, execute: async name => {actions.push(name); assert.equal(name, 'click_element'); return failure.result;},
    completeAnalysis: async (wire, childTools) => {
      children++;
      assert.deepEqual(childTools.map(tool => tool.function.name), ['read_analysis_evidence']);
      const brief = JSON.parse(wire[1].content);
      assert.match(wire[0].content, /isolated recovery analyst/); assert.equal(brief.evidence.length, 1);
      assert.match(JSON.stringify(brief.evidence_reads), /script_obscured/);
      return {content: JSON.stringify({status: 'complete', summary: '가림 요소로 대상이 클릭되지 않았습니다.',
        findings: [{text: '새 화면에서 가림 요소와 실제 메뉴를 다시 확인해야 합니다.', evidence_ids: brief.evidence.map(item => item.evidence_id)}],
        uncertainties: [], next_step: '현재 화면의 가림 요소를 읽으세요.'})};
    }});
  assert.equal(children, 1);
  assert.deepEqual(actions, ['click_element', 'click_element']);
  assert.equal(result.content, '현재 가림 요소를 먼저 확인해야 합니다.');
  assert(trace.some(step => step.tool === 'analysis_recovery' && step.analysis?.delivered && step.analysis?.outcome === 'complete'));
});

test('a user correction cancels the automatic recovery child before old advice can be delivered', async () => {
  let parent = 0, queued = false, changed = false, aborted = 0, start;
  const started = new Promise(resolve => {start = resolve;});
  const tools = ['read_page', 'click_element'].map(name => ({type: 'function', function: {name,
    parameters: {type: 'object', properties: {ref: {type: 'string'}}}}}));
  const result = await runAgent({messages: [{role: 'user', content: '관찰한 메뉴 열기'}], tools, signal: new AbortController().signal,
    onStep: step => {if (step.tool === 'analysis_recovery' && step.status === 'queued') queued = true;},
    takeInput: async () => {if (!queued || changed) return null; await started; changed = true; return {text: '메뉴를 열지 말고 현재 화면만 설명해줘'};},
    execute: async () => failure.result,
    complete: async wire => {
      if (++parent <= 2) return {calls: [{id: crypto.randomUUID(), type: 'function', function: {name: 'click_element', arguments: JSON.stringify({ref: 'observed-target'})}}]};
      assert(changed); assert(!JSON.stringify(wire).includes('Delegated analysis returned.'));
      return {content: '현재 화면만 설명합니다.'};
    }, completeAnalysis: async (_wire, _tools, {signal}) => {
      start(); await new Promise((_, reject) => signal.addEventListener('abort', () => {aborted++; reject(Error('cancelled'));}, {once: true}));
    }});
  assert.equal(aborted, 1); assert.equal(result.content, '현재 화면만 설명합니다.');
});


test('queue rejection does not consume an attempt and stale acknowledgements cannot revive it after reset', () => {
  const routing = createActionRecoveryAnalysis();
  routing.assignment(failure);
  const rejected = routing.assignment(failure);
  const retry = routing.assignment(failure);
  assert(retry); routing.accepted(retry);
  assert.equal(routing.assignment(failure), null);
  routing.reset(); routing.accepted(rejected);
  assert.equal(routing.assignment(failure), null);
  assert(routing.assignment(failure));
});

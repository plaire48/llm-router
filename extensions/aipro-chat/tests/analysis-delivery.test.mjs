import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const report = (id = 'ev_1') => ({content: JSON.stringify({status: 'complete', summary: '담당 팀 확인', findings: [{text: '담당 팀은 개발팀입니다.', evidence_ids: [id]}], uncertainties: [], next_step: ''})});
const task = (role = 'page', evidence_ids = ['ev_1']) => ({role, task: '담당 팀을 확인하세요.', done_when: '근거 확보', evidence_ids});
const gate = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
const definition = name => ({type: 'function', function: {name, description: name, parameters: {type: 'object', properties: {}}}});
function setup(t, options, source = {text: '담당 팀 개발팀'}) {
  const value = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'QWEN3.8-27B-FP8-256K', run: runAgent,
    execute: async () => assert.fail('No browser action belongs to a child'), ...options});
  t.after(() => value.dispose());
  value.observe('read_page', {}, source);
  return value;
}

test('completed advice enters the next leader decision once, without waiting for another analyst', async () => {
  const fastDone = gate(), slowGate = gate();
  const rounds = {}, deliveries = []; let parentRound = 0;
  const result = await runAgent({messages: [{role: 'user', content: 'PRIVATE_PARENT_HISTORY'}], tools: [definition('read_page'), definition('browser_snapshot')],
    signal: new AbortController().signal,
    onStep: event => {if (event.tool === 'analysis_page' && event.status === 'done') fastDone.resolve();},
    completeAnalysis: async (wire, tools, scope) => {
      assert(!JSON.stringify(wire).includes('PRIVATE_PARENT_HISTORY'));
      rounds[scope.role] = (rounds[scope.role] || 0) + 1;
      if (rounds[scope.role] === 1) return call('read_analysis_evidence', {evidence_id: 'ev_1'});
      if (scope.role === 'review') await slowGate.promise;
      return report();
    },
    execute: async name => {
      if (name === 'browser_snapshot') await fastDone.promise;
      return {text: '담당 팀 개발팀'};
    },
    complete: async wire => {
      const messages = wire.filter(message => message.role === 'user' && String(message.content).startsWith('Delegated analysis returned.'));
      deliveries.push(messages.length);
      if (++parentRound === 1) return call('read_page');
      if (parentRound === 2) return call('delegate_analysis', {tasks: [task(), task('review')]});
      if (parentRound === 3) return call('browser_snapshot');
      if (parentRound === 4) {
        assert.equal(messages.length, 1, 'The leader receives finished advice before its next operation');
        const packet = JSON.parse(messages[0].content.split('\n').slice(1).join('\n'));
        assert.equal(packet.results[0].role, 'page');
        assert.equal(packet.pending[0].role, 'review');
        slowGate.resolve();
        return call('cancel_analysis', {task_id: packet.pending[0].task_id});
      }
      assert.equal(messages.length, 1, 'Already delivered advice is not appended repeatedly');
      return {content: '확인했습니다.'};
    }});
  assert.equal(result.content, '확인했습니다.');
  assert.deepEqual(deliveries.slice(3), [1, 1]);
});

test('equivalent briefs reuse work despite key order, evidence order and empty optional constraints', async t => {
  const ready = gate(); let calls = 0;
  const value = setup(t, {complete: async () => {calls++; await ready.promise; return {content: JSON.stringify({status: 'partial', summary: '추가 확인 필요', findings: [], uncertainties: [], next_step: ''})};}});
  value.observe('verify_page', {}, {verified: true});
  const first = await value.execute('delegate_analysis', {tasks: [task('page', ['ev_1', 'ev_2'])]});
  const second = await value.execute('delegate_analysis', {tasks: [{evidence_ids: ['ev_2', 'ev_1', 'ev_1'], constraints: '', done_when: '근거 확보', task: '담당 팀을 확인하세요.', role: 'page'}]});
  assert.equal(second.tasks[0].task_id, first.tasks[0].task_id);
  assert.equal(second.tasks[0].reused, true);
  ready.resolve(); await value.collect(); assert.equal(calls, 1);
});

test('scoped evidence search finds a late fact and returns source ranges without copying the full document', async t => {
  let calls = 0;
  const value = setup(t, {complete: async wire => {
    if (++calls === 1) return call('read_analysis_evidence', {evidence_id: 'ev_2', query: '승인 담당팀'});
    const read = JSON.parse(wire.at(-1).content);
    assert.match(read.text, /승인 담당팀은 개발팀/);
    assert(read.text.length <= 6000);
    assert(read.ranges.some(range => range.start > 30000));
    assert.equal(read.selection, 'query'); assert.equal(read.coverage, 'partial');
    return report('ev_2');
  }});
  value.observe('read_page', {}, {text: '일반 안내 '.repeat(7000) + '승인 담당팀은 개발팀입니다. 마감일은 10월 8일입니다.'});
  await value.execute('delegate_analysis', {tasks: [task('page', ['ev_2'])]});
  const result = (await value.collect()).results[0];
  assert.equal(result.status, 'done');
  assert(result.evidence[0].read_ranges.some(range => range.start > 30000));
  assert(result.evidence[0].read_excerpt.length <= 320);
  assert.match(result.evidence[0].read_excerpt, /승인 담당팀/);
  assert(!JSON.stringify(result).includes('일반 안내 '.repeat(200)));
});

test('an empty read cannot authorize a citation and viewport changes stale frozen advice', async t => {
  const value = setup(t, {complete: async wire => {
    const brief = JSON.parse(wire[1].content);
    if (!wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: 'ev_1', offset: brief.evidence[0].characters});
    return report();
  // None of the assignment's words occur in this source, so nothing is sent ahead of the read.
  }}, {text: '안내 문구 '.repeat(500), coverage: {partial: true}});
  await value.execute('delegate_analysis', {tasks: [task()]});
  const result = (await value.collect()).results[0];
  assert.equal(result.report.status, 'partial'); assert.equal(result.recovery.reason, 'analysis_format');
  assert.deepEqual(result.report.findings, []);
  assert.equal(result.evidence.length, 0);
  value.observe('hover_element', {}, {ok: true});
  const read = await value.execute('read_analysis_evidence', {evidence_id: 'ev_1'});
  assert.equal(read.stale, true);
});

test('a delegate reserves its last turn for a bounded partial handoff with actual usage', async t => {
  let calls = 0;
  const value = setup(t, {complete: async (wire, tools) => {
    calls++;
    const usage = {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120};
    if (tools.length) return {...call('read_analysis_evidence', {evidence_id: 'ev_1', offset: calls - 1}), usage};
    assert.equal(calls, 6); assert.match(wire.at(-1).content, /partial/);
    assert.match(JSON.stringify(wire), /개발팀/);
    return {...report(), usage};
  }});
  await value.execute('delegate_analysis', {tasks: [task()]});
  const result = (await value.collect()).results[0];
  assert.equal(result.status, 'done'); assert.equal(result.report.status, 'partial');
  assert.equal(result.context.model_turns, 6);
  assert.equal(result.context.usage.total_tokens, 720);
  assert.equal(result.context.usage.measured_calls, 6);
  assert.equal(result.context.usage.complete, true);
});

test('a large child context hands off actual excerpts within budget without losing its brief', async t => {
  const value = setup(t, {run: async ({messages, complete, execute, tools}) => {
    await execute('read_analysis_evidence', {evidence_id: 'ev_1'});
    return complete([...messages, {role: 'user', content: 'large observation '.repeat(3000)}], tools);
  }, complete: async (wire, tools) => {
    assert.equal(tools.length, 0); assert(JSON.stringify(wire).length < 32000);
    assert.equal(JSON.parse(wire[1].content).constraints, '담당 팀만 확인하고 화면은 수정하지 않음');
    assert.match(wire.at(-1).content, /담당 팀 개발팀/);
    return report();
  }});
  await value.execute('delegate_analysis', {tasks: [{...task(), constraints: '담당 팀만 확인하고 화면은 수정하지 않음'}]});
  const result = (await value.collect()).results[0];
  assert.equal(result.report.status, 'partial');
  assert.equal(result.context.usage.total_tokens, null, 'Missing usage is unknown, not zero or estimated tokens');
  assert.equal(result.context.usage.complete, false);
});

test('search cannot escape assigned sources and no lexical match does not prove absence', async t => {
  let round = 0;
  const value = setup(t, {complete: async wire => {
    if (++round === 1) return call('read_analysis_evidence', {evidence_id: 'ev_2', query: 'secret'});
    if (round === 2) {
      assert.match(wire.at(-1).content, /analysis_evidence_missing/);
      return call('read_analysis_evidence', {evidence_id: 'ev_1', query: 'unmatchedword'});
    }
    const read = JSON.parse(wire.at(-1).content);
    assert.equal(read.text, ''); assert.deepEqual(read.ranges, []); assert.equal(read.coverage, 'partial');
    return {content: JSON.stringify({status: 'blocked', summary: '다른 키워드나 자료가 필요합니다.', findings: [], uncertainties: ['현재 조회만으로는 판단할 수 없습니다.'], next_step: ''})};
  }}, {text: '안내 문구 '.repeat(500), coverage: {partial: true}});
  value.observe('read_page', {}, {text: 'secret'});
  await value.execute('delegate_analysis', {tasks: [task()]});
  const result = (await value.collect()).results[0];
  assert.equal(result.report.status, 'blocked'); assert.deepEqual(result.evidence, []);
});

test('query retrieval handles Korean words after serialized page newlines', async t => {
  const value = setup(t, {complete: async () => report()});
  const id = value.observe('read_page', {}, {text: '안내\n마감일은 10월 8일입니다.\n담당 팀 개발팀'});
  const result = await value.execute('read_analysis_evidence', {evidence_id: id, query: '마감일'});
  assert.match(result.text, /마감일은/); assert(result.ranges.length);
});

test('questions stop the leader and cancel pending analysts without a late follow-up', async () => {
  let calls = 0, aborted = false, asked = 0;
  const result = await runAgent({messages: [{role: 'user', content: '이 화면 확인'}], tools: [definition('read_page'), definition('ask_user')], signal: new AbortController().signal,
    execute: async name => name === 'ask_user' ? (asked++, {requiresUserInput: true}) : {text: '담당 팀 개발팀'},
    completeAnalysis: async (wire, tools, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => {aborted = true; reject(new Error('cancelled'));}, {once: true})),
    complete: async () => {
      if (++calls === 1) return call('read_page');
      if (calls === 2) return call('delegate_analysis', {tasks: [task()]});
      assert.equal(calls, 3); return call('ask_user');
    }});
  assert.equal(result.awaitingUser, true); assert.equal(aborted, true); assert.equal(asked, 1);
});

test('repeated empty nonblocking polls cannot create an infinite leader loop', async () => {
  let calls = 0;
  await assert.rejects(runAgent({messages: [{role: 'user', content: '화면 확인'}], tools: [definition('read_page')], signal: new AbortController().signal,
    execute: async () => assert.fail('No page action should execute'), completeAnalysis: async () => assert.fail('No delegate was requested'),
    complete: async () => {calls++; return call('collect_analysis', {wait: false});}}), /agent_stalled/);
  assert.equal(calls, 3);
});

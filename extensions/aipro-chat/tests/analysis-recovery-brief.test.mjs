import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

const call = args => ({content: '', calls: [{id: crypto.randomUUID(), function: {name: 'read_analysis_evidence', arguments: JSON.stringify(args)}}]});
const report = ids => ({content: JSON.stringify({status: 'complete', summary: '실패 기록을 확인했습니다.',
  findings: [{text: '가려진 대상은 새 관찰로 확인하고 다른 접근을 검토해야 합니다.', evidence_ids: ids}], uncertainties: [], next_step: ''})});
const task = extra => ({role: 'recovery', task: '첫 클릭 실패를 진단하세요.', constraints: '미확정 쓰기를 재전송하지 않음',
  done_when: '관찰된 오류와 다음 결과 검증을 제안', evidence_ids: ['ev_1'], effort: 'quick', ...extra});
function setup(t, options) {
  const value = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'QWEN3.8-27B-FP8-256K', run: runAgent,
    tools: [], execute: async () => assert.fail('Recovery cannot execute browser actions'), ...options});
  t.after(() => value.dispose()); return value;
}

test('a recovery brief includes bounded assigned frozen receipts and can diagnose with one model call', async t => {
  let models = 0; const trace = [];
  const value = setup(t, {onStep: step => trace.push(step), complete: async (wire, tools) => {
    models++;
    assert.deepEqual(tools.map(tool => tool.function.name), ['read_analysis_evidence']);
    const brief = JSON.parse(wire[1].content);
    assert.equal(brief.constraints, '미확정 쓰기를 재전송하지 않음');
    assert.equal(brief.done_when, '관찰된 오류와 다음 결과 검증을 제안');
    assert(brief.evidence_reads.length <= 2);
    assert(JSON.stringify(brief.evidence_reads).length <= 5000);
    assert.match(JSON.stringify(brief.evidence_reads), /target_obscured/);
    assert.match(JSON.stringify(brief.evidence_reads), /현재 확인된 도움말/);
    assert(!JSON.stringify(wire).includes('UNASSIGNED_SECRET'));
    assert(brief.evidence_reads.every(read => read.coverage === 'complete' && !read.image));
    return report(brief.evidence_reads.map(read => read.evidence_id));
  }});
  value.observe('click_element', {}, {error: 'target_obscured', actionIssued: false});
  value.observe('read_page', {}, {text: '현재 확인된 도움말', documentId: 'doc-1'});
  value.observe('read_page', {}, {text: 'UNASSIGNED_SECRET'});
  await value.execute('delegate_analysis', {tasks: [task({evidence_ids: ['ev_1', 'ev_2']})]});
  const item = (await value.collect()).results[0];
  assert.equal(models, 1); assert.equal(item.context.model_turns, 1);
  assert.equal(item.report.status, 'complete'); assert.equal(item.advisory, true);
  assert.deepEqual(item.evidence.map(source => source.evidence_id), ['ev_1', 'ev_2']);
  assert(trace.some(step => step.analysis.reads === 2));
});

test('large recovery evidence and images still require the explicit assigned reader', async t => {
  let models = 0;
  const value = setup(t, {complete: async wire => {
    models++;
    const brief = JSON.parse(wire[1].content);
    assert.equal(brief.evidence_reads, undefined);
    assert(!JSON.stringify(wire[1]).includes('LARGE_SOURCE'));
    if (models === 1) return call({evidence_id: 'ev_1'});
    assert.match(wire.at(-1).content, /LARGE_SOURCE/);
    return report(['ev_1']);
  }});
  value.observe('read_page', {}, {text: 'LARGE_SOURCE '.repeat(500), image: {mimeType: 'image/png', data: 'AAAA'}});
  await value.execute('delegate_analysis', {tasks: [task()]});
  const item = (await value.collect()).results[0];
  assert.equal(models, 2); assert.equal(item.report.status, 'complete');
  assert.equal(item.evidence[0].image_read, false);
});

test('an exhausted child returns actionable partial work even if the handoff model claims complete', async t => {
  let models = 0;
  const value = setup(t, {complete: async (_wire, tools) => {
    models++;
    return tools.length ? call({evidence_id: 'ev_1', offset: models - 1}) : report(['ev_1']);
  }});
  value.observe('read_page', {}, {text: '현재 관찰한 오류 원문'});
  await value.execute('delegate_analysis', {tasks: [task({role: 'page'})]});
  const item = (await value.collect()).results[0];
  assert.equal(models, 3); assert.equal(item.report.status, 'partial');
  assert(item.report.uncertainties.length); assert(item.report.next_step.trim());
  assert.equal(item.recovery.reason, 'analysis_budget');
  assert.equal(item.recovery.method, 'model_handoff');
  const reused = await value.execute('delegate_analysis', {tasks: [task({role: 'page', effort: 'deep'})]});
  assert.equal(reused.tasks[0].task_id, item.task_id); assert.equal(reused.tasks[0].recovery_required, true);
  assert.equal(models, 3);
});

test('context overflow preserves its actual reason and the remaining work in the partial handoff', async t => {
  let models = 0;
  const value = setup(t, {complete: async (wire, tools) => {
    models++;
    if (models === 1) return call({evidence_id: 'ev_1'});
    if (models === 2) throw Error('context_overflow');
    assert.equal(tools.length, 0); assert.match(wire.at(-1).content, /context_overflow/);
    return report(['ev_1']);
  }});
  value.observe('read_page', {}, {text: '관찰한 실패 근거'});
  await value.execute('delegate_analysis', {tasks: [task({role: 'page', effort: 'standard'})]});
  const item = (await value.collect()).results[0];
  assert.equal(models, 3); assert.equal(item.report.status, 'partial');
  assert.equal(item.recovery.reason, 'context_overflow');
  assert(item.report.uncertainties.length); assert(item.report.next_step.trim());
  assert.match(item.evidence[0].read_excerpt, /관찰한 실패 근거/);
});

test('a cancelled recovery never accepts a late report based on the prefetched receipt', async t => {
  let release, started; const began = new Promise(resolve => {started = resolve;});
  const late = new Promise(resolve => {release = resolve;}); const trace = [];
  const value = setup(t, {onStep: step => trace.push(step), complete: async wire => {
    assert(JSON.parse(wire[1].content).evidence_reads.length); started(); return late;
  }});
  value.observe('click_element', {}, {error: 'target_obscured', actionIssued: false});
  const {tasks} = await value.execute('delegate_analysis', {tasks: [task()]}); await began;
  const cancelled = await value.execute('cancel_analysis', {task_id: tasks[0].task_id});
  assert.equal(cancelled.status, 'cancelled'); const count = trace.length;
  release(report(['ev_1'])); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(trace.length, count);
  const result = (await value.collect({task_ids: [tasks[0].task_id]})).results[0];
  assert.equal(result.status, 'cancelled'); assert.equal(result.report, undefined);
});

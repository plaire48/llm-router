import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator, analysisToolDefinitions} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
import {toolArgumentIssues} from '../tool-validation.js';

const brief = extra => ({role: 'page', task: 'Find the responsible team. '.repeat(12) + 'Preserve the exception at the end.', constraints: 'Only inspect; do not submit.', done_when: 'Identify the team and any unresolved exception with evidence.', evidence_ids: ['ev_1'], ...extra});
const partial = {content: JSON.stringify({status: 'partial', summary: '예외 조건 미확인', findings: [], uncertainties: ['예외 조건의 원문이 필요합니다.'], next_step: '예외 조건 원문을 추가해 확인하세요.'})};
function setup(t, complete = async () => partial) {
  const value = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'QWEN3.8-27B-FP8-256K', run: runAgent, complete,
    execute: async () => assert.fail('No browser executor is assigned')});
  t.after(() => value.dispose()); value.observe('read_page', {}, {text: '담당 팀 개발팀'}); return value;
}

test('collected and recalled advice retains the full immutable assignment, independent of the display label', async t => {
  let calls = 0; const value = setup(t, async () => {calls++; return partial;});
  const input = brief(); const expected = {...structuredClone(input), effort: 'standard', document_ids: [], document_ranges: []};
  const started = await value.execute('delegate_analysis', {tasks: [input]});
  input.task = 'Changed by caller'; input.evidence_ids.push('unassigned');
  const collected = (await value.collect()).results[0];
  assert.deepEqual(collected.assignment, expected);
  assert(collected.task.length <= 160);
  collected.assignment.constraints = 'Mutated reply'; collected.assignment.evidence_ids.push('mutated');
  const recalled = (await value.collect({task_ids: [started.tasks[0].task_id]})).results[0];
  assert.deepEqual(recalled.assignment, expected); assert.equal(calls, 1);
});

test('malformed or empty delegation is rejected atomically before any model call with safe schema feedback', async t => {
  let calls = 0; const value = setup(t, async () => {calls++; return partial;});
  for (const bad of [null, {tasks: [null]}, {tasks: [brief(), brief({task: '   '})]}, {tasks: [brief({done_when: '\n '})]}, {tasks: [brief({task: 'x'.repeat(1801)})]}, {tasks: [brief({SECRET_VALUE: 'DO_NOT_ECHO'})]}]) {
    const result = await value.execute('delegate_analysis', bad);
    assert.equal(result.error, 'analysis_scope'); assert(result.issues?.length);
    assert(!JSON.stringify(result).includes('DO_NOT_ECHO')); assert(!JSON.stringify(result).includes('SECRET_VALUE'));
  }
  assert.equal(calls, 0); assert.deepEqual(value.status(), []);
  await value.execute('delegate_analysis', {tasks: [brief()]}); await value.collect(); assert.equal(calls, 1);
});

test('advertised task schema rejects blank objectives and completion conditions', () => {
  const schema = analysisToolDefinitions().find(tool => tool.function.name === 'delegate_analysis').function.parameters;
  for (const key of ['task', 'done_when']) assert(toolArgumentIssues(schema, {tasks: [brief({[key]: '  \n '})]}));
  assert.equal(toolArgumentIssues(schema, {tasks: [brief()]}), null);
});

test('partial and blocked assignments reuse their result when only effort changes, while changed work can proceed', async t => {
  for (const status of ['partial', 'blocked']) {
    let calls = 0; const value = setup(t, async () => {calls++; return {content: JSON.stringify({...JSON.parse(partial.content), status})};});
    const first = await value.execute('delegate_analysis', {tasks: [brief({effort: 'quick'})]}); await value.collect();
    const again = await value.execute('delegate_analysis', {tasks: [brief({effort: 'deep'})]});
    assert.equal(again.tasks[0].task_id, first.tasks[0].task_id); assert.equal(again.tasks[0].recovery_required, true); assert.equal(calls, 1);
    const changed = await value.execute('delegate_analysis', {tasks: [brief({effort: 'deep', task: 'Inspect the exception using a different observed source.'})]});
    assert.notEqual(changed.tasks[0].task_id, first.tasks[0].task_id); await value.collect(); assert.equal(calls, 2);
  }
});

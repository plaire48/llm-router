import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
import {projectTools} from '../project-tools.js';

const call = (name, args) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const assignment = extra => ({role: 'research', task: 'Find the deadline', done_when: 'Cite its source', evidence_ids: [], effort: 'deep', ...extra});
const partial = () => ({content: JSON.stringify({status: 'partial', summary: '마감일의 추가 근거가 필요합니다.', findings: [], uncertainties: ['날짜 미확인'], next_step: '다른 출처에서 확인하세요.'})});
function setup(t, options) {
  const value = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'QWEN3.8-27B-FP8-256K', run: runAgent,
    tools: projectTools({status: 'connected', capabilities: ['wiki']}), ...options});
  t.after(() => value.dispose()); return value;
}

test('Pi repeated failures become one tool-free handoff and the same assignment is not restarted', async t => {
  let reads = 0, models = 0, handoffs = 0;
  const steps = [];
  const value = setup(t, {onStep: step => steps.push(step),
    execute: async () => {reads++; return {error: 'project_not_found'};},
    complete: async (wire, tools) => {
      models++;
      if (tools.length) return call('wiki_read', {id: 'missing.md'});
      handoffs++; assert.match(wire.at(-1).content, /agent_stalled/);
      assert.equal(wire.some(item => item.role === 'tool'), false);
      assert.match(wire.at(-1).content, /project_not_found/);
      return partial();
    }});
  const started = await value.execute('delegate_analysis', {tasks: [assignment({effort: 'standard'})]});
  const item = (await value.collect()).results[0];
  assert.equal(reads, 3); assert.equal(models, 4); assert.equal(handoffs, 1);
  assert.equal(item.report.status, 'partial'); assert.deepEqual(item.report.findings, []);
  assert.equal(item.recovery.method, 'model_handoff');
  assert(item.evidence.every(source => source.source_status === 'error'));
  const again = await value.execute('delegate_analysis', {tasks: [assignment({effort: 'deep'})]});
  assert.equal(again.tasks[0].task_id, started.tasks[0].task_id);
  assert.equal(again.tasks[0].recovery_required, true); assert.equal(models, 4);
  assert.equal((await value.collect({task_ids: [item.task_id]})).results[0].report.status, 'partial');
  assert(steps.some(step => step.analysis?.outcome === 'partial' && step.analysis.delivered));
  assert(!steps.some(step => step.analysis?.outcome === 'complete'));
  const changed = await value.execute('delegate_analysis', {tasks: [assignment({task: 'Search a different source for the deadline'})]});
  assert.notEqual(changed.tasks[0].task_id, item.task_id);
  await value.collect();
});

test('malformed fallback discards claims, retains observed excerpts, and uses no extra repair loop', async t => {
  let reads = 0, models = 0;
  const value = setup(t, {execute: async () => {reads++; return {content: 'Original evidence KEEP_ME', provenance: {path: 'guide.md', hash: 'a'.repeat(64)}};},
    complete: async () => ++models === 1 ? call('wiki_read', {id: 'guide.md'}) : {content: '{"summary":"INVENTED_SECRET"'} });
  await value.execute('delegate_analysis', {tasks: [assignment()]});
  const item = (await value.collect()).results[0];
  assert.equal(reads, 1); assert.equal(models, 3);
  assert.equal(item.report.status, 'partial'); assert.deepEqual(item.report.findings, []);
  assert.equal(item.recovery.reason, 'analysis_format');
  assert.match(item.evidence[0].read_excerpt, /KEEP_ME/);
  assert.equal(item.evidence[0].provenance.path, 'guide.md');
  assert(!JSON.stringify(item).includes('INVENTED_SECRET'));
});

test('transport failures remain failures and reused failed work requires changed input', async t => {
  let models = 0;
  const value = setup(t, {complete: async () => {models++; throw Error('unauthorized');}});
  const initial = await value.execute('delegate_analysis', {tasks: [assignment()]});
  const failed = (await value.collect()).results[0];
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'unauthorized'); assert.equal(failed.report, undefined);
  const reused = await value.execute('delegate_analysis', {tasks: [assignment({effort: 'standard'})]});
  assert.equal(reused.tasks[0].task_id, initial.tasks[0].task_id); assert.equal(models, 1);
  const id = value.observe('read_page', {}, {text: 'New observation'});
  const fresh = await value.execute('delegate_analysis', {tasks: [assignment({evidence_ids: [id]})]});
  assert.notEqual(fresh.tasks[0].task_id, failed.task_id); await value.collect(); assert.equal(models, 2);
});

test('cancel during the recovery model call releases the slot and ignores late completion', async t => {
  let release, began; const started = new Promise(resolve => {began = resolve;});
  const late = new Promise(resolve => {release = resolve;}); let handoffs = 0;
  const steps = [];
  const value = setup(t, {onStep: step => steps.push(step), execute: async () => ({error: 'project_not_found'}),
    complete: async (_, tools) => {
      if (tools.length) return call('wiki_read', {id: 'missing.md'});
      handoffs++; began(); return late;
    }});
  const {tasks} = await value.execute('delegate_analysis', {tasks: [assignment()]});
  await started;
  const cancelled = await value.execute('cancel_analysis', {task_id: tasks[0].task_id});
  assert.equal(cancelled.status, 'cancelled'); const count = steps.length;
  release(partial()); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(steps.length, count); assert.equal(handoffs, 1);
  assert.equal((await value.collect({task_ids: [tasks[0].task_id]})).results[0].status, 'cancelled');
});

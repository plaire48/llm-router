import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
import {contentPacket} from '../browser-content.js';

const call = id => ({calls: [{id: crypto.randomUUID(), function: {name: 'read_analysis_evidence', arguments: JSON.stringify({evidence_id: id})}}]});
const answer = ids => ({content: JSON.stringify({status: 'complete', summary: 'Captured facts checked.',
  findings: ids.map(id => ({text: 'The assigned source states a deadline.', evidence_ids: [id]})), uncertainties: [], next_step: ''})});
const assignment = (id, role = 'page') => ({role, task: 'Check the deadline in this source.', done_when: 'Return the observed deadline and its source.', evidence_ids: [id], effort: 'quick'});
function coordinator(t, options) {
  const value = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'test-model', run: runAgent,
    tools: [], execute: async () => assert.fail('No browser access'), ...options});
  t.after(() => value.dispose()); return value;
}

test('two assigned sources need two model calls: a small one arrives whole, a large one as a focused excerpt', async t => {
  for (const padding of ['', ' '.repeat(2500)]) {
    let calls = 0;
    const value = coordinator(t, {complete: async (wire, tools) => {
      calls++;
      assert.deepEqual(tools.map(tool => tool.function.name), ['read_analysis_evidence']);
      assert(!JSON.stringify(wire).includes('UNASSIGNED_SECRET'));
      const brief = JSON.parse(wire[1].content), id = brief.evidence[0].evidence_id;
      const actual = brief.evidence_reads?.[0] || (wire.findLast(m => m.role === 'tool') && JSON.parse(wire.findLast(m => m.role === 'tool').content));
      if (!actual) return call(id);
      assert.equal(actual.evidence_id, id); assert.match(actual.text, /deadline/);
      assert.equal(actual.requires_fresh_check, true);
      // A large source arrives as the ranges matching the assignment's words, marked partial.
      assert.equal(actual.coverage, padding ? 'partial' : 'complete'); assert.equal(actual.selection, padding ? 'query' : 'range');
      return answer([id]);
    }});
    const first = {url: 'https://one.example/source', text: `A deadline 3 days.${padding}`};
    value.observe('read_page', {}, first);
    value.observe('read_page', {}, {url: 'https://two.example/source', text: `B deadline 5 days.${padding}`});
    value.observe('read_page', {}, {text: 'UNASSIGNED_SECRET'});
    first.text = 'Mutated after observation';
    await value.execute('delegate_analysis', {tasks: [assignment('ev_1'), assignment('ev_2', 'review')]});
    const results = (await value.collect()).results;
    // collect waits for the first completed job, so recover both by IDs.
    const all = await Promise.all(value.status().map(job => value.collect({task_ids: [job.task_id]})));
    assert.equal(calls, 2);
    for (const result of all.flatMap(item => item.results)) {
      assert.equal(result.report.status, 'complete'); assert.equal(result.advisory, true);
      assert(!JSON.stringify(result).includes('Mutated after observation'));
      assert(result.evidence.every(source => source.requires_fresh_check));
    }
    assert(results.length);
  }
});

test('image-bearing, metadata and failed observations keep the explicit reader', async t => {
  const cases = [{text: 'deadline', image: {mimeType: 'image/png', data: 'AAAA'}}, {text: 'deadline', metadata_only: true},
    {error: 'source_read_failed'}];
  for (const source of cases) {
    let calls = 0;
    const value = coordinator(t, {complete: async wire => {
      calls++;
      assert.equal(JSON.parse(wire[1].content).evidence_reads, undefined);
      if (!wire.some(message => message.role === 'tool')) return call('ev_1');
      return {content: JSON.stringify({status: 'partial', summary: 'Only a limited source was read.', findings: [], uncertainties: ['More evidence needed.'], next_step: 'Read missing evidence.'})};
    }});
    value.observe('read_page', {}, source);
    await value.execute('delegate_analysis', {tasks: [assignment('ev_1')]});
    const result = (await value.collect()).results[0];
    assert.equal(calls, 2); assert.equal(result.report.status, 'partial');
  }
});

test('a focused content packet reaches a one-call analyst without promoting partial page coverage', async t => {
  const source = {text: '# Deadline\n\nThe exception deadline is 3 days.\n\n## Other section\n\n' + 'Unrelated policy details. '.repeat(300),
    title: 'Policy', url: 'https://example.com/policy', frame: 0, documentId: 'doc-policy',
    sourceIdentity: ['doc-policy', 'https://example.com/policy'], method: 'main_landmark',
    coverage: {partial: true, omittedSubtrees: 1, shadowRoots: 1, embeddedFrames: 1, inputValues: 'omitted'}};
  const input = {mode: 'content', query: 'exception deadline'};
  const packet = await contentPacket(source, input);
  assert(packet.ranges[0].end < packet.characters); assert(JSON.stringify({input, result: packet}).length <= 2400);
  let calls = 0;
  const value = coordinator(t, {complete: async wire => {
    calls++;
    const read = JSON.parse(wire[1].content).evidence_reads[0];
    assert.equal(read.coverage, 'complete'); assert.equal(read.coverage_scope, 'returned_observation_only');
    assert.match(read.scope, /Unreturned page content remains unread/);
    const captured = JSON.parse(read.text).result;
    assert.deepEqual(captured, packet);
    assert.equal(captured.coverage.partial, true); assert.equal(captured.queryFiltered, true);
    assert(captured.ranges[0].end < captured.characters);
    return {content: JSON.stringify({status: 'partial', summary: 'The observed exception is 3 days; later sections remain unread.',
      findings: [{text: 'The first returned section says 3 days.', evidence_ids: ['ev_1']}],
      uncertainties: [`Unread content starts at ${captured.ranges[0].end}.`], next_step: 'Read the remaining section before claiming full coverage.'})};
  }});
  value.observe('read_page', input, packet);
  await value.execute('delegate_analysis', {tasks: [assignment('ev_1')]});
  const result = (await value.collect()).results[0];
  assert.equal(calls, 1); assert.equal(result.report.status, 'partial');
  const explicit = await value.execute('read_analysis_evidence', {evidence_id: 'ev_1'});
  assert.equal(explicit.coverage_scope, 'returned_observation_only');
  assert.deepEqual(JSON.parse(explicit.text).result, packet);
});

test('prefetched evidence cannot authorize a finding citing an unassigned source', async t => {
  let calls = 0;
  const value = coordinator(t, {complete: async wire => {
    calls++;
    assert.equal(JSON.parse(wire[1].content).evidence_reads[0].evidence_id, 'ev_1');
    assert(!JSON.stringify(wire).includes('UNASSIGNED_SECRET'));
    return calls === 1 ? answer(['ev_2']) : answer(['ev_1']);
  }});
  value.observe('read_page', {}, {text: 'deadline 3 days'});
  value.observe('read_page', {}, {text: 'UNASSIGNED_SECRET'});
  await value.execute('delegate_analysis', {tasks: [assignment('ev_1')]});
  const result = (await value.collect()).results[0];
  assert.equal(calls, 2); assert.deepEqual(result.report.findings[0].evidence_ids, ['ev_1']);
});

test('a brief keeps the two-source and combined-size bound without crediting an omitted source', async t => {
  let calls = 0;
  const value = coordinator(t, {complete: async wire => {
    calls++;
    const brief = JSON.parse(wire[1].content);
    assert.equal(brief.evidence_reads.length, 2);
    assert(JSON.stringify(brief.evidence_reads).length <= 5000);
    assert(!JSON.stringify(brief.evidence_reads).includes('THIRD_SOURCE'));
    return calls === 1 ? answer(['ev_3']) : answer(['ev_1', 'ev_2']);
  }});
  value.observe('read_page', {}, {text: 'First deadline. '.repeat(70)});
  value.observe('read_page', {}, {text: 'Second deadline. '.repeat(70)});
  value.observe('read_page', {}, {text: 'THIRD_SOURCE deadline.'});
  await value.execute('delegate_analysis', {tasks: [{...assignment('ev_1', 'review'), evidence_ids: ['ev_1', 'ev_2', 'ev_3']}]});
  const result = (await value.collect()).results[0];
  assert.equal(calls, 2);
  assert.deepEqual(result.evidence.map(source => source.evidence_id), ['ev_1', 'ev_2']);
});

test('cancelling a page analyst discards its late prefetched-source report', async t => {
  let start, release;
  const started = new Promise(resolve => {start = resolve;});
  const pending = new Promise(resolve => {release = resolve;});
  const value = coordinator(t, {complete: async wire => {
    assert(JSON.parse(wire[1].content).evidence_reads); start(); return pending;
  }});
  value.observe('read_page', {}, {text: 'deadline 3 days'});
  const {tasks} = await value.execute('delegate_analysis', {tasks: [assignment('ev_1')]});
  await started;
  await value.execute('cancel_analysis', {task_id: tasks[0].task_id});
  release(answer(['ev_1']));
  const result = (await value.collect({task_ids: [tasks[0].task_id]})).results[0];
  assert.equal(result.status, 'cancelled'); assert.equal(result.report, undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {documentBindings, executeDocumentTool, documentToolDefinitions} from '../document-tools.js';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

const text = '서문과 반복 문단\n\n'.repeat(900) + '승인 조건은 품질팀 확인입니다.\n' + 'x'.repeat(9000) + '   \n';
const file = {id: 'doc', hash: 'a'.repeat(64), name: '요구사항.md', kind: 'text', blob: new Blob([text])};
const bindings = documentBindings([{attachments: [file]}]);
const read = (name, args) => executeDocumentTool({bindings, owner: {}}, name, args, {load: async () => file});
const span = (start, end) => ({document_id: file.id, hash: file.hash, start, end});
const task = ranges => ({role: 'research', task: '배정한 요구사항 구간을 요약', done_when: '모든 배정 구간의 근거 확인', evidence_ids: [], document_ids: ['doc'], document_ranges: ranges});
const calls = (...args) => ({calls: args.map(arg => ({id: crypto.randomUUID(), type: 'function', function: {name: 'read_document', arguments: JSON.stringify(arg)}}))});
const report = (ids, status = 'complete') => ({content: JSON.stringify({status, summary: '구간 근거 확인', findings: ids.map(id => ({text: '원문을 확인함', evidence_ids: [id]})), uncertainties: [], next_step: ''})});
function harness(t, options) {
  const h = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'qwen3.8-27b', run: runAgent,
    documents: bindings, tools: documentToolDefinitions(), execute: read, ...options});
  t.after(() => h.dispose()); return h;
}
async function collectAll(h) {
  const results = [];
  do {const packet = await h.collect(); results.push(...packet.results); if (!packet.pending.length) break;} while (true);
  return results;
}

test('reordered document ranges and JSON fields cannot restart an unchanged failed assignment', async t => {
  let calls = 0;
  const h = harness(t, {complete: async () => {calls++; throw Error('network');}});
  const ranges = [span(0, 100), span(100, 200)];
  const first = await h.execute('delegate_analysis', {tasks: [task(ranges)]});
  await h.collect();
  const reordered = ranges.toReversed().map(({end, start, hash, document_id}) => ({end, start, hash, document_id}));
  const second = await h.execute('delegate_analysis', {tasks: [{...task(reordered), effort: 'deep'}]});
  assert.equal(second.tasks[0].task_id, first.tasks[0].task_id);
  assert.equal(second.tasks[0].recovery_required, true); assert.equal(calls, 1);
  const changed = await h.execute('delegate_analysis', {tasks: [task([span(0, 101)])]});
  assert.notEqual(changed.tasks[0].task_id, first.tasks[0].task_id);
  await h.collect(); assert.equal(calls, 2);
});

test('LangChain plan pages cover exact original text including repeated sections and whitespace without loading body', async () => {
  let offset = 0, ranges = [];
  do {
    const plan = await read('read_document', {document_id: 'doc', mode: 'plan', offset});
    assert.equal(plan.metadata_only, true); assert.equal(plan.coverage, 'unread');
    assert(!JSON.stringify(plan).includes('승인 조건')); assert(plan.ranges.length <= 6);
    ranges.push(...plan.ranges); offset = plan.next_offset;
  } while (offset !== null);
  let cursor = 0, restored = '';
  for (const r of ranges) {
    assert.equal(r.start, cursor); assert(r.end - r.start <= 3600);
    const part = await read('read_document', {document_id: 'doc', offset: r.start, length: r.end - r.start});
    restored += part.text; cursor = r.end;
  }
  assert.equal(restored, text); assert.equal(cursor, text.length);
});

test('two isolated analysts read disjoint document parts concurrently and return exact coverage', async t => {
  const ranges = [span(0, 1500), span(1500, 3000)], starts = new Set(); let release;
  const gate = new Promise(resolve => {release = resolve;});
  const h = harness(t, {execute: async (name, args) => {
    starts.add(args.offset); if (starts.size === 2) release(); await gate; return read(name, args);
  }, complete: async wire => {
    const result = wire.findLast(m => m.role === 'tool');
    if (!result) {
      const brief = JSON.parse(wire.find(m => m.role === 'user').content), r = brief.document_ranges[0];
      assert.equal(brief.document_ranges.length, 1);
      return calls({document_id: r.document_id, offset: r.start, length: r.end - r.start});
    }
    const packet = JSON.parse(result.content); assert.equal(JSON.parse(packet.text).result.text.length, 1500);
    return report([packet.evidence_id]);
  }});
  await h.execute('delegate_analysis', {tasks: ranges.map(r => task([r]))});
  const results = await collectAll(h);
  assert.equal(starts.size, 2); assert.equal(results.length, 2);
  for (const item of results) {
    assert.equal(item.report.status, 'complete'); assert.equal(item.document_progress[0].coverage, 'read');
    assert.deepEqual(item.document_progress[0].remaining, []); assert.equal(item.document_progress[0].review_needed, false);
  }
});

test('missing range downgrades complete; fresh analyst can resume only the missing span', async t => {
  const executed = [];
  const h = harness(t, {execute: async (name, args) => {executed.push(args.offset); return read(name, args);}, complete: async wire => {
    const output = wire.findLast(m => m.role === 'tool');
    if (!output) {
      const r = JSON.parse(wire.find(m => m.role === 'user').content).document_ranges[0];
      return calls({document_id: 'doc', offset: r.start, length: Math.min(100, r.end - r.start)});
    }
    return report([JSON.parse(output.content).evidence_id]);
  }});
  await h.execute('delegate_analysis', {tasks: [task([span(0, 200)])]});
  const first = (await h.collect()).results[0];
  assert.equal(first.report.status, 'partial'); assert.deepEqual(first.document_progress[0].remaining, [span(100, 200)]);
  await h.execute('delegate_analysis', {tasks: [task(first.document_progress.flatMap(p => p.remaining))]});
  assert.equal((await h.collect()).results[0].report.status, 'complete'); assert.deepEqual(executed, [0, 100]);
});

test('evicted document evidence requires renewed review without erasing the historical read range',async t=>{
  const h=harness(t,{complete:async wire=>{
    const output=wire.findLast(m=>m.role==='tool');
    return output?report([JSON.parse(output.content).evidence_id]):calls({document_id:'doc',offset:0,length:100});
  }});
  const launched=await h.execute('delegate_analysis',{tasks:[task([span(0,100)])]});
  assert.equal((await h.collect()).results[0].report.status,'complete');
  for(let i=0;i<60;i++)h.observe('read_page',{}, {text:`New observation ${i}`});
  const recalled=(await h.collect({task_ids:[launched.tasks[0].task_id]})).results[0];
  assert.equal(recalled.report.status,'partial');assert.deepEqual(recalled.report.findings,[]);
  assert.equal(recalled.document_progress[0].review_needed,true);
  assert.equal(recalled.document_progress[0].coverage,'read');
  assert.deepEqual(recalled.document_progress[0].read,[{start:0,end:100}]);
  assert.equal(recalled.context.returned_characters,JSON.stringify(recalled.report).length);
});

test('one parallel read failing keeps successful evidence and exposes only the unread range', async t => {
  const h = harness(t, {execute: async (name, args) => {if (args.offset === 100) throw Error('network'); return read(name, args);}, complete: async wire => {
    const outputs = wire.filter(m => m.role === 'tool');
    if (!outputs.length) return calls({document_id: 'doc', offset: 0, length: 100}, {document_id: 'doc', offset: 100, length: 100});
    const packets = outputs.map(m => JSON.parse(m.content));
    assert.equal(packets[1].error, 'network');
    return report([packets[0].evidence_id], 'partial');
  }});
  await h.execute('delegate_analysis', {tasks: [task([span(0, 200)])]});
  const item = (await h.collect()).results[0];
  assert.equal(item.report.status, 'partial'); assert.deepEqual(item.document_progress[0].read, [{start: 0, end: 100}]);
  assert.deepEqual(item.document_progress[0].remaining, [span(100, 200)]);
});

test('scoped reads reject cross-range access and stale hashes before crediting coverage', async t => {
  let step = 0, executions = 0;
  const h = harness(t, {execute: async (name, args) => {executions++; return {...await read(name, args), provenance: {document_id: 'doc', hash: 'changed'}};}, complete: async wire => {
    if (++step === 1) return calls({document_id: 'doc', offset: 90, length: 20});
    if (step === 2) {assert.match(wire.at(-1).content, /analysis_scope/); return calls({document_id: 'doc', offset: 0, length: 100});}
    assert.match(wire.at(-1).content, /analysis_source_changed/); return report([], 'blocked');
  }});
  assert.equal((await h.execute('delegate_analysis', {tasks: [task([{...span(0, 100), hash: 'old'}])]})).error, 'analysis_scope');
  await h.execute('delegate_analysis', {tasks: [task([span(0, 100)])]});
  const item = (await h.collect()).results[0]; assert.equal(executions, 1);
  assert.deepEqual(item.document_progress[0].remaining, [span(0, 100)]); assert.deepEqual(item.evidence, []);
});

test('explicit context overflow gets one tool-free partial handoff without repeating reads', async t => {
  let modelCalls = 0, reads = 0;
  const h = harness(t, {execute: async (name, args) => {reads++; return read(name, args);}, complete: async (wire, tools) => {
    if (++modelCalls === 1) return calls({document_id: 'doc', offset: 0, length: 100});
    if (modelCalls === 2) throw Error('context_overflow');
    assert.equal(modelCalls, 3); assert.deepEqual(tools, []); assert.match(wire.at(-1).content, /document_progress/);
    return report(['ev_1'], 'partial');
  }});
  await h.execute('delegate_analysis', {tasks: [task([span(0, 200)])]});
  const item = (await h.collect()).results[0];
  assert.equal(item.report.status, 'partial'); assert.equal(reads, 1); assert.equal(modelCalls, 3);
  assert.deepEqual(item.document_progress[0].remaining, [span(100, 200)]);
});

test('failed overflow handoff still returns read receipts and review-needed ranges', async t => {
  let count = 0;
  const h = harness(t, {complete: async () => {
    if (++count === 1) return calls({document_id: 'doc', offset: 0, length: 100});
    throw Error('context_overflow');
  }});
  await h.execute('delegate_analysis', {tasks: [task([span(0, 100)])]});
  const item = (await h.collect()).results[0];
  assert.equal(count, 3); assert.equal(item.report.status, 'partial'); assert.equal(item.recovery.reason, 'context_overflow');
  assert.deepEqual(item.report.findings, []);
  assert.equal(item.document_progress[0].coverage, 'read'); assert.equal(item.document_progress[0].review_needed, true);
  assert.equal(item.evidence.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

const report = id => ({content: JSON.stringify({status: 'complete', summary: '유효 부위 확인', findings: [{text: '사브르는 허리 위가 유효합니다.', evidence_ids: [id]}], uncertainties: [], next_step: ''})});
const filler = '대회 운영 일반 규정과 장비 검사 절차를 설명합니다. '.repeat(400);
const rules = `${filler}\n사브르 유효 타격 부위는 허리 위 전체이며 에페는 전신입니다.\n${filler}`;
function coordinator(t, complete) {
  const value = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'test-model', run: runAgent, tools: [],
    execute: async () => assert.fail('No browser access'), complete});
  t.after(() => value.dispose()); return value;
}
const assignment = (id, extra = {}) => ({role: 'page', effort: 'quick', evidence_ids: [id], task: '사브르 유효 타격 부위를 확인하세요.', done_when: '유효 부위 문장을 인용', ...extra});

test('a large source reaches the analyst as the ranges that match its assignment, in one model call', async t => {
  let calls = 0, brief;
  const value = coordinator(t, async wire => {calls++; brief = JSON.parse(wire[1].content); return report(brief.evidence[0].evidence_id);});
  const id = value.observe('read_page', {}, {url: 'https://rules.example/technical', text: rules});
  await value.execute('delegate_analysis', {tasks: [assignment(id)]});
  const result = (await value.collect()).results[0];
  assert.equal(calls, 1); assert.equal(result.report.status, 'complete');
  const [read] = brief.evidence_reads;
  assert.equal(read.evidence_id, id); assert.equal(read.selection, 'query'); assert.equal(read.coverage, 'partial');
  assert.match(read.text, /사브르 유효 타격 부위는 허리 위 전체/);
  assert(read.text.length <= 1800 && JSON.stringify(brief.evidence_reads).length <= 4800, 'a quick assignment gets one range and keeps room for its own reads');
  assert(wireSize(brief) < 16000);
  assert.deepEqual(result.evidence.map(source => source.evidence_id), [id]);
});
const wireSize = brief => JSON.stringify(brief).length;

test('a source that shares no word with the assignment is not sent ahead and must be read explicitly', async t => {
  let calls = 0;
  const value = coordinator(t, async wire => {
    calls++; const brief = JSON.parse(wire[1].content);
    assert.equal(brief.evidence_reads, undefined);
    if (!wire.some(message => message.role === 'tool')) return {calls: [{id: crypto.randomUUID(), function: {name: 'read_analysis_evidence', arguments: JSON.stringify({evidence_id: brief.evidence[0].evidence_id})}}]};
    return {content: JSON.stringify({status: 'partial', summary: '관련 문장이 없습니다.', findings: [], uncertainties: ['해당 내용 미확인'], next_step: '다른 출처 확인'})};
  });
  const id = value.observe('read_page', {}, {url: 'https://rules.example/other', text: 'Unrelated English policy text. '.repeat(200)});
  await value.execute('delegate_analysis', {tasks: [assignment(id)]});
  assert.equal((await value.collect()).results[0].report.status, 'partial'); assert.equal(calls, 2);
});

test('failed, image-bearing and research assignments keep their explicit reader', async t => {
  for (const [source, extra] of [[{error: 'source_read_failed', text: rules}, {}], [{text: rules, image: {mimeType: 'image/png', data: 'AAAA'}}, {}]]) {
    let first;
    const value = coordinator(t, async wire => {first ||= JSON.parse(wire[1].content); return {content: JSON.stringify({status: 'partial', summary: '읽지 못했습니다.', findings: [], uncertainties: ['근거 없음'], next_step: '다시 관찰'})};});
    const id = value.observe('read_page', {}, source);
    await value.execute('delegate_analysis', {tasks: [assignment(id, extra)]});
    await value.collect();
    assert.equal(first.evidence_reads, undefined, JSON.stringify(Object.keys(source)));
  }
});

test('after the excerpt a quick analyst can still make its own read within its allocation', async t => {
  let calls = 0;
  const value = coordinator(t, async wire => {
    calls++; const brief = JSON.parse(wire[1].content), id = brief.evidence[0].evidence_id;
    if (!wire.some(message => message.role === 'tool')) return {calls: [{id: crypto.randomUUID(), function: {name: 'read_analysis_evidence', arguments: JSON.stringify({evidence_id: id})}}]};
    return report(id);
  });
  const id = value.observe('read_page', {}, {url: 'https://rules.example/technical', text: rules});
  await value.execute('delegate_analysis', {tasks: [assignment(id)]});
  const result = (await value.collect()).results[0];
  assert.equal(result.report.status, 'complete', JSON.stringify(result.recovery)); assert.equal(calls, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const goal = '배송비를 확인하고 읽은 범위만 설명하세요. 구매하지 마세요.';
const base = () => ({goal, messages: [{role: 'user', content: goal}], tools, harness: true});
const tasks = count => Array.from({length: count}, (_, i) => ({role: 'page', effort: 'quick', task: `상품 정보 ${i + 1} 확인`, evidence_ids: ['ev_1'], done_when: '원문 인용'}));
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
function report(wire) {
  const brief = JSON.parse(wire[1].content), id = brief.evidence[0].evidence_id;
  if (!brief.evidence_reads?.length && !wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: id});
  return {content: JSON.stringify({status: 'complete', summary: brief.task.startsWith('상품 정보') ? brief.task : '배송비를 조회하세요.', findings: [{text: '상품 제목만 확인했습니다.', evidence_ids: [id]}], uncertainties: [], next_step: '배송비 부분을 읽으세요.'})};
}
test('six occupied assignments are collected before one loop repair without losing reports or raising a user question', async () => {
  const gate = deferred(), controller = new AbortController(), events = [];
  let rounds = 0, reads = 0, timer, recoveryCalls = 0; const received = new Set();
  const deadline = setTimeout(() => controller.abort(), 2500);
  try {
    const result = await runAgent({...base(), signal: controller.signal, onStep: event => events.push(event),
      complete: async wire => {
        rounds++;
        for (const match of JSON.stringify(wire).matchAll(/report-(\d+)/g)) received.add(Number(match[1]));
        if (rounds === 1 || rounds === 3 || rounds === 4) return call('read_page');
        if (rounds === 2) return call('delegate_analysis', {tasks: tasks(6)});
        if (rounds === 5) {
          assert.equal(events.filter(event => event.tool === 'analysis_recovery' && event.status === 'queued').length, 1);
          const transcript = JSON.stringify(wire);
          assert(received.size > 0, 'Capacity must be freed by collecting actual reports');
          assert(transcript.includes('배송비를 조회하세요.'));
          return call('read_page', {query: '배송비'});
        }
        assert(rounds < 10); return {content: '배송비 3000원'};
      }, execute: async (name, args) => {
        assert.equal(name, 'read_page');
        if (++reads === 3) timer = setTimeout(gate.resolve, 25);
        return {text: args.query ? '배송비 3000원' : '상품 제목'};
      }, reviewGoal: async () => ({status: 'complete'}),
      completeAnalysis: async wire => {
        const brief = JSON.parse(wire[1].content);
        if (brief.task.startsWith('상품 정보')) {
          await gate.promise;
          const value = report(wire);
          if (value.content) {const parsed = JSON.parse(value.content); parsed.summary = `report-${brief.task.match(/\d+/)[0]}`; value.content = JSON.stringify(parsed);}
          return value;
        }
        recoveryCalls++; return report(wire);
      }});
    assert.equal(result.content, '배송비 3000원'); assert.equal(recoveryCalls, 1); assert.equal(received.size, 6);
    assert.equal(events.filter(event => event.tool === 'analysis_page' && event.status === 'queued').length, 6);
  } finally {gate.resolve(); clearTimeout(timer); clearTimeout(deadline);}
});

for (const collection of ['automatic', 'explicit']) test(`steering interrupts ${collection} collection without discarding manually assigned results`, async () => {
  const gate = deferred(), controller = new AbortController();
  let rounds = 0, ready = false, changed = false, timer;
  const deadline = setTimeout(() => controller.abort(), 1500);
  try {
    const result = await runAgent({...base(), signal: controller.signal,
      takeInput: async () => {if (!ready || changed) return null; changed = true; return {text: '배송비 대신 현재 상품 제목만 설명하세요.'};},
      complete: async wire => {
        if (++rounds === 1) return call('read_page');
        if (rounds === 2) return call('delegate_analysis', {tasks: tasks(2)});
        if (rounds === 3) {timer = setTimeout(() => {ready = true;}, 15); return collection === 'explicit' ? call('collect_analysis', {wait: true}) : {content: '기존 답변'};}
        assert(changed); gate.resolve();
        if (rounds > 4) assert(JSON.stringify(wire).includes('Delegated analysis returned.'));
        assert(rounds < 8); return {content: '상품 제목'};
      }, execute: async name => {assert.equal(name, 'read_page'); return {text: '상품 제목'};},
      completeAnalysis: async wire => {await gate.promise; return report(wire);}, reviewGoal: async () => ({status: 'complete'})});
    assert.equal(result.content, '상품 제목'); assert(changed); assert(!controller.signal.aborted);
  } finally {gate.resolve(); clearTimeout(timer); clearTimeout(deadline);}
});

test('a queued correction cancels a capacity wait before any recovery worker is launched', async () => {
  const gate = deferred(), controller = new AbortController(), events = [];
  let rounds = 0, reads = 0, ready = false, changed = false, timer;
  const deadline = setTimeout(() => controller.abort(), 1600);
  try {
    const result = await runAgent({...base(), signal: controller.signal, onStep: event => events.push(event),
      takeInput: async () => {if (!ready || changed) return null; changed = true; return {text: '배송비 대신 상품 제목만 설명하세요.'};},
      complete: async () => {
        if (++rounds === 1 || rounds === 3 || rounds === 4) return call('read_page');
        if (rounds === 2) return call('delegate_analysis', {tasks: tasks(6)});
        assert(changed); assert(rounds < 10); gate.resolve(); return {content: '상품 제목'};
      }, execute: async name => {assert.equal(name, 'read_page'); if (++reads === 3) timer = setTimeout(() => {ready = true;}, 15); return {text: '상품 제목'};},
      completeAnalysis: async wire => {assert(JSON.parse(wire[1].content).task.startsWith('상품 정보')); await gate.promise; return report(wire);},
      reviewGoal: async () => ({status: 'complete'})});
    assert.equal(result.content, '상품 제목'); assert(!events.some(event => event.tool === 'analysis_recovery'));
    assert.equal(events.filter(event => event.tool === 'analysis_page' && event.analysis?.delivered).length, 6);
  } finally {gate.resolve(); clearTimeout(timer); clearTimeout(deadline);}
});

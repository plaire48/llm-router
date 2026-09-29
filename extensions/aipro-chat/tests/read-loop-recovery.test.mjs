import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const goal = '배송비를 확인하고 없으면 확인한 범위만 설명하세요. 구매하지 마세요.';
const base = () => ({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal});
function analyst(wire, selected) {
  assert.deepEqual(selected.map(tool => tool.function.name), ['read_analysis_evidence']);
  const brief = JSON.parse(wire[1].content), id = brief.evidence[0].evidence_id;
  assert.match(brief.task, /Repeated reading or navigation/); assert.match(brief.task, /구매하지 마세요/);
  assert.doesNotMatch(brief.task, /failed an independent review/);
  if (!wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: id});
  return {content: JSON.stringify({status: 'complete', summary: '현재 근거에 배송비가 없습니다.',
    findings: [{text: '상품 제목만 읽었습니다.', evidence_ids: [id]}], uncertainties: ['배송비 미확인'], next_step: '배송비 구간을 읽고 확인한 범위를 설명하세요.'})};
}

test('unchanged reads receive one restricted analyst and a focused read before final verification', async () => {
  let rounds = 0, children = 0, reviews = 0; const actions = [], events = [];
  const result = await runAgent({...base(), onStep: event => events.push(event),
    complete: async wire => {
      if (++rounds <= 2) return call('read_page');
      if (rounds === 3) {assert(JSON.stringify(wire).includes('Delegated analysis returned.')); return call('read_page', {query: '배송비'});}
      assert.equal(rounds, 4); return {content: '배송비는 3000원입니다.'};
    }, execute: async (name, args) => {actions.push(name); assert.equal(name, 'read_page'); return {text: args.query ? '배송비 3000원' : '상품 제목'};},
    reviewGoal: async ({evidence}) => {reviews++; assert(evidence.some(item => item.result.text === '배송비 3000원')); return {status: 'complete'};},
    completeAnalysis: async (wire, selected) => {children++; return analyst(wire, selected);}});
  assert.equal(result.content, '배송비는 3000원입니다.'); assert.equal(children, 2); assert.equal(reviews, 1);
  assert.deepEqual(actions, ['read_page', 'read_page', 'read_page']);
  assert.equal(events.filter(event => event.tool === 'analysis_recovery' && event.status === 'queued').length, 1);
});

test('ignoring recovery advice pauses a technical loop without inventing a missing user requirement', async () => {
  let rounds = 0, children = 0; const actions = [];
  const result = await runAgent({...base(), complete: async () => {assert(++rounds <= 3); return call('read_page');},
    execute: async (name, args) => {actions.push(name); if (name === 'read_page') return {text: '상품 제목'};
      assert.equal(name, 'ask_user'); assert.match(args.question, /같은 내용을 반복/);
      assert.deepEqual(args.choices.map(choice => choice.label), ['다시 확인', '중지']); return {requiresUserInput: true};},
    completeAnalysis: async (wire, selected) => {children++; return analyst(wire, selected);}});
  assert.equal(result.awaitingUser, true); assert.equal(children, 2);
  assert.deepEqual(actions, ['read_page', 'read_page', 'read_page', 'ask_user']);
});

test('a new user instruction cancels the slow loop analyst and withholds obsolete advice', async () => {
  let rounds = 0, inputReady = false, changed = false, aborted = false, timer;
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 1800);
  try {
    const result = await runAgent({...base(), signal: controller.signal,
      takeInput: async () => {if (!inputReady || changed) return null; changed = true; return {text: '배송비는 그만하고 상품 제목만 알려주세요.'};},
      complete: async wire => {if (++rounds <= 2) return call('read_page'); assert(changed); assert(!JSON.stringify(wire).includes('Delegated analysis returned.')); return {content: '상품 제목'};},
      execute: async name => {assert.equal(name, 'read_page'); return {text: '상품 제목'};}, reviewGoal: async () => ({status: 'complete'}),
      completeAnalysis: async (_wire, _selected, {signal}) => {timer = setTimeout(() => {inputReady = true;}, 15);
        await new Promise((_, reject) => signal.addEventListener('abort', () => {aborted = true; reject(Error('cancelled'));}, {once: true}));}});
    assert.equal(result.content, '상품 제목'); assert(aborted); assert(!controller.signal.aborted);
  } finally {clearTimeout(timer); clearTimeout(deadline);}
});

test('uncertain writes cannot start automatic read-loop analysis or clear their outcome fence', async () => {
  let rounds = 0, questions = 0;
  const result = await runAgent({...base(), resumeUncertainAction: true,
    complete: async () => ++rounds <= 3 ? call('read_page') : call('ask_user', {question: '실제 저장 상태를 확인해 주세요.'}),
    execute: async name => name === 'read_page' ? {text: '동일한 페이지'} : (questions++, {requiresUserInput: true}),
    completeAnalysis: async () => assert.fail('Uncertain writes must not trigger automatic loop recovery')});
  assert.equal(result.awaitingUser, true); assert.equal(questions, 1);
});

test('a source recheck after a useful delegated report does not launch another recovery analyst', async () => {
  let rounds = 0, children = 0; const events = [];
  const result = await runAgent({...base(), onStep: event => events.push(event),
    complete: async () => {
      if (++rounds === 1 || rounds === 4) return call('read_page');
      if (rounds === 2) return call('delegate_analysis', {tasks: [{role: 'page', effort: 'quick', task: '상품 제목 확인',
        evidence_ids: ['ev_1'], constraints: '읽은 근거만 사용', done_when: '상품 제목 인용'}]});
      if (rounds === 3) return call('collect_analysis', {wait: true});
      assert.equal(rounds, 5); return {content: '읽은 범위에는 상품 제목만 있습니다.'};
    }, execute: async name => {assert.equal(name, 'read_page'); return {text: '상품 제목'};},
    reviewGoal: async () => ({status: 'complete'}), completeAnalysis: async wire => {
      children++; const brief = JSON.parse(wire[1].content); assert.equal(brief.task, '상품 제목 확인');
      if (!wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: 'ev_1'});
      return {content: JSON.stringify({status: 'complete', summary: '상품 제목을 확인했습니다.', findings: [{text: '상품 제목', evidence_ids: ['ev_1']}], uncertainties: [], next_step: ''})};
    }});
  assert(result.content.includes('상품 제목')); assert.equal(children, 2);
  assert(!events.some(event => event.tool === 'analysis_recovery'));
});

test('rewording the query on one unchanged source starts one analyst, not one per query', async () => {
  let rounds = 0, children = 0; const events = [], queries = [];
  const page = {ok: true, dataKind: 'page_content', url: 'https://rules.example/technical.pdf', source_key: 'a'.repeat(64), content_hash: 'b'.repeat(64), frame: 0, characters: 157243,
    ranges: [{start: 69532, end: 69700, markdown: '규정 본문의 같은 구간입니다. '.repeat(8)}], next_offset: 1, queryFiltered: true, coverage: {partial: true}};
  const result = await runAgent({...base(), onStep: event => events.push(event),
    complete: async () => {assert(++rounds <= 12, 'the loop must end'); return call('read_page', {mode: 'content', query: `유효 부위 ${rounds}`});},
    execute: async (name, args) => {
      if (name === 'ask_user') return {requiresUserInput: true};
      queries.push(args.query); return structuredClone(page);
    },
    completeAnalysis: async (wire, selected) => {children++;
      const brief = JSON.parse(wire[1].content), id = brief.evidence[0].evidence_id;
      return {content: JSON.stringify({status: 'complete', summary: '같은 구간만 반복해서 읽었습니다.', findings: [{text: '다른 구간을 읽어야 합니다.', evidence_ids: brief.evidence_reads?.length ? [id] : []}].filter(item => item.evidence_ids.length), uncertainties: ['유효 부위 조항 미확인'], next_step: '목차에서 조항 위치를 찾아 그 구간을 읽으세요.'})};
    }});
  assert.equal(result.awaitingUser, true);
  assert(new Set(queries).size >= 3, 'the model did reword its query');
  assert.equal(events.filter(event => event.tool === 'analysis_recovery' && event.status === 'queued').length, 1);
  assert(children <= 2);
});

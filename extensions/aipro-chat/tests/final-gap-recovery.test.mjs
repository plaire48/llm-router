import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const goal = '페이지에서 배송비를 확인하세요. 없으면 읽은 범위와 미확인 사항을 설명하세요. 구매하지 마세요.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const base = () => ({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal});
const revise = () => ({status: 'revise', checks: [{requirement: '배송비 또는 미확인 범위', status: 'unknown', evidence_ids: []}], next_step: '배송비 안내를 읽고 확인한 범위를 설명하세요.'});
function advice(wire, selected) {
  assert.deepEqual(selected.map(tool => tool.function.name), ['read_analysis_evidence']);
  const brief = JSON.parse(wire[1].content);
  assert.match(brief.task, /final task answer/); assert.match(brief.task, /구매하지 마세요/);
  assert.match(brief.task, /배송비 안내/); assert(brief.evidence_reads.length);
  return {content: JSON.stringify({status: 'complete', summary: '배송비 안내 확인이 필요합니다.',
    findings: [{text: '현재 근거는 상품 제목만 포함합니다.', evidence_ids: brief.evidence.map(item => item.evidence_id)}],
    uncertainties: [], next_step: 'read_page로 배송비 부분을 확인하세요.'})};
}
test('unchanged final gaps get one frozen-source analyst before a focused read and a new final review', async () => {
  let rounds = 0, reviews = 0, children = 0; const executed = [], events = [];
  const result = await runAgent({...base(), onStep: event => events.push(event),
    complete: async wire => {
      if (++rounds === 1) return call('read_page');
      if (rounds === 4) {assert(JSON.stringify(wire).includes('Delegated analysis returned.')); return call('read_page', {query: '배송비'});}
      assert(rounds <= 5); return {content: rounds < 4 ? '상품을 확인했습니다.' : '배송비 안내를 확인했습니다.'};
    }, execute: async name => {executed.push(name); assert.equal(name, 'read_page'); return {text: executed.length === 1 ? '상품 제목' : '배송비 3000원'};},
    reviewGoal: async ({evidence}) => {reviews++; return evidence.length > 1 ? {status: 'complete'} : revise();},
    completeAnalysis: async (wire, selected) => {children++; return advice(wire, selected);}});
  assert.equal(result.content, '배송비 안내를 확인했습니다.'); assert.equal(reviews, 3); assert.equal(children, 1);
  assert.deepEqual(executed, ['read_page', 'read_page']); assert(events.some(event => event.tool === 'analysis_recovery' && event.analysis?.delivered));
});
test('advice and candidate rewording alone never become progress or trigger repeated workers', async () => {
  let rounds = 0, children = 0; const executed = [];
  const result = await runAgent({...base(), complete: async () => {assert(rounds < 6); return ++rounds === 1 ? call('read_page') : {content: `새 표현 ${rounds}`};},
    execute: async (name, args) => {executed.push(name); if (name === 'read_page') return {text: '상품 제목'};
      assert.equal(name, 'ask_user'); assert.match(args.question, /같은 완료 조건을 검증하지 못했습니다/);
      assert.deepEqual(args.choices.map(choice => choice.label), ['다시 확인', '중지']); return {requiresUserInput: true};},
    reviewGoal: async () => revise(), completeAnalysis: async (wire, selected) => {children++; return advice(wire, selected);}});
  assert.equal(children, 1); assert.equal(result.awaitingUser, true); assert.equal(result.content, ''); assert.deepEqual(executed, ['read_page', 'ask_user']);
});
test('a blocked final review asks the genuine user decision without autonomous repair', async () => {
  let rounds = 0; const questions = [];
  const result = await runAgent({...base(), complete: async () => ++rounds === 1 ? call('read_page') : {content: '후보'},
    execute: async (name, args) => name === 'read_page' ? {text: '상품 두 개'} : (questions.push(args.question), {requiresUserInput: true}),
    reviewGoal: async () => ({...revise(), status: 'blocked', next_step: '두 상품 중 어느 상품인가요?'}),
    completeAnalysis: async () => assert.fail('User intent cannot be guessed by a worker')});
  assert.equal(result.awaitingUser, true); assert.deepEqual(questions, ['두 상품 중 어느 상품인가요?']);
});
test('steering cancels final recovery and withholds the obsolete report', async () => {
  let rounds = 0, queued = false, changed = false, aborted = false, start;
  const started = new Promise(resolve => {start = resolve;});
  const result = await runAgent({...base(), onStep: event => {if (event.tool === 'analysis_recovery' && event.status === 'queued') queued = true;},
    takeInput: async () => {if (!queued || changed) return null; await started; changed = true; return {text: '배송비 조사를 그만하고 상품 제목만 설명하세요.'};},
    complete: async wire => {if (++rounds === 1) return call('read_page'); if (changed) assert(!JSON.stringify(wire).includes('Delegated analysis returned.')); return {content: '상품 제목'};},
    execute: async name => {assert.equal(name, 'read_page'); return {text: '상품 제목'};}, reviewGoal: async () => changed ? {status: 'complete'} : revise(),
    completeAnalysis: async (_wire, _selected, {signal}) => {start(); await new Promise((_, reject) => signal.addEventListener('abort', () => {aborted = true; reject(Error('cancelled'));}, {once: true}));}});
  assert(aborted); assert.equal(result.content, '상품 제목');
});
test('without an analyst connection the technical pause does not invent missing user requirements', async () => {
  let rounds = 0;
  const result = await runAgent({...base(), complete: async () => ++rounds === 1 ? call('read_page') : {content: '후보'},
    execute: async (name, args) => {if (name === 'read_page') return {text: '상품 제목'}; assert.match(args.question, /같은 완료 조건을 검증하지 못했습니다/); return {requiresUserInput: true};}, reviewGoal: async () => revise()});
  assert.equal(result.awaitingUser, true);
});
test('steering arriving after collection starts cancels a slow worker before its response arrives', async () => {
  const controller = new AbortController(); let rounds = 0, inputReady = false, changed = false, aborted = false, inputTimer;
  const deadline = setTimeout(() => controller.abort(), 1500);
  try {
    const result = await runAgent({...base(), signal: controller.signal,
      takeInput: async () => {if (!inputReady || changed) return null; changed = true; return {text: '배송비 조사를 그만하고 제목만 설명하세요.'};},
      complete: async () => ++rounds === 1 ? call('read_page') : {content: '상품 제목'},
      execute: async name => {assert.equal(name, 'read_page'); return {text: '상품 제목'};},
      reviewGoal: async () => changed ? {status: 'complete'} : revise(),
      completeAnalysis: async (_wire, _selected, {signal}) => {
        inputTimer = setTimeout(() => {inputReady = true;}, 15);
        await new Promise((_, reject) => signal.addEventListener('abort', () => {aborted = true; reject(Error('cancelled'));}, {once: true}));
      }});
    assert(aborted); assert(changed); assert(!controller.signal.aborted); assert.equal(result.content, '상품 제목');
  } finally {clearTimeout(deadline); clearTimeout(inputTimer);}
});
test('independently narrowing final-answer omissions can finish without redundant page reads or user interruption', async()=>{
 let rounds=0,reviews=0;const executed=[];
 const result=await runAgent({...base(),complete:async()=>{
  assert(++rounds<=5);if(rounds===1)return call('read_page');return {content:`전체 결과 ${rounds}`};
 },execute:async name=>{executed.push(name);assert.equal(name,'read_page');return {text:'원문 A B C'};},
 reviewGoal:async()=>{reviews++;return reviews===4?{status:'complete'}:{status:'revise',checks:['A','B','C'].map((requirement,index)=>({requirement,status:index<reviews-1?'met':'unmet',evidence_ids:[1]})),next_step:'원문에 있는 누락 결과를 포함한 전체 답변을 작성하세요.'};},
 completeAnalysis:async()=>assert.fail('shrinking reviewed gaps should not start a recovery worker')});
 assert.equal(reviews,4);assert.equal(result.content,'전체 결과 5');assert.deepEqual(executed,['read_page']);
});

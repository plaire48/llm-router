import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const goal = '공개 자료에서 선수의 종목과 소속을 알려줘. 오래된 소속은 구분하고 확인한 출처만 붙여 줘.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const reviewed = (met, gaps, prefix = '요구사항') => ({status: 'revise',
  checks: Array.from({length: met + gaps}, (_, index) => ({requirement: `${prefix} ${index}`, status: index < met ? 'met' : 'unknown', evidence_ids: index < met ? [1] : []})),
  next_step: '근거 없는 주장을 제거하고 원래 요청 전체의 결과와 출처를 다시 작성하세요.'});
const complete = {status: 'complete', checks: [{requirement: '원래 요청 전체', status: 'met', evidence_ids: [1]}], next_step: ''};

async function sequence(reviews, {answers, steering, extraReadAt, nextReview} = {}) {
  let rounds = 0, reviewedCount = 0, children = 0, reads = 0, changed = false;
  const executed = [], events = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true,
    signal: new AbortController().signal, onStep: event => events.push(event),
    takeInput: steering ? async () => {
      if (reviewedCount !== steering.afterReview || changed) return null;
      changed = true; return {text: '추가로 선수의 생년월일도 같은 출처 범위에서 알려줘.'};
    } : undefined,
    complete: async () => {
      assert(++rounds < 12, 'correction feedback must not sustain a self-loop');
      if (rounds === 1 || rounds === extraReadAt) return call('read_page', rounds === 1 ? {} : {query: '추가 원문'});
      return {content: answers?.[reviewedCount] ?? `원래 요청 전체를 포함한 답변 수정 ${rounds}`};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'read_page') return {url: 'https://example.test/source', text: ++reads === 1 ? '펜싱 사브르 선수. 소속은 검색 스니펫 기준 잠정 판단.' : '새로 읽은 실제 출처. 추가 사실을 확인했습니다.'};
      assert.equal(name, 'ask_user'); assert.match(args.question, /같은 완료 조건을 검증하지 못했습니다/);
      return {requiresUserInput: true};
    },
    reviewGoal: async payload => {
      const index = reviewedCount++;
      return nextReview ? nextReview({index, changed, payload}) : reviews[Math.min(index, reviews.length - 1)];
    },
    completeAnalysis: async wire => {
      children++;
      const brief = JSON.parse(wire[1].content);
      return {content: JSON.stringify({status: 'partial', summary: '관찰된 원문에 근거 없는 주장을 삭제하세요.',
        findings: [{text: '원문은 잠정 소속만 뒷받침합니다.', evidence_ids: brief.evidence.map(item => item.evidence_id)}],
        uncertainties: ['추가 소속 이력은 원문에 없습니다.'], next_step: '현재 답변에서 확인하지 않은 주장과 URL을 제거하세요.'})};
    }});
  return {result, reviewedCount, children, executed, events, changed};
}

test('E08 can correct a newly exposed unsupported claim after confirmed 5-check 2-to-1 gap progress', async () => {
  const first = reviewed(3, 2, '종목 및 소속 시점과 두 번째 URL');
  first.checks.at(-1).status = 'unmet'; // Actual E08: three met, one unknown, one unmet.
  const corrected = reviewed(4, 1, '동명이인 구분과 과거 성남시청 주장');
  assert(!first.checks.some(a => corrected.checks.some(b => a.requirement === b.requirement)));
  const run = await sequence([first, first, corrected, complete]);
  assert.equal(run.reviewedCount, 4); assert.equal(run.children, 1);
  assert.deepEqual(run.executed, ['read_page']); assert(!run.result.awaitingUser);
  assert.match(run.result.content, /원래 요청 전체/);
  assert(run.events.some(event => event.tool === 'analysis_recovery' && event.analysis?.delivered));
});

test('reworded gaps, new candidate wording and a delivered worker ID cannot renew final repair', async () => {
  const run = await sequence([reviewed(3, 2, 'A'), reviewed(3, 2, 'B'), reviewed(3, 2, 'C')]);
  assert.equal(run.children, 1); assert.equal(run.reviewedCount, 3);
  // Repair is not renewed. With no unmet check in a read-only run the answer
  // is released as unverified instead of being withheld behind a question.
  assert(!run.result.awaitingUser); assert.equal(run.result.reviewLimited, true); assert.match(run.result.content, /검증 완료가 아닙니다/); assert.deepEqual(run.executed, ['read_page']);
});

test('2-to-1-to-2-to-1 gap oscillation cannot reuse an earlier improvement', async () => {
  const run = await sequence([reviewed(3, 2), reviewed(4, 1), reviewed(3, 2), reviewed(4, 1)]);
  assert.equal(run.children, 1); assert.equal(run.reviewedCount, 4); assert(!run.result.awaitingUser); assert.equal(run.result.reviewLimited, true); assert.match(run.result.content, /검증 완료가 아닙니다/);
  assert.deepEqual(run.executed, ['read_page']);
});

test('shrinking the checklist cannot count as an answer correction even when met increases', async () => {
  const run = await sequence([reviewed(2, 3), reviewed(3, 1), reviewed(3, 1)]);
  assert.equal(run.children, 1); assert(!run.result.awaitingUser); assert.equal(run.result.reviewLimited, true); assert.match(run.result.content, /검증 완료가 아닙니다/);
  assert.deepEqual(run.executed, ['read_page']);
});

test('reviewer variability on the exact same answer cannot establish correction progress', async () => {
  const run = await sequence([reviewed(3, 2), reviewed(4, 1), reviewed(4, 1)], {answers: ['동일한 전체 답변', '동일한 전체 답변', '동일한 전체 답변']});
  assert.equal(run.children, 1); assert(!run.result.awaitingUser); assert.equal(run.result.reviewLimited, true); assert.match(run.result.content, /검증 완료가 아닙니다/);
});

test('after the repair budget is spent a lookup with an unmet check is released with that check stated', async () => {
  const gap = reviewed(3, 2); gap.checks.at(-1).status = 'unmet';
  const run = await sequence([gap, gap, gap]);
  assert.equal(run.children, 1); assert(!run.result.awaitingUser); assert.equal(run.result.reviewLimited, true);
  assert.match(run.result.content, /검증 완료가 아닙니다/); assert.match(run.result.content, /- \(충족되지 않음\) 요구사항 4/); assert.match(run.result.content, /- \(확인하지 못함\) 요구사항 3/);
  assert.deepEqual(run.executed, ['read_page']);
});

test('without a majority of met checks an unmet check still withholds the answer and asks', async () => {
  const gap = reviewed(2, 2); gap.checks.at(-1).status = 'unmet';
  const run = await sequence([gap, gap, gap]);
  assert(run.result.awaitingUser); assert.equal(run.result.content, '');
  assert.equal(run.executed.at(-1), 'ask_user');
});

test('a new explicit user request gets a fresh correction frontier without relaxing its final review', async () => {
  const run = await sequence([], {steering: {afterReview: 2}, nextReview: ({index, changed}) => {
    if (!changed) return index === 0 ? reviewed(3, 2) : reviewed(4, 1);
    return index === 2 ? reviewed(3, 2, '새 사용자 요청') : index === 3 ? reviewed(4, 1, '추가 생년월일') : complete;
  }});
  assert(run.changed); assert.equal(run.reviewedCount, 5); assert.equal(run.children, 0); assert(!run.result.awaitingUser);
  assert.deepEqual(run.executed, ['read_page']);
});

test('new external source content establishes a separate correction frontier within the round limit', async () => {
  const run = await sequence([reviewed(3, 2), reviewed(4, 1), complete], {extraReadAt: 3});
  assert.equal(run.reviewedCount, 3); assert.equal(run.children, 0); assert(!run.result.awaitingUser);
  assert.equal(run.result.reviewLimited, undefined);
  assert.deepEqual(run.executed, ['read_page', 'read_page']);
});

test('a lookup that still has a gap at the fourth review is released with it instead of being reviewed again', async () => {
  // Measured over 75 runs: 45 of the 47 answers that passed did so within three revisions.
  const run = await sequence([reviewed(3, 2), reviewed(4, 1), reviewed(3, 2), reviewed(4, 1), complete], {extraReadAt: 4});
  assert.equal(run.reviewedCount, 4); assert(!run.result.awaitingUser); assert.equal(run.result.reviewLimited, true);
  assert.match(run.result.content, /독립 검토를 4회 거쳤지만/); assert.match(run.result.content, /- \(확인하지 못함\) 요구사항 4/);
});

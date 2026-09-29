import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {reviewEvidence, goalReviewMessages} from '../goal-review.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const source = (path, hash, markdown = '관찰한 출처의 조건') => ({ok: true, dataKind: 'page_content', url: `https://example.test/${path}`, frame: 0,
  content_hash: hash.repeat(64), characters: markdown.length, ranges: [{start: 0, end: markdown.length, markdown}],
  coverage: {partial: true}, queryFiltered: true, scope: 'Reference excerpts, not browser action evidence.'});
const base = () => ({goal: '두 출처의 조건을 비교해줘', messages: [{role: 'user', content: '두 출처의 조건을 비교해줘'}], tools,
  signal: new AbortController().signal, harness: true});

test('navigation preserves both source excerpts for comparison while retiring old live DOM evidence', async () => {
  let round = 0;
  await runAgent({...base(), complete: async () => {
    round++;
    if (round === 1) return call('read_page', {mode: 'content'});
    if (round === 2) return call('browser_snapshot');
    if (round === 3) return call('navigate_page', {url: 'https://example.test/b'});
    if (round === 4) return call('read_page', {mode: 'content'});
    return {content: '열람한 두 출처의 일부 조건을 비교했습니다.'};
  }, execute: async name => name === 'read_page' ? source(round === 1 ? 'a' : 'b', round === 1 ? 'a' : 'b') :
    name === 'browser_snapshot' ? {url: 'https://example.test/a', frames: [{frame: 0, elements: [{ref: 'old-button', name: '실행'}]}]} : {ok: true, url: 'https://example.test/b'},
  reviewGoal: async ({phase, evidence}) => {
    if (phase === 'checkpoint') return {status: 'revise', next_step: '다른 출처를 확인하세요.'};
    const references = evidence.filter(item => item.result?.dataKind === 'page_content');
    assert.equal(references.length, 2);
    assert(references.every(item => item.usable && !item.superseded));
    assert(references.every(item => item.result.coverage.partial && item.result.queryFiltered));
    assert.equal(evidence.find(item => item.tool === 'browser_snapshot').usable, false);
    const review = goalReviewMessages({goal: base().goal, history: [], evidence, answer: '', inputBudget: 8000});
    const payload = JSON.parse(review.messages[1].content);
    assert(references.every(item => payload.citeable_evidence_ids.includes(item.id)));
    return {status: 'complete'};
  }});
});

test('a changed content hash retires only the earlier version of the same URL and frame', async () => {
  let round = 0;
  await runAgent({...base(), complete: async () => ++round <= 3 ? call('read_page', {mode: 'content'}) : {content: '새 원문으로 비교했습니다.'},
    execute: async () => source(round === 2 ? 'b' : 'a', round === 3 ? 'c' : round === 2 ? 'b' : 'a'),
    reviewGoal: async ({phase, evidence}) => {
      if (phase === 'checkpoint') return {status: 'revise', next_step: '현재 원문을 확인하세요.'};
      assert.equal(evidence[0].usable, false);
      assert.equal(evidence[0].superseded, true);
      assert.equal(evidence[1].usable, true);
      assert.equal(evidence[2].usable, true);
      return {status: 'complete'};
    }});
});

test('review cannot silently trim one side of a source comparison to fit the context budget', () => {
  const evidence = ['a', 'b'].map((key, index) => reviewEvidence(index + 1, 'read_page', {mode: 'content'}, source(key, key, 'Detailed observed source conditions '.repeat(280))));
  assert(evidence.every(item => item.usable));
  const adequate = goalReviewMessages({goal: '두 출처 비교', history: [], evidence, answer: '', inputBudget: 10000});
  assert.equal(adequate.evidence.filter(item => item.usable).length, 2);
  assert.throws(() => goalReviewMessages({goal: '두 출처 비교', history: [], evidence, answer: '', inputBudget: 4000}), /goal_review_failed/);
});

test('failed or malformed content cannot be retained as a citeable source', () => {
  for (const value of [{...source('a', 'a'), error: 'read_failed'}, {...source('a', 'a'), ok: false}, {...source('a', 'a'), content_hash: 'invalid'},
    {...source('a', 'a'), ranges: []}, source('a', 'a', '')]) {
    const item = reviewEvidence(1, 'read_page', {}, value);
    assert.equal(item.usable, false);
  }
});

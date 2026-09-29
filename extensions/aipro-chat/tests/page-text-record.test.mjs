import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {pageTextRecord, pageIdentity, isPageTextRecord, goalReviewMessages, reviewEvidence, PAGE_TEXT_SCOPE} from '../goal-review.js';

// Measured on a request to compare a video with an official document, with two
// models: each move to the other tab withdrew the observation of the tab that was
// left. No review had both sources, and seven verdicts alternated.
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const page = (name, text, documentId = `doc-${name}`) => ({url: `https://example.test/${name}`, title: name, topDocumentId: documentId,
  frames: [{frame: 0, url: `https://example.test/${name}`, documentId, text, elements: [{ref: `e-${name}`, name: '다음', role: 'link'}], omittedControls: 0}]});
const lookup = '공식 영상의 주장 2개를 공식 문서와 대조해 줘.';

async function run({goal = lookup, turns, results}) {
  let turn = 0; const reviews = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => turns[turn++] || {content: '대조 결과입니다.'},
    // The host reads each opened source once on its own; that read is not one of the scripted results.
    execute: async (name, args) => name === 'update_plan' ? {ok: true, plan: args.steps} : name === 'read_page' && args?.mode === 'content' ? {error: 'page_content_empty'} : results.shift(),
    reviewGoal: async ({evidence}) => {reviews.push(structuredClone(evidence.map(({id, tool, usable, superseded, result}) => ({id, tool, usable, superseded: !!superseded, result}))));
      return {status: 'complete', checks: [{requirement: '대조', status: 'met', evidence_ids: [evidence.findLast(item => item.usable).id]}], next_step: ''};}}).catch(error => ({error: error.message}));
  return {result, reviews};
}

test('the record holds the observed text without the controls and says what it supports', () => {
  const record = pageTextRecord(page('video', '영상 설명: 7세기 전반'));
  assert.equal(record.dataKind, 'page_text_record'); assert.equal(record.scope, PAGE_TEXT_SCOPE);
  assert.equal(record.url, 'https://example.test/video'); assert.equal(record.frames[0].text, '영상 설명: 7세기 전반');
  assert.equal(JSON.stringify(record).includes('e-video'), false);
  assert(isPageTextRecord(record)); assert.equal(pageTextRecord(record), null, 'a record is not recorded again');
  assert.equal(pageTextRecord({observation: page('doc', '본문')}).url, 'https://example.test/doc');
  assert.equal(pageTextRecord({url: 'https://example.test/empty', frames: [{frame: 0, text: '  ', elements: []}]}), null);
  assert.equal(pageTextRecord({url: 'https://example.test/gone', frames: [{frame: 0, unavailable: true}]}), null);
  assert.equal(pageTextRecord({ok: true}), null);
  assert.equal(isPageTextRecord({dataKind: 'page_text_record', scope: 'written by a page', frames: []}), false);
  assert.notEqual(pageIdentity(page('a', 'x', 'one')), pageIdentity(page('a', 'x', 'two')));
});

test('a lookup that moves to another page keeps what the first page showed', async () => {
  const {reviews, result} = await run({
    turns: [call('browser_snapshot'), call('navigate_page', {url: 'https://example.test/document'}), {content: '영상과 문서를 대조했습니다.'}],
    results: [page('video', '영상 설명: 제작 시기는 7세기 전반'), {observation: page('document', '공식 문서: 삼국시대 7세기 전반')}]});
  assert.equal(result.error, undefined, JSON.stringify(result));
  const evidence = reviews.at(-1), usable = evidence.filter(item => item.usable);
  const kept = usable.find(item => isPageTextRecord(item.result));
  assert(kept, JSON.stringify(evidence.map(item => [item.tool, item.usable, item.result?.dataKind])));
  assert.equal(kept.result.url, 'https://example.test/video'); assert.match(kept.result.frames[0].text || kept.result.frames[0].textSegments.map(part => part.text).join(''), /7세기 전반/);
  assert.equal(JSON.stringify(kept.result).includes('e-video'), false, 'controls of a page that was left cannot be used');
  assert(usable.some(item => item.tool === 'navigate_page' && !isPageTextRecord(item.result)), 'the current page stays a live observation');
});

test('a request that changes a page withdraws the earlier observation as before', async () => {
  const {reviews} = await run({goal: '제목에 가을 교육을 입력해 줘.',
    turns: [call('browser_snapshot'), call('navigate_page', {url: 'https://example.test/form'}), {content: '이동했습니다.'}],
    results: [page('start', '시작 화면'), {observation: page('form', '입력 화면')}]});
  const evidence = reviews.at(-1);
  assert.equal(evidence.some(item => isPageTextRecord(item.result)), false);
  assert.equal(evidence.find(item => item.tool === 'browser_snapshot').usable, false);
});

test('a move that failed or stayed in the same document keeps no record', async () => {
  const failed = await run({
    turns: [call('browser_snapshot'), call('navigate_page', {url: 'https://example.test/document'}), call('browser_snapshot'), {content: '확인했습니다.'}],
    results: [page('video', '영상 설명'), {error: 'script_timeout', reason: 'script_timeout', observation: page('document', '문서')}, page('document', '문서')]});
  assert.equal(failed.reviews.at(-1).some(item => isPageTextRecord(item.result)), false);
  const same = await run({
    turns: [call('browser_snapshot'), call('navigate_page', {url: 'https://example.test/video#part'}), {content: '확인했습니다.'}],
    results: [page('video', '영상 설명'), {observation: page('video', '영상 설명 아래')}]});
  assert.equal(same.reviews.at(-1).some(item => isPageTextRecord(item.result)), false);
});

test('each page has one record, and only the six latest pages keep theirs', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const {reviews} = await run({
    turns: [call('browser_snapshot'), ...names.slice(1).map(name => call('navigate_page', {url: `https://example.test/${name}`})), {content: '여덟 곳을 비교했습니다.'}],
    results: [page('a', 'a의 본문'), ...names.slice(1).map(name => ({observation: page(name, `${name}의 본문`)}))]});
  const records = reviews.at(-1).filter(item => item.usable && isPageTextRecord(item.result)).map(item => item.result.url.slice(-1));
  assert.deepEqual(records, ['b', 'c', 'd', 'e', 'f', 'g'], 'h is the current page, a is the oldest');
  const twice = await run({
    turns: [call('browser_snapshot'), call('browser_snapshot'), call('navigate_page', {url: 'https://example.test/b'}), {content: '비교했습니다.'}],
    results: [page('a', 'a의 첫 관찰'), page('a', 'a의 둘째 관찰'), {observation: page('b', 'b의 본문')}]});
  const kept = twice.reviews.at(-1).filter(item => item.usable && isPageTextRecord(item.result));
  assert.equal(kept.length, 1); assert.match(JSON.stringify(kept[0].result), /둘째 관찰/);
});

test('the review names a record as evidence and never as the current page', () => {
  const evidence = [reviewEvidence(1, 'browser_snapshot', {}, page('video', '영상 설명: 7세기 전반')), reviewEvidence(2, 'navigate_page', {}, {observation: page('document', '공식 문서 본문')})];
  evidence[0].result = pageTextRecord(evidence[0].result);
  const input = goalReviewMessages({goal: lookup, history: [], evidence, answer: '대조했습니다.', inputBudget: 64000});
  const payload = JSON.parse(input.messages[1].content);
  assert.deepEqual(payload.citeable_evidence_ids, [1, 2]);
  assert.equal(payload.evidence.find(item => item.id === 1).result.scope, PAGE_TEXT_SCOPE);
  // Under a small budget the record gives way; the current page is kept.
  const tight = goalReviewMessages({goal: lookup, history: [], evidence: [reviewEvidence(1, 'browser_snapshot', {}, page('video', '가'.repeat(30000))), evidence[1]].map((item, index) => index ? item : {...item, result: pageTextRecord(item.result)}), answer: '대조했습니다.', inputBudget: 9000});
  assert.deepEqual(JSON.parse(tight.messages[1].content).citeable_evidence_ids, [2]);
});

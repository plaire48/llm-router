import test from 'node:test';
import assert from 'node:assert/strict';
import {settleReadOnlyChecks} from '../review-host-facts.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const facts = (extra = {}) => ({ok: true, dataKind: 'host_tool_dispatch', taskStartObserved: true, noPageInteractionToolsInvoked: true, calls: [{tool: 'read_page', count: 2}], ...extra});
const check = (requirement, status) => ({requirement, status, evidence_ids: status === 'met' ? [1] : []});
const review = checks => ({status: 'revise', checks, next_step: '읽기 전용 준수를 다시 확인하세요.'});

test('a check that asks only for read-only conduct is settled when nothing was clicked or typed', () => {
  for (const wording of ['읽기 전용 조사 준수', '읽기 전용 조사 제한 준수', '읽기 전용으로 조사', 'Read-only research']) {
    const settled = settleReadOnlyChecks(review([check('종목 제시', 'met'), check(wording, 'unknown')]), facts());
    assert.equal(settled.status, 'complete', wording); assert.equal(settled.checks[1].status, 'met'); assert.equal(settled.checks[1].settledBy, 'host_tool_dispatch');
    assert.equal(settled.next_step, '');
  }
});

test('other open checks keep the review in revision and unmet checks are never changed', () => {
  const partial = settleReadOnlyChecks(review([check('읽기 전용 조사 준수', 'unknown'), check('소속 시점', 'unknown')]), facts());
  assert.equal(partial.status, 'revise'); assert.deepEqual(partial.checks.map(item => item.status), ['met', 'unknown']);
  const unmet = review([check('읽기 전용 조사 준수', 'unmet'), check('종목', 'met')]);
  assert.equal(settleReadOnlyChecks(unmet, facts()), unmet);
});

test('wording, source and scope judgments, page interactions and unobserved starts are left to the reviewer', () => {
  for (const wording of ['읽기 전용 조사 준수 및 그에 맞는 표현', '읽기 전용 조사 결과를 출처 인용과 함께 제시', '읽기 전용 준수 여부를 답변에 명시', '확인하지 못한 부분 구분']) {
    const input = review([check('종목', 'met'), check(wording, 'unknown')]);
    assert.equal(settleReadOnlyChecks(input, facts()), input, wording);
  }
  const input = review([check('종목', 'met'), check('읽기 전용 조사 준수', 'unknown')]);
  for (const changed of [{noPageInteractionToolsInvoked: false}, {taskStartObserved: false}, {dataKind: 'other'}]) assert.equal(settleReadOnlyChecks(input, facts(changed)), input);
  const blocked = {...input, status: 'blocked'};
  assert.equal(settleReadOnlyChecks(blocked, facts()), blocked);
  assert.equal(settleReadOnlyChecks({...input, status: 'blocked'}, facts()).status, 'blocked');
  assert.equal(settleReadOnlyChecks(null, facts()), null);
});

test('a lookup whose only open check is read-only conduct is delivered as reviewed after one review', async () => {
  const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
  const goal = '사브르와 에페의 유효 타격 부위 차이를 알려줘.'; let rounds = 0, reviews = 0;
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => ++rounds === 1 ? {calls: [{id: 'a', type: 'function', function: {name: 'read_page', arguments: '{}'}}]} : {content: '에페는 전신, 사브르는 허리 위입니다.'},
    execute: async () => ({url: 'https://rules.example/technical', text: '에페는 전신이 유효면이고 사브르는 허리 위가 유효면입니다. '.repeat(4)}),
    reviewGoal: async () => {reviews++; return review([check('유효 타격 부위 차이 설명', 'met'), check('출처 제시', 'met'), check('읽기 전용 조사 준수', 'unknown')]);}});
  assert.equal(reviews, 1); assert.equal(rounds, 2);
  assert.equal(result.content, '에페는 전신, 사브르는 허리 위입니다.');
  assert.equal(result.reviewSettled, true); assert.equal(result.reviewLimited, undefined);
});

test('the host certifies a run that only searched and followed links, and nothing wider', async () => {
  const {createReviewExecution, projectReviewExecution} = await import('../review-execution.js');
  const target = extra => ({tabId: 1, frameId: 0, topDocumentId: 'top', documentId: 'doc', controlId: 'c1', role: 'combobox', name: '검색어를 입력해 주세요.', tag: 'input', type: 'search', ...extra});
  const input = (method, extra = {}) => ({ok: true, actionIssued: true, inputExecution: {commands: [{method, state: 'returned', actionIssued: true,
    inputReceipt: {dataKind: 'script_input_dispatch', version: 1, method, actionIssued: true, targetStatus: 'observed', target: target(extra), ...(method === 'press' ? {key: 'Enter'} : {readback: {status: 'observed', matchesExpected: true, expectedDigest: 'a'.repeat(64)}})}}], omitted: 0}});
  const click = (role, name, tag, href) => ({ok: true, actionIssued: true, actionTargetReceipt: {dataKind: 'click_target_dispatch', version: 1, status: 'observed', actionIssued: true,
    target: {tabId: 1, frameId: 0, topDocumentId: 'top', documentId: 'doc', role, name, tag, ...(href ? {href} : {})}}});
  const run = steps => {const ledger = createReviewExecution({taskStartObserved: true}); for (const [tool, result] of steps) ledger.complete(ledger.record(tool), result); return ledger.snapshot();};
  const lookup = run([['browser_snapshot', {}], ['fill_form', input('fill')], ['press_key', input('press')], ['read_page', {}], ['click_element', click('link', '기사 제목', 'a', 'https://news.example.test/1')], ['scroll_page', {ok: true}]]);
  assert.equal(lookup.searchAndReadOnly, true); assert.equal(lookup.noPageInteractionToolsInvoked, false);
  const projected = projectReviewExecution(lookup);
  assert(projected.absenceCertificates.includes('only_search_input_and_link_navigation_dispatched')); assert.equal(projected.searchAndReadOnly, undefined);
  assert.equal(run([['fill_form', {ok: false, error: 'browser_stale', actionIssued: false, inputExecution: {commands: [], omitted: 0}}], ['click_element', click('button', '검색', 'button')]]).searchAndReadOnly, true);
  for (const [label, steps] of [
    ['a field that is not a search field', [['fill_form', input('fill', {role: 'textbox', name: '제목', type: 'text'})]]],
    ['a button that is not search', [['click_element', click('button', '등록', 'button')]]],
    ['a script', [['fill_form', input('fill')], ['run_playwright', {ok: true, actionIssued: true, execution: {commands: [], omitted: 0}}]]],
    ['a selection', [['fill_form', input('fill')], ['select_option', {ok: true}]]],
    ['reads only', [['read_page', {}]]]]) assert.equal(run(steps).searchAndReadOnly, false, label);
  const settled = settleReadOnlyChecks(review([check('차이 설명', 'met'), check('읽기 전용 조사 준수', 'unknown')]), lookup);
  assert.equal(settled.status, 'complete');
  const unmet = review([check('차이 설명', 'met'), check('읽기 전용 조사 준수', 'unmet')]);
  assert.equal(settleReadOnlyChecks(unmet, lookup), unmet, 'an unmet verdict is the reviewer\'s and is never changed');
});

test('a prohibition is settled only when no dispatched target carries the prohibited name', async () => {
  const {settleConductChecks} = await import('../review-host-facts.js');
  const video = {clickTargetReceipts: [{actionIssued: true, status: 'observed', target: {role: 'link', tag: 'a', name: '모두에게 열린 박물관, 국립중앙박물관'}}], semanticInputReceipts: []};
  const lookup = facts({noPageInteractionToolsInvoked: false, searchAndReadOnly: true, ...video});
  for (const wording of ['구독·좋아요 금지 준수', '구독·좋아요를 누르지 않음', '구독·좋아요를 하지 않는 읽기 전용 조사', '계정 변경 동작 없음', 'Did not subscribe or like']) {
    const settled = settleConductChecks(review([check('제목·채널·길이 제시', 'met'), check(wording, 'unknown')]), lookup);
    assert.equal(settled.status, 'complete', wording);
  }
  const pressed = facts({noPageInteractionToolsInvoked: false, searchAndReadOnly: true, clickTargetReceipts: [{actionIssued: true, status: 'observed', target: {role: 'link', tag: 'a', name: '채널 구독 안내'}}]});
  const input = review([check('제목 제시', 'met'), check('구독·좋아요 금지 준수', 'unknown')]);
  assert.equal(settleConductChecks(input, pressed), input, 'a target named after the prohibited action is left to the reviewer');
  const other = facts({noPageInteractionToolsInvoked: false, searchAndReadOnly: false, ...video});
  assert.equal(settleConductChecks(input, other), input, 'a run the host cannot certify is left to the reviewer');
  for (const wording of ['영상 길이 확인', '구독하지 않았다고 답변에 명시', '등록 횟수 0']) {
    const content = review([check('제목 제시', 'met'), check(wording, 'unknown')]);
    assert.equal(settleConductChecks(content, lookup), content, wording);
  }
});

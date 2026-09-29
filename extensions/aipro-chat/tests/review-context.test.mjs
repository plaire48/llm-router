import test from 'node:test';
import assert from 'node:assert/strict';
import {goalReviewMessages, parseGoalReview, reviewEvidence} from '../goal-review.js';
import {clearDuplicateObservations} from '../context-evidence.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {CLARIFICATION_PROMPT} from '../user-question.js';

const restriction = '검토용 초안만 작성하고 보내거나 등록하지 마세요. 제목과 본문을 모두 확인하세요.';
const snapshot = (id, text = '검토할 본문') => ({id, title: '초안', url: 'https://example.test/draft', frames: [{frame: 0, text,
  elements: [{ref: `e-${id}`, id: 'body', role: 'textbox', name: '본문'}]}]});
const read = (id, result) => [{role: 'assistant', content: '', tool_calls: [{id, type: 'function', function: {name: 'read_page', arguments: '{}'}}]},
  {role: 'tool', tool_call_id: id, content: JSON.stringify(result)}];
const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const response = value => ({content: JSON.stringify(value)});

test('review context retains original user restrictions before obsolete observations and assistant narration', () => {
  const history = [{role: 'user', content: restriction}, {role: 'assistant', content: 'OLD_NARRATION '.repeat(1800)}, {role: 'user', content: '계속해줘'}];
  const evidence = Array.from({length: 12}, (_, i) => ({...reviewEvidence(i + 1, 'read_page', {}, snapshot(String(i), `OLD_PAGE_${i} ` + 'old '.repeat(2300))), usable: false, superseded: true}));
  evidence.push(reviewEvidence(13, 'verify_page', {checks: [{kind: 'text_present', expected: '초안'}]}, {ok: true, verified: true, checks: [{passed: true}]}));
  const original = structuredClone({history, evidence});
  const result = goalReviewMessages({goal: '계속해줘', history, evidence, answer: '초안을 확인했습니다.', inputBudget: 8000});
  const payload = JSON.parse(result.messages[1].content);
  assert(payload.conversation.some(message => message.content === restriction));
  assert.equal(result.evidence.at(-1).id, 13);
  assert(!result.messages[1].content.includes('OLD_PAGE_'));
  assert(payload.omitted);
  assert.deepEqual({history, evidence}, original);
  assert.throws(() => parseGoalReview(response({status: 'complete', checks: [{requirement: '초안', status: 'met', evidence_ids: [1]}], next_step: ''}), result.evidence), /goal_review_failed/);
});

test('an oversized user requirement fails review instead of being silently forgotten', () => {
  assert.throws(() => goalReviewMessages({goal: '계속', history: [{role: 'user', content: restriction + '요구사항 '.repeat(8000)}, {role: 'user', content: '계속'}],
    evidence: [reviewEvidence(1, 'read_page', {}, snapshot('latest'))], answer: '', inputBudget: 8000}), /goal_review_failed/);
});

test('long literal requirements use the available model budget instead of an arbitrary character cutoff', () => {
  const requirements = restriction + '원본 요구사항을 보존합니다. '.repeat(3200);
  const result = goalReviewMessages({goal: '계속', history: [{role: 'user', content: requirements}],
    evidence: [reviewEvidence(1, 'read_page', {}, snapshot('latest'))], answer: '', inputBudget: 221184});
  assert(JSON.parse(result.messages[1].content).conversation.some(message => message.content === requirements));
  assert(result.evidence[0].usable);
});

test('new observation IDs do not prevent lossless duplicate clearing; actual element IDs still matter', () => {
  const wire = Array.from({length: 5}, (_, i) => read(String(i), snapshot(String(i)))).flat();
  const original = structuredClone(wire), packed = clearDuplicateObservations(wire);
  assert.equal(packed.filter(message => message.content?.includes('contextCleared')).length, 3);
  assert.deepEqual(packed.slice(-4), wire.slice(-4));
  assert.deepEqual(wire, original);
  const changed = snapshot('different'); changed.frames[0].elements[0].id = 'recipient';
  const varied = [...read('distinct', changed), ...wire];
  assert.deepEqual(clearDuplicateObservations(varied)[1], varied[1]);
});

test('review prunes only redundant reads and keeps changed state, failed checks and document evidence', () => {
  const evidence = [reviewEvidence(1, 'read_page', {}, snapshot('first', '이전 사실')), ...Array.from({length: 6}, (_, i) => reviewEvidence(i + 2, 'read_page', {}, snapshot(`read-${i}`))),
    reviewEvidence(8, 'verify_page', {checks: [{kind: 'text_present', expected: '저장됨'}]}, {ok: false, error: 'verification_failed', verified: false}),
    reviewEvidence(9, 'wiki_read', {}, {dataKind: 'project_reference', content: '문서에 명시된 제약'})];
  const result = goalReviewMessages({goal: '결과 확인', history: [], evidence, answer: '', inputBudget: 16000});
  assert(result.evidence.some(item => item.id === 1));
  assert(result.evidence.some(item => item.id === 8 && item.usable === false));
  assert(result.evidence.some(item => item.id === 9));
  assert.equal(result.evidence.filter(item => item.tool === 'read_page').length, 3);
});

test('final review does not mistake fresh read IDs or focus changes for corrected results', async () => {
  let round = 0, reads = 0, reviews = 0, questions = 0;
  const result = await runAgent({messages: [{role: 'user', content: restriction}], tools: browserTools({}, BUILTIN_SKILLS[0]), harness: true,
    signal: new AbortController().signal,
    complete: async messages => {
      if (messages.at(-1).content?.startsWith(CLARIFICATION_PROMPT)) return call('ask_user', {question: '본문에 포함할 검토 의견을 알려주세요.', input_mode: 'long_text'});
      assert(++round < 12, 'unchanged reviews must not loop indefinitely');
      return round % 2 ? call('read_page') : {content: '확인했습니다.', calls: null};
    },
    execute: async name => {
      if (name === 'ask_user') {questions++; return {requiresUserInput: true};}
      const value = snapshot(`read-${++reads}`); value.frames[0].elements[0].focused = reads % 2 === 0; return value;
    },
    reviewGoal: async () => {reviews++; return {status: 'revise', checks: [{requirement: '검토 의견', status: 'unknown', evidence_ids: []}], next_step: '본문의 검토 의견을 확인하세요.'};},
  });
  assert.equal(result.awaitingUser, true);
  assert.equal(reads, 2); assert.equal(reviews, 2); assert.equal(questions, 1);
});

test('correcting a different observed field is real progress even when values and check outcomes match', async () => {
  let round = 0, revision = 0, reviews = 0;
  const view = () => ({url: 'https://example.test/draft', frames: [{frame: 0, elements: ['title', 'body', 'note'].map(id => ({ref: `${id}-${revision}`, id, role: 'textbox', name: id}))}]});
  const result = await runAgent({messages: [{role: 'user', content: '세 항목에 같은 내용을 작성해줘'}], tools: browserTools({}, BUILTIN_SKILLS[0]), harness: true,
    signal: new AbortController().signal,
    complete: async messages => {
      assert(!messages.at(-1).content?.startsWith(CLARIFICATION_PROMPT), 'a different target correction must not be treated as the same attempt');
      if (++round === 1) return call('read_page');
      const position = (round - 2) % 3, target = ['title', 'body', 'note'][Math.floor((round - 2) / 3)];
      if (position === 0) return call('fill_form', {fields: [{field_id: `${target}-${revision}`, value: '검토'}]});
      if (position === 1) return call('verify_page', {checks: [{kind: 'field_value', ref: `${target}-${revision}`, expected: '검토'}]});
      return {content: '작성했습니다.', calls: null};
    }, execute: async name => {
      revision++;
      return name === 'read_page' ? view() : name === 'verify_page' ? {ok: true, verified: true, checks: [{passed: true}], observation: view()} : {ok: true, applied: 1, observation: view()};
    }, reviewGoal: async () => ({status: ++reviews === 3 ? 'complete' : 'revise', next_step: '다음 누락 항목을 작성하세요.'}),
  });
  assert.equal(result.awaitingUser, undefined); assert.equal(reviews, 3); assert.equal(revision, 7);
});


test('a complete large search observation remains citeable within the reviewer model budget', () => {
  const page = snapshot('search', '검색 결과 원문\n'.repeat(3500));
  page.frames[0].elements.push({ref: 'official', role: 'link', name: '공식 관람 안내', href: 'https://example.test/official'});
  const original = structuredClone(page);
  const evidence = reviewEvidence(1, 'browser_snapshot', {}, page);
  assert.equal(evidence.truncated, false);
  assert.equal(evidence.usable, true);
  assert.deepEqual(evidence.result, original);
  const result = goalReviewMessages({goal: '검색 결과 제목과 링크 확인', history: [], evidence: [evidence], answer: '공식 관람 안내', inputBudget: 60000});
  const payload = JSON.parse(result.messages[1].content);
  assert.deepEqual(payload.citeable_evidence_ids, [1]);
  // The reviewer reads one line per element; name and link survive verbatim.
  assert.equal(payload.evidence[0].result.frames[0].elements.at(-1), '[official] link "공식 관람 안내" +{"href":"https://example.test/official"}');
  assert.deepEqual(result.evidence[0].result.frames[0].elements.at(-1), page.frames[0].elements.at(-1));
  assert.deepEqual(page, original);
  assert.throws(() => goalReviewMessages({goal: '검색 결과 확인', history: [], evidence: [evidence], answer: '', inputBudget: 1024}), /goal_review_failed/);
});

test('large partial and failed observations never become full-coverage or successful evidence', () => {
  const page = snapshot('partial', '원문\n'.repeat(9000));
  page.frames[0].truncated = true;
  const partial = reviewEvidence(1, 'read_page', {}, page);
  assert.equal(partial.usable, true);
  assert.equal(partial.coverage.partial, true);
  assert.equal(partial.result.frames[0].truncated, true);
  assert.equal(reviewEvidence(2, 'read_page', {}, {...page, ok: false, error: 'browser_stale'}).usable, false);
  assert.equal(reviewEvidence(3, 'read_page', {}, snapshot('oversized', 'x'.repeat(321000))).usable, false);
  const stale = {...partial, usable: false, superseded: true};
  const payload = JSON.parse(goalReviewMessages({goal: '확인', history: [], evidence: [stale], answer: '', inputBudget: 8000}).messages[1].content);
  assert.deepEqual(payload.citeable_evidence_ids, []);
  assert(!payload.evidence[0].result.frames);
});

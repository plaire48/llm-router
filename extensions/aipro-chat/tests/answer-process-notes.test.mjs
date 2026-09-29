import test from 'node:test';
import assert from 'node:assert/strict';
import {stripProcessNotes} from '../answer-process-notes.js';

const goal = '검색 결과에서 펜싱 기사 한 건을 열어 제목, 언론사, 발행일, 경기 결과를 간단히 알려줘.';
const body = '**확인된 기사**\n- 제목: 「펜싱 남자 사브르, 단체전 은메달」\n- 언론사: KBS 뉴스\n\n출처: https://news.example.test/view?ncd=1\n\n열람 범위는 기사 제목과 본문입니다.';

test('commentary about the review is removed from the first and last paragraph only', () => {
  const written = `검토 실패를 반영해 표현을 보수적으로 정정합니다.\n\n${body}\n\n이는 **독립 최종 검토 전의 후보 답변**이며, 최종 완료로 확정하지 않습니다.`;
  assert.equal(stripProcessNotes(written, goal), body);
  assert.equal(stripProcessNotes(`Following the review feedback, here is the corrected version.\n\n${body}`, goal), body);
  assert.equal(stripProcessNotes(body, goal), body);
  for (const line of ['검증을 완료했습니다.', '최신 확인이 완료되었습니다.', '조사를 완료했습니다']) assert.equal(stripProcessNotes(`${line}\n\n${body}`, goal), body, line);
  for (const line of ['검증을 완료했습니다. 결과는 아래와 같습니다.', '예약이 완료되었습니다.', '등록을 완료했습니다.']) assert.equal(stripProcessNotes(`${line}\n\n${body}`, goal), `${line}\n\n${body}`, line);
});

test('content is never removed: inner paragraphs, lists, links, long text and single paragraphs stay', () => {
  for (const written of [
    `${body}\n\n독립 검토에서 확인하지 못한 항목이 있습니다.\n\n${body}`,
    `- 검토 의견: 승인\n- 담당: 품질팀\n\n${body}`,
    `검토 피드백 원문은 https://docs.example.test/review 에 있습니다.\n\n${body}`,
    `검토 실패를 반영해 정정합니다. ${'자세한 설명입니다. '.repeat(40)}\n\n${body}`,
    '검토 실패를 반영해 표현을 정정했습니다.',
    `확인한 내용입니다.\n\n${body}`]) assert.equal(stripProcessNotes(written, goal), written);
  assert.equal(stripProcessNotes('검토 실패를 반영합니다.\n\n후보 답변입니다.', goal), '후보 답변입니다.');
  assert.equal(stripProcessNotes(undefined, goal), undefined); assert.equal(stripProcessNotes('', goal), '');
});

test('a request that is itself about a review or a candidate is left untouched', () => {
  const written = `검토 의견을 반영한 결과입니다.\n\n${body}`;
  assert.equal(stripProcessNotes(written, '이 문서의 검토 의견을 정리해 줘.'), written);
  assert.equal(stripProcessNotes(`후보 답변 두 개를 비교했습니다.\n\n${body}`, '후보 두 명의 공약을 비교해 줘.'), `후보 답변 두 개를 비교했습니다.\n\n${body}`);
  assert.equal(stripProcessNotes(`Review feedback follows.\n\n${body}`, 'Summarize the code review.'), `Review feedback follows.\n\n${body}`);
});

test('the reviewer and the user both receive the answer without review commentary', async () => {
  const {runAgent} = await import('../agent-runtime.js');
  const {browserTools, BUILTIN_SKILLS} = await import('../skills.js');
  const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
  let rounds = 0, reviews = 0; const reviewed = [], feedback = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async wire => {
      if (++rounds === 1) return {calls: [{id: 'a', type: 'function', function: {name: 'read_page', arguments: '{}'}}]};
      feedback.push(String(wire.at(-1).content));
      return {content: rounds === 2 ? body : `검토 실패를 반영해 표현을 보수적으로 정정합니다.\n\n${body}\n\n이는 독립 최종 검토 전의 후보 답변이며, 최종 완료로 확정하지 않습니다.`};
    },
    execute: async () => ({url: 'https://news.example.test/view', text: '펜싱 남자 사브르, 단체전 은메달 KBS 뉴스 기사 본문입니다. '.repeat(6)}),
    reviewGoal: async ({answer}) => {reviewed.push(answer); return ++reviews === 1
      ? {status: 'revise', checks: [{requirement: '열람 범위', status: 'unmet', evidence_ids: [1]}], next_step: '열람 범위를 좁히세요.'}
      : {status: 'complete', checks: [{requirement: '원래 요청', status: 'met', evidence_ids: [1]}], next_step: ''};}});
  assert.equal(result.content, body);
  assert.deepEqual(reviewed, [body, body]);
  assert(feedback.some(text => /never mention this review/.test(text)));
});

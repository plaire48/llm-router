import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {goalReviewMessages, replacesPageContent} from '../goal-review.js';

// Measured on candidate 41 with GPT-5.6 Sol (H-04, H-06): research answers
// were released as limited because (1) an audit that found a gap needing a new
// source read was not passed on, so the model only rewrote the answer, and
// (2) reading a page again dropped the first read of it, so the review could
// not see that the page had been read before another one.

const content = (hash, text) => ({dataKind: 'page_content', url: 'https://lib.example.test/main/useInfo', frame: 0, title: '이용안내',
  content_hash: hash, content_text_hash: text, method: 'readability', characters: 40, ranges: [{start: 0, end: 40}], text: '자료실 토요일 09:00~18:00'});

test('an unchanged page opened again does not replace its earlier read; changed text does', () => {
  assert.equal(replacesPageContent(content('a'.repeat(64), 't'.repeat(64)), content('b'.repeat(64), 't'.repeat(64))), false);
  assert.equal(replacesPageContent(content('a'.repeat(64), 't'.repeat(64)), content('b'.repeat(64), 'u'.repeat(64))), true);
  const old = {...content('a'.repeat(64)), content_text_hash: undefined};
  assert.equal(replacesPageContent(old, content('b'.repeat(64), 't'.repeat(64))), true, 'without a text hash the document hash decides, as before');
  assert.equal(replacesPageContent(content('a'.repeat(64), 't'.repeat(64)), {...content('b'.repeat(64), 'u'.repeat(64)), url: 'https://other.example.test/'}), false);
});

test('a replaced read still tells the review which page was read, without its text', () => {
  const evidence = [{id: 1, tool: 'read_page', usable: false, superseded: true, result: content('a'.repeat(64), 't'.repeat(64))},
    {id: 2, tool: 'read_page', usable: true, referenceOnly: true, result: content('b'.repeat(64), 'u'.repeat(64))}];
  const {messages} = goalReviewMessages({goal: '서울도서관을 다시 열어 확인해 줘.', history: [{role: 'user', content: '서울도서관을 다시 열어 확인해 줘.'}], evidence, answer: '토요일 09:00~18:00', inputBudget: 20000});
  const payload = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
  assert.match(payload, /"id":1,"tool":"read_page","usable":false,"superseded":true,"result":\{"visited":\{"url":"https:\/\/lib\.example\.test\/main\/useInfo","title":"이용안내"\}\}/);
  assert.equal(payload.split('자료실 토요일').length - 1, 1, 'the replaced text is not given to the review');
});

const plan = ['서울도서관 안내 확인', '비교표 작성'].map(text => ({text, status: 'completed', expected_outcome: `${text} 결과`}));
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const goal = '서울도서관 운영시간을 공식 안내로 알려줘.';
async function run(correctionTarget) {
  let rounds = 0, reviews = 0;
  const notes = [];
  await runAgent({goal, messages: [{role: 'user', content: goal}], resumePlan: plan, tools, harness: true, signal: new AbortController().signal,
    complete: async wire => {
      rounds++;
      const last = wire.findLast(message => message.role === 'user');
      const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content || '');
      if (text.includes('Independent requirement review found gaps')) notes.push(text);
      if (rounds === 1) return call('read_page');
      return {content: '서울도서관 운영시간은 평일 09:00~21:00입니다.'};
    },
    execute: async () => ({url: 'https://lib.example.test/membership', text: '회원증 발급 안내'}),
    reviewGoal: async ({phase}) => {
      if (phase === 'plan_step') return {status: 'complete'};
      if (++reviews === 1) return {status: 'revise', correctionTarget,
        checks: [{requirement: '운영시간을 공식 근거로 제시', status: 'unmet', evidence_ids: [1]}], next_step: '공식 이용 안내 페이지에서 운영시간을 확인하세요.'};
      return {status: 'complete'};
    }});
  return notes;
}

test('a gap the audit found to need a new source read tells the model to read before rewriting', async () => {
  const notes = await run('external');
  assert(notes.length >= 1, 'the review feedback reached the model');
  assert.match(notes[0], /needs new evidence, not only new wording/);
});

test('a wording-only gap does not ask for a new read', async () => {
  const notes = await run('answer');
  assert(notes.length >= 1);
  assert(notes.every(note => !/needs new evidence/.test(note)));
});

// A read was asked for and made, and the review still names the same gap: one
// pass without tools removes what could not be confirmed (H-04, candidate 43).
const external = {status: 'revise', correctionTarget: 'external', checks: [
  {requirement: '안내 페이지 확인', status: 'met', evidence_ids: [1]}, {requirement: '운영시간 제시', status: 'met', evidence_ids: [1]},
  {requirement: '운영시간을 공식 근거로 제시', status: 'unmet', evidence_ids: []}], next_step: '공식 이용 안내 페이지에서 운영시간을 확인하세요.'};
const passed = {status: 'complete', checks: [{requirement: '원래 요청 전체', status: 'met', evidence_ids: [1]}], next_step: ''};
async function searched(reviews) {
  let rounds = 0, reviewed = 0, reads = 0;
  const calls = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async (wire, selected) => {
      assert(++rounds < 14);
      if (rounds === 1) return call('update_plan', {steps: [{text: '운영시간 확인', status: 'in_progress', expected_outcome: '운영시간을 출처와 함께 제시'}]});
      const text = JSON.stringify(wire.at(-1));
      calls.push({tools: selected.length, text});
      if (rounds === 2 || text.includes('needs new evidence')) return call('read_page');
      return {content: text.includes('DELETE every statement') ? '서울도서관 운영시간은 공식 안내에서 확인하지 못했습니다.' : '서울도서관 운영시간은 평일 09:00~21:00입니다.'};
    },
    execute: async (name, args) => {
      if (name === 'update_plan') return {ok: true, plan: args.steps};
      if (name === 'ask_user') return {requiresUserInput: true};
      return {url: 'https://lib.example.test/membership', text: `회원증 발급 안내 ${++reads}`};
    },
    reviewGoal: async () => reviews[Math.min(reviewed++, reviews.length - 1)]});
  return {result, calls, reviewed, reads};
}

test('a gap that stays after a new read gets one pass without tools that removes unconfirmed points', async () => {
  const {result, calls, reads} = await searched([external, external, passed]);
  const removal = calls.findIndex(item => item.text.includes('Another read did not provide the evidence'));
  assert(removal > 0, JSON.stringify(calls.map(item => item.text.slice(0, 80))));
  assert.equal(calls[removal].tools, 0, 'the removal pass has no tools');
  assert.match(calls[removal].text, /DELETE every statement/);
  assert.doesNotMatch(calls[removal].text, /read it with the browser tools/, 'the removal pass does not also ask for a read');
  assert(reads >= 2, 'the first external review led to a new read');
  assert.match(result.content, /확인하지 못했습니다/); assert(!result.awaitingUser);
});

test('one external review asks for a read and gives no removal pass', async () => {
  const {calls} = await searched([external, passed]);
  assert(calls.some(item => item.text.includes('needs new evidence')));
  assert(!calls.some(item => item.text.includes('Another read did not provide the evidence')));
});

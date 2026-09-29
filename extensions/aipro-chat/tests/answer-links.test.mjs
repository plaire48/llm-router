import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeLinks, observedLinks} from '../answer-links.js';

const seen = 'https://korean.visitseoul.net/attractions/%EA%B5%AD%EB%A6%BD%EC%A4%91%EC%95%99%EB%B0%95%EB%AC%BC%EA%B4%80/KOP000433';
const evidence = [{id: 1, tool: 'browser_snapshot', usable: true, result: {url: 'https://search.example.test/search', frames: [{elements: [
  {ref: 'c-1', name: '국립중앙박물관 - Visit Seoul', role: 'link', destination: seen}, {ref: 'c-2', name: '공식', role: 'link', destination: 'https://www.museum.go.kr/MUSEUM/contents/M0101000000.do'}]}]}},
  {id: 2, tool: 'read_page', usable: false, result: {url: 'https://unusable.example.test/x'}}];

test('links are collected only from usable evidence link fields', () => {
  assert.deepEqual(observedLinks(evidence), ['https://search.example.test/search', seen, 'https://www.museum.go.kr/MUSEUM/contents/M0101000000.do']);
  assert.deepEqual(observedLinks(null), []);
});

test('a decoded spelling of an observed link is rewritten to the observed form, in prose and Markdown', () => {
  const links = observedLinks(evidence);
  const written = '1. [Visit Seoul](https://korean.visitseoul.net/attractions/국립중앙박물관/KOP000433)\n2. 출처: https://korean.visitseoul.net/attractions/국립중앙박물관/KOP000433.';
  assert.equal(canonicalizeLinks(written, links), `1. [Visit Seoul](${seen})\n2. 출처: ${seen}.`);
  assert.equal(canonicalizeLinks(`이미 정확함 ${seen}`, links), `이미 정확함 ${seen}`);
});

test('unobserved, different or ambiguous links are never changed', () => {
  const links = observedLinks(evidence);
  for (const text of ['https://korean.visitseoul.net/attractions/국립중앙박물관/KOP000434', 'https://other.example.test/attractions/국립중앙박물관/KOP000433', 'http://korean.visitseoul.net/attractions/국립중앙박물관/KOP000433', '링크 없음', ''])
    assert.equal(canonicalizeLinks(text, links), text);
  const ambiguous = ['https://a.example.test/%EA%B0%80', 'https://a.example.test/%ea%b0%80'];
  assert.equal(canonicalizeLinks('https://a.example.test/가', ambiguous), 'https://a.example.test/가');
  assert.equal(canonicalizeLinks('https://a.example.test/가', []), 'https://a.example.test/가');
  assert.equal(canonicalizeLinks(undefined, links), undefined);
});

test('the final review and the delivered answer both carry the observed link form', async () => {
  const {runAgent} = await import('../agent-runtime.js');
  const {browserTools, BUILTIN_SKILLS} = await import('../skills.js');
  const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
  const goal = '일반 결과 1개의 제목과 링크를 알려줘.'; let rounds = 0; const reviewed = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => ++rounds === 1 ? {calls: [{id: 'a', type: 'function', function: {name: 'browser_snapshot', arguments: '{}'}}]} :
      {content: 'Visit Seoul https://korean.visitseoul.net/attractions/국립중앙박물관/KOP000433'},
    execute: async () => evidence[0].result,
    reviewGoal: async ({answer}) => {reviewed.push(answer); return {status: 'complete', checks: [{requirement: '제목과 링크', status: 'met', evidence_ids: [1]}], next_step: ''};}});
  assert.equal(result.content, `Visit Seoul ${seen}`);
  assert.deepEqual(reviewed, [`Visit Seoul ${seen}`]);
});

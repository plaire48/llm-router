import test from 'node:test';
import assert from 'node:assert/strict';
import {summarySource} from '../context-evidence.js';
import {createRunContext} from '../context-manager.js';

const element = (tag, index) => ({ref: `e-${tag}-0-${index}`, name: `결과 제목 ${tag} ${index}`, accessibleName: `결과 제목 ${tag} ${index}`, role: 'link', kind: 'link', tag: 'a', inViewport: true,
  destination: `https://example.test/${tag}/${index}`, type: '', disabled: false, context: [{role: 'listitem'}, {role: 'region', name: '웹 검색 결과'}, {role: 'main'}]});
const observation = (tag, count = 150) => ({title: tag, url: `https://example.test/${tag}`, frames: [{frame: 0, url: `https://example.test/${tag}`,
  elements: [{ref: `e-${tag}-0-x`, name: '검색', role: 'searchbox', kind: 'field', tag: 'input', type: 'search'}, ...Array.from({length: count}, (_, index) => element(tag, index))],
  text: `본문 사실 ${tag}: 관람시간 10:00~18:00`, headings: [{level: 1, name: tag}], retrieval: {method: 'dom_order', textBlocks: Array.from({length: 40}, (_, i) => ({start: i, end: i + 1, regionIndex: i}))},
  coverage: {nodesInspected: 5000, scope: 'x'.repeat(300)}}]});
let id = 0;
const pair = (name, result) => {const call = `call-${++id}`; return [{role: 'assistant', content: '', tool_calls: [{id: call, type: 'function', function: {name, arguments: '{}'}}]}, {role: 'tool', tool_call_id: call, content: JSON.stringify(result)}];};

test('past observations keep text, receipts and links but not controls or layout tables', () => {
  const wire = [{role: 'user', content: '검색해 줘'}, ...pair('browser_snapshot', observation('a')),
    ...pair('fill_form', {ok: true, applied: 1, verified: true, fields: [{value_set: true}], observation: observation('b')}),
    ...pair('verify_page', {ok: false, error: 'verification_failed', checks: [{kind: 'url_is', passed: false, reason: 'url_query_mismatch'}], observation: observation('c')}),
    ...pair('read_page', {ok: true, dataKind: 'page_content', ranges: [{start: 0, end: 5000, markdown: '원문 '.repeat(1600)}]})];
  const next = summarySource(wire), tools = next.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  assert(JSON.stringify(next).length < JSON.stringify(wire).length * .4);
  assert.equal(tools[0].frames[0].elements, undefined); assert.equal(tools[0].frames[0].retrieval, undefined); assert.equal(tools[0].frames[0].coverage, undefined);
  assert.equal(tools[0].frames[0].elementsOmitted, 151);
  assert.equal(tools[0].frames[0].text, '본문 사실 a: 관람시간 10:00~18:00'); assert.deepEqual(tools[0].frames[0].headings, [{level: 1, name: 'a'}]);
  assert.equal(tools[0].frames[0].links.length, 80); assert.equal(tools[0].frames[0].linksOmitted, 70);
  assert.equal(tools[0].frames[0].links[0], '"결과 제목 a 0" -> https://example.test/a/0');
  assert.equal(tools[1].applied, 1); assert.equal(tools[1].verified, true); assert.deepEqual(tools[1].fields, [{value_set: true}]);
  assert.equal(tools[2].error, 'verification_failed'); assert.deepEqual(tools[2].checks, [{kind: 'url_is', passed: false, reason: 'url_query_mismatch'}]);
  assert.deepEqual(next.at(-1), wire.at(-1));
  assert.deepEqual(next.map(message => [message.role, message.tool_call_id]), wire.map(message => [message.role, message.tool_call_id]));
  assert(wire[2].content.includes('"elements"'), 'the original transcript is not modified');
});

test('small results and results without frames are returned unchanged', () => {
  const wire = [...pair('browser_snapshot', observation('s', 2)), ...pair('list_tabs', {tabs: [{tab_id: '1'}]})];
  assert.deepEqual(summarySource(wire), wire);
});

test('in-run compaction summarizes the prepared span with far fewer model calls', async () => {
  const model = {name: 'm', contextLength: 64000, maxOutputTokens: 4096};
  const body = [{role: 'system', content: 's'}, {role: 'user', content: '국립중앙박물관 관람시간을 검색해 줘. 광고는 제외해 줘.'},
    ...Array.from({length: 7}, (_, index) => pair('browser_snapshot', {...observation(`p${index}`), marker: index})).flat(),
    {role: 'assistant', content: '', tool_calls: [{id: 'last', type: 'function', function: {name: 'read_page', arguments: '{}'}}]}, {role: 'tool', tool_call_id: 'last', content: JSON.stringify({text: '최신 결과'})}];
  const fragments = [];
  const context = createRunContext({model, tools: [], goal: '검색', signal: new AbortController().signal, save: async () => {},
    invoke: async messages => {fragments.push(messages.at(-1).content); return {content: JSON.stringify({goal: '검색', constraints: ['광고 제외'], decisions: [], completed: ['검색 결과 관찰'], pending: [], references: []})};}});
  const prepared = await context.prepare(body, true);
  assert(fragments.length >= 1 && fragments.length <= 3, String(fragments.length));
  assert(fragments.every(fragment => !fragment.includes('"ref":"e-p')));
  assert(fragments.some(fragment => fragment.includes('본문 사실 p0')) && fragments.some(fragment => fragment.includes('-> https://example.test/p0/0')));
  assert(prepared.some(message => message.role === 'tool' && message.tool_call_id === 'last'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {compactHistory, contextBudget, createRunContext, knownAddresses} from '../context-manager.js';
import {normalizeSummary, summaryMessage} from '../context-state.js';
import {continuityMessage} from '../context-evidence.js';

const base = {goal: '세 도서관 운영시간 비교', constraints: ['로그인하지 말 것'], decisions: ['공식 안내만 사용'], completed: ['서울도서관 안내 열람'], pending: ['국회도서관 운영시간 확인'], references: []};
const signal = () => new AbortController().signal;
const pair = (id, name, result) => [{role: 'assistant', content: '', tool_calls: [{id, type: 'function', function: {name, arguments: '{}'}}]}, {role: 'tool', tool_call_id: id, content: typeof result === 'string' ? result : JSON.stringify(result)}];

test('a summary can hand over what was found, what failed and where the work stood', () => {
  const handoff = {...base, findings: ['서울도서관 일반자료실 평일 09:00~21:00 (출처: https://lib.seoul.go.kr/guide, 원문 열람)'], failed: ['국회도서관 검색 결과 링크는 로그인 화면으로 이동함'], current: '국립중앙도서관 이용시간 표를 읽는 중. 다음은 국회도서관 공식 안내 열기.'};
  assert.deepEqual(normalizeSummary(JSON.stringify(handoff)), handoff);
  // A summary stored before these fields existed is unchanged, and empty fields are left out.
  assert.deepEqual(normalizeSummary(base), base);
  assert.deepEqual(normalizeSummary({...base, findings: [], failed: [' '], current: '  '}), base);
  for (const value of [{...base, findings: 'text'}, {...base, findings: Array(21).fill('x')}, {...base, findings: ['x'.repeat(801)]}, {...base, failed: Array(9).fill('x')},
    {...base, failed: ['x'.repeat(601)]}, {...base, current: 'x'.repeat(1201)}, {...base, current: 3},
    {...base, completed: Array(12).fill('가'.repeat(1100)), findings: ['x']}]) assert.equal(normalizeSummary(value), null);
  assert(!JSON.stringify(normalizeSummary({...handoff, findings: ['토큰 Bearer synthetic-secret 확인']})).includes('synthetic-secret'));
  const notice = summaryMessage(handoff).content;
  assert.match(notice, /continue from current and pending, reuse findings, and do not repeat completed or failed work/);
});

test('an address the summarizer did not read is never handed over', () => {
  const source = '{"url":"https://lib.seoul.go.kr/guide","title":"이용 안내"} 본문 https://www.nl.go.kr/NL/contents/N50201000000.do?x=1 끝';
  const summary = {...base, references: ['https://lib.seoul.go.kr/guide/', 'https://www.nanet.go.kr/invented/hours.do'],
    findings: ['평일 09~21시 (https://lib.seoul.go.kr/guide).', '토요일 09~18시 (https://www.nl.go.kr/NL/contents/N50201000000.do?x=1)', '일요일 휴관 (https://lib.seoul.go.kr/made-up)', '주소 없는 사실'],
    pending: ['https://www.nanet.go.kr/ 에서 확인'], current: '읽는 중'};
  const checked = knownAddresses(summary, source);
  assert.deepEqual(checked.references, ['https://lib.seoul.go.kr/guide/']);
  assert.deepEqual(checked.findings, ['평일 09~21시 (https://lib.seoul.go.kr/guide).', '토요일 09~18시 (https://www.nl.go.kr/NL/contents/N50201000000.do?x=1)', '주소 없는 사실']);
  assert.deepEqual(checked.pending, []); assert.equal(checked.current, '읽는 중'); assert.deepEqual(checked.constraints, base.constraints);
  assert.equal(knownAddresses(base, source), base);
  assert.equal(knownAddresses({...base, findings: ['출처 https://lib.seoul.go.kr/other']}, source).findings, undefined);
  assert.equal(knownAddresses(null, source), null);
});

test('the summarizer is asked for a handoff, gets room for it, and its invented address is dropped from memory', async () => {
  assert.equal(contextBudget({contextLength: 16000, maxInputTokens: 14000}).summaryOutput, 2048);
  assert.equal(contextBudget({contextLength: 272000}).summaryOutput, 4096);
  assert.equal(contextBudget({contextLength: 64000, maxOutputTokens: 3000}).summaryOutput, 3000);
  assert.equal(contextBudget({}).summaryOutput, 2048);
  const model = {name: 'large', contextLength: 128000}, calls = [];
  const turn = (id, text) => [{id: `u${id}`, role: 'user', content: `질문 ${id}`}, {id: `a${id}`, role: 'assistant', state: 'done', content: text}];
  const messages = [...turn(0, '서울도서관 https://lib.seoul.go.kr/guide 열람. 평일 09:00~21:00.'), ...turn(1, '다음'), ...turn(2, '최근'), ...turn(3, '마지막')];
  const result = await compactHistory({messages, model, force: true, signal: signal(), invoke: async (input, options) => {
    calls.push({input, options});
    return {finishReason: 'stop', content: JSON.stringify({...base, findings: ['평일 09:00~21:00 (https://lib.seoul.go.kr/guide)', '주말 운영 (https://lib.seoul.go.kr/weekend-invented)']})};
  }});
  assert.equal(calls[0].options.maxTokens, 4096); assert.equal(calls[0].options.summary, true);
  const prompt = calls[0].input[0].content;
  assert(prompt.startsWith('Summarize conversation'));
  for (const phrase of ['handoff', 'findings', 'failed', 'current', 'next step first', 'When unsure whether a fact will be needed, keep it', 'never construct or complete one'])assert(prompt.includes(phrase), phrase);
  assert.deepEqual(result.memory.summary.findings, ['평일 09:00~21:00 (https://lib.seoul.go.kr/guide)']);
});

test('pages read in the summarized span stay as addresses that can be opened again', () => {
  const observation = (url, title) => ({ok: true, observation: {url, title, frames: [{frame: 0, text: '본문', elements: []}]}});
  const wire = [...pair('1', 'navigate_page', observation('https://lib.seoul.go.kr/guide', ' 서울도서관\n이용 안내 ')),
    ...pair('2', 'read_page', {ok: true, dataKind: 'page_content', url: 'https://lib.seoul.go.kr/guide', title: '', characters: 5000, ranges: []}),
    ...pair('3', 'browser_snapshot', {url: 'https://www.nl.go.kr/NL/contents/hours.do', title: '국립중앙도서관 이용시간', frames: [{frame: 0, text: '표', elements: []}]}),
    ...pair('4', 'navigate_page', {error: 'page_unavailable', observation: {url: 'https://www.nanet.go.kr/login', frames: []}}),
    ...pair('5', 'click_element', observation('javascript:alert(1)', '잘못된 주소')),
    ...pair('6', 'navigate_page', observation('https://lib.seoul.go.kr/guide', '서울도서관 이용 안내'))];
  const record = JSON.parse(continuityMessage(wire)[0].content.split('\n').at(-2));
  assert.deepEqual(record.pages, [{url: 'https://www.nl.go.kr/NL/contents/hours.do', title: '국립중앙도서관 이용시간', read: 'observation'},
    {url: 'https://lib.seoul.go.kr/guide', title: '서울도서관 이용 안내', read: 'content'}]);
  assert.equal(record.omittedPages, 0);
  assert.match(continuityMessage(wire)[0].content, /open one again to read it instead of searching for it/);
  const many = Array.from({length: 20}, (_, index) => pair(`m${index}`, 'navigate_page', observation(`https://example.test/page/${index}`, `화면 ${index}`))).flat();
  const bounded = JSON.parse(continuityMessage(many)[0].content.split('\n').at(-2));
  assert.equal(bounded.pages.length, 16); assert.equal(bounded.omittedPages, 4); assert.equal(bounded.pages.at(-1).url, 'https://example.test/page/19');
  assert.deepEqual(continuityMessage([{role: 'user', content: '질문'}]), []);
});

test('after a compaction in a run the next request carries the summary, the pages and the recent results', async () => {
  const observation = (index) => ({ok: true, observation: {url: `https://example.test/page/${index}`, title: `화면 ${index}`, frames: [{frame: 0, text: `본문 ${index} ` + '가'.repeat(24000), elements: []}]}});
  const wire = [{role: 'system', content: '지침'}, {role: 'user', content: base.goal}, ...[1, 2, 3, 4].flatMap(index => pair(`c${index}`, 'navigate_page', observation(index)))];
  const context = createRunContext({model: {name: 'small', contextLength: 60000}, tools: [], goal: base.goal, signal: signal(),
    invoke: async () => ({finishReason: 'stop', content: JSON.stringify({...base, findings: ['화면 1에서 운영시간 확인 (https://example.test/page/1)'], current: '화면 3을 읽는 중'})})});
  const packed = await context.prepare(wire);
  const text = packed.map(message => typeof message.content === 'string' ? message.content : '').join('\n');
  assert.match(text, /<context_summary>/); assert.match(text, /화면 1에서 운영시간 확인/); assert.match(text, /화면 3을 읽는 중/);
  assert.match(text, /<continuity_evidence>/); assert.match(text, /"pages":\[\{"url":"https:\/\/example\.test\/page\/1"/);
  assert(packed.some(message => message.role === 'tool' && message.content.includes('본문 4')), 'the latest result stays verbatim');
  assert(JSON.stringify(packed).length < JSON.stringify(wire).length);
});

test('a span too short to be worth a summary is not sent to the model', async () => {
  let calls = 0;
  const context = createRunContext({model: {name: 'small', contextLength: 32000, maxInputTokens: 28000}, tools: [], goal: base.goal, requirements: ['로그인하지 마세요.'], signal: signal(),
    invoke: async () => {calls++; return {finishReason: 'stop', content: JSON.stringify(base)};}});
  const wire = [{role: 'system', content: 'S'.repeat(52000)}, {role: 'user', content: base.goal}, ...pair('w', 'fill_form', {ok: true, applied: 1, verified: false}),
    ...pair('r1', 'read_page', {text: 'read 1: ' + 'evidence '.repeat(3800)})];
  // Over the trigger, but the only span that could be summarized is one small receipt.
  const first = await context.prepare(wire);
  assert.equal(calls, 0); assert(!first.some(message => message.content?.includes?.('<context_summary>')));
  // Once the context is over its limit the summary is made, and the receipt survives it.
  wire.push(...pair('r2', 'read_page', {text: 'read 2: ' + 'evidence '.repeat(3800)}));
  const second = await context.prepare(wire);
  assert.equal(calls, 1);
  assert(second.some(message => message.content?.includes?.('<context_summary>')));
  assert(second.find(message => message.content?.includes?.('<continuity_evidence>')).content.includes('"applied":1'));
  assert(second.some(message => message.role === 'tool' && message.content.includes('read 2')));
});

test('reported usage lowers the estimate only when it is a plausible count of the request', async () => {
  const model = {name: 'm', contextLength: 40000, maxInputTokens: 30000};
  const wire = [{role: 'system', content: '지침'}, {role: 'user', content: base.goal}, ...pair('a', 'read_page', {text: '가'.repeat(8000)}), ...pair('b', 'read_page', {text: '나'.repeat(8000)}), ...pair('c', 'read_page', {text: '다'.repeat(3000)})];
  const summaries = async usage => {
    let calls = 0;
    const context = createRunContext({model, tools: [], goal: base.goal, signal: signal(), invoke: async () => {calls++; return {finishReason: 'stop', content: JSON.stringify(base)};}});
    if (usage) context.record(usage, wire);
    await context.prepare(wire);
    return calls > 0;
  };
  const {contextTokens} = await import('../context-manager.js');
  const estimate = contextTokens(wire);
  assert(estimate > contextBudget(model).trigger, String(estimate));
  assert(estimate * .7 <= contextBudget(model).trigger, 'the fixture sits between the two thresholds');
  assert.equal(await summaries(null), true);
  // Sixty percent of the estimate is counted as seventy: under the trigger, so no summary is made.
  assert.equal(await summaries({prompt_tokens: Math.floor(estimate * .6)}), false);
  // An implausibly small report changes nothing, and a larger one never lowers the estimate.
  assert.equal(await summaries({prompt_tokens: 100}), true);
  assert.equal(await summaries({prompt_tokens: Math.floor(estimate * 1.5)}), true);
});

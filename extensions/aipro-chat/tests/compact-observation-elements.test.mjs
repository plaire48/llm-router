import test from 'node:test';
import assert from 'node:assert/strict';
import {compactObservationElements, compactObservationResult, parseElementLine, clearDuplicateObservations, ELEMENT_DEFAULTS, ELEMENT_OMISSIONS} from '../context-evidence.js';

const element = (index, extra = {}) => ({ref: `c-n-${index}`, name: `결과 제목 ${index}`, accessibleName: `결과 제목 ${index}`, role: 'link', kind: 'link', tag: 'a', inViewport: true,
  destination: `https://example.test/article/${index}`, type: '', disabled: false, context: [{role: 'listitem'}, {role: 'region', name: '웹 "검색" 결과'}, {role: 'main'}], ...extra});
const observation = elements => ({title: 't', url: 'https://example.test/', frames: [{frame: 0, url: 'https://example.test/', elements, text: '본문'}]});
const wireOf = result => [{role: 'user', content: 'q'}, {role: 'assistant', content: '', tool_calls: [{id: 'a', type: 'function', function: {name: 'inspect_dom', arguments: '{}'}}]}, {role: 'tool', tool_call_id: 'a', content: JSON.stringify(result)}];

test('earlier observations and a large latest one are grouped lines; a small latest one keeps keyed objects', () => {
  // Measured on a 30-row time sheet: 88 tokens per control as keyed objects, 46
  // grouped. Ancestors shared by consecutive controls are written once.
  const elements = [...Array.from({length: 40}, (_, index) => element(index)),
    element(40, {accessibleName: '다른 접근성 이름', kind: 'field', role: 'searchbox', tag: 'input', type: 'search', disabled: true, required: true, readonly: true, invalid: true, inViewport: false, editable: true, focused: true, sameDestinationLabels: ['가', '나']})];
  const earlier = wireOf(observation(elements)), later = wireOf(observation([...Array.from({length: 40}, (_, index) => element(index))]));
  later[1].tool_calls[0].id = 'b'; later[2].tool_call_id = 'b';
  const wire = [...earlier, ...later.slice(1)], next = compactObservationElements(wire);
  const grouped = JSON.parse(next[2].content);
  assert(next[2].content.length < wire[2].content.length * .6, String(next[2].content.length / wire[2].content.length));
  assert.equal(grouped.elementDefaults, ELEMENT_DEFAULTS);
  assert.equal(grouped.frames[0].elements[0], 'in listitem < region "웹 \\"검색\\" 결과" < main:');
  assert.equal(grouped.frames[0].elements[1], '[c-n-0] link "결과 제목 0" -> https://example.test/article/0');
  assert.equal(grouped.frames[0].elements.filter(line => line.startsWith('in ')).length, 1, 'one heading for controls that share their ancestors');
  assert.equal(grouped.frames[0].elements[41], '[c-n-40] searchbox "결과 제목 40" aka "다른 접근성 이름" -> https://example.test/article/40 {focused,editable,disabled,required,readonly,invalid,offscreen} +{"sameDestinationLabels":["가","나"]}');
  // The small latest observation, the one the next action reads, keeps keyed objects.
  const latest = JSON.parse(next[4].content);
  assert.equal(latest.elementDefaults, ELEMENT_OMISSIONS);
  assert.deepEqual(latest.frames[0].elements[0], {ref: 'c-n-0', name: '결과 제목 0', role: 'link', kind: 'link', tag: 'a', destination: 'https://example.test/article/0',
    context: [{role: 'listitem'}, {role: 'region', name: '웹 "검색" 결과'}, {role: 'main'}]});
  // A latest observation with more than 80 controls is grouped as well.
  const large = compactObservationElements(wireOf(observation(Array.from({length: 90}, (_, index) => element(index)))));
  const big = JSON.parse(large[2].content);
  assert.equal(big.elementDefaults, ELEMENT_DEFAULTS); assert.equal(big.frames[0].elements.filter(line => line.startsWith('[')).length, 90);
  assert.equal(JSON.parse(wire[2].content).frames[0].elements[0].disabled, false, 'the stored result keeps every field');
});

test('default values that only repeat the role are left out of a line', () => {
  const box = element(0, {name: 'checkbox', accessibleName: '', role: 'checkbox', kind: 'checkbox', tag: 'input', type: 'checkbox', destination: undefined, editable: false,
    checked: false, state: false, stateKind: 'checked', stateSource: 'native', context: [{role: 'item', name: '인사팀 10월 교육'}]});
  const cell = element(1, {name: 'g19490', accessibleName: '', role: 'textbox', kind: 'field', tag: 'input', type: 'text', destination: undefined, editable: true,
    validation: {valid: true, issues: []}, column: '9월 4주 / 09/24(수)', context: [{role: 'row', name: '데이터 시스템 모니터링'}]});
  const star = element(2, {name: '☆', accessibleName: '☆', role: 'button', kind: 'control', tag: 'button', type: 'button', destination: undefined, description: '중요', context: [{role: 'item', name: '인사팀 10월 교육'}]});
  const invalid = element(3, {name: '금액', accessibleName: '금액', role: 'textbox', kind: 'field', tag: 'input', type: 'number', destination: undefined, context: undefined, validation: {valid: false, issues: ['rangeOverflow']}});
  const [head, boxLine, rowHead, cellLine, starHead, starLine, pageHead, invalidLine] = compactObservationResult(observation([box, cell, star, invalid])).frames[0].elements;
  assert.deepEqual([head, rowHead, starHead, pageHead], ['in item "인사팀 10월 교육":', 'in row "데이터 시스템 모니터링":', 'in item "인사팀 10월 교육":', 'in page:']);
  assert.equal(boxLine, '[c-n-0] checkbox "checkbox" +{"checked":false}');
  assert.equal(cellLine, '[c-n-1] textbox "g19490" {editable} +{"column":"9월 4주 / 09/24(수)"}');
  assert.equal(starLine, '[c-n-2] button "☆" +{"description":"중요"}');
  assert.equal(invalidLine, '[c-n-3] textbox "금액" +{"validation":{"valid":false,"issues":["rangeOverflow"]},"type":"number"}');
});

test('state words of a row stay on the heading of its controls', () => {
  // A mail row marked only by its class ("row starred") keeps that word, so the
  // review sees the star is on without another click that would turn it off.
  const starred = element(0, {name: '중요', accessibleName: '중요', role: 'button', kind: 'button', tag: 'button', destination: undefined, stateHint: 'on',
    context: [{role: 'item', name: '인사팀 10월 교육 일정 안내', state: ['starred', 'unread']}, {role: 'main'}]});
  const earlier = wireOf(observation([starred, ...Array.from({length: 40}, (_, index) => element(index + 1))])), later = wireOf(observation([element(99)]));
  later[1].tool_calls[0].id = 'b'; later[2].tool_call_id = 'b';
  const [heading, line] = JSON.parse(compactObservationElements([...earlier, ...later.slice(1)])[2].content).frames[0].elements;
  assert.equal(heading, 'in item "인사팀 10월 교육 일정 안내" (starred,unread) < main:');
  assert.equal(line, '[c-n-0] button "중요" +{"stateHint":"on"}');
  assert.equal(parseElementLine(heading), null, 'a heading is not an element');
  assert.match(ELEMENT_DEFAULTS, /state words from its class names/);
});

test('nested action observations keep their receipts, and a second pass changes nothing', () => {
  const wire = wireOf({ok: true, applied: 1, fields: [{ref: 'c-n-1'}], observation: observation(Array.from({length: 40}, (_, index) => element(index)))});
  const once = compactObservationElements(wire), result = JSON.parse(once[2].content);
  assert.equal(result.applied, 1); assert.deepEqual(result.fields, [{ref: 'c-n-1'}]);
  assert.equal(result.observation.frames[0].elements.length, 40);
  assert.equal(compactObservationElements(once), once);
});

test('small results, non-DOM results and unknown context shapes are untouched', () => {
  const small = wireOf(observation([element(0)]));
  assert.equal(compactObservationElements(small), small);
  const content = wireOf({ok: true, dataKind: 'page_content', ranges: [{start: 0, end: 5000, markdown: 'x'.repeat(5000)}]});
  assert.equal(compactObservationElements(content), content);
  const odd = compactObservationElements(wireOf(observation(Array.from({length: 40}, (_, index) => element(index, {context: [{role: 'row', name: 'n', index: 3}]})))));
  assert.deepEqual(JSON.parse(odd[2].content).frames[0].elements[0].context, [{role: 'row', name: 'n', index: 3}]);
});

test('identical observations are still recognised as duplicates after compaction', () => {
  const calls = ['a', 'b', 'c', 'd'].flatMap(id => [{role: 'assistant', content: '', tool_calls: [{id, type: 'function', function: {name: 'inspect_dom', arguments: '{}'}}]},
    {role: 'tool', tool_call_id: id, content: JSON.stringify(observation(Array.from({length: 40}, (_, index) => element(index))))}]);
  const cleared = clearDuplicateObservations(compactObservationElements(calls)).filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  assert.equal(cleared.filter(result => result.contextCleared).length, 2);
});

test('a line can be read back into its fields', () => {
  const full = element(7, {id: 'search', accessibleName: '다른 이름', kind: 'field', role: 'combobox', tag: 'input', type: 'search', disabled: true, inViewport: false, editable: true, focused: true});
  const [heading, plain, rich] = compactObservationResult(observation([element(3), full])).frames[0].elements;
  assert.equal(heading, 'in listitem < region "웹 \\"검색\\" 결과" < main:');
  assert.deepEqual(parseElementLine(plain), {ref: 'c-n-3', name: '결과 제목 3', role: 'link', kind: 'link', destination: 'https://example.test/article/3'});
  assert.deepEqual(parseElementLine(rich), {ref: 'c-n-7', name: '결과 제목 7', role: 'combobox', kind: 'field', id: 'search', type: 'search', accessibleName: '다른 이름',
    destination: 'https://example.test/article/7', focused: true, editable: true, disabled: true, inViewport: false});
  assert.equal(parseElementLine('[c-n-1] link "x" in listitem < main').context, 'listitem < main', 'a line with its own ancestors is still read');
  for (const value of [null, {}, 'not a line', '[ref] role', '[a b] link "x"']) assert.equal(parseElementLine(value), null);
});

test('instruction texts repeated in every frame are stated once and frame owners are bounded at the source', async () => {
  const {frameOwner, FRAME_OWNER_LIMIT} = await import('../browser-observation.js');
  const instruction = 'Matches are candidates, not certainty or permission. '.repeat(12), scope = 'Rendered DOM in this document and open shadow roots. '.repeat(4);
  const frame = index => ({frame: index, url: `https://example.test/${index}`, elements: index ? [] : Array.from({length: 40}, (_, i) => element(i)), text: index ? '' : '본문',
    retrieval: {method: 'dom_order', textBlocks: [], instruction}, coverage: {nodesInspected: 10, scope}});
  const wire = wireOf({title: 't', url: 'https://example.test/', frames: Array.from({length: 12}, (_, index) => frame(index))});
  const result = JSON.parse(compactObservationElements(wire)[2].content);
  assert.equal(result.frameNotes.retrieval, instruction); assert.equal(result.frameNotes.coverage, scope);
  for (const item of result.frames) {assert.equal(item.retrieval.instruction, undefined); assert.equal(item.coverage.scope, undefined); assert.equal(item.retrieval.method, 'dom_order'); assert.equal(item.coverage.nodesInspected, 10);}
  assert(JSON.stringify(result).split(instruction).length === 2, 'the instruction appears once');
  const own = wireOf({title: 't', url: 'https://example.test/', frames: [frame(0), {...frame(1), retrieval: {method: 'lexical', instruction: 'A different instruction for this frame.'}}]});
  const kept = JSON.parse(compactObservationElements(own)[2].content);
  assert.equal(kept.frames[1].retrieval.instruction, 'A different instruction for this frame.');
  const owner = frameOwner({tag: 'iframe', id: 'ad', name: 'x'.repeat(57000), title: null});
  assert.equal(owner.name.length, FRAME_OWNER_LIMIT); assert.equal(owner.tag, 'iframe'); assert.equal(owner.title, null); assert.equal(frameOwner(null), null);
});

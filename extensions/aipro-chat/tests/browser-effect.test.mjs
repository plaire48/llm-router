import test from 'node:test';
import assert from 'node:assert/strict';
import {observationEffect, noteRepeatedNoEffect, NO_EFFECT_NOTE, REPEATED_NO_EFFECT_NOTE} from '../browser-effect.js';

const row = (name, state) => ({role: 'row', name, ...(state ? {state} : {})});
const page = ({elements = [], text = '', regions = [], alerts = [], url = 'https://mail.test/inbox', title = '받은 편지함', doc = 'd1', tabId = 1, omitted = 0, filtered = false} = {}) => ({
  tabId, url, title, topDocumentId: doc,
  frames: [{frame: 0, url, elements, text, textFiltered: filtered, regions, alerts, omittedControls: omitted}],
});
const star = (ref, sender, extra = {}) => ({ref, role: 'button', name: '중요', context: [row(`${sender} 업무 메일`, extra.row)], ...extra.control});

test('a state change is matched across refs and reported with the new ref', () => {
  const before = page({elements: [star('e-a-0-0', '보낸사람1'), star('e-a-0-1', '보낸사람2')]});
  const after = page({elements: [star('e-b-0-0', '보낸사람1'), star('e-b-0-1', '보낸사람2', {row: ['starred'], control: {pressed: true}})]});
  const effect = observationEffect(before, after, 'click_element');
  assert.deepEqual(effect.controlsChanged, [{ref: 'e-b-0-1', role: 'button', name: '중요', from: {pressed: false, row: false}, to: {pressed: true, row: 'starred'}}]);
  assert.equal(effect.none, undefined);
});

test('a click that changed nothing says so, and only click tools get the note', () => {
  const before = page({elements: [star('e-a-0-0', '보낸사람1')], text: '받은 편지함\n보낸사람1 업무 메일'});
  const after = page({elements: [star('e-b-0-0', '보낸사람1')], text: '받은 편지함\n보낸사람1 업무 메일'});
  assert.deepEqual(observationEffect(before, after, 'click_element'), {none: true, note: NO_EFFECT_NOTE});
  assert.deepEqual(observationEffect(before, after, 'wait_page'), {none: true});
});

test('dialogs, alerts and new text lines are listed, bounded', () => {
  const before = page({text: '주문서\n수량 1'});
  const after = page({text: '주문서\n수량 1\n저장되었습니다\n' + 'x'.repeat(400), regions: [{role: 'dialog', name: '확인'}], alerts: [{role: 'status', text: '저장되었습니다'}]});
  const effect = observationEffect(before, after, 'click_element');
  assert.deepEqual(effect.dialogsOpened, ['dialog "확인"']);
  assert.deepEqual(effect.alertsAdded, ['저장되었습니다']);
  assert.equal(effect.textAdded.count, 2);
  assert(effect.textAdded.first[1].length <= 160);
  const closed = observationEffect(after, before, 'click_element');
  assert.deepEqual(closed.dialogsClosed, ['dialog "확인"']);
  assert.equal(closed.textRemoved.count, 2);
});

test('a control that changed its name in the same place is one renamed control', () => {
  const before = page({elements: [{ref: 'e-a-0-0', role: 'button', name: 'Follow', context: [{role: 'region', name: 'profile'}]}]});
  const after = page({elements: [{ref: 'e-b-0-0', role: 'button', name: 'Following', context: [{role: 'region', name: 'profile'}]}]});
  const effect = observationEffect(before, after, 'click_element');
  assert.deepEqual(effect.controlsRenamed, [{ref: 'e-b-0-0', role: 'button', name: 'Following', from: 'Follow'}]);
  assert.equal(effect.controlsAdded, undefined); assert.equal(effect.controlsRemoved, undefined);
});

test('added and removed controls are listed only when both observations are complete', () => {
  const field = (ref, name) => ({ref, role: 'textbox', name, context: [{role: 'form', name: '신청'}]});
  const before = page({elements: [field('e-a-0-0', '이름')]});
  const after = page({elements: [field('e-b-0-0', '이름'), field('e-b-0-1', '사업자번호'), field('e-b-0-2', '대표자')]});
  const effect = observationEffect(before, after, 'select_option');
  assert.deepEqual(effect.controlsAdded, {count: 2, first: [{ref: 'e-b-0-1', role: 'textbox', name: '사업자번호'}, {ref: 'e-b-0-2', role: 'textbox', name: '대표자'}]});
  assert.deepEqual(observationEffect(after, before, 'click_element').controlsRemoved, {count: 2, first: [{role: 'textbox', name: '사업자번호'}, {role: 'textbox', name: '대표자'}]}, 'a removed control has no ref to act on');
  const partial = observationEffect(page({elements: [field('e-a-0-0', '이름')], omitted: 12}), after, 'select_option');
  assert.equal(partial.controlsAdded, undefined);
  assert.match(partial.partial, /not listed/);
  const filtered = observationEffect(page({elements: [field('e-a-0-0', '이름')], filtered: true}), after, 'select_option');
  assert.equal(filtered.controlsAdded, undefined); assert.equal(filtered.textAdded, undefined);
});

test('another tab or a new document is reported without comparing controls', () => {
  const before = page({elements: [star('e-a-0-0', '보낸사람1')]});
  assert.deepEqual(observationEffect(before, page({doc: 'd2', url: 'https://mail.test/read/1', title: '메일'}), 'click_element'), {urlChanged: true, titleChanged: true, newDocument: true});
  assert.deepEqual(observationEffect(before, page({tabId: 2}), 'click_element'), {tabChanged: true});
});

test('the same address in a single-page app compares controls; a cut text does not invent a line', () => {
  const before = page({text: '목록\n첫 줄\n잘린 줄의 앞', elements: []});
  before.frames[0].truncated = true;
  const after = page({url: 'https://mail.test/inbox?page=2', text: '목록\n첫 줄\n잘린 줄의 앞부분이 더 길다', elements: []});
  after.frames[0].truncated = true;
  const effect = observationEffect(before, after, 'click_element');
  assert.equal(effect.urlChanged, true);
  assert.equal(effect.textAdded, undefined);
});

test('nothing is compared without two observations', () => {
  assert.equal(observationEffect(null, page(), 'click_element'), null);
  assert.equal(observationEffect(page(), {error: 'x'}, 'click_element'), null);
});

test('the effect stays small on a large page', () => {
  const many = prefix => Array.from({length: 300}, (_, i) => ({ref: `e-${prefix}-0-${i}`, role: 'checkbox', name: `행 ${i}`, context: [row(`메일 ${i}`)], checked: false}));
  const after = many('b').map(element => ({...element, checked: true}));
  const effect = observationEffect(page({elements: many('a')}), page({elements: after}), 'click_element');
  assert.equal(effect.controlsChanged.length, 6); assert.equal(effect.controlsChangedOmitted, 294);
  assert(JSON.stringify(effect).length < 1500, String(JSON.stringify(effect).length));
});

test('focus that lands in a field is an effect; focus on the clicked button is not', () => {
  const box = focused => ({ref: 'e-0', role: 'searchbox', name: '검색', ...(focused ? {focused: true} : {})});
  const button = focused => ({ref: 'e-1', role: 'button', name: '검색 열기', ...(focused ? {focused: true} : {})});
  const opened = observationEffect(page({elements: [box(false), button(false)]}), page({elements: [box(true), button(false)]}), 'click_element');
  assert.deepEqual(opened.focused, {ref: 'e-0', role: 'searchbox', name: '검색'});
  assert.equal(opened.none, undefined);
  assert.equal(observationEffect(page({elements: [box(false), button(false)]}), page({elements: [box(false), button(true)]}), 'click_element').none, true);
  assert.equal(observationEffect(page({elements: [box(true)]}), page({elements: [box(true)]}), 'click_element').focused, undefined, 'focus that stayed is not a change');
});

test('on a page whose controls were left out, a change in the number of controls is still reported', () => {
  const before = page({elements: [{ref: 'e-0', role: 'button', name: '메뉴'}], omitted: 300});
  const after = page({elements: [{ref: 'e-0', role: 'button', name: '메뉴'}], omitted: 305});
  before.frames[0].coverage = {controlsObserved: 700}; after.frames[0].coverage = {controlsObserved: 705};
  const effect = observationEffect(before, after, 'click_element');
  assert.deepEqual(effect.controlCount, {from: 700, to: 705});
  assert.equal(effect.none, undefined);
  after.frames[0].coverage = {controlsObserved: 700};
  const same = observationEffect(before, after, 'click_element');
  assert.equal(same.none, true); assert.match(same.partial, /not listed/);
});

test('a second click in a row that changed nothing says to stop repeating; a change resets the count', () => {
  const task = {};
  const none = {none: true, note: NO_EFFECT_NOTE};
  assert.equal(noteRepeatedNoEffect(task, 'click_element', none).note, NO_EFFECT_NOTE);
  const second = noteRepeatedNoEffect(task, 'click_element', none);
  assert.equal(second.note, REPEATED_NO_EFFECT_NOTE); assert.equal(second.repeated, 2);
  assert.equal(noteRepeatedNoEffect(task, 'scroll_page', {none: true}).note, undefined, 'only click-like actions count');
  noteRepeatedNoEffect(task, 'click_element', {alertsAdded: ['완료']});
  assert.equal(noteRepeatedNoEffect(task, 'click_element', none).note, NO_EFFECT_NOTE);
  assert.equal(noteRepeatedNoEffect(task, 'click_element', null), null);
});

test('the same controls and lines in another order are reported as reordered, not as no change', () => {
  const item = (ref, name) => ({ref, role: 'listitem', name, context: [{role: 'list', name: '할 일'}]});
  const before = page({elements: [item('e-a-0-0', '보고서'), item('e-a-0-1', '회의'), item('e-a-0-2', '메일')], text: '보고서\n회의\n메일'});
  const after = page({elements: [item('e-b-0-0', '회의'), item('e-b-0-1', '보고서'), item('e-b-0-2', '메일')], text: '회의\n보고서\n메일'});
  const effect = observationEffect(before, after, 'drag_element');
  assert.deepEqual(effect.reordered, {controls: 2, text: true});
  assert.equal(effect.none, undefined);
  assert.equal(observationEffect(before, page({elements: before.frames[0].elements, text: '보고서\n회의\n메일'}), 'drag_element').none, true);
});

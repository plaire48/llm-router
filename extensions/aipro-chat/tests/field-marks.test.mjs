import test from 'node:test';
import assert from 'node:assert/strict';
import {takeFieldMarks, fieldScope, markFieldWritten, fieldUnchanged, FIELD_MARK_LIMIT} from '../field-marks.js';

// A review of the first version found that a field was told apart by its label
// and its position among the fields an observation happened to return. A search
// that returned two of five fields renumbered them, and two records of one
// screen (…?seq=1, …?seq=2) shared their fields.
const mark = text => `${text.length}:${text.padEnd(16, '0').slice(0, 16).replace(/[^a-f0-9]/g, 'a')}`;
const field = (place, value, extra = {}) => ({role: 'textbox', name: '메모', valueMark: mark(value), ...(place ? {fieldPlace: place} : {}), ...extra});
const scope = 'https://example.test/view.do?seq=1';

test('the mark and the place never reach the observation', () => {
  const [taken] = takeFieldMarks({}, scope, [field('id:memo', 'abc')]);
  assert.deepEqual(taken.descriptor, {role: 'textbox', name: '메모'});
  assert.equal(typeof taken.fieldKey, 'string');
  const [unplaced] = takeFieldMarks({}, scope, [{role: 'textbox', name: '메모', fieldPlace: 'id:x'}]);
  assert.equal(Object.hasOwn(unplaced.descriptor, 'fieldPlace'), false);
});

test('an observation that returns some of the fields does not renumber them', () => {
  const task = {};
  const all = takeFieldMarks(task, scope, [field('at:0', 'aaa'), field('at:1', 'bbb'), field('at:2', 'ccc')]);
  // A search returns the third field first and leaves the second out.
  const some = takeFieldMarks(task, scope, [field('at:2', 'ccc'), field('at:0', 'aaa')]);
  assert.equal(some[0].fieldKey, all[2].fieldKey); assert.equal(some[1].fieldKey, all[0].fieldKey);
  assert.deepEqual(fieldUnchanged(task, some[0], mark('ccc')), {passed: true, compared: 'first_observation'});
  assert.deepEqual(fieldUnchanged(task, some[1], mark('aaa')), {passed: true, compared: 'first_observation'});
});

test('two records of one screen keep their own fields', () => {
  const task = {};
  const [first] = takeFieldMarks(task, 'https://example.test/view.do?seq=1', [field('id:memo', 'aaa')]);
  const [second] = takeFieldMarks(task, 'https://example.test/view.do?seq=2', [field('id:memo', 'bbb')]);
  assert.notEqual(first.fieldKey, second.fieldKey);
  assert.equal(fieldUnchanged(task, second, mark('bbb')).passed, true);
  assert.equal(fieldUnchanged(task, first, mark('aaa')).passed, true);
  markFieldWritten(task, first);
  assert.equal(fieldUnchanged(task, first, mark('aaa')).reason, 'field_written');
  assert.equal(fieldUnchanged(task, second, mark('bbb')).passed, true, 'writing one record says nothing about the other');
});

test('frames without an address of their own are told apart by the element that holds them', () => {
  const top = 'https://example.test/edit?id=3';
  assert.equal(fieldScope('https://example.test/inner?x=1', top, {id: 'a'}), 'https://example.test/inner?x=1');
  const body = fieldScope('about:srcdoc', top, {tag: 'iframe', id: 'body', name: '', title: '본문'});
  const note = fieldScope('about:blank', top, {tag: 'iframe', id: 'note', name: null, title: undefined});
  assert.notEqual(body, note); assert.notEqual(body, top); assert(body.startsWith(top));
  assert.equal(fieldScope('about:blank', 'chrome://newtab', null), null);
  assert.equal(fieldScope('about:blank', top, {tag: 'iframe', id: 'note', name: '', title: ''}), note, 'both observation paths give the same scope');
});

test('a field without a place or a scope has no record and cannot pass', () => {
  const task = {};
  const [unplaced] = takeFieldMarks(task, scope, [field(null, 'aaa')]);
  assert.equal(unplaced.fieldKey, undefined); assert.equal(Object.hasOwn(unplaced.descriptor, 'valueMark'), false);
  assert.deepEqual(fieldUnchanged(task, unplaced, mark('aaa')), {passed: false, reason: 'baseline_missing'});
  const [unscoped] = takeFieldMarks(task, null, [field('id:memo', 'aaa')]);
  assert.equal(unscoped.fieldKey, undefined); assert.equal(task.fieldMarks.size, 0);
});

test('a document that is still loading starts no record', () => {
  const task = {};
  const [early] = takeFieldMarks(task, scope, [field('id:memo', '')], {baseline: false});
  assert.equal(typeof early.fieldKey, 'string'); assert.equal(task.fieldMarks.size, 0);
  assert.equal(fieldUnchanged(task, early, mark('')).reason, 'baseline_missing');
  // The page then shows the stored value: that is the first value of the run.
  const [loaded] = takeFieldMarks(task, scope, [field('id:memo', 'stored')]);
  assert.equal(fieldUnchanged(task, loaded, mark('stored')).passed, true);
});

test('the first value stays the comparison, and a malformed mark is not recorded', () => {
  const task = {};
  const [seen] = takeFieldMarks(task, scope, [field('id:memo', 'aaa')]);
  takeFieldMarks(task, scope, [field('id:memo', 'bbb')]);
  assert.equal(fieldUnchanged(task, seen, mark('bbb')).reason, 'value_changed');
  assert.equal(fieldUnchanged(task, seen, mark('aaa')).passed, true);
  assert.equal(fieldUnchanged(task, seen, 'plain text').reason, 'baseline_missing');
  const other = {};
  takeFieldMarks(other, scope, [{role: 'textbox', name: 'x', fieldPlace: 'id:x', valueMark: 'the value itself'}]);
  assert.equal(other.fieldMarks.size, 0);
});

test('past the limit a new field has no record', () => {
  const task = {};
  takeFieldMarks(task, scope, Array.from({length: FIELD_MARK_LIMIT + 5}, (_, index) => field(`at:${index}`, String(index))));
  assert.equal(task.fieldMarks.size, FIELD_MARK_LIMIT);
  const [late] = takeFieldMarks(task, scope, [field(`at:${FIELD_MARK_LIMIT + 1}`, String(FIELD_MARK_LIMIT + 1))]);
  assert.equal(fieldUnchanged(task, late, mark(String(FIELD_MARK_LIMIT + 1))).reason, 'baseline_missing');
});

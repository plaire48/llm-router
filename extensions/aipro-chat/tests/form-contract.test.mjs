import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILTIN_SKILLS, browserTools} from '../skills.js';
import {toolArgumentIssues} from '../tool-validation.js';

const schema = name => browserTools({}, BUILTIN_SKILLS[0]).find(tool => tool.function.name === name).function.parameters;
test('one full fill fits in an independent verification without unbounded batches', () => {
  const fields = Array.from({length: 20}, (_, i) => ({field_id: `ref-${i}`, value: `${i}`}));
  const checks = fields.map(field => ({kind: 'field_value', ref: field.field_id, expected: field.value}));
  assert.deepEqual(toolArgumentIssues(schema('fill_form'), {fields}), null);
  assert.deepEqual(toolArgumentIssues(schema('verify_page'), {checks}), null);
  assert(toolArgumentIssues(schema('fill_form'), {fields: [...fields, {field_id: 'extra', value: '21'}]}).some(issue => issue.rule === 'maxItems'));
  assert(toolArgumentIssues(schema('verify_page'), {checks: [...checks, {kind: 'text_present', expected: 'extra'}]}).some(issue => issue.rule === 'maxItems'));
});

test('fill schemas reject oversized values before entering browser execution', () => {
  const fields = [{field_id: 'ref-1', value: 'x'.repeat(16000)}];
  assert.deepEqual(toolArgumentIssues(schema('fill_form'), {fields}), null);
  assert(toolArgumentIssues(schema('fill_form'), {fields: [{...fields[0], value: fields[0].value + 'x'}]}).some(issue => issue.rule === 'maxLength'));
});

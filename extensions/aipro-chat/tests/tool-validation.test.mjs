import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {toolArgumentIssues} from '../tool-validation.js';
import {runAgent} from '../agent-runtime.js';
import {rejectedToolFeedback} from '../tool-errors.js';

const parameters = {type: 'object', properties: {
  fields: {type: 'array', minItems: 1, maxItems: 8, items: {type: 'object', properties: {
    field_id: {type: 'string', pattern: '^ref-[0-9]+$'}, value: {type: 'string', maxLength: 20}, optional: {type: 'string'},
  }, required: ['field_id', 'value'], additionalProperties: false}},
}, required: ['fields'], additionalProperties: false};
const args = value => ({fields: [{field_id: 'ref-1', value}]});
const tools = [{type: 'function', function: {name: 'fill_form', description: 'Observed form', parameters}}];
const call = (args, id) => ({calls: [{id, type: 'function', function: {name: 'fill_form', arguments: JSON.stringify(args)}}]});

test('safe schema issues identify nested invalid fields without coercing or altering inputs', () => {
  for (const [value, path, rule] of [[args(42), '/fields/0/value', 'type'], [args('x'.repeat(30)), '/fields/0/value', 'maxLength'],
    [{fields: [{field_id: 'PRIVATE_BAD_REF', value: 'ok'}]}, '/fields/0/field_id', 'pattern'],
    [{fields: [{value: 'ok'}]}, '/fields/0/field_id', 'required'], [{}, '/fields', 'required']]) {
    const before = structuredClone(value), issues = toolArgumentIssues(parameters, value);
    assert(issues.some(issue => issue.path === path && issue.rule === rule), JSON.stringify(issues));
    assert.deepEqual(value, before); assert(!JSON.stringify(issues).includes('PRIVATE_BAD_REF'));
  }
  assert.equal(toolArgumentIssues(parameters, args('00123')), null);
  assert(toolArgumentIssues(parameters, {fields: [{...args('ok').fields[0], optional: null}]}));
});

test('standard JSON Schema unions, item uniqueness and nullable values share Pi semantics without conversion', () => {
  const schema = {type: 'object', properties: {
    target: {anyOf: [{type: 'string', pattern: '^ref-'}, {type: 'integer', minimum: 1}]},
    tags: {type: 'array', uniqueItems: true, items: {type: 'string'}},
    value: {type: ['string', 'number', 'boolean', 'null']},
  }, required: ['target', 'tags', 'value'], additionalProperties: false};
  for (const target of ['ref-1', 1]) for (const value of ['00123', 0, false, null]) {
    assert.equal(toolArgumentIssues(schema, {target, tags: ['a', 'b'], value}), null);
  }
  assert(toolArgumentIssues(schema, {target: false, tags: [], value: null}));
  assert(toolArgumentIssues(schema, {target: 1, tags: ['a', 'a'], value: null}).some(issue => issue.rule === 'uniqueItems'));
});

test('feedback is bounded and never copies arbitrary property names or argument values', () => {
  const value = {PRIVATE_ROOT: 'PRIVATE_VALUE', fields: Array.from({length: 8}, () => ({field_id: 'PRIVATE_REF', value: 99, PRIVATE_NESTED: 'PRIVATE_VALUE'}))};
  const issues = toolArgumentIssues(parameters, value);
  assert(issues.length > 0 && issues.length <= 4);
  assert(!/PRIVATE|99/.test(JSON.stringify(issues)));
  const onlyExtra = toolArgumentIssues(parameters, {...args('ok'), PRIVATE_ROOT: 'PRIVATE_VALUE'});
  assert(onlyExtra.some(issue => issue.path === '' && issue.rule === 'additionalProperties'));
  const nested = toolArgumentIssues(parameters, {fields: [{...args('ok').fields[0], PRIVATE_NESTED: true}]});
  assert(nested.some(issue => issue.path === '/fields/0' && issue.rule === 'additionalProperties'));
  assert(!JSON.stringify(nested).includes('PRIVATE_NESTED'));
});

test('interpreter validates in a runtime that forbids generated code', () => {
  const script = `import assert from 'node:assert/strict'; import {toolArgumentIssues} from ${JSON.stringify(new URL('../tool-validation.js', import.meta.url).href)};
    const schema = ${JSON.stringify(parameters)};
    assert.equal(toolArgumentIssues(schema, ${JSON.stringify(args('ok'))}), null);
    assert(toolArgumentIssues(schema, ${JSON.stringify(args(42))}).some(issue => issue.rule === 'type'));`;
  const result = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', script], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('closed-object repair names allowed and required schema fields without exposing rejected names or values', () => {
  const bad = {fields: [{field_id: 'ref-1', value: 'ok'}], PRIVATE_UNKNOWN: 'PRIVATE_VALUE'};
  const before = structuredClone(bad);
  const issues = toolArgumentIssues(parameters, bad);
  const extra = issues.find(issue => issue.rule === 'additionalProperties');
  assert.equal(extra.objectSchemaPath, '');
  assert.deepEqual(extra.objectSchemas, [{allowedProperties: ['fields'], requiredProperties: ['fields'], additionalProperties: false}]);
  const feedback = rejectedToolFeedback(false, issues);
  assert.equal(feedback.actionIssued, false);
  assert.match(feedback.instruction, /No arguments were automatically removed/);
  assert(!JSON.stringify(feedback).includes('PRIVATE'));
  assert.deepEqual(bad, before);
  assert(toolArgumentIssues(parameters, bad));
  assert.equal(toolArgumentIssues(parameters, args('ok')), null);
  const missing = toolArgumentIssues(parameters, {});
  assert.equal(missing[0].path, '/fields');
  assert.equal(missing[0].objectSchemaPath, '');
  assert.deepEqual(missing[0].objectSchemas[0].requiredProperties, ['fields']);
});

test('nested array repairs use the containing object schema without leaking rejected properties', () => {
  const schema = {type: 'object', properties: {items: {type: 'array', items: parameters.properties.fields.items}}, required: ['items'], additionalProperties: false};
  const input = {items: [{field_id: 'ref-1', value: 'ok', PRIVATE_EXTRA: 'PRIVATE_VALUE'}]};
  const issue = toolArgumentIssues(schema, input).find(issue => issue.rule === 'additionalProperties');
  assert.equal(issue.path, '/items/0');
  assert.equal(issue.objectSchemaPath, '/items/0');
  assert.deepEqual(issue.objectSchemas[0].allowedProperties, ['field_id', 'value', 'optional']);
  assert.deepEqual(issue.objectSchemas[0].requiredProperties, ['field_id', 'value']);
  assert(!JSON.stringify(issue).includes('PRIVATE'));
});

test('unresolved validator pointers do not attach a misleading parent-object hint', () => {
  // TypeBox currently emits slash-containing property names unescaped. Keep
  // that ambiguous path masked instead of guessing which schema object it is.
  const schema = {type: 'object', properties: {'a/b': {type: 'array', items: parameters.properties.fields.items}}};
  const issues = toolArgumentIssues(schema, {'a/b': [{field_id: 'ref-1', value: 'ok', PRIVATE_EXTRA: true}]});
  assert.equal(issues[0].path, '/*');
  assert.equal(issues[0].objectSchemas, undefined);
  assert(!JSON.stringify(issues).includes('PRIVATE'));
});

test('union repair keeps branch requirements separate and still rejects every invalid branch', () => {
  const schema = {anyOf: [
    {type: 'object', properties: {ref: {type: 'string'}}, required: ['ref'], additionalProperties: false},
    {type: 'object', properties: {query: {type: 'string'}}, required: ['query'], additionalProperties: false},
  ]};
  const issues = toolArgumentIssues(schema, {PRIVATE_EXTRA: 'PRIVATE_VALUE'});
  const hints = issues.flatMap(issue => issue.objectSchemas || []);
  assert(hints.some(hint => JSON.stringify(hint.requiredProperties) === '["ref"]'));
  assert(hints.some(hint => JSON.stringify(hint.requiredProperties) === '["query"]'));
  assert(hints.every(hint => hint.requiredProperties.length === 1));
  assert(!JSON.stringify(issues).includes('PRIVATE'));
  assert.equal(toolArgumentIssues(schema, {ref: 'observed'}), null);
  assert.equal(toolArgumentIssues(schema, {query: 'search'}), null);
  assert(toolArgumentIssues(schema, {ref: 'observed', query: 'search'}));
  const exclusive = {oneOf: schema.anyOf};
  assert(toolArgumentIssues(exclusive, {PRIVATE_EXTRA: 'PRIVATE_VALUE'}).some(issue => issue.objectSchemas?.length));
  assert.equal(toolArgumentIssues(exclusive, {ref: 'observed'}), null);
});

test('intersection hints remain fragments and a closed empty object stays closed', () => {
  const schema = {allOf: [
    {type: 'object', properties: {ref: {type: 'string'}}, required: ['ref']},
    {type: 'object', properties: {query: {type: 'string'}}, required: ['query']},
  ]};
  const hints = toolArgumentIssues(schema, {}).flatMap(issue => issue.objectSchemas || []);
  assert(hints.some(hint => JSON.stringify(hint.requiredProperties) === '["ref"]'));
  assert(hints.some(hint => JSON.stringify(hint.requiredProperties) === '["query"]'));
  assert(hints.every(hint => hint.requiredProperties.length === 1));
  assert.equal(toolArgumentIssues(schema, {ref: 'observed', query: 'search'}), null);
  assert(toolArgumentIssues(schema, {ref: 'observed'}));
  const empty = {type: 'object', properties: {}, additionalProperties: false};
  assert.deepEqual(toolArgumentIssues(empty, {PRIVATE_EXTRA: true})[0].objectSchemas,
    [{allowedProperties: [], requiredProperties: [], additionalProperties: false}]);
  assert.equal(toolArgumentIssues(empty, {}), null);
});

test('large schema repair hints and arbitrary oversized input stay bounded and never mutate input', () => {
  const properties = Object.fromEntries(Array.from({length: 300}, (_, index) => [`declared_${index}_${'x'.repeat(30)}`, {type: 'string'}]));
  const schema = {type: 'object', properties, required: [], additionalProperties: false};
  const secret = `PRIVATE_${'z'.repeat(100000)}`;
  const input = {[secret]: secret};
  const issues = toolArgumentIssues(schema, input);
  assert(issues.length <= 4);
  assert(issues[0].schemaHintsTruncated);
  assert(issues[0].objectSchemas.every(hint => hint.allowedProperties.length <= 24));
  assert(JSON.stringify(issues).length < 3000);
  assert(!JSON.stringify(issues).includes('PRIVATE'));
  assert.equal(input[secret], secret);
  assert.match(rejectedToolFeedback(false, issues).instruction, /consult the full declared schema/);
});

test('actual verify-page style failure repairs in the next call without weakening closed-object validation', async () => {
  const parameters = {type: 'object', properties: {checks: {type: 'array', minItems: 1, items: {type: 'object', properties: {
    kind: {type: 'string', enum: ['text_present']}, expected: {type: 'string'},
  }, required: ['kind', 'expected'], additionalProperties: false}}}, required: ['checks'], additionalProperties: false};
  const tools = [{type: 'function', function: {name: 'verify_page', description: 'Verify current page', parameters}}];
  let turn = 0; const executed = [];
  const good = {checks: [{kind: 'text_present', expected: 'Observed result'}]};
  await runAgent({messages: [{role: 'user', content: '현재 결과를 확인해줘'}], tools, signal: new AbortController().signal,
    complete: async messages => {
      if (++turn === 3) return {content: '확인 완료', calls: null};
      if (turn === 2) {
        assert.deepEqual(executed, []);
        const feedback = JSON.parse(messages.find(message => message.role === 'tool').content);
        assert.deepEqual(feedback.issues[0].objectSchemas[0].allowedProperties, ['checks']);
        assert(!JSON.stringify(feedback).includes('PRIVATE'));
      }
      return {calls: [{id: 'verify', type: 'function', function: {name: 'verify_page', arguments: JSON.stringify(turn === 1 ? {...good, PRIVATE_EXTRA: 'PRIVATE_VALUE'} : good)}}]};
    }, execute: async (name, input) => {executed.push({name, input}); return {ok: true, verified: true};},
  });
  assert.deepEqual(executed, [{name: 'verify_page', input: good}]);
});

test('Pi and raw-argument failures keep corrective issues across reused call IDs and dispatch only the repair', async () => {
  const invalid = [args(42), {fields: [{field_id: 'PRIVATE_BAD_REF', value: 'ok'}]}, {fields: [{...args('ok').fields[0], optional: null}]},
    {fields: [{...args('ok').fields[0], PRIVATE_EXTRA: 'PRIVATE_VALUE'}]}];
  for (const bad of invalid) {
    let turn = 0; const executed = [], trace = [];
    await runAgent({messages: [{role: 'user', content: '초안을 입력해줘'}], tools, signal: new AbortController().signal, onStep: step => trace.push(step),
      complete: async messages => {
        if (++turn === 1) return call(bad, 'shared-id');
        const feedback = messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
        const failure = feedback[0];
        assert.equal(failure.error, 'tool_arguments_invalid'); assert.equal(failure.actionIssued, false);
        assert(failure.issues.length); assert(!/PRIVATE/.test(JSON.stringify(failure)));
        if (turn === 2) {assert.deepEqual(executed, []); return call(args('00123'), 'shared-id');}
        assert.equal(feedback[1].ok, true); return {content: '입력 확인', calls: null};
      }, execute: async (name, input) => {executed.push({name, input}); return {ok: true};},
    });
    assert.deepEqual(executed, [{name: 'fill_form', input: args('00123')}]);
    assert(!/PRIVATE|00123/.test(JSON.stringify(trace)));
  }
});

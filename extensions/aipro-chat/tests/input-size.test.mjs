import test from 'node:test';
import assert from 'node:assert/strict';
import {measureInputCharacters, completeChat} from '../src/api.js';

test('input sizes partition the existing message plus schema JSON count without returning content', () => {
  const url = 'data:image/png;base64,PRIVATE_IMAGE_PAYLOAD';
  const messages = [{role: 'user', content: [{type: 'text', text: 'PRIVATE_SOURCE_TEXT'}, {type: 'image_url', image_url: {url, detail: 'high'}}]}];
  const tools = [{type: 'function', function: {name: 'inspect', parameters: {type: 'object'}}}];
  const original = structuredClone({messages, tools});
  const sizes = measureInputCharacters(messages, tools);
  assert.equal(sizes.inputCharacters, JSON.stringify(messages).length + JSON.stringify(tools).length);
  assert.equal(sizes.imageInputCharacters, JSON.stringify(url).length - 2);
  assert.equal(sizes.schemaCharacters, JSON.stringify(tools).length);
  assert.equal(sizes.inputCharacters, sizes.textInputCharacters + sizes.imageInputCharacters + sizes.schemaCharacters);
  assert.equal(sizes.inputSizeVersion, 1);
  assert(Object.values(sizes).every(Number.isSafeInteger));
  assert(!JSON.stringify(sizes).includes('PRIVATE_'));
  assert.deepEqual({messages, tools}, original);
});

test('URLs in ordinary text, tool argument JSON and schemas are not counted as image input', () => {
  const url = 'https://example.com/photo.png';
  const encoded = JSON.stringify({type: 'image_url', image_url: {url}});
  const messages = [{role: 'user', content: [{type: 'text', text: encoded}]},
    {role: 'assistant', content: '', tool_calls: [{id: 'tool', function: {name: 'lookup', arguments: encoded}}]},
    {role: 'tool', tool_call_id: 'tool', content: encoded}];
  const sizes = measureInputCharacters(messages, [{description: encoded}]);
  assert.equal(sizes.imageInputCharacters, 0);
  assert.equal(sizes.textInputCharacters, JSON.stringify(messages).length);
});

test('multiple typed images count encoded URL characters while JSON framing and detail stay text', () => {
  const urls = ['https://example.com/한글😀?x="quoted"\n', 'data:image/png;base64,AAAA'];
  const messages = [{role: 'user', content: urls.map(url => ({type: 'image_url', image_url: {url, detail: 'low'}}))}];
  const sizes = measureInputCharacters(messages);
  assert.equal(sizes.imageInputCharacters, urls.reduce((sum, url) => sum + JSON.stringify(url).length - 2, 0));
  assert.equal(sizes.schemaCharacters, 2);
  assert.equal(sizes.textInputCharacters, JSON.stringify(messages).length - sizes.imageInputCharacters);
  assert.equal(sizes.inputCharacters, sizes.textInputCharacters + sizes.imageInputCharacters + 2);
});

test('missing or malformed image URLs are not inferred and empty input keeps JSON overhead', () => {
  const messages = [{role: 'user', content: [{type: 'image_url'}, {type: 'image_url', image_url: {url: 123}},
    {type: 'text', image_url: {url: 'text field, not a typed image'}}]}];
  assert.equal(measureInputCharacters(messages).imageInputCharacters, 0);
  assert.deepEqual(measureInputCharacters([]), {inputSizeVersion: 1, inputCharacters: 4,
    textInputCharacters: 2, imageInputCharacters: 0, schemaCharacters: 2});
});

test('the provider start and finish usage events carry the measured request split', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic-only', receivedAt: 1}})}}};
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({choices: [{message: {content: 'Done.'}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 2, total_tokens: 12}});
  };
  const events = [];
  const result = await completeChat({provider: 'aipro', modelId: 'test-model', model: {contextLength: 100000},
    credentialReceivedAt: 1, messages: [{role: 'user', content: 'Say done.'}]}, new AbortController().signal,
    undefined, undefined, undefined, undefined, undefined, undefined, event => events.push(event));
  assert.equal(result, 'Done.');
  assert.deepEqual(events.map(event => event.phase), ['start', 'report', 'finish']);
  const sizes = measureInputCharacters(sent.messages, sent.tools || []);
  for (const event of events) for (const [field, value] of Object.entries(sizes)) assert.equal(event[field], value);
  assert.equal(events[0].imageInputCharacters, 0);
  assert(!JSON.stringify(events).includes('synthetic-only'));
  assert(!JSON.stringify(events).includes('Say done.'));
});

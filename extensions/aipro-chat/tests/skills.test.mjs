import test from 'node:test';
import assert from 'node:assert/strict';
import {importSkill, exportSkill, normalizeSkill, allSkills, browserTools, BUILTIN_SKILLS} from '../skills.js';
import {completeChat} from '../src/api.js';
import {chatMessages} from '../chat-contract.js';

test('Markdown skills keep instructions as text and never grant executable tools on import', () => {
  const skill = importSkill('---\nname: "리뷰"\nallowed-tools: Bash\n---\nReview DOM.\n```js\nalert(1)\n```');
  assert.equal(skill.name, '리뷰');
  assert.equal(skill.allowFill, false);
  assert(!skill.instructions.includes('allowed-tools'));
  assert.equal(allSkills([skill]).length, 6);
  assert.deepEqual(browserTools(null, {...skill, allowFill: true}).map(tool => tool.function.name), ['ask_user']);
  assert.deepEqual(browserTools(null, skill, '', {autoConnect: true}).map(tool => tool.function.name), ['ask_user']);
  assert.deepEqual(browserTools(null, BUILTIN_SKILLS.find(item => item.id === 'form'), '', {autoConnect: true}).map(tool => tool.function.name), ['ask_user']);
  assert.deepEqual(browserTools({}, skill).map(tool => tool.function.name), ['ask_user', 'read_page', 'inspect_dom']);
  assert.equal(browserTools({}, {...skill, allowFill: true}).length, 5);
  assert(!('image_refs' in browserTools(null, skill)[0].function.parameters.properties));
  assert.deepEqual(browserTools(null, null), []);
  assert.throws(() => normalizeSkill({name: '', instructions: 'x'}));
  assert.throws(() => normalizeSkill({name: 'x', instructions: 'x'.repeat(16001)}));
  const preamble = chatMessages([], 'glm', undefined, {skill, page: {title: 'Example'}, tools: browserTools({}, skill)});
  assert(preamble[0].content.includes('User-selected skill: 리뷰'));
  assert(preamble[1].content.includes('inspect_dom'));
});

const frame = value => `data: ${JSON.stringify(value)}\n\n`;
test('automatic copilot avoids duplicate instructions while explicit skills remain intact', () => {
  const skill = BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent');
  const now = new Date('2026-09-24T00:00:00Z');
  const base = chatMessages([], 'qwen', now, {});
  const automatic = chatMessages([], 'qwen', now, {skill, autoConnect: true});
  assert.equal(automatic[0].content, base[0].content);
  assert.match(automatic[0].content, /request_approval/);
  assert.match(automatic[0].content, /verify_page/);
  const explicit = chatMessages([], 'qwen', now, {skill, autoConnect: false});
  assert(explicit[0].content.includes(skill.instructions));
  const custom = {id: 'custom-workflow', name: '업무 절차', instructions: 'Preserve this business rule.'};
  assert(chatMessages([], 'qwen', now, {skill: custom, autoConnect: true})[0].content.includes(custom.instructions));
});

const streamedCall = (id, name, args) => new Response(
  frame({choices: [{delta: {tool_calls: [{index: 0, id, type: 'function', function: {name, arguments: args.slice(0, 2)}}]}}]}) +
  frame({choices: [{delta: {tool_calls: [{index: 0, function: {arguments: args.slice(2)}}]}, finish_reason: 'tool_calls'}]}) + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});

test('fragmented tool calls execute in order and tool-role results reach the final completion', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  const skill = BUILTIN_SKILLS.find(skill => skill.id === 'form');
  const request = {credentialReceivedAt: 1, modelId: 'glm', messages: [{role: 'user', content: '이름에 테스트를 넣어줘'}], skill, page: {title: 'Example'}, tools: browserTools({}, skill)};
  const bodies = [], executed = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) return streamedCall('call-inspect', 'inspect_dom', '{}');
    if (bodies.length === 2) return streamedCall('call-fill', 'fill_form', JSON.stringify({fields: [{field_id: 'f1', value: '테스트'}]}));
    return Response.json({choices: [{message: {content: '입력했습니다.'}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 5, total_tokens: 105}});
  };
  let usage;
  const result = await completeChat(request, new AbortController().signal, undefined, value => {usage = value;}, undefined, undefined, async (name, args) => {
    executed.push({name, args}); return name === 'inspect_dom' ? {fields: [{field_id: 'f1', label: '이름'}]} : {ok: true, applied: 1};
  });
  assert.equal(result, '입력했습니다.');
  assert.equal(bodies[0].tool_choice, 'auto');
  assert.deepEqual(executed.map(call => call.name), ['inspect_dom', 'fill_form']);
  assert.equal(bodies[2].messages.at(-1).role, 'tool');
  assert.equal(bodies[2].messages.at(-1).tool_call_id, 'call-fill');
  assert.deepEqual(JSON.parse(bodies[2].messages.at(-1).content), {ok: true, applied: 1, analysis_evidence_id: 'ev_2'});
  assert.equal(usage.total_tokens, 105);
  assert.equal(request.messages.length, 1);
});

test('unregistered functions and repeated tool requests stop without arbitrary execution', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  const request = {credentialReceivedAt: 1, modelId: 'glm', messages: [], tools: browserTools({}, null).filter(tool => tool.function.name !== 'ask_user')};
  let executed = 0;
  const execute = async () => {executed++; return {};};
  globalThis.fetch = async () => streamedCall('call', 'Bash', '{"command":"x"}');
  await assert.rejects(completeChat(request, new AbortController().signal, undefined, undefined, undefined, undefined, execute), /agent_stalled/);
  assert.equal(executed, 0);
  globalThis.fetch = async () => streamedCall('call', 'inspect_dom', '{}');
  await assert.rejects(completeChat(request, new AbortController().signal, undefined, undefined, undefined, undefined, execute), /agent_stalled/);
  assert.equal(executed, 3);
});

test('the chat adapter keeps read-only skill calls interactive without enabling write tools', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  const skill = BUILTIN_SKILLS.find(skill => skill.id === 'source'), executed = [], phases = [];
  const request = {credentialReceivedAt: 1, modelId: 'QWEN3.8-27B-FP8-256K', messages: [{role: 'user', content: '현재 페이지 마감일을 알려줘'}], skill, tools: browserTools({}, skill)};
  let round = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert(!body.tools.some(tool => ['fill_form', 'verify_page', 'run_playwright'].includes(tool.function.name)));
    if (++round === 1) return Response.json({choices: [{message: {content: '마감일을 확인하겠습니다.', tool_calls: ['read_page', 'inspect_dom'].map(name => ({id: name, type: 'function', function: {name, arguments: '{}'}}))}, finish_reason: 'tool_calls'}]});
    assert.deepEqual(executed, ['read_page']);
    assert.equal(JSON.parse(body.messages.at(-1).content).deferred, true);
    assert.match(body.messages[0].content, /Compare the actual input and output/);
    return Response.json({choices: [{message: {content: '마감일은 10월 8일입니다.'}, finish_reason: 'stop'}]});
  };
  const result = await completeChat(request, new AbortController().signal, undefined, undefined, phase => phases.push(phase), undefined, async name => {executed.push(name); return {text: '마감일 10월 8일'};});
  assert.equal(result, '마감일은 10월 8일입니다.');
  assert.equal(round, 2);
  assert(phases.includes('verifying'));
});


test('portable skill round trip preserves explicit capabilities but excludes runtime and arbitrary fields', () => {
  const builtin = BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent');
  const exported = exportSkill({...builtin, token: 'not-exported', history: ['private'], tools: ['Bash']});
  assert.equal(JSON.parse(exported).format, 'nubi-browser-skill');
  const legacy = importSkill(JSON.stringify({...JSON.parse(exported), format: 'aipro-browser-skill', version: 1}));
  assert.equal(legacy.instructions, builtin.instructions);
  assert.equal(legacy.allowAutomation, true);
  assert(!exported.includes('not-exported'));
  const imported = importSkill(exported);
  assert.equal(imported.name, builtin.name);
  assert.equal(imported.instructions, builtin.instructions);
  assert.equal(imported.needsPage, true);
  assert.equal(imported.allowStorage, true);
  assert.equal(imported.allowFill, true);
  assert.notEqual(imported.id, builtin.id);
  assert.equal(imported.allowAutomation, true);
  assert(browserTools({}, imported).some(tool => tool.function.name === "click_element"));
  assert.throws(() => importSkill('{"format":"aipro-browser-skill","version":2}'), /skill_invalid/);
  assert.throws(() => importSkill('{"name":"arbitrary JSON"}'), /skill_invalid/);
  assert.equal(normalizeSkill({name:'storage',instructions:'read',allowStorage:true}).needsPage, true);
  const escaped = {name:'escaped', instructions: '"'.repeat(16000)};
  assert.equal(importSkill(exportSkill(escaped)).instructions, escaped.instructions);
});

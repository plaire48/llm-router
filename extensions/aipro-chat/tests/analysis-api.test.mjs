import test from 'node:test';
import assert from 'node:assert/strict';
import {completeChat} from '../src/api.js';
import {recordUsage, usageSummary} from '../usage-ledger.js';
import {projectTools} from '../project-tools.js';

const usage = {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120};
const call = (name, args) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const reply = (content, calls) => Response.json({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}], usage});
const readPage = {type: 'function', function: {name: 'read_page', description: 'Read', parameters: {type: 'object', properties: {}}}};

test('parallel child requests reuse the provider without leaking transcripts or overwriting text, and all usage is counted', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  const bodies = [], visible = [], external = [], states = [], phases = [], childRoles = new Set();
  let releaseChildren, parentRound = 0, ledger;
  const bothChildren = new Promise(resolve => {releaseChildren = resolve;});
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://aipro.sdsdev.co.kr/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer synthetic');
    const body = JSON.parse(options.body); bodies.push(body);
    assert.equal(body.model, 'qwen3.8-27b');
    assert.match(body.messages[0].content, /<nubi_computer_time>/);
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    const role = /isolated (\w+) analyst/.exec(body.messages[0].content)?.[1];
    if (role) {
      assert(!JSON.stringify(body).includes('PARENT_ONLY_HISTORY'));
      assert(!body.tools.some(tool => ['delegate_analysis', 'click_element', 'run_playwright', 'ask_user', 'request_approval'].includes(tool.function.name)));
      childRoles.add(role); if (childRoles.size === 2) releaseChildren();
      await bothChildren;
      const output = body.messages.findLast(message => message.role === 'tool');
      if (!output) return reply('', [role === 'research' ? call('wiki_read', {id: 'observed-doc'}) : call('read_analysis_evidence', {evidence_id: 'ev_1'})]);
      const evidence = JSON.parse(output.content);
      const content = JSON.stringify({status: 'complete', summary: `${role} 확인 완료`, findings: [{text: '담당 팀은 개발팀입니다.', evidence_ids: [evidence.evidence_id]}], uncertainties: [], next_step: ''});
      return new Response(`data: ${JSON.stringify({choices: [{delta: {reasoning_content: 'PRIVATE_CHILD_THINKING'}}]})}\n\ndata: ${JSON.stringify({choices: [{delta: {content}, finish_reason: 'stop'}], usage})}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
    }
    assert(!JSON.stringify(body).includes('DOCUMENT_DETAIL_DO_NOT_COPY'.repeat(200)), 'The parent receives bounded excerpts, never the full child document');
    if (++parentRound === 1) return reply('', [call('read_page', {})]);
    if (parentRound === 2) return reply('', [call('delegate_analysis', {tasks: [
      {role: 'page', task: '담당 팀 확인', done_when: '근거 확보', evidence_ids: ['ev_1']},
      {role: 'research', task: '관찰된 observed-doc 문서에서 담당 팀 확인', done_when: '근거 확보', evidence_ids: []},
    ]})]);
    const result = JSON.parse(body.messages.findLast(message => message.role === 'tool').content);
    if (!result.results || result.pending?.length) return reply('', [call('collect_analysis', {})]);
    return reply('담당 팀은 개발팀입니다.');
  };
  const request = {provider: 'aipro', modelId: 'qwen3.8-27b', model: {contextLength: 262144}, credentialReceivedAt: 1,
    messages: [{role: 'user', content: 'PARENT_ONLY_HISTORY'}, {role: 'assistant', content: '이전 대화'}, {role: 'user', content: '이 페이지와 문서를 비교해 담당 팀을 확인해줘'}],
    tools: [readPage, ...projectTools({status: 'connected', capabilities: ['wiki']})]};
  const result = await completeChat(request, new AbortController().signal, text => visible.push(text), undefined, phase => phases.push(phase), undefined,
    async name => {external.push(name); return name === 'read_page' ? {text: '담당 팀 개발팀'} : {dataKind: 'project_reference', content: '담당 팀은 개발팀입니다.\n' + 'DOCUMENT_DETAIL_DO_NOT_COPY'.repeat(800), provenance: {path: 'guide.md', hash: 'doc-v1'}};},
    event => states.push(event), measurement => {ledger = recordUsage(ledger, {...measurement, provider: 'aipro', requestId: 'same-owner'});});
  assert.equal(result, '담당 팀은 개발팀입니다.');
  assert.deepEqual(external.sort(), ['read_page', 'wiki_read']);
  assert(visible.every(text => !text.includes('findings') && !text.includes('확인 완료')));
  assert(!phases.includes('thinking'), 'Child reasoning events must not replace the leader phase');
  assert.equal(usageSummary(ledger).total.aipro.total, bodies.length * 120);
  assert.equal(usageSummary(ledger).total.aipro.calls, bodies.length);
  assert.equal(new Set(states.filter(event => ['analysis_page', 'analysis_research'].includes(event.tool) && event.status === 'done').map(event => event.index)).size, 2);
});

test('question continuation passes the stored comparison goal through the API to real child transports', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  const goal = '두 출처의 가격과 조건을 비교해 줘.\n사용자 수정 요청: 배송비도 포함해 줘.';
  const briefs = [];
  let parentCalls = 0, childCalls = 0, reads = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.messages[0].content.includes('isolated page analyst')) {
      childCalls++;
      const brief = JSON.parse(body.messages[1].content), id = brief.evidence[0].evidence_id;
      if (!body.messages.some(message => message.role === 'tool')) {briefs.push(brief); return reply('', [call('read_analysis_evidence', {evidence_id: id})]);}
      return reply(JSON.stringify({status: 'complete', summary: '관찰한 가격 조건입니다.', findings: [{text: '가격과 배송비를 확인했습니다.', evidence_ids: [id]}], uncertainties: [], next_step: ''}));
    }
    return ++parentCalls <= 2 ? reply('', [call('read_page', {})]) : reply('두 출처를 배송비와 함께 비교했습니다.');
  };
  const request = {provider: 'aipro', modelId: 'qwen3.8-27b', credentialReceivedAt: 1,
    messages: [{role: 'user', content: '두 출처를 비교해 줘.'}, {role: 'user', content: '배송비도 포함해 줘.'}],
    resumeTask: {goal, plan: [], steps: []}, tools: [readPage]};
  const result = await completeChat(request, new AbortController().signal, undefined, undefined, undefined, undefined,
    async () => ({url: `https://source${++reads}.example.com/article`, text: '가격과 배송비에 관한 현재 관찰 자료입니다. '.repeat(10)}));
  assert.equal(result, '두 출처를 배송비와 함께 비교했습니다.');
  assert.equal(briefs.length, 2); assert.equal(childCalls, 4);
  assert(briefs.every(brief => brief.task.includes(goal) && !brief.task.includes('<task_checkpoint>')));
});

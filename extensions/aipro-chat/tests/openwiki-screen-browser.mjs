import {wikiAgentCompletion} from './fixtures/openwiki-model.mjs';
import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload} from './fixtures/goal-review.mjs';
import {startOpenWikiFixture} from './fixtures/openwiki-server.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-openwiki-screen-'));
const extension = resolve(profile, 'extension'), requests = [], errors = [], checks = [];
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
let fixture, context, worker, ui, target, manifest, stage = 0, routeFailure, screenEvidence, sourceEvidence, reviewed = false;
const check = value => {checks.push(value); console.log(`PASS ${value}`);};
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
async function poll(fn, predicate = value => value) {
  for (let i = 0; i < 500; i++) {if (routeFailure) throw routeFailure; const value = await fn(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 50));}
  throw new Error('Screen/source comparison did not finish');
}
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const sse = (name, args, content) => frame({choices: [{delta: name ? {tool_calls: [{index: 0, id: `screen-source-${stage}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content}, finish_reason: name ? 'tool_calls' : 'stop'}]}) + frame({choices: [], usage: {prompt_tokens: 300, completion_tokens: 25, total_tokens: 325}}) + 'data: [DONE]\n\n';
try {
  await mkdir('verification', {recursive: true});
  fixture = await startOpenWikiFixture();
  await cp(resolve('dist'), extension, {recursive: true});
  manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Only the isolated integration-test copy receives a loopback host grant.
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', context_length: 524288}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', async route => {
    try {
      assert.equal(route.request().headers().authorization, `Bearer ${token}`);
      const body = route.request().postDataJSON();
      const wikiReply=wikiAgentCompletion(body); if(wikiReply)return route.fulfill({json:wikiReply});
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning}); requests.push(body);
      const review = goalReviewPayload(body.messages);
      if (review) {
        const screen = review.evidence.find(item => item.tool === 'read_page' && item.usable);
        const source = review.evidence.find(item => item.tool === 'read_source' && item.usable);
        assert(!review.evidence.some(item => ['find_skills', 'read_skill'].includes(item.tool)), 'Workflow guidance is not completion evidence');
        assert(screen && source, 'The independent review must receive both kinds of evidence');
        assert.match(JSON.stringify(screen.result), /Review checkout/);
        assert.match(source.result.content, /const label = 'Review checkout';/);
        assert.equal(await target.getByRole('button', {name: 'Review checkout', exact: true}).count(), 1);
        reviewed = true;
        return route.fulfill({json: {choices: [{message: {content: JSON.stringify({status: 'complete', checks: [
          {requirement: '현재 화면의 버튼 문구 확인', status: 'met', evidence_ids: [screen.id]},
          {requirement: '현재 소스와 비교하고 파일 위치 인용', status: 'met', evidence_ids: [screen.id, source.id]},
        ], next_step: ''})}, finish_reason: 'stop'}], usage: {prompt_tokens: 300, completion_tokens: 25, total_tokens: 325}}});
      }
      const environment = body.messages.find(message => message.role === 'user' && typeof message.content === 'string' && message.content.startsWith('<environment>'))?.content;
      assert.match(environment, /Connected project:.*Checkout demo/);
      assert.match(environment, /"capabilities":\["wiki","source"\]/);
      const names = body.tools?.map(tool => tool.function.name) || [];
      const last = body.messages.findLast(message => message.role === 'tool');
      const result = last ? JSON.parse(last.content) : null;
      assert(!result?.error, result?.error);
      let name, args = {}, content = '';
      if (stage < 5) assert.equal((await state()).page, null, 'Skill/library retrieval must not open a browser workspace');
      if (stage === 0) {assert(names.includes('find_skills')); assert(!environment.includes('Evidence contract')); name = 'find_skills'; args = {query: 'OpenWiki'};}
      if (stage === 1) {assert.equal(result.skills[0].id, 'openwiki-page-workflow'); name = 'read_skill'; args = {skill_id: result.skills[0].id};}
      if (stage === 2) {assert.equal(result.dataKind, 'skill_reference'); assert(result.resources.some(item => item.path === 'references/evidence-contract.md')); name = 'read_skill'; args = {skill_id: 'openwiki-page-workflow', path: 'references/evidence-contract.md'};}
      // ask_openwiki belongs to the knowledge group; project holds the source tools.
      if (stage === 3) {assert.match(result.content, /Evidence contract/); name = 'select_tools'; args = {groups: ['knowledge']};}
      if (stage === 4) {assert(names.includes('ask_openwiki')); name = 'ask_openwiki'; args = {wiki:'external',question: 'How does CheckoutButton present the review before payments?'};}
      if (stage === 5) {assert.equal(result.engine, 'openwiki-deepagents'); assert(result.evidence.some(item => item.excerpt.includes('CheckoutButton'))); assert.equal(result.coverage.sourceComplete, true); assert(names.includes('read_page')); name = 'read_page';}
      if (stage === 6) {
        screenEvidence = result;
        assert.equal(result.url, `${fixture.origin}/checkout`);
        assert(result.frames.some(frame => frame.text.includes('CheckoutButton')));
        assert(result.frames.flatMap(frame => frame.elements || []).some(element => element.name === 'Review checkout' && element.role === 'button'));
        assert(names.includes('select_tools')); name = 'select_tools'; args = {groups: ['project']};
      }
      if (stage === 7) {assert(names.includes('source_search')); name = 'source_search'; args = {query: 'CheckoutButton', limit: 5};}
      if (stage === 8) {
        const match = result.results.find(item => item.path === 'src/CheckoutButton.tsx');
        assert(match); assert.equal(match.provenance.kind, 'source');
        name = 'read_source'; args = {path: match.path, start: 1, end: 4};
      }
      if (stage === 9) {
        sourceEvidence = result;
        assert.equal(result.provenance.hash, await fixture.sourceHash());
        assert.equal(result.provenance.start, 1); assert.equal(result.provenance.end, 4);
        assert.match(result.content, /const label = 'Review checkout';/);
        content = '화면의 “Review checkout” 버튼 문구는 `src/CheckoutButton.tsx:2`의 label과 같습니다. 이 비교는 화면 관찰과 현재 파일 내용에 근거합니다.';
      }
      assert(stage <= 9, 'The fixture must not request unexpected actions');
      stage++;
      return route.fulfill({contentType: 'text/event-stream', body: sse(name, args, content)});
    } catch (error) {routeFailure = error; return route.fulfill({status: 500, body: 'Synthetic comparison assertion failed'});}
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(token => {
    globalThis.screenProjectDebuggerCalls = 0;
    const attach = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = (...args) => {globalThis.screenProjectDebuggerCalls++; return attach(...args);};
    return chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 191}});
  }, token);
  const visualizer = await context.newPage(); await visualizer.goto(fixture.origin);
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.setViewportSize({width: 1100, height: 850});
  await poll(async () => (await state()).catalog?.models?.length, count => count === 1);
  const connected = await ui.evaluate(origin => chrome.runtime.sendMessage({type: 'PROJECT_CONNECT', origin}), fixture.origin);
  assert.equal(connected.ok, true, connected.error);
  target = await context.newPage(); await target.goto(`${fixture.origin}/checkout`);
  assert.equal(await target.locator('[data-component="CheckoutButton"]').innerText(), 'Review checkout');
  const targetTab = await worker.evaluate(async () => (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0].id);
  const chatTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({targetTab, chatTab}) => chrome.storage.session.set({chatSourceTabs: {[chatTab]: targetTab}}), {targetTab, chatTab});
  await ui.bringToFront();
  assert.equal((await state()).page, null);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('현재 화면의 checkout 버튼과 연결된 프로젝트 소스를 비교하고 파일 위치를 알려줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  const answer = await poll(async () => (await state()).chat.messages.at(-1), value => ['done', 'error'].includes(value?.state));
  assert.equal(answer.state, 'done', answer.error);
  assert.equal((await state()).page.url, `${fixture.origin}/checkout`);
  // After the model's read_page the host reads the opened page's content once
  // on its own (automatic source capture, labelled '출처 본문 확보').
  const readSteps = answer.trace.filter(step => ['read_page', 'source_search', 'read_source'].includes(step.tool));
  assert(readSteps.filter(step => step.label === '출처 본문 확보').length <= 1);
  assert.deepEqual(readSteps.filter(step => step.label !== '출처 본문 확보').map(step => [step.tool, step.status]), [['read_page', 'done'], ['source_search', 'done'], ['read_source', 'done']]);
  check('workflow discovery, selective resource reads and real OpenWiki evidence retrieval precede browser use');
  check('the current application tab is observed automatically and project source tools run in the same chat');
  assert(reviewed); assert(screenEvidence && sourceEvidence);
  assert.match(answer.content, /src\/CheckoutButton\.tsx:2/);
  await ui.getByText('src/CheckoutButton.tsx:2', {exact: true}).waitFor();
  await ui.screenshot({path: resolve('verification/openwiki-screen-source-desktop.png'), fullPage: true});
  check('screen text and current file contents reach the model and reviewer with distinct evidence and a rendered path:line citation');
  const exposed = JSON.stringify({state: await state(), requests, local: await ui.evaluate(() => chrome.storage.local.get(null))});
  for (const secret of [token, ...fixture.secrets]) assert(!exposed.includes(secret));
  assert.equal(await worker.evaluate(() => globalThis.screenProjectDebuggerCalls), 0);
  assert.deepEqual(errors, []);
  check('screen and source reading uses no debugger and exposes no pairing or access credentials');
  await writeFile('verification/openwiki-screen-browser.json', JSON.stringify({version: manifest.version, checks, realChromeExtension: true, realOpenWikiHttpHandler: true, realScreenDom: true, temporarySourceFiles: true, syntheticModelResponses: true, actualModelReasoningEvaluated: false, exactComponentMappingProven: false, fixtureLoopbackHostPregranted: true}, null, 2));
} finally {await context?.close(); await fixture?.close(); await rm(profile, {recursive: true, force: true});}

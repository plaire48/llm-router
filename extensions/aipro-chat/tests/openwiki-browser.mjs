import {wikiAgentCompletion} from './fixtures/openwiki-model.mjs';
import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';
import {startOpenWikiFixture} from './fixtures/openwiki-server.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-openwiki-browser-'));
const extension = resolve(profile, 'extension');
const checks = [], errors = [], modelRequests = [], toolResults = [], fixtures = [];
const credential = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
const projectToolNames = ['ask_openwiki', 'source_search', 'read_source'];
let context, worker, ui, projectTab, project, manifest, mode = 'project', stage = 0, routeFailure;
const check = value => {checks.push(value); console.log(`PASS ${value}`);};
const rpc = (type, values = {}) => ui.evaluate(message => chrome.runtime.sendMessage(message), {type, clientId: 'openwiki-browser', ...values});
const state = async () => {const result = await rpc('GET_STATE'); assert.equal(result.ok, true, result.error); return result.data;};
async function poll(fn, predicate = value => value, label = 'condition') {
  let value;
  for (let i = 0; i < 500; i++) {
    if (routeFailure) throw routeFailure;
    value = await fn(); if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(predicate(value), `Timed out waiting for ${label}`);
}
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const response = (name, args = {}, text = '문서와 현재 소스코드를 확인했습니다.') => frame({choices: [{delta: name ? {tool_calls: [{index: 0, id: `project-${modelRequests.length}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content: text}, finish_reason: name ? 'tool_calls' : 'stop'}]}) + frame({choices: [], usage: {prompt_tokens: 200, completion_tokens: 20, total_tokens: 220}}) + 'data: [DONE]\n\n';

async function send(text, nextMode = mode) {
  const settings = ui.getByRole('dialog', {name: '설정', exact: true});
  if (await settings.isVisible()) await settings.getByRole('button', {name: '닫기', exact: true}).click();
  mode = nextMode; stage = 0;
  const previousReply = (await state()).chat.messages.at(-1)?.id;
  await ui.bringToFront();
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text);
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1), value => value?.id !== previousReply && ['done', 'error'].includes(value?.state), 'completed project chat');
  await poll(async () => !(await state()).busy);
  await ui.getByRole('button', {name: '전송', exact: true}).waitFor();
  return (await state()).chat.messages.at(-1);
}

async function bindSourceTab(tab) {
  await tab.bringToFront();
  const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0].id);
  const chatTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({sourceTab, chatTab}) => chrome.storage.session.set({chatSourceTabs: {[chatTab]: sourceTab}}), {sourceTab, chatTab});
  await ui.bringToFront();
  return sourceTab;
}

async function openProjectDialog() {
  if (!await ui.getByRole('button', {name: '프로젝트 연결', exact: true}).isVisible()) {
    await ui.getByRole('button', {name: '설정', exact: true}).click();
    await ui.locator('.wiki-folder-settings > summary').click();
    await ui.locator('.wiki-server-settings > summary').click();
  }
  await ui.getByRole('button', {name: '프로젝트 연결', exact: true}).click();
  const dialog = ui.getByRole('dialog', {name: '프로젝트 연결', exact: true});
  await dialog.waitFor();
  await poll(() => dialog.getByText('열린 프로젝트 확인 중', {exact: true}).count(), count => count === 0);
  return dialog;
}

async function assertNoSecrets() {
  const exposed = JSON.stringify({state: await state(), local: await ui.evaluate(() => chrome.storage.local.get(null)), requests: modelRequests});
  for (const secret of [credential, ...fixtures.flatMap(item => item.secrets)]) {
    assert(!exposed.includes(secret), 'Credentials and pairing codes must not reach model requests, GET_STATE, traces or local storage');
  }
}

try {
  await mkdir('verification', {recursive: true});
  project = await startOpenWikiFixture(); fixtures.push(project);
  const wikiOnly = await startOpenWikiFixture({source: false}); fixtures.push(wikiOnly);
  const oldServer = await startOpenWikiFixture({legacy: true}); fixtures.push(oldServer);
  const noPairing = await startOpenWikiFixture({pairing: false}); fixtures.push(noPairing);
  await cp(resolve('dist'), extension, {recursive: true});
  manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Chrome match patterns grant the loopback host, not an individual port.
  // Only the test copy is pregranted; worker connection validation still pins
  // every request to the exact origin chosen through the production UI.
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', context_length: 524288}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', async route => {
    try {
      assert.equal(route.request().headers().authorization, `Bearer ${credential}`);
      const body = route.request().postDataJSON();
      const wikiReply=wikiAgentCompletion(body); if(wikiReply)return route.fulfill({json:wikiReply});
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning}); modelRequests.push(body);
      const review = goalReviewPayload(body.messages);
      if (review) {
        if (mode === 'offline') return route.fulfill({json: {choices: [{message: {content: JSON.stringify({status: 'blocked', checks: [{requirement: '프로젝트 읽기', status: 'unknown', evidence_ids: []}], next_step: 'OpenWiki를 실행한 뒤 다시 시도해 주세요.'})}, finish_reason: 'stop'}]}});
        return route.fulfill({json: reviewCompletion(review)});
      }
      const names = body.tools?.map(tool => tool.function.name) || [];
      const lastTool = body.messages.findLast(message => message.role === 'tool');
      const result = lastTool ? JSON.parse(lastTool.content) : null;
      if (result && !result.tools) toolResults.push({mode, stage, result});
      if (mode === 'disconnected') {
        assert(!body.tools.some(t=>['source_search','read_source'].includes(t.function.name) || t.function.name==='ask_openwiki' && t.function.parameters.properties.wiki.enum.includes('external')));
        return route.fulfill({contentType: 'text/event-stream', body: response(null, {}, '프로젝트를 연결해 주세요.')});
      }
      const wanted = mode === 'project' ? ['ask_openwiki', 'source_search', 'read_source'][stage] : mode === 'wiki-only' ? ['ask_openwiki'][stage] : stage === 0 ? 'read_source' : null;
      if (wanted && !names.includes(wanted)) {
        const selector = body.tools?.find(tool => tool.function.name === 'select_tools');
        // ask_openwiki is in the knowledge group; source tools are in project.
        // Choose the advertised group that actually lists the wanted tool.
        const overview = JSON.parse(/Available groups: (\{.*\})\. No software/.exec(selector?.function.description || '')?.[1] || '{}');
        const group = selector?.function.parameters.properties.groups.items.enum.find(value => overview[value]?.tools.includes(wanted));
        assert(group, `Project tool ${wanted} must be reachable without a browser page`);
        return route.fulfill({contentType: 'text/event-stream', body: response('select_tools', {groups: [group]})});
      }
      if (mode === 'wiki-only') assert(!names.some(name => ['source_search', 'read_source'].includes(name)));
      if (result?.error && mode !== 'offline') throw new Error(`Unexpected project tool failure: ${result.error}`);
      let args = {};
      if (wanted === 'ask_openwiki') args = {wiki:'external',question:'How does checkout work?'};
      if (wanted === 'source_search') {
        const wiki=toolResults.findLast(item=>item.mode===mode && item.result.engine==='openwiki-deepagents')?.result;
        assert(wiki); assert(wiki.evidence.some(e=>e.excerpt.includes('CheckoutButton')));
        args = {query: 'CheckoutButton', limit: 5};
      }
      if (wanted === 'read_source') {
        if (mode === 'project') assert(result.results.some(item => item.path === 'src/CheckoutButton.tsx'));
        args = {path: 'src/CheckoutButton.tsx', start: 1, end: 12};
      }
      if (!wanted) {
        if (mode === 'offline') assert(result?.error, 'Offline server must produce a recoverable tool error');
        else if (mode === 'wiki-only') {assert.equal(result.engine,'openwiki-deepagents'); assert(result.evidence.some(e=>e.excerpt.includes('CheckoutButton')));}
        else {
          assert.equal(result.path, 'src/CheckoutButton.tsx');
          assert.equal(result.provenance.kind, 'source');
          assert.equal(result.provenance.start, 1);
          assert.match(result.provenance.hash, /^[a-f\d]{64}$/i);
          assert.match(result.content, mode === 'fresh' ? /Updated checkout/ : /Review checkout/);
        }
      }
      stage++;
      return route.fulfill({contentType: 'text/event-stream', body: response(wanted, args, mode === 'offline' ? 'OpenWiki를 실행한 뒤 다시 시도해 주세요.' : '문서와 현재 소스코드를 확인했습니다.')});
    } catch (error) {
      routeFailure = error;
      return route.fulfill({status: 500, body: 'Synthetic model assertion failed'});
    }
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(token => {
    globalThis.projectDebuggerCalls = 0;
    const attach = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = (...args) => {globalThis.projectDebuggerCalls++; return attach(...args);};
    return chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 190}});
  }, credential);
  projectTab = await context.newPage(); await projectTab.goto(project.origin);
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.setViewportSize({width: 360, height: 800});
  await poll(async () => (await state()).catalog?.models?.length, count => count === 1);
  await bindSourceTab(projectTab);
  assert.equal((await state()).project, null);
  assert.equal((await state()).page, null);
  let dialog = await openProjectDialog();
  await assertModalTypography(dialog);
  await ui.evaluate(() => {
    window.projectPermissionRequest = chrome.permissions.request.bind(chrome.permissions);
    window.projectPermissionCalls = [];
    chrome.permissions.request = async value => {window.projectPermissionCalls.push(value); return false;};
  });
  await dialog.getByRole('button', {name: '프로젝트 연결', exact: true}).click();
  await dialog.getByText('OpenWiki 사이트 접근을 허용해 주세요.', {exact: true}).waitFor();
  assert.equal((await state()).project, null);
  assert.equal(project.pairCount, 0);
  assert.equal(modelRequests.length, 0);
  assert.deepEqual(await ui.evaluate(() => window.projectPermissionCalls), [{origins: [`${project.origin}/*`]}]);
  check('project connection requests only the chosen origin and permission denial performs no pairing or model request');
  await ui.evaluate(() => {chrome.permissions.request = window.projectPermissionRequest;});
  await dialog.getByRole('button', {name: '프로젝트 연결', exact: true}).click();
  await poll(async () => (await state()).project?.status, status => status === 'connected');
  await dialog.waitFor({state: 'hidden'});
  assert.deepEqual((await state()).project.capabilities, ['wiki', 'source']);
  assert.equal(project.pairCount, 1);
  assert.equal((await state()).page, null);
  await projectTab.close();
  await ui.screenshot({path: resolve('verification/openwiki-connected-panel.png'), fullPage: true});
  check('production connection UI pairs with the real OpenWiki HTTP handler without connecting a page or using debugger');

  const answer = await send('checkout 동작을 문서와 소스코드에서 찾아서 설명해 줘.', 'project');
  assert.equal(answer.state, 'done');
  assert(projectToolNames.every(name => answer.trace.some(step => step.tool === name && step.status === 'done')));
  assert.equal((await state()).page, null);
  const firstSource = toolResults.findLast(item => item.mode === 'project' && item.result.path === 'src/CheckoutButton.tsx').result;
  assert.equal(firstSource.provenance.hash, await project.sourceHash());
  await assertNoSecrets();
  check('natural-language chat selects Wiki and source tools, receives fresh path/line/hash evidence and finishes without an open website');
  await ui.reload();
  await poll(async () => (await state()).project?.status, value => value === 'connected');
  assert.equal((await state()).chat.messages.at(-1).content, answer.content);
  await project.updateSource();
  assert.equal((await send('src/CheckoutButton.tsx 최신 코드를 다시 확인해 줘.', 'fresh')).state, 'done');
  const freshSource = toolResults.findLast(item => item.mode === 'fresh' && item.result.path === 'src/CheckoutButton.tsx').result;
  assert.notEqual(freshSource.provenance.hash, firstSource.provenance.hash);
  assert.equal(freshSource.provenance.hash, await project.sourceHash());
  check('project session and chat restore after reload while a changed source file is read again with a new matching hash');
  await ui.setViewportSize({width: 1100, height: 850});
  dialog = await openProjectDialog(); await assertModalTypography(dialog);
  const disconnectButton = dialog.getByRole('button', {name: '프로젝트 연결 해제', exact: true});
  assert.equal(await disconnectButton.getAttribute('data-icon-only'), 'true');
  assert.equal(await disconnectButton.locator('.visually-hidden').count(), 1);
  await ui.screenshot({path: resolve('verification/openwiki-project-desktop.png'), fullPage: true});
  await dialog.getByRole('button', {name: '프로젝트 연결 해제', exact: true}).click();
  await poll(async () => (await state()).project, value => value === null);
  await dialog.waitFor({state: 'hidden'});
  const beforeDisconnected = project.readCount;
  // Inspect the next authorized model request at the worker boundary. An
  // unrelated browser-host grant is not needed to prove capability revocation.
  const disconnected = await rpc('START_CHAT', {text: '연결 없이 코드를 확인할 수 있니?'});
  assert.equal(disconnected.ok, true, disconnected.error);
  assert(!disconnected.data.tools.some(t=>['source_search','read_source'].includes(t.function.name) || t.function.name==='ask_openwiki' && t.function.parameters.properties.wiki.enum.includes('external')));
  const staleRead = await rpc('RUN_TOOL', {requestId: disconnected.data.requestId, name: 'read_source', args: {path: 'src/CheckoutButton.tsx'}});
  assert.equal(staleRead.ok, false);
  assert.equal(staleRead.error, 'tools_unavailable');
  assert.equal((await rpc('FINISH_CHAT', {requestId: disconnected.data.requestId, content: '프로젝트를 연결해 주세요.', status: 200})).ok, true);
  assert.equal(project.readCount, beforeDisconnected);
  check('icon-only disconnect removes project tools from the next request catalog, rejects stale tool calls and sends no further project reads');

  for (const [fixture, label] of [[oldServer, 'old-server'], [noPairing, 'missing-pairing-proof']]) {
    const tab = await context.newPage(); await tab.goto(fixture.origin); const tabId = await bindSourceTab(tab);
    const result = await rpc('PROJECT_CONNECT', {origin: fixture.origin, tabId});
    assert.equal(result.ok, false, label);
    assert.equal((await state()).project, null);
    assert.equal(fixture.pairCount, 0);
    await tab.close();
  }
  assert.equal((await rpc('PROJECT_CONNECT', {origin: 'https://unapproved.example.test'})).ok, false);
  check('old servers, pages without pairing proof and non-loopback addresses fail closed without creating a project session');

  projectTab = await context.newPage(); await projectTab.goto(wikiOnly.origin); const wikiTabId = await bindSourceTab(projectTab);
  assert.equal((await rpc('PROJECT_CONNECT', {origin: wikiOnly.origin, tabId: wikiTabId})).ok, true);
  await projectTab.close();
  assert.deepEqual((await state()).project.capabilities, ['wiki']);
  assert.equal((await send('checkout 문서 내용을 확인해 줘.', 'wiki-only')).state, 'done');
  assert.equal(wikiOnly.sourceReadCount, 0);
  await rpc('PROJECT_DISCONNECT');
  check('Wiki-only servers support document chat without advertising or requesting source access');

  projectTab = await context.newPage(); await projectTab.goto(project.origin); const sourceTabId = await bindSourceTab(projectTab);
  assert.equal((await rpc('PROJECT_CONNECT', {origin: project.origin, tabId: sourceTabId})).ok, true);
  await projectTab.close();
  for (const [httpStatus, code, connectionStatus] of [[403,'project_scope','connected'],[401,'project_expired','expired']]) {
    project.setReadFailure(httpStatus);
    const request=await rpc('START_CHAT',{text:'외부 위키의 연결 상태 확인'});
    assert.equal(request.ok,true,request.error);
    const before=project.readCount;
    const read=await rpc('RUN_TOOL',{requestId:request.data.requestId,name:'ask_openwiki',args:{wiki:'external',question:'근거를 읽어줘'}});
    assert.equal(read.data?.error,code);
    assert.equal((await state()).project.status,connectionStatus);
    assert.equal(project.readCount,before+1);
    if(httpStatus===401) {
      const again=await rpc('RUN_TOOL',{requestId:request.data.requestId,name:'ask_openwiki',args:{wiki:'external',question:'다시 읽어줘'}});
      assert.equal(again.data?.error,code);assert.equal(project.readCount,before+1);
    }
    assert.equal((await rpc('FINISH_CHAT',{requestId:request.data.requestId,content:'연결을 확인해 주세요.',status:200})).ok,true);
  }
  await ui.reload();
  assert.equal((await state()).project.status,'expired');
  const expired=await rpc('START_CHAT',{text:'만료한 위키를 쓸 수 있니?'});
  assert.equal(expired.ok,true,expired.error);
  assert(!expired.data.tools.some(t=>['read_source','source_search'].includes(t.function.name) || t.function.name==='ask_openwiki' && t.function.parameters.properties.wiki.enum.includes('external')));
  await rpc('FINISH_CHAT',{requestId:expired.data.requestId,content:'프로젝트를 다시 연결해 주세요.',status:200});
  project.setReadFailure(null);
  assert.equal((await rpc('PROJECT_CONNECT',{origin:project.origin})).ok,true);
  assert.equal((await state()).project.status,'connected');
  check('HTML 403 preserves the connection; HTML 401 revokes Wiki authority across reload, blocks repeated reads and permits explicit reconnection');
  await project.stop();
  const stopped = await send('src/CheckoutButton.tsx를 확인해 줘.', 'offline');
  assert(toolResults.some(item => item.mode === 'offline' && item.result.error));
  assert(['done', 'error'].includes(stopped.state));
  assert.equal((await state()).page, null);
  assert.equal(await worker.evaluate(() => globalThis.projectDebuggerCalls), 0);
  await assertNoSecrets();
  assert.deepEqual(errors, []);
  check('server shutdown ends the read with a recoverable result, retains chat and never falls back to debugger or a browser page');
  await writeFile('verification/openwiki-browser.json', JSON.stringify({version: manifest.version, checks, realChromeExtension: true, realOpenWikiHttpHandler: true, temporaryProjectFiles: true, syntheticModelResponses: true, fixtureLoopbackHostPregranted: true, nativePermissionDialogVerified: false, actualCompanyModelVerified: false}, null, 2));
} catch (error) {
  console.error({mode, stage, errors, lastMessageState: await state().then(value => value.chat.messages.at(-1)?.state).catch(() => null)});
  throw error;
} finally {
  await context?.close();
  await Promise.all(fixtures.map(fixture => fixture.close()));
  await rm(profile, {recursive: true, force: true});
}

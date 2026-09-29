import {wikiAgentCompletion} from './fixtures/openwiki-model.mjs';
import {planCompletion,fixturePlan} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';
import {handbook, initialBody, revisedBody, draftPage, seedWikiDirectory, rewriteWikiDirectory} from './fixtures/wiki-folder.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-wiki-folder-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], requests = [], wikiReads = [], network = [];
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
let context, ui, worker, target, manifest, routeFailure, mode = 'read', stage = 0, chosenText, reviewPhases=[];
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const rpc = (type, values = {}) => ui.evaluate(message => chrome.runtime.sendMessage(message), {type, clientId: 'wiki-folder-browser', ...values});
const state = async () => {const value = await rpc('GET_STATE'); assert.equal(value.ok, true, value.error); return value.data;};
async function poll(fn, predicate = value => value, label = 'condition') {
  for (let i = 0; i < 750; i++) {if (routeFailure) throw routeFailure; const value = await fn(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 40));}
  throw new Error(`Timed out waiting for ${label}`);
}
const ref = (value, name) => {const found = (value.observation || value).frames.flatMap(frame => frame.elements || []).find(element => element.name === name); assert(found, name); return found.ref;};
function denyBroadSiteGrant() {
  const request = chrome.permissions.request.bind(chrome.permissions);
  chrome.permissions.request = async options => options.origins?.some(origin => ['http://*/*', 'https://*/*'].includes(origin)) ? false : request(options);
}
const reply = (name, args = {}) => ({choices: [{message: name ? {content: '', tool_calls: [{id: `wiki-${requests.length}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content: mode === 'write' ? '교육 문서대로 제목과 본문을 입력하고 초안 저장을 확인했습니다.' : '교육 안내 문서를 확인했습니다.'}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 220, completion_tokens: 22, total_tokens: 242}});
async function settings() {
  await ui.getByRole('button', {name: '설정', exact: true}).click();
  const dialog = ui.getByRole('dialog', {name: '설정', exact: true});
  await dialog.getByText('OpenWiki 폴더', {exact: true}).click();
  return dialog;
}
async function send(text, nextMode) {
  mode = nextMode; stage = 0; reviewPhases=[];
  const previous = (await state()).chat.messages.at(-1)?.id;
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text);
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  const answer = await poll(async () => (await state()).chat.messages.at(-1), value => value?.id !== previous && ['done', 'error'].includes(value?.state), 'wiki chat result');
  assert.equal(answer.state, 'done', answer.error);
  assert((await state()).chat.task.plan.every(step=>step.status==='completed'));
  // A lookup is judged by the final review only; a request that writes keeps its stage review.
  assert.deepEqual(reviewPhases,mode==='write'?['plan_step','final']:['final']);
  assert.match(answer.content,mode==='write'?/초안 저장을 확인/:/교육 안내 문서를 확인/);
  await ui.getByRole('button', {name: '전송', exact: true}).waitFor();
  return answer;
}

try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://draft.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  const backgroundPath = resolve(extension, 'background.js');
  await writeFile(backgroundPath, (await readFile(backgroundPath, 'utf8')) + '\nglobalThis.wikiFixtureLoadFolder = loadWikiFolder;\n');
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  context.on('request', request => {if (/^https?:/.test(request.url())) network.push(request.url());});
  await context.route('https://draft.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: draftPage}));
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', context_length: 524288}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', async route => {
    try {
      assert.equal(route.request().headers().authorization, `Bearer ${token}`);
      const body = route.request().postDataJSON();
      const wikiReply=wikiAgentCompletion(body); if(wikiReply)return route.fulfill({json:wikiReply});
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning}); requests.push(body);
      const review = goalReviewPayload(body.messages);
      if (review) {
        reviewPhases.push(review.phase);assert(review.evidence.some(item=>item.tool==='ask_openwiki' && item.usable));
        assert(!review.evidence.some(item => item.tool === 'read_skill'), 'Skill instructions must not establish task completion');
        if (mode === 'write') {
          assert(review.evidence.some(item => item.tool === 'ask_openwiki' && item.usable));
          assert(review.evidence.some(item => item.tool === 'verify_page' && item.usable && item.result.verified));
          const saved = await target.evaluate(() => window.savedDraft);
          assert.equal(saved.title, '팀 교육 안내'); assert.equal(saved.body, revisedBody);
        }
        return route.fulfill({json: reviewCompletion(review)});
      }
      const names = body.tools.map(tool => tool.function.name);
      assert(!names.includes('source_search') && !names.includes('read_source'), 'A Wiki folder must not grant repository source access');
      const result = body.messages.findLast(message => message.role === 'tool');
      const value = result ? JSON.parse(result.content) : null;
      assert(!value?.error, value?.error);
      let name, args = {};
      if (stage === 0) {name = 'read_skill'; args = {skill_id: 'openwiki-page-workflow'};}
      if (stage === 1) {assert.equal(value.dataKind, 'skill_reference'); name = 'read_skill'; args = {skill_id: 'openwiki-page-workflow', path: 'references/verification.md'};}
      if (stage === 2) {assert.match(value.content, /Verify the outcome/); name = 'select_tools'; args = {query:'OpenWiki', ...(mode === 'write' ? {groups:['input']} : {})};}
      if (stage === 3) {name = 'ask_openwiki'; args = {wiki:'external',question:'교육 안내의 제목과 본문을 확인해줘'};}
      if (stage === 4) {
        assert.equal(value.engine,'openwiki-deepagents'); assert.equal(value.status,'complete');
        const entry=value.evidence.find(e=>e.path==='training.md'); assert(entry);
        assert.equal(entry.kind,'folder');
        assert.equal(entry.hash,createHash('sha256').update(handbook(mode === 'read' ? initialBody : revisedBody)).digest('hex'));
        assert.match(entry.excerpt, mode === 'read' ? /금요일 오후 2시/ : /목요일 오후 3시/);
        wikiReads.push({provenance:entry}); chosenText=entry.excerpt;
        if(mode==='write')name='read_page';
        else {name='update_plan';args={steps:fixturePlan.map(step=>({...step,status:'completed'}))};}
      }
      if (stage === 5 && mode !== 'write')assert(value.ok && value.plan.every(step=>step.status==='completed'));
      if (stage === 5 && mode === 'write') {
        name = 'fill_form'; args = {fields: [
          {field_id: ref(value, '제목'), value: /^제목: (.+)$/m.exec(chosenText)[1]},
          {field_id: ref(value, '본문'), value: /^본문: (.+)$/m.exec(chosenText)[1]},
        ]};
      }
      if (stage === 6) {
        assert.equal(value.verified, true);
        name = 'verify_page'; args = {checks: [
          {kind: 'field_value', ref: ref(value, '제목'), expected: '팀 교육 안내'},
          {kind: 'field_value', ref: ref(value, '본문'), expected: revisedBody},
          {kind: 'text_present', expected: '초안 저장됨'},
        ]};
      }
      if (stage === 7) {assert.equal(mode, 'write'); assert.equal(value.verified, true);name='update_plan';args={steps:fixturePlan.map(step=>({...step,status:'completed'}))};}
      if(stage===8){assert.equal(mode,'write');assert(value.ok && value.plan.every(step=>step.status==='completed'));}
      assert(stage <= (mode === 'write' ? 8 : 5));
      stage++; return route.fulfill({json: reply(name, args)});
    } catch (error) {routeFailure = error; return route.fulfill({status: 500, body: 'Synthetic wiki fixture assertion failed'});}
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async token => {
    globalThis.wikiDebuggerAttaches = 0;
    const original = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = (...args) => {globalThis.wikiDebuggerAttaches++; return original(...args);};
    // This case verifies the original form; owned windows have separate coverage.
    await chrome.storage.local.set({browserWorkMode: 'current'});
    return chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 210}});
  }, token);
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  // Native browser permission prompts are not automated by this fixture. Keep
  // a denied broad grant while the application fixture host is pregranted.
  await ui.addInitScript(denyBroadSiteGrant);
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`); await ui.setViewportSize({width: 360, height: 800});
  await poll(async () => (await state()).catalog?.models?.length, value => value === 1);
  const nativeHandle = await ui.evaluate(seedWikiDirectory, handbook(initialBody));
  assert.deepEqual(nativeHandle, {kind: 'directory', constructor: 'FileSystemDirectoryHandle', permission: 'granted'});
  let dialog = await settings();
  await assertModalTypography(dialog);
  await ui.evaluate(() => {window.showDirectoryPicker = async () => {throw new DOMException('Picker access denied', 'NotAllowedError');};});
  await dialog.getByRole('button', {name: 'OpenWiki 폴더 선택', exact: true}).click();
  await poll(() => dialog.getByRole('alert').count(), count => count > 0, 'folder picker error');
  assert.equal((await state()).wikiFolder, null);
  check('a denied picker result leaves no folder connection and displays a recoverable settings error');
  await ui.evaluate(() => {window.showDirectoryPicker = async () => {window.wikiTestPickerCalls++; return window.wikiTestSelectedHandle;};});
  await dialog.getByRole('button', {name: 'OpenWiki 폴더 선택', exact: true}).click();
  await poll(async () => (await state()).wikiFolder?.status, status => status === 'connected');
  const folder = (await state()).wikiFolder;
  assert.equal(folder.kind, 'folder'); assert.deepEqual(folder.capabilities, ['wiki']);
  assert.equal((await state()).project.kind, 'folder');
  const stored = await worker.evaluate(async () => {
    const record = await globalThis.wikiFixtureLoadFolder();
    return {name: record.handle.name, constructor: record.handle.constructor.name, permission: await record.handle.queryPermission({mode: 'read'}), text: await (await (await record.handle.getFileHandle('training.md')).getFile()).text()};
  });
  assert.equal(stored.name, 'openwiki'); assert.equal(stored.constructor, 'FileSystemDirectoryHandle'); assert.equal(stored.permission, 'granted'); assert.equal(stored.text, handbook(initialBody));
  await assertModalTypography(dialog);
  await ui.screenshot({path: resolve('verification/wiki-folder-settings-panel.png'), fullPage: true});
  for (const width of [320, 1100]) {
    await ui.setViewportSize({width, height: 850}); await assertModalTypography(dialog);
    assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await ui.screenshot({path: resolve(`verification/wiki-folder-settings-${width}.png`), fullPage: true});
  }
  await ui.setViewportSize({width: 360, height: 800});
  check('settings stores a real directory handle in IndexedDB and the service worker reads its openwiki child through structured clone');
  await ui.keyboard.press('Escape');
  await send('선택한 폴더의 교육 안내를 찾아 설명해줘.', 'read');
  assert.equal((await state()).page, null);
  assert.equal(await worker.evaluate(() => globalThis.wikiDebuggerAttaches), 0);
  assert(!network.some(url => new URL(url).hostname === 'localhost' || new URL(url).hostname === '127.0.0.1'));
  check('Wiki-only natural-language chat delegates to OpenWiki with the current model without a website, local server or debugger');
  await ui.reload();
  await poll(async () => (await state()).wikiFolder?.status, status => status === 'connected');
  assert.equal((await state()).wikiFolder.id, folder.id);
  await ui.evaluate(rewriteWikiDirectory, handbook(revisedBody));
  await send('교육 안내의 최신 내용을 다시 확인해줘.', 'fresh');
  assert.notEqual(wikiReads[0].provenance.hash, wikiReads[1].provenance.hash);
  check('folder choice survives extension reload and changed Markdown is read again with a fresh matching hash');

  target = await context.newPage(); await target.goto('https://draft.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0].id);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId, uiId}) => chrome.storage.session.set({chatSourceTabs: {[uiId]: tabId}}), {tabId, uiId});
  await ui.bringToFront();
  const written = await send('OpenWiki 폴더의 교육 안내를 찾아 현재 페이지 제목과 본문에 입력해줘. 등록은 하지 마.', 'write');
  assert.equal(await target.getByRole('textbox', {name: '제목', exact: true}).inputValue(), '팀 교육 안내');
  assert.equal(await target.getByRole('textbox', {name: '본문', exact: true}).inputValue(), revisedBody);
  const pageResult = await target.evaluate(() => ({draft: JSON.parse(sessionStorage.getItem('draft')), submits, trustedInputs}));
  assert.deepEqual(pageResult.draft, {title: '팀 교육 안내', body: revisedBody}); assert.equal(pageResult.submits, 0); assert(pageResult.trustedInputs.length > 0 && pageResult.trustedInputs.every(Boolean));
  assert(written.trace.some(step => step.tool === 'ask_openwiki' && step.status === 'done')); assert(written.trace.some(step => step.tool === 'verify_page' && step.status === 'done'));
  assert.equal((await state()).chat.task.verification.status, 'passed');
  await ui.setViewportSize({width: 1100, height: 850}); await ui.screenshot({path: resolve('verification/wiki-folder-page-draft-desktop.png'), fullPage: true});
  check('the same agent loads workflow guidance and reads the selected Wiki, fills a real form with trusted input and verifies retained fields and draft status without submitting');
  assert.equal(await worker.evaluate(async tabId => {try {await chrome.debugger.sendCommand({tabId}, 'Page.getFrameTree'); return true;} catch {return false;}}, tabId), false);

  dialog = await settings();
  await ui.evaluate(() => {window.showDirectoryPicker = async () => {throw new DOMException('Cancelled', 'AbortError');};});
  await dialog.getByRole('button', {name: 'OpenWiki 폴더 변경', exact: true}).click();
  await poll(() => dialog.getByRole('button', {name: 'OpenWiki 폴더 변경', exact: true}).isEnabled());
  assert.equal((await state()).wikiFolder.id, folder.id);
  await dialog.getByRole('button', {name: 'OpenWiki 폴더 연결 해제', exact: true}).click();
  await poll(async () => (await state()).wikiFolder, folder => folder === null);
  assert.equal(await worker.evaluate(() => globalThis.wikiFixtureLoadFolder()), null);
  await ui.keyboard.press('Escape');
  const lease = await rpc('START_CHAT', {text: '연결 해제 상태 확인'}); assert.equal(lease.ok, true, lease.error);
  assert(!lease.data.tools.some(tool => ['wiki_search', 'wiki_read'].includes(tool.function.name)));
  const removedRead = await rpc('RUN_TOOL', {requestId: lease.data.requestId, name: 'wiki_read', args: {id: 'training'}});
  assert.equal(removedRead.error, 'tools_unavailable');
  await rpc('FINISH_CHAT', {requestId: lease.data.requestId, content: '폴더 연결이 해제되었습니다.', status: 200});
  check('cancelled replacement preserves the folder; removal clears IndexedDB and rejects Wiki tool calls in subsequent requests');
  const exposed = JSON.stringify({state: await state(), local: await ui.evaluate(() => chrome.storage.local.get(null)), requests});
  assert(!exposed.includes(token)); assert(!exposed.includes('private-outside-wiki-marker')); assert(!exposed.includes('FileSystemDirectoryHandle'));
  assert(!network.some(url => /\/api\/nubi\//.test(url)));
  assert.deepEqual(errors, []);
  await writeFile('verification/wiki-folder-browser.json', JSON.stringify({version: manifest.version, checks, settingsWidths: [320, 360, 1100], realChromeExtension: true, realDirectoryHandles: true, indexedDbStructuredCloneAndWorkerReads: true, directoryHandleFixture: 'Origin private file system', nativeOsDirectoryPickerVerified: false, pickerErrorPathsSimulated: true, broadSitePermissionDeniedByFixture: true, fixturePageOriginPregranted: true, nativeSitePermissionDialogVerified: false, syntheticModelResponses: true, actualCompanyModelVerified: false, realBrowserForm: true, serverRequired: false}, null, 2));
} catch (error) {console.error({mode, stage, errors, reason: routeFailure?.message}); throw error;}
finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

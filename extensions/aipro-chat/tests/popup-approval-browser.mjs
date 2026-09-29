import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-popup-approval-')), extension = resolve(profile, 'extension');
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
let context, worker, ui, stage = 0, routeFailure, mode = 'popup';
const checks = [], errors = [], submitted = [];
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const ref = (result, name) => {const field = (result.observation || result).frames.flatMap(f => f.elements || []).find(e => e.name === name); assert(field, name); return field.ref;};
async function poll(fn, want) {
  let value;
  for (let i = 0; i < 1200; i++) {if (routeFailure) throw routeFailure; value = await fn(); if (value === want) return; await new Promise(r => setTimeout(r, 40));}
  assert.equal(value, want);
}
async function send(text) {await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text); await ui.getByRole('button', {name: '전송', exact: true}).click();}
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*/*', 'http://*/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000); context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://portal.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<title>업무 포털</title>
    <button onclick="window.opens++;const w=window.open('','compose','popup,width=600,height=600');setTimeout(()=>w.location='https://draft.example.test/popup',1200)">새 창 작성</button>
    <a href="https://draft.example.test/noopener" target="_blank" rel="noopener" onclick="window.opens++">새 탭 작성</a>
    <output id="result">대기</output><script>window.opens=0;addEventListener('message',e=>{if(e.origin==='https://draft.example.test')document.querySelector('output').textContent=e.data});</script>`}));
  await context.route('https://draft.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<title>업무 초안</title>
    <label>제목<input></label><label>본문<textarea></textarea></label><button id="publish">등록</button>
    <script>document.querySelector('button').onclick=async e=>{await window.recordSubmission({trusted:e.isTrusted,title:document.querySelector('input').value,body:document.querySelector('textarea').value});window.close()};</script>`}));
  await context.route('https://unrelated.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>Unrelated</title><label>본문<textarea>Do not change</textarea></label><button>등록</button>'}));
  let portal;
  await context.exposeBinding('recordSubmission', async ({page}, value) => {submitted.push({...value, url: page.url()}); await portal.locator('output').evaluate(el => {el.textContent = '등록 완료';});});
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {
    try {
      if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', context_length: 524288}]}});
      const body = route.request().postDataJSON(), review = goalReviewPayload(body.messages);
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
      if (review) return route.fulfill({json: reviewCompletion(review)});
      const last = body.messages.findLast(m => m.role === 'tool');
      const resumed = body.messages.findLast(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('Fresh browser observation for this continuation.'));
      const result = last ? JSON.parse(last.content) : resumed ? JSON.parse(resumed.content.slice(resumed.content.indexOf('\n') + 1)) : null;
      if (result?.yielded && mode !== 'closed-between') {
        assert.equal(result.completed, false);
        assert.equal(result.observation.title, '업무 초안');
        const draft = context.pages().find(page => page.url().startsWith('https://draft.example.test/'));
        assert.equal(await draft.getByLabel('본문').inputValue(), '');
        assert.deepEqual(result.execution.commands.map(command => command.method), ['click']);
        const code = 'await page.getByLabel("제목").fill("팀 업무 안내"); await page.getByLabel("본문").fill("금요일까지 제출해주세요.");';
        check('the model receives the new window before composing and continues without repeating the opening click');
        return route.fulfill({json: {choices: [{message: {content: '작성 화면을 확인했습니다. 초안을 입력하겠습니다.', tool_calls: [{id: `continue-${stage}`, type: 'function', function: {name: 'run_playwright', arguments: JSON.stringify({code})}}]}, finish_reason: 'tool_calls'}]}});
      }
      const current = stage++; let name, args = {};
      if (mode === 'closed-between') {
        if (current === 0) name = 'browser_snapshot';
        if (current === 1) {name = 'run_playwright'; args = {code: 'await page.getByRole("button",{name:"새 창 작성",exact:true}).click(); await page.getByLabel("본문").fill("확인용 초안");'};}
        if (current === 2) {
          assert.equal(result.ok, true, JSON.stringify(result));
          await context.pages().find(page => page.url() === 'https://draft.example.test/popup').close();
          await poll(async () => !!(await worker.evaluate(() => chrome.storage.session.get('page'))).page, false);
          name = 'browser_snapshot';
        }
        if (current === 3) {assert.equal(result.title, '업무 포털', JSON.stringify(result)); name = 'verify_page'; args = {checks: [{kind: 'text_present', expected: '새 창 작성'}]};}
        if (current === 4) assert.equal(result.verified, true);
        assert(current <= 4);
        return route.fulfill({json: {choices: [{message: name ? {content: '', tool_calls: [{id: `step-${stage}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content: '원래 페이지로 돌아왔습니다.'}, finish_reason: name ? 'tool_calls' : 'stop'}]}});
      }
      if (current === 0) name = 'browser_snapshot';
      if (current === 1) {assert.equal(result.title, '업무 포털'); name = 'run_playwright'; args = {code: mode === 'popup'
        ? 'await page.getByRole("button",{name:"새 창 작성",exact:true}).click(); await page.getByLabel("제목").fill("팀 업무 안내"); await page.getByLabel("본문").fill("금요일까지 제출해주세요.");'
        : 'await page.getByRole("link",{name:"새 탭 작성",exact:true}).click(); await page.getByLabel("제목").fill("팀 업무 안내"); await page.getByLabel("본문").fill("금요일까지 제출해주세요.");'};}
      if (current === 2) {assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.observation.title, '업무 초안'); name = 'verify_page'; args = {checks: [{kind: 'field_contains', ref: ref(result, '본문'), expected: '금요일까지'}]};}
      if (current === 3) {assert.equal(result.verified, true); name = 'request_approval'; args = {ref: ref(result, '등록')};}
      if (current === 4) {assert.equal(result.title, '업무 초안', JSON.stringify(result)); name = 'run_playwright'; args = {code: 'await page.getByLabel("본문").fill("목요일까지 제출해주세요.");'};}
      if (current === 5) {assert.equal(result.ok, true, JSON.stringify(result)); name = 'verify_page'; args = {checks: [{kind: 'field_contains', ref: ref(result, '본문'), expected: '목요일까지'}]};}
      if (current === 6) {assert.equal(result.verified, true); name = 'request_approval'; args = {ref: ref(result, '등록')};}
      if (current === 7) {assert.equal(result.title, '업무 포털', JSON.stringify(result)); name = 'verify_page'; args = {checks: [{kind: 'text_present', expected: '등록 완료'}]};}
      if (current === 8) assert.equal(result.verified, true);
      // The first plan stage passed its review. The reporting stage answers once
      // more without another action; the approved click is never repeated.
      if (current === 9) {assert.match(body.messages.at(-1).content, /Later stages remain unfinished/); assert.equal(submitted.length, mode === 'popup' ? 1 : 2);}
      assert(current <= 9, `Unexpected round ${current}`);
      return route.fulfill({json: {choices: [{message: name ? {content: '', tool_calls: [{id: `step-${stage}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content: '등록 결과를 확인했습니다.'}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}}});
    } catch (error) {routeFailure = error; return route.fulfill({status: 500, body: 'Synthetic assertion failed'});}
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  portal = await context.newPage(); await portal.goto('https://portal.example.test/');
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 1}}), token);
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url === 'https://portal.example.test/').id);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId, uiId}) => chrome.storage.session.set({chatSourceTabs: {[uiId]: tabId}}), {tabId, uiId});
  await poll(async () => !!(await state()).catalog?.models?.length, true);
  for (const scenario of ['popup', 'noopener']) {
    mode = scenario; stage = 0; await portal.bringToFront();
    // Exercise both automatic page connection and an explicitly selected skill.
    if (mode === 'noopener') await ui.evaluate(async () => chrome.runtime.sendMessage({type: 'SELECT_SKILL', id: 'browser-agent'}));
    await send('새 창에서 팀 업무 안내를 작성해줘.');
    await poll(async () => (await state()).chat.task?.status, 'awaiting_user');
    const draft = context.pages().find(page => page.url() === `https://draft.example.test/${mode}`); assert(draft);
    const popupId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, draft.url());
    if (mode === 'popup') assert.equal(await worker.evaluate(async id => (await chrome.windows.get((await chrome.tabs.get(id)).windowId)).type, popupId), 'popup');
    else assert.equal(await draft.evaluate(() => window.opener), null);
    assert.equal(submitted.length, mode === 'popup' ? 0 : 1);
    const sessionId = (await state()).chat.sessionId;
    const contextSaved = await worker.evaluate(async id => (await chrome.storage.session.get('browserContexts')).browserContexts[id].context, sessionId);
    assert.equal(contextSaved.tabId, popupId); assert(contextSaved.openers.some(([child, parent]) => child === popupId && parent === tabId));
    check(`${mode}: draft and parent identity remain after final-action approval pauses the browser connection`);
    await ui.reload();
    const unrelated = await context.newPage(); await unrelated.goto('https://unrelated.example.test/');
    // Replace the global connected page deliberately. Continuation must be scoped
    // to this conversation's approval, never the last selected page/window.
    await ui.evaluate(async () => chrome.runtime.sendMessage({type: 'CONNECT_PAGE'}));
    const card = ui.locator('.action-approval[data-answered=false]');
    await card.locator('.approval-preview summary').click();
    await card.getByRole('button', {name: '본문 편집', exact: true}).click();
    const editor = card.getByRole('group', {name: '초안 편집'}); await editor.waitFor();
    await editor.getByLabel('본문', {exact: true}).fill('목요일까지 제출해주세요.');
    await card.getByRole('button', {name: '수정 반영', exact: true}).click();
    await poll(async () => (await state()).chat.messages.at(-1)?.question?.preview?.some(f => f.value === '목요일까지 제출해주세요.'), true);
    assert.equal(await draft.getByLabel('본문').inputValue(), '목요일까지 제출해주세요.');
    assert.equal(await unrelated.getByLabel('본문').inputValue(), 'Do not change');
    assert.equal(await portal.evaluate(() => window.opens), mode === 'popup' ? 1 : 2);
    check(`${mode}: after chat reload and a different active page, inline editing changes only the original draft without reopening it`);
    await ui.reload(); await unrelated.bringToFront();
    await ui.getByRole('button', {name: '등록', exact: true}).click();
    await poll(async () => (await state()).chat.task?.status, 'done');
    assert(draft.isClosed()); assert.equal(submitted.length, mode === 'popup' ? 1 : 2);
    assert.equal(submitted.at(-1).body, '목요일까지 제출해주세요.'); assert.equal(submitted.at(-1).trusted, true);
    assert.equal((await state()).chat.task.verification.status, 'passed');
    assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get('page')).page.tabId), tabId);
    assert.equal(await unrelated.getByLabel('본문').inputValue(), 'Do not change'); await unrelated.close();
    check(`${mode}: approval clicks once, follows the closed child back to its known parent and verifies the result`);
  }
  mode = 'closed-between'; stage = 0; await portal.bringToFront();
  await send('새 창을 확인하고 닫히면 원래 페이지로 돌아와줘.');
  await poll(async () => (await state()).chat.task?.status, 'done');
  assert.equal(submitted.length, 2);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get('page')).page.tabId), tabId);
  check('a child closed between model tool calls reconnects to its known parent and continues without page_changed');
  assert.deepEqual(errors, []);
  await writeFile('verification/popup-approval-browser.json', JSON.stringify({checks, errors, syntheticModelResponses: true, realBrowserActions: true, actualCompanyPageVerified: false}, null, 2));
} catch (error) {console.error({stage, mode, routeFailure: routeFailure?.message, chat: await state().then(s => s.chat).catch(() => null)}); throw error;}
finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

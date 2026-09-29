import {clickComposerAction} from './helpers/composer-actions.mjs';
import {completionIntentResponse} from './fixtures/completion-intent.mjs';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, readFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-browser-agent-')), extension = resolve(profile, 'extension');
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
const checks = [], errors = [], requests = [];
let context, ui, portal, stage = 0, mode = 'mail', routeFailure, expectedPagePath = '/portal';
const check = message => {checks.push(message); console.log(`PASS ${message}`);};
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
async function poll(fn, expected) {let value; for (let i = 0; i < 1200; i++) {if (routeFailure) throw routeFailure; value = await fn(); if (value === expected) return; await new Promise(r => setTimeout(r, 50));} assert.equal(value, expected);}
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
function response(name, args) {
  const delta = name ? {tool_calls: [{index: 0, id: `call-${requests.length}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content: '요청한 작업을 확인했습니다.'};
  return frame({choices: [{delta, finish_reason: name ? 'tool_calls' : 'stop'}]}) + frame({choices: [], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}}) + 'data: [DONE]\n\n';
}
function elements(value) {return (value.observation || value).frames?.flatMap(frame => frame.elements || []) || [];}
function ref(value, name) {const item = elements(value).find(element => element.name === name); assert(item, `Missing observed control: ${name} in ${JSON.stringify(value)}`); return item.ref;}
async function send(text) {await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text); await ui.getByRole('button', {name: '전송', exact: true}).click();}
try {
  await mkdir('verification', {recursive: true});
  // Grant fixture origins in this integration-test copy. Production's native
  // optional-permission prompt is covered separately, not by this test.
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  const workerFile = resolve(extension, 'background.js');
  await writeFile(workerFile, (await readFile(workerFile, 'utf8')) + '\nglobalThis.testOnDebuggerDetached = onDebuggerDetached;\n');
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://first.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<title>업무 홈페이지</title><h1>업무 홈페이지</h1><a target="_blank" href="https://mail.example.test/inbox">메일</a><button aria-label="메뉴" onmouseover="document.querySelector('output').textContent='메뉴 열림'">메뉴</button><output></output><div style="height:2000px"></div><p>페이지 끝</p>`}));
  await context.route('https://mail.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<title>업무 메일</title><h1>받은 메일</h1><button onclick="openCompose(event)">메일 쓰기</button><main></main><script>
    window.clickTrusted=false;window.sent=0;window.bodySaved='';
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=50;canvas.style='position:fixed;right:20px;top:20px;width:160px;height:50px;background:#eef2ff';document.body.append(canvas);canvas.getContext('2d').fillText('Preview',30,30);canvas.onclick=event=>{window.visualClicked=event.isTrusted;};
    function openCompose(event){window.clickTrusted=event.isTrusted;document.querySelector('main').innerHTML='<h2>새 메일</h2><label>받는 사람<input aria-label="받는 사람"></label><div id="subject"></div><iframe title="본문 편집기" src="https://editor.example.test/write"></iframe><label>중요<input type="checkbox" aria-label="중요"></label><label>분류<select aria-label="분류"><option value="normal">일반</option><option value="work">업무</option></select></label><button onclick="window.sent++">보내기</button><output id="saved"></output>';document.querySelector('#subject').attachShadow({mode:'open'}).innerHTML='<label>제목<input aria-label="제목"></label>';document.querySelector('input').addEventListener('keydown',event=>{if(event.key==='Enter'){document.querySelector('#saved').textContent='받는 사람 확인됨';window.recipientConfirmed=true;}});}
    addEventListener('message',event=>{if(event.origin==='https://editor.example.test'){window.bodySaved=event.data.body;document.querySelector('#saved').textContent='초안 저장됨';}});
    </script>`}));
  await context.route('https://editor.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<title>본문 편집기</title><div role="textbox" aria-label="본문" contenteditable="true"></div><script>document.querySelector('div').addEventListener('input',event=>{window.inputTrusted=event.isTrusted;parent.postMessage({body:event.target.innerText},'https://mail.example.test');});</script>`}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', context_length: 524288}, {name: 'QWEN3.8-27B-FP8-256K', display_name: 'QWEN3.8-27B-256K', context_length: 262144}]})});
    const body = route.request().postDataJSON();
    const intent = completionIntentResponse(body); if (intent) return route.fulfill({json: intent});
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning}); requests.push(body);
    const review = goalReviewPayload(body.messages); if (review) return route.fulfill({contentType: 'application/json', body: JSON.stringify(reviewCompletion(review))});
    assert.equal(route.request().headers().authorization, `Bearer ${token}`);
    const last = body.messages.findLast(message => message.role === 'tool'), result = last ? JSON.parse(last.content) : null;
    if (result?.error && !(mode === 'script' && stage === 2)) throw new Error(`Tool failed: ${JSON.stringify(result)}`);
    let name, args = {};
    if (mode === 'ordinary') {
      assert(body.tools.some(tool => tool.function.name === 'read_page'));
      assert(!body.messages.some(message => message.content?.includes?.('https://first.example.test')));
    } else if (mode === 'analysis') {
      if (stage === 0) name = 'read_page';
      else {
        assert(result.url.endsWith(expectedPagePath), JSON.stringify(result));
        assert(result.frames.some(frame => frame.text.includes('업무 홈페이지')));
      }
    } else if (mode === 'mail') {
      if (stage === 0) name = 'inspect_dom';
      if (stage === 1) {name = 'click_element'; args = {ref: ref(result, '메일')};}
      if (stage === 2) {assert(result.observation.url.includes('mail.example.test'),JSON.stringify(result)); name = 'click_element'; args = {ref: ref(result, '메일 쓰기')};}
      if (stage === 3) {name = 'fill_form'; args = {fields: [{field_id: ref(result, '받는 사람'), value: 'colleague@example.invalid'}, {field_id: ref(result, '제목'), value: '교육 일정 안내'}, {field_id: ref(result, '본문'), value: '안녕하세요.\n교육 일정을 안내드립니다.'}]};}
      if (stage === 4) {assert.equal(result.verified, true); assert.equal(result.matched, 3); name = 'press_key'; args = {ref: ref(result, '받는 사람'), key: 'Enter'};}
      if (stage === 5) {name = 'select_option'; args = {ref: ref(result, '분류'), values: ['work']};}
      if (stage === 6) {name = 'fill_form'; args = {fields: [{field_id: ref(result, '중요'), value: 'true'}]};}
      if (stage === 7) {assert.equal(result.verified, true); assert(result.observation.frames.some(frame => frame.text.includes('초안 저장됨') || frame.text.includes('받는 사람 확인됨')));}
    } else if (mode === 'navigation') {
      if (stage === 0) name = 'list_tabs';
      if (stage === 1) {name = 'switch_tab'; args = {tab_id: result.tabs.find(tab => tab.title === '업무 홈페이지').tab_id};}
      if (stage === 2) {name = 'hover_element'; args = {ref: ref(result, '메뉴')};}
      if (stage === 3) {assert(result.observation.frames[0].text.includes('메뉴 열림')); name = 'scroll_page'; args = {direction: 'down'};}
      if (stage === 4) {name = 'navigate_page'; args = {url: 'https://first.example.test/next'};}
      if (stage === 5) {assert(result.observation.url.endsWith('/next')); name = 'go_back';}
      if (stage === 6) {assert(result.observation.url.endsWith('/portal')); name = 'wait_page';}
    } else if (mode === 'script') {
      assert.equal(body.model, 'QWEN3.8-27B-FP8-256K');
      if (stage === 0) name = 'inspect_dom';
      if (stage === 1) {name = 'run_playwright'; args = {code: `await page.getByRole('button',{name:'존재하지 않는 메일'}).click();`};}
      if (stage === 2) {assert.equal(result.reason, 'script_missing'); assert(result.observation); name = 'run_playwright'; args = {code: `await page.getByRole('link',{name:'메일',exact:true}).click(); await page.getByRole('button',{name:'메일 쓰기',exact:true}).click(); return await browser.snapshot();`};}
      if (stage === 3 && result.yielded) {
        assert.equal(result.completed, false); assert.deepEqual(result.execution.commands.map(command => command.method), ['click']);
        return route.fulfill({contentType: 'text/event-stream', body: response('run_playwright', {code: `await page.getByRole('button',{name:'메일 쓰기',exact:true}).click(); return await browser.snapshot();`})});
      }
      if (stage === 3) {assert.equal(result.ok, true, JSON.stringify(result)); assert(result.observation.frames.some(frame => frame.owner?.title === '본문 편집기')); name = 'run_playwright'; args = {code: `for (const [label,value] of [['받는 사람','colleague@example.invalid'],['제목','스크립트 작성']]) await page.getByRole('textbox',{name:label,exact:true}).fill(value); const body=page.frameLocator('iframe[title="본문 편집기"]').getByRole('textbox',{name:'본문'}); await body.fill('첫 줄\\n둘째 줄'); return {recipient:await page.getByLabel('받는 사람').inputValue(),body:await body.innerText()};`};}
      if (stage === 4) {assert.deepEqual(result.value, {recipient: 'colleague@example.invalid', body: '첫 줄\n둘째 줄'}); name = 'run_playwright'; args = {code: 'return await browser.screenshot({fullPage:false});'};}
      if (stage === 5) {
        const images = body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
        assert.equal(images.length, 1); assert(images[0].image_url.url.startsWith('data:image/png;base64,iVBOR'));
        assert(!last.content.includes('iVBOR'));
        name = 'click_at'; args = {screenshot_id: result.value.screenshot_id, x: result.value.width - 100, y: 45};
      }
      if (stage === 6) assert.equal(result.ok, true);
    } else if (mode === 'cancel') {
      name = 'run_playwright'; args = {code: `await page.getByRole('textbox',{name:'never appears'}).fill('x'); await page.getByRole('button',{name:'보내기'}).click();`};
    }
    if (!name && ['mail', 'navigation', 'script'].includes(mode) && !result?.checks) {
      name = 'verify_page';
      args = {checks: mode === 'navigation' ? [{kind: 'url_is', expected: 'https://first.example.test/portal'}] : [
        {kind: 'field_value', ref: ref(result, '받는 사람'), expected: 'colleague@example.invalid'},
        {kind: 'field_value', ref: ref(result, '제목'), expected: mode === 'mail' ? '교육 일정 안내' : '스크립트 작성'},
        {kind: 'field_value', ref: ref(result, '본문'), expected: mode === 'mail' ? '안녕하세요.\n교육 일정을 안내드립니다.' : '첫 줄\n둘째 줄'},
        {kind: 'text_present', expected: mode === 'mail' ? '받는 사람 확인됨' : '초안 저장됨'},
      ]};
    }
    stage++; return route.fulfill({contentType: 'text/event-stream', body: response(name, args)});
  } catch (error) {routeFailure = error; return route.fulfill({status: 500, body: 'Synthetic model assertion failed'});}});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 12}}), token);
  portal = await context.newPage(); await portal.goto('https://first.example.test/portal');
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async () => !!(await state()).catalog?.models?.length, true);
  assert.equal((await state()).activeSkillId, '');
  assert.equal((await state()).page, null);
  await portal.bringToFront();
  // Bind the target tab through the same source-tab state used by full-screen chat.
  const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0].id);
  const chatTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({sourceTab, chatTab}) => chrome.storage.session.set({chatSourceTabs: {[chatTab]: sourceTab}}), {sourceTab, chatTab});
  await ui.bringToFront(); await ui.setViewportSize({width: 360, height: 800});
  mode = 'ordinary'; stage = 0;
  const beforeChat = await worker.evaluate(() => {
    globalThis.pageConnectCalls = 0;
    globalThis.debuggerAttaches = 0;
    const attach = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = (...args) => {globalThis.debuggerAttaches++; return attach(...args);};
    const original = chrome.scripting.executeScript.bind(chrome.scripting);
    chrome.scripting.executeScript = options => {if (options.args?.[0] === 'connect') globalThis.pageConnectCalls++; return original(options);};
    return globalThis.pageConnectCalls;
  });
  await send('안녕하세요');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal((await state()).page, null);
  assert.equal((await state()).chat.task, null);
  assert.equal(await worker.evaluate(() => globalThis.pageConnectCalls), beforeChat);
  check('ordinary text chat exposes optional browser tools without connecting, inspecting or transmitting the current page');
  mode = 'analysis'; stage = 0;
  await send('현재 페이지 분석해줘');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal((await state()).activeSkillId, '');
  assert((await state()).page.url.endsWith('/portal'));
  assert.equal((await state()).chat.messages.at(-1).trace.find(step => step.tool !== 'update_plan').tool, 'read_page');
  await ui.screenshot({path: resolve('verification/auto-page-analysis-panel.png'), fullPage: true});
  check('plain current-page analysis automatically connects and reads real DOM without a link click or skill selection');
  await ui.getByRole('button', {name: '페이지 연결 해제', exact: true}).click();
  await poll(async () => (await state()).page, null);
  await portal.goto('https://first.example.test/updated');
  await ui.reload(); await ui.bringToFront();
  await ui.setViewportSize({width: 1100, height: 850});
  expectedPagePath = '/updated'; stage = 0;
  await send('지금 보고 있는 화면을 읽고 핵심을 정리해줘');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert((await state()).page.url.endsWith('/updated'));
  await ui.screenshot({path: resolve('verification/auto-page-analysis-desktop.png'), fullPage: true});
  check('a new natural-language request reconnects after disconnect, navigation and chat reload using fresh page evidence');
  await ui.getByRole('button', {name: '페이지 연결 해제', exact: true}).click();
  await poll(async () => (await state()).page, null);
  await clickComposerAction(ui, '현재 페이지 연결');
  await poll(async () => !!(await state()).page, true);
  check('the original link icon still manually connects the current source page');
  assert.equal(await worker.evaluate(() => globalThis.debuggerAttaches), 0);
  check('plain chat, automatic analysis, manual page linking and reloaded analysis never attach a debugger');
  await portal.goto('https://first.example.test/portal');
  await ui.bringToFront(); await ui.setViewportSize({width: 360, height: 800}); mode = 'mail'; stage = 0;
  const usageBeforeMail = (await state()).usage.total.aipro;
  await send('홈페이지에서 메일을 열고 colleague@example.invalid에게 교육 일정 안내 제목과 본문으로 메일을 작성해줘. 중요 표시하고 업무로 분류해줘. 발송하지 마.');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  const mail = context.pages().find(page => page.url().startsWith('https://mail.example.test/'));
  assert(mail); assert.equal(await mail.getByRole('textbox', {name: '받는 사람'}).inputValue(), 'colleague@example.invalid');
  assert.equal(await mail.getByRole('textbox', {name: '제목'}).inputValue(), '교육 일정 안내');
  assert.equal(await mail.frameLocator('iframe').getByRole('textbox', {name: '본문'}).innerText(), '안녕하세요.\n교육 일정을 안내드립니다.');
  assert.equal(await mail.getByRole('checkbox', {name: '중요'}).isChecked(), true);
  assert.equal(await mail.getByRole('combobox', {name: '분류'}).inputValue(), 'work');
  assert.equal(await mail.evaluate(() => window.sent), 0);
  check('mail workflow opens an observed link in a new tab, composes recipients/subject/body across shadow DOM and cross-origin iframe, checks and selects without sending');
  assert.equal(await mail.evaluate(() => window.clickTrusted && window.recipientConfirmed), true);
  assert.equal(await mail.frames().find(frame => frame.url().includes('editor.example.test')).evaluate(() => window.inputTrusted), true);
  assert.equal(await mail.evaluate(() => window.bodySaved), '안녕하세요.\n교육 일정을 안내드립니다.');
  check('Playwright produces trusted click, keyboard and rich-editor input events and observes the resulting draft state');
  // 10 executor turns, 1 plan, 1 checkpoint, 1 scope audit of the checkpoint's
  // revise verdict, 2 stage reviews (a text answer closes one plan stage at a
  // time, agent-runtime.js) and 1 final review. Every call carries 110 tokens.
  assert.equal((await state()).usage.total.aipro.calls - usageBeforeMail.calls, 16); assert.equal((await state()).usage.total.aipro.total - usageBeforeMail.total, 1760);
  assert.equal((await state()).chat.messages.at(-1).usage.total_tokens, 110);
  check('execution, planning, intermediate review and final review contribute usage while context remains the last request');
  assert.equal(await worker.evaluate(async () => {
    const tabs = (await chrome.tabs.query({})).filter(tab => /example\.test/.test(tab.url));
    return (await Promise.all(tabs.map(async tab => {try {await chrome.debugger.sendCommand({tabId: tab.id}, 'Page.getFrameTree'); return true;} catch {return false;}}))).filter(Boolean).length;
  }), 0);
  check('automation debugger attachments end after the completed task');
  await ui.screenshot({path: resolve('verification/browser-agent-chat-panel.png'), fullPage: true});
  await mail.screenshot({path: resolve('verification/browser-agent-mail-draft.png'), fullPage: true});
  mode = 'navigation'; stage = 0;
  await send('열린 홈페이지 탭으로 돌아가 메뉴를 확인하고 스크롤한 다음 https://first.example.test/next에 갔다가 뒤로 돌아와줘');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(portal.url(), 'https://first.example.test/portal');
  check('tab discovery/switch, hover, scrolling, navigation, back and wait execute through the same observed action loop');
  await ui.evaluate(() => chrome.runtime.sendMessage({type: 'SELECT_MODEL', name: 'QWEN3.8-27B-FP8-256K'}));
  mode = 'script'; stage = 0;
  await send('Playwright 코드를 작성해서 메일 초안을 만들고 화면의 Preview를 눌러줘. 발송하지 마.');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  const scriptedMail = context.pages().filter(page => page.url().startsWith('https://mail.example.test/')).at(-1);
  assert.equal(await scriptedMail.getByLabel('제목').inputValue(), '스크립트 작성');
  assert.equal(await scriptedMail.evaluate(() => window.sent), 0);
  assert.equal(await scriptedMail.evaluate(() => window.bodySaved), '첫 줄\n둘째 줄');
  check('generated Playwright JavaScript runs in the packaged WASM VM, receives a locator error, corrects the script and verifies a draft across shadow DOM and iframe');
  assert.equal(await scriptedMail.evaluate(() => window.visualClicked), true);
  check('Qwen receives one PNG image_url and a screenshot-bound point click activates a canvas control with trusted input');
  await ui.screenshot({path: resolve('verification/browser-agent-script-panel.png'), fullPage: true});
  // START_CHAT follows the active page; make the script-created mail the source.
  await scriptedMail.bringToFront();
  const scriptTab = await worker.evaluate(async () => (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0].id);
  await worker.evaluate(({chatTab, scriptTab}) => chrome.storage.session.set({chatSourceTabs: {[chatTab]: scriptTab}}), {chatTab, scriptTab});
  await ui.bringToFront(); mode = 'cancel'; stage = 0;
  await send('중지 동작 테스트');
  await poll(async () => stage > 0, true);
  await new Promise(resolve => setTimeout(resolve, 400));
  const started = Date.now(); await ui.getByRole('button', {name: '중지', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'error');
  assert(Date.now() - started < 5000);
  assert.equal(await scriptedMail.evaluate(() => window.sent), 0);
  assert.equal((await state()).chat.messages.at(-1).error, 'cancelled');
  check('stop interrupts a pending Playwright script and prevents subsequent actions');
  await poll(async () => !!(await state()).busy, false);
  mode = 'cancel'; stage = 0;
  await send('브라우저 표시줄 취소 테스트');
  await poll(() => worker.evaluate(async id => {try {await chrome.debugger.sendCommand({tabId:id}, 'Page.getFrameTree'); return true;} catch {return false;}}, scriptTab), true);
  await worker.evaluate(id => globalThis.testOnDebuggerDetached({tabId: id}, 'canceled_by_user'), scriptTab);
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'error');
  await poll(async () => !!(await state()).busy, false);
  assert.equal((await state()).chat.messages.at(-1).error, 'cancelled');
  assert.equal(await scriptedMail.evaluate(() => window.sent), 0);
  check('a simulated native cancel event aborts the live chat through the session observer and prevents subsequent actions');
  await ui.reload(); assert.equal((await state()).chat.messages.at(-1).state, 'error');
  const stored = await ui.evaluate(() => chrome.storage.local.get(null));
  assert(!JSON.stringify(stored).includes(token)); assert(!JSON.stringify(stored).includes('elementHandle')); assert.deepEqual(errors, []);
  check('completed work survives UI reload without persisting browser handles or credentials');
  await clickComposerAction(ui, '스킬 선택');
  await ui.screenshot({path: resolve('verification/browser-agent-skills-panel.png'), fullPage: true});
  await ui.getByRole('button', {name: '스킬 등록', exact: true}).click();
  await ui.getByRole('textbox', {name: '이름', exact: true}).fill('메일 초안');
  await ui.getByRole('textbox', {name: '지침', exact: true}).fill('홈페이지에서 메일을 찾아 초안을 작성하고 저장 결과를 확인합니다.');
  await ui.getByRole('textbox', {name: '사용할 때', exact: true}).fill('웹메일 초안을 작성할 때');
  assert.equal(await ui.getByLabel('브라우저 자동화', {exact: true}).count(), 0);
  assert.equal(await ui.getByLabel('페이지 입력', {exact: true}).count(), 0);
  assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ui.screenshot({path: resolve('verification/browser-agent-skill-editor-panel.png'), fullPage: true});
  await ui.setViewportSize({width: 1100, height: 850});
  await ui.screenshot({path: resolve('verification/browser-agent-skill-editor-desktop.png'), fullPage: true});
  await ui.getByRole('button', {name: '저장', exact: true}).click();
  await poll(async () => (await state()).skills.some(skill => skill.name === '메일 초안'), true);
  await ui.reload();
  const savedSkill=(await state()).skills.find(skill=>skill.name==='메일 초안');
  assert.equal(savedSkill.toolMode,'automatic');assert.equal(savedSkill.needsPage,false);
  assert.equal(savedSkill.allowAutomation,true);assert.equal(savedSkill.description,'웹메일 초안을 작성할 때');
  assert.equal(savedSkill.instructions,'홈페이지에서 메일을 찾아 초안을 작성하고 저장 결과를 확인합니다.');
  check('CX skill registration uses automatic tool selection without capability checkboxes and preserves the workflow after reload');
  await writeFile('verification/browser-agent-browser.json', JSON.stringify({version: manifest.version, checks, syntheticModelResponses: true, realBrowserActions: true, fixtureSiteAccessPregranted: true, actualCompanyMailVerified: false}, null, 2));
} catch (error) {console.error({stage, errors, summary: await state().then(s => ({last: s.chat.messages.at(-1), busy: s.busy})).catch(() => null)}); throw error;}
finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

import {fixturePlan} from './fixtures/task-plan.mjs';
import {PLAN_PROMPT} from '../task-plan.js';
import {goalReviewPayload, acceptedReview} from './fixtures/goal-review.mjs';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, readFile, writeFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {connection, models, conversation, toolReply, messageReply, nativeResponse} from './fixtures/fabrix.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-fabrix-')), extension = resolve(profile, 'extension');
const checks = [], errors = []; let context, ui, worker, failed, mode = 'models', stage = 0, requests = 0;
let actionMalformed = false, selectedId = connection.modelId, modelRequests = 0, planningRequests = 0;
let heldModelCheck, releaseModelCheck;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
async function poll(fn, expected) {let value; for (let i = 0; i < 800; i++) {if (failed) throw failed; value = await fn(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 50));} assert.equal(value, expected);}
async function capture(name) {await ui.screenshot({path: resolve(`verification/fabrix-${name}.png`)});}
async function fit() {assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));}
async function send(text) {await ui.getByRole('dialog').waitFor({state: 'hidden'}); await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text); await ui.getByRole('button', {name: '전송', exact: true}).click();}
try {
  await mkdir('verification', {recursive: true}); await cp(resolve(process.env.TEST_EXTENSION || 'dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Only this temporary test copy pregrants fixture origins. The native Chrome
  // optional host permission prompt is not covered by these UI assertions.
  manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://portal.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>업무 홈</title><h1>업무 홈</h1><a target="_blank" href="https://mail.example.test/compose">메일 작성</a>'}));
  await context.route('https://mail.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<title>메일 초안</title><h1>메일 초안</h1><label>제목<input aria-label="제목"></label><iframe title="본문" src="https://editor.example.test/write"></iframe><button onclick="window.saved=document.querySelector('input').value;document.querySelector('output').textContent='초안 저장됨'">초안 저장</button><button onclick="window.sent++">보내기</button><output></output><script>window.sent=0;addEventListener('message',e=>{if(e.origin==='https://editor.example.test')window.draftBody=e.data;});</script>`}));
  await context.route('https://editor.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<div role="textbox" contenteditable="true" aria-label="본문"></div><script>document.querySelector('div').oninput=e=>parent.postMessage(e.target.innerText,'https://mail.example.test');</script>`}));
  await context.route('https://fabrix.example.test/**', async route => {
    try {
      const req = route.request();
      assert.equal(req.headers()['x-fabrix-client'], connection.clientKey); assert.equal(req.headers()['x-openapi-token'], `Bearer ${connection.token}`);
      if (req.method() === 'GET') {
        modelRequests++; assert.equal(new URL(req.url()).pathname, '/openapi/chat/v1/models');
        if (heldModelCheck) await heldModelCheck;
        return route.fulfill(mode === 'failure' ? {status: 401, body: 'Private failure body'} : {contentType: 'application/json', body: JSON.stringify(models)});
      }
      requests++; const body = req.postDataJSON();
      assert.equal(new URL(req.url()).pathname, '/openapi/chat/v1/messages');
      assert.equal(req.headers()['x-fabrix-client'], connection.clientKey); assert.equal(req.headers()['x-openapi-token'], `Bearer ${connection.token}`);
      assert.deepEqual(body.modelIds, [selectedId]); assert(!JSON.stringify(body).includes(connection.token));
      if (mode === 'failure') return route.fulfill({status: 401, body: 'Private failure body'});
      if (mode === 'upstream502') return route.fulfill({status: 502, body: 'Private upstream failure'});
      let text;
      const review = goalReviewPayload([{role: 'system', content: body.systemPrompt}, ...conversation(body)]);
      if (body.systemPrompt.startsWith(PLAN_PROMPT)) {planningRequests++; text = toolReply(body, 'update_plan', {steps: fixturePlan});}
      else if (body.systemPrompt.startsWith(COMPLETION_REVIEW_PROMPT)) {assert.equal(mode, 'ordinary'); text = JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''});}
      else if (review) {
        if (review.phase === 'final') {const saved = (await state()).chat.task.plan; assert(saved.length === fixturePlan.length && saved.every(step => step.status === 'completed'));}
        text = JSON.stringify(acceptedReview(review));
      }
      else if (mode === 'protocolFailure') text = 'Private malformed provider content';
      else if (mode === 'agent' && stage === 3 && !actionMalformed) {actionMalformed = true; text = 'Private malformed action content';}
      else if (mode === 'ordinary') {assert(!body.contents[0].includes('portal.example.test')); text = messageReply(body, '안녕하세요.');}
      else {
        assert(!body.systemPrompt.includes('"name":"capture_page"'));
        const messages = conversation(body), last = messages.findLast(message => message.role === 'tool'), result = last && JSON.parse(last.content);
        if (result?.error) throw new Error(`Unexpected tool failure: ${JSON.stringify(result)}`);
        if (stage === 0) text = toolReply(body, 'select_tools', {groups: ['scripts']});
        if (stage === 1) text = toolReply(body, 'inspect_dom');
        if (stage === 2) {assert(JSON.stringify(result).includes('메일 작성'), JSON.stringify(result)); text = toolReply(body, 'run_playwright', {code: "await page.getByRole('link',{name:'메일 작성',exact:true}).click(); return await browser.snapshot();"});}
        if (stage === 3) {assert(JSON.stringify(result).includes('mail.example.test')); text = toolReply(body, 'run_playwright', {code: "await page.getByRole('textbox',{name:'제목',exact:true}).fill('FabriX 테스트 초안'); await page.frameLocator('iframe[title=본문]').getByRole('textbox',{name:'본문'}).fill('교육 일정을 안내합니다.'); await page.getByRole('button',{name:'초안 저장',exact:true}).click(); return await browser.snapshot();"});}
        if (stage === 4) {assert(JSON.stringify(result).includes('초안 저장됨')); const refs = result.observation.frames.flatMap(f => f.elements || []); text = toolReply(body, 'verify_page', {checks: [{kind: 'text_present', expected: '초안 저장됨'}, {kind: 'field_value', ref: refs.find(e => e.name === '제목').ref, expected: 'FabriX 테스트 초안'}, {kind: 'field_value', ref: refs.find(e => e.name === '본문').ref, expected: '교육 일정을 안내합니다.'}]});}
        if (stage === 5) {assert.equal(result.verified, true); text = toolReply(body, 'update_plan', {steps: fixturePlan.map(step => ({...step, status: 'completed'}))});}
        if (stage === 6) {assert(result.ok && result.plan?.length === fixturePlan.length && result.plan.every(step => step.status === 'completed')); const saved = (await state()).chat.task.plan; assert.deepEqual(saved, result.plan); text = messageReply(body, '메일 초안을 저장했습니다.');}
        assert(stage <= 6, 'No browser work is repeated after verified plan closure');
        stage++;
      }
      // Realistic Markdown wrapping around a complete tool response is harmless.
      if (text.startsWith('{"protocol"')) text = '```json\n' + text + '\n```';
      const response = nativeResponse(text, {stream: body.isStream, usage: {inputTokens: 100, outputTokens: 20}});
      await route.fulfill({status: 200, contentType: response.headers.get('content-type'), body: await response.text()});
    } catch (error) {failed = error; console.error('Fixture error', error); await route.fulfill({status: 500, body: 'Synthetic assertion failed'});}
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const portal = await context.newPage(); await portal.goto('https://portal.example.test/home');
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  for (const [width, height] of [[360, 800], [1100, 850], [360, 480]]) {
    await ui.setViewportSize({width, height}); await ui.getByRole('button', {name: 'FabriX', exact: true}).waitFor(); await fit();
    const alignment = await ui.locator('.provider-label').evaluateAll(labels => labels.map(label => ({icon: label.querySelector('img').getBoundingClientRect().x, text: label.querySelector('span').getBoundingClientRect().x})));
    assert.equal(new Set(alignment.map(row => row.icon)).size, 1); assert.equal(new Set(alignment.map(row => row.text)).size, 1);
    const centering = await ui.locator('.provider-label').evaluateAll(labels => labels.map(label => {const group = label.getBoundingClientRect(), button = label.closest('button').getBoundingClientRect(); return Math.abs(group.x + group.width / 2 - button.x - button.width / 2);}));
    assert(centering.every(offset => offset < 1), JSON.stringify(centering));
    await capture(`login-${width}x${height}`);
    await ui.getByRole('button', {name: 'FabriX', exact: true}).click();
    const dialog = ui.getByRole('dialog', {name: 'FabriX 연결'}); await dialog.waitFor(); await fit();
    await capture(`modal-${width}x${height}`);
    assert(await dialog.getByRole('button', {name: '연결', exact: true}).isDisabled());
    const footer = await dialog.getByRole('button', {name: '연결 테스트', exact: true}).boundingBox(); assert(footer.y + footer.height <= height);
    await dialog.getByRole('button', {name: '닫기', exact: true}).click();
  }
  await worker.evaluate(() => chrome.storage.session.set({attempt: {provider: 'aipro', receiverVersion: 3, expiresAt: Date.now() + 60000, port: 55555}}));
  await ui.getByRole('button', {name: '로그인 대기 중', exact: true}).waitFor();
  const pendingAlignment = await ui.locator('.provider-logo').evaluateAll(icons => icons.map(icon => icon.getBoundingClientRect().x));
  assert.equal(new Set(pendingAlignment).size, 1);
  await worker.evaluate(() => chrome.storage.session.remove('attempt'));
  await ui.getByRole('button', {name: 'AI Pro', exact: true}).waitFor();
  check('provider icons/text align in shared columns even while loading; login and modal fit three viewport sizes with a visible footer');
  await ui.setViewportSize({width: 360, height: 800}); await ui.getByRole('button', {name: 'FabriX', exact: true}).click();
  const dialog = ui.getByRole('dialog', {name: 'FabriX 연결'});
  for (const [label, value] of [['Endpoint', connection.endpoint], ['Client Key', connection.clientKey], ['API Token', connection.token]]) await dialog.getByLabel(label).fill(value);
  assert.equal(await dialog.getByLabel('API Token').getAttribute('type'), 'password');
  mode = 'failure'; await dialog.getByRole('button', {name: '연결 테스트', exact: true}).click();
  await dialog.getByText('Client Key와 API Token을 확인해 주세요.', {exact: true}).waitFor();
  assert(await dialog.getByRole('button', {name: '연결', exact: true}).isDisabled()); assert.equal((await state()).auth.present, false);
  check('failed credentials keep the user in the modal and cannot enable Connect');
  mode = 'models'; heldModelCheck = new Promise(resolve => {releaseModelCheck = resolve;});
  await dialog.getByRole('button', {name: '연결 테스트', exact: true}).click();
  await dialog.getByText('연결 확인 중', {exact: true}).waitFor();
  const statusType = () => dialog.locator('.fabrix-test-status').evaluate(el => {
    const s = getComputedStyle(el); return {font: s.fontFamily, size: s.fontSize, line: s.lineHeight, weight: s.fontWeight, spacing: s.letterSpacing};
  });
  const checkingType = await statusType(); await assertModalTypography(dialog); await capture('checking');
  releaseModelCheck(); heldModelCheck = null;
  await dialog.getByText('테스트 통과', {exact: true}).waitFor();
  assert.deepEqual(await statusType(), checkingType, 'Checking and completed connection states must have identical typography');
  assert.equal(checkingType.weight, '400'); await assertModalTypography(dialog);
  check('connection checking and completion share the same 14/22px font and weight');
  assert(!(await dialog.getByRole('button', {name: '연결', exact: true}).isDisabled())); await capture('tested');
  await dialog.getByLabel('Client Key').fill('changed');
  assert(await dialog.getByRole('button', {name: '연결', exact: true}).isDisabled());
  await dialog.getByLabel('Client Key').fill(connection.clientKey);
  await dialog.getByRole('button', {name: '연결 테스트', exact: true}).click();
  await dialog.getByText('테스트 통과', {exact: true}).waitFor();
  await dialog.getByRole('button', {name: '연결', exact: true}).click();
  await poll(async () => (await state()).auth.provider, 'fabrix');
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  assert.equal(requests, 0); assert.equal(modelRequests, 3);
  assert.equal((await state()).catalog.models.length, 2);
  await ui.getByRole('button', {name: '모델 변경'}).click();
  const picker = ui.getByRole('dialog', {name: '모델 선택'});
  assert(!await picker.innerText().then(text => text.includes(connection.modelId)));
  assert(!await picker.locator('[title]').evaluateAll(elements => elements.some(el => el.title.includes('second-model-id'))));
  await picker.getByRole('button', {name: '추론 모델', exact: true}).click(); selectedId = 'second-model-id';
  assert.equal((await state()).settings.modelId, selectedId);
  await poll(() => ui.getByRole('button', {name: '모델 변경'}).innerText(), '추론 모델');
  await ui.reload(); await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  assert.equal((await state()).settings.modelId, selectedId);
  check('three-field registration discovers models without inference; Korean-only picker changes and restores the selected ID');
  await portal.bringToFront();
  const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0].id);
  const chatTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({sourceTab, chatTab}) => chrome.storage.session.set({chatSourceTabs: {[chatTab]: sourceTab}}), {sourceTab, chatTab});
  await ui.bringToFront(); mode = 'ordinary'; await send('안녕하세요');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done'); assert.equal((await state()).page, null);
  await ui.getByRole('button', {name: '모델 변경'}).click();
  await ui.getByRole('dialog', {name: '모델 선택'}).getByRole('button', {name: '테스트 모델', exact: true}).click(); selectedId = connection.modelId;
  // Keep this provider/popup contract on the connected page. Real-server
  // workspace regressions cover window creation without route-attachment races.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  mode = 'agent'; await send('현재 홈페이지에서 메일 작성으로 이동해 제목과 본문을 입력하고 초안 저장해줘. 보내지는 마.');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(stage, 7);
  const mail = context.pages().find(page => page.url().startsWith('https://mail.example.test'));
  assert(mail); assert.equal(await mail.evaluate(() => window.saved), 'FabriX 테스트 초안');
  assert.equal(await mail.evaluate(() => window.draftBody), '교육 일정을 안내합니다.'); assert.equal(await mail.evaluate(() => window.sent), 0);
  await ui.bringToFront(); await capture('agent-panel');
  await mail.screenshot({path: resolve('verification/fabrix-mail-draft.png')});
  check('FabriX envelope drives real Pi/Playwright DOM inspection, popup navigation, iframe editing, save click and application-state verification');
  const before = await state(); assert.equal(before.chat.messages.at(-1).usage.total_tokens, 120);
  assert.equal(planningRequests, 1);
  assert.equal(before.usage.total.fabrix.calls, requests); assert.equal(before.usage.total.fabrix.total, requests * 120); assert.equal(before.usage.total.fabrix.measured, requests);
  assert.equal(before.events.filter(e => e.event === 'fabrix_format_retry' && e.reason === 'invalid_json' && e.status === 200).length, 1);
  assert.equal(before.events.filter(e => e.event === 'fabrix_format_recovered').length, 1);
  assert(!JSON.stringify(before).includes('Private malformed'));
  check('action responses recover once with safe diagnostics, separate token counts and no malformed response execution');
  await ui.reload(); const after = await state(); assert.equal(after.auth.provider, 'fabrix'); assert.equal(after.chat.messages.at(-1).content, '메일 초안을 저장했습니다.'); assert.deepEqual(after.usage, before.usage);
  for (const data of [await ui.evaluate(() => chrome.storage.local.get(null)), after]) {assert(!JSON.stringify(data).includes(connection.token)); assert(!JSON.stringify(data).includes(connection.clientKey));}
  assert.deepEqual(errors, []); await fit();
  check('chat, usage and provider survive reload; credentials and private reasoning stay out of diagnostics and local storage');
  await ui.getByRole('button', {name: '사용량', exact: true}).click(); await capture('usage');
  await ui.getByRole('dialog').getByRole('button', {name: '닫기', exact: true}).click();
  let beforeRequests = requests; mode = 'upstream502'; await send('서버 오류 확인');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'error');
  assert.equal(requests - beforeRequests, 4);
  assert((await state()).events.some(e => e.event === 'upstream' && e.status === 502));
  beforeRequests = requests; mode = 'protocolFailure'; await send('형식 오류 확인');
  await poll(async () => (await state()).chat.messages.at(-1)?.error, 'fabrix_tool_protocol');
  assert.equal(requests - beforeRequests, 2);
  const broken = await state();
  assert(broken.events.some(e => e.event === 'fabrix_format_failed' && e.reason === 'invalid_json' && e.status === 200));
  assert.equal(broken.events.at(-1).event, 'fabrix_tool_protocol'); assert.equal(broken.events.at(-1).status, 0);
  assert(!JSON.stringify(broken).includes('Private malformed'));
  assert.equal(await mail.evaluate(() => window.sent), 0);
  await capture('protocol-error');
  check('HTTP 502 receives three transport retries and retains its status; two malformed HTTP 200 replies stop without transport retry or browser action');
  await writeFile('verification/fabrix-browser.json', JSON.stringify({version: manifest.version, checks, requests, modelRequests, syntheticProvider: true, realBrowserActions: true, nativePermissionPromptVerified: false, companyConnectionVerified: false}, null, 2));
} catch (error) {console.error({mode, stage, requests, errors, summary: await state().then(value => ({last: value.chat.messages.at(-1), auth: value.auth})).catch(() => null)}); if (ui) await capture('failure').catch(() => {}); throw error;}
finally {releaseModelCheck?.(); await context?.close(); await rm(profile, {recursive: true, force: true});}

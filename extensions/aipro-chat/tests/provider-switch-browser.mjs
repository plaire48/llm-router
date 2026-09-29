import {completionIntentReply, completionIntentResponse} from './fixtures/completion-intent.mjs';
import {forbidLoginDebugger, assertNoLoginDebugger} from './helpers/no-login-debugger.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chatgptToken, responsesSSE} from './fixtures/chatgpt.mjs';
import {connection, models, probeReply, messageReply, nativeResponse} from './fixtures/fabrix.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-providers-')), extension = resolve(profile, 'extension');
await cp(resolve('dist'), extension, {recursive: true});
 await forbidLoginDebugger(extension);
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://*/*', 'https://*/*');
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const aiproToken = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const gptToken = chatgptToken(), checks = [], errors = [], requests = [];
let context, page, worker, oauth = 'success', held, authCount = 0, exchangeCount = 0, replyGate;
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const button = name => page.getByRole('button', {name, exact: true});
const input = () => page.getByRole('textbox', {name: '메시지', exact: true});
const picker = () => page.getByRole('dialog', {name: '모델 선택', exact: true});
const tab = name => picker().getByRole('tab', {name, exact: true});
const rpc = (type, fields = {}) => page.evaluate(async ({type, fields}) => chrome.runtime.sendMessage({type, ...fields}), {type, fields});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {let value; for (let i = 0; i < 300; i++) {value = await fn(); if (value === expected) return; await new Promise(r => setTimeout(r, 50));} assert.equal(value, expected);}
async function openPicker() {await button('모델 변경').click(); await picker().waitFor();}
async function send(text) {await input().fill(text); await button('전송').click(); await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/auth/cli/login') {
      authCount++;
      return route.fulfill({status: 302, headers: {location: `http://localhost:${url.searchParams.get('port')}/auth?code=synthetic-code&status=00`}, body: ''});
    }
    if (url.pathname === '/auth/exchange') {
      assert.equal(new URLSearchParams(req.postData()).get('code'), 'synthetic-code');
      return route.fulfill({contentType: 'application/json', body: JSON.stringify({token: aiproToken})});
    }
    assert.equal(req.headers().authorization, `Bearer ${aiproToken}`);
    if (url.pathname === '/api/models') return route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', context_length: 524288}, {name: 'QWEN3.8-27B-FP8-256K', display_name: 'Qwen3.8', context_length: 262144}]})});
    const intent = completionIntentResponse(req.postDataJSON()); if (intent) return route.fulfill({json:intent});
    requests.push({provider: 'aipro', body: req.postDataJSON()});
    if (replyGate) await new Promise(resolve => {replyGate = resolve;});
    return route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: '사내 자료를 확인했습니다.'}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}})});
  });
  await context.route('https://auth.openai.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/oauth/authorize') {
      authCount++;
      return route.fulfill({status: 302, headers: {location: `${url.searchParams.get('redirect_uri')}?state=${url.searchParams.get('state')}&code=synthetic-gpt-code`}, body: ''});
    }
    exchangeCount++;
    if (oauth === 'hold') {held = route; return;}
    if (oauth === 'fail') return route.fulfill({status: 400, contentType: 'application/json', body: '{}'});
    return route.fulfill({contentType: 'application/json', body: JSON.stringify({access_token: gptToken, refresh_token: 'synthetic-refresh', expires_in: 3600})});
  });
  await context.route('https://chatgpt.com/**', async route => {
    assert.equal(route.request().headers().authorization, `Bearer ${gptToken}`);
    const body = route.request().postDataJSON();
    const intent = completionIntentReply(body); if (intent) return route.fulfill({contentType:'text/event-stream',body:responsesSSE({text:intent,usage:null})});
    requests.push({provider: 'chatgpt', body});
    assert(!JSON.stringify(body).includes('사내 자료')); assert(!JSON.stringify(body).includes('AI Pro 초안'));
    return route.fulfill({contentType: 'text/event-stream', body: responsesSSE({text: '개인 일정을 확인했습니다.'})});
  });
  await context.route('https://fabrix.example.test/**', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({contentType: 'application/json', body: JSON.stringify(models)});
    const body = req.postDataJSON();
    assert.equal(req.headers()['x-fabrix-client'], connection.clientKey);
    const intent = completionIntentReply(body); if (intent) return route.fulfill({json:{status:'SUCCESS',content:intent,finishReason:'stop'}});
    const probe = body.systemPrompt.includes('connection_echo');
    if (!probe) {requests.push({provider: 'fabrix', body}); assert(!JSON.stringify(body).includes('사내 자료')); assert(!JSON.stringify(body).includes('개인 일정'));}
    const response = nativeResponse(probe ? probeReply(body) : messageReply(body, '업무를 확인했습니다.'), {usage: {prompt_tokens: 80, completion_tokens: 20, total_tokens: 100}});
    return route.fulfill({status: response.status, contentType: response.headers.get('Content-Type'), body: await response.text()});
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 360, height: 800});
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await button('대화 이력').waitFor();
}
try {
  await mkdir('verification', {recursive: true}); await launch();
  await button('AI Pro').click();
  await input().waitFor(); await poll(async () => (await state()).catalog?.models?.length, 2);
  await send('사내 자료 정리');
  await input().fill('AI Pro 초안'); await openPicker(); await tab('ChatGPT').click();
  oauth = 'hold'; await picker().getByRole('button', {name: '로그인', exact: true}).click();
  await poll(() => Promise.resolve(!!held), true);
  assert.equal((await state()).auth.provider, 'aipro'); assert.equal((await state()).auth.present, true);
  await button('로그인 취소').click();
  await poll(async () => (await state()).pending, null);
  await held.fulfill({contentType: 'application/json', body: JSON.stringify({access_token: gptToken, refresh_token: 'synthetic-refresh', expires_in: 3600})}); held = null;
  await page.waitForTimeout(200);
  assert.equal((await state()).auth.provider, 'aipro'); assert.equal((await state()).connections.chatgpt.present, false);
  oauth = 'fail'; const exchanges = exchangeCount;
  await picker().getByRole('button', {name: '로그인', exact: true}).click();
  await poll(() => Promise.resolve(exchangeCount > exchanges), true); await poll(async () => (await state()).pending, null);
  assert.equal((await state()).auth.provider, 'aipro'); assert.equal((await state()).chat.draft, 'AI Pro 초안');
  check('AI Pro callback login works; cancelled or failed ChatGPT login retains the active connection and immediate draft');
  oauth = 'success'; await picker().getByRole('button', {name: '로그인', exact: true}).click();
  await poll(async () => (await state()).auth.provider, 'chatgpt'); await picker().waitFor({state: 'hidden'});
  await poll(async () => !!(await state()).catalog?.models?.length, true);
  assert.equal((await state()).connections.aipro.present, true);
  await send('개인 일정 확인'); await input().fill('ChatGPT 초안');
  const authenticated = authCount;
  await openPicker(); await tab('AI Pro').click();
  await poll(async () => (await state()).activeProvider, 'aipro');
  await poll(() => input().inputValue(), 'AI Pro 초안'); assert.equal(authCount, authenticated);
  await picker().getByRole('button', {name: 'Qwen3.8', exact: true}).click();
  assert.equal((await state()).settings.modelId, 'QWEN3.8-27B-FP8-256K');
  await openPicker(); await tab('ChatGPT').click();
  await poll(() => input().inputValue(), 'ChatGPT 초안'); assert.equal(authCount, authenticated);
  check('connected provider tabs switch without another login and restore each draft, model and isolated transcript');
  for (const width of [320, 360, 1100]) {
    await page.setViewportSize({width, height: width === 320 ? 480 : 800});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bounds = await picker().boundingBox(); assert(bounds.y >= 0 && bounds.y + bounds.height <= (await page.viewportSize()).height);
    assert(bounds.width <= 420 && bounds.height <= 440, 'model picker stays compact');
    assert.equal(await picker().getByRole('tab').count(), 3);
    const labels = await picker().getByRole('tab').evaluateAll(tabs => tabs.map(el => ({width: el.getBoundingClientRect().width, iconOnly: !!el.querySelector('.visually-hidden')})));
    assert(labels.every(label => label.iconOnly)); assert(Math.max(...labels.map(x => x.width))-Math.min(...labels.map(x => x.width)) < 1);
    assert(await picker().locator('.model-option').evaluateAll(buttons => buttons.every(button => button.querySelector('.model-option-text').getBoundingClientRect().bottom <= button.getBoundingClientRect().bottom - 4)), 'model rows preserve readable spacing instead of shrinking inside short panels');
    assert.equal(await picker().locator('.provider-account-row, .reply-note, .model-option small').count(), 0);
    assert.equal(await picker().getByRole('button', {name: '모델 목록 새로고침', exact: true}).count(), 1);
    await poll(() => picker().evaluate(el => {
      const tab = el.querySelector('[role="tab"][aria-selected="true"]').getBoundingClientRect(), highlight = el.querySelector('.provider-tab-highlight').getBoundingClientRect();
      return Math.abs(tab.x - highlight.x) < 1 && Math.abs(tab.width - highlight.width) < 1;
    }), true);
    await page.screenshot({path: `verification/provider-models-${width}.png`});
  }
  await page.setViewportSize({width: 360, height: 800});
  const beforeTabBounds = await picker().boundingBox();
  const moving = page.evaluate(async () => {
    const highlight = document.querySelector('.provider-tab-highlight'), frames = [], end = performance.now() + 850;
    while (performance.now() < end) {frames.push(getComputedStyle(highlight).transform); await new Promise(requestAnimationFrame);}
    return [...new Set(frames)];
  });
  await tab('FabriX').click();
  assert((await moving).length > 3, 'selected background visibly moves between tabs');
  const afterTabBounds = await picker().boundingBox();
  assert(afterTabBounds.height < beforeTabBounds.height && afterTabBounds.y >= 0 && afterTabBounds.y + afterTabBounds.height <= 800, 'login state removes empty model-list space');
  await page.screenshot({path: 'verification/provider-models-fabrix.png'});
  await page.emulateMedia({reducedMotion: 'reduce'}); await tab('ChatGPT').click();
  const reduced = await picker().evaluate(el => ({duration: getComputedStyle(el.querySelector('.provider-tab-highlight')).transitionDuration, panel: getComputedStyle(el.querySelector('[role="tabpanel"]')).animationName, border: getComputedStyle(el.querySelector('[role="tab"][aria-selected="true"]')).borderBottomWidth}));
  assert(parseFloat(reduced.duration) <= .001, 'reduced motion has no perceptible transition');
  assert.equal(reduced.panel, 'none'); assert.equal(reduced.border, '0px');
  await page.emulateMedia({reducedMotion: 'no-preference'}); await tab('FabriX').click();
  check('HTML-inspired soft tab backgrounds slide and crossfade; reduced motion keeps selection visible without animation');
  await picker().getByRole('button', {name: '연결', exact: true}).click();
  let fabrix = page.getByRole('dialog', {name: 'FabriX 연결', exact: true});
  await fabrix.getByRole('button', {name: '닫기', exact: true}).click();
  await picker().waitFor(); assert.equal(await tab('FabriX').getAttribute('aria-selected'), 'true');
  await picker().getByRole('button', {name: '연결', exact: true}).click();
  for (const [name, value] of [['Endpoint', connection.endpoint], ['Client Key', connection.clientKey], ['API Token', connection.token]]) await fabrix.getByLabel(name).fill(value);
  await fabrix.getByRole('button', {name: '연결 테스트', exact: true}).click();
  await fabrix.getByText('테스트 통과', {exact: true}).waitFor();
  await fabrix.getByRole('button', {name: '연결', exact: true}).click();
  await poll(async () => (await state()).auth.provider, 'fabrix'); await fabrix.waitFor({state: 'hidden'});
  await send('FabriX 업무 확인'); await input().fill('FabriX 초안');
  await openPicker(); await tab('AI Pro').click();
  await poll(async () => (await state()).activeProvider, 'aipro');
  assert.equal((await state()).settings.modelId, 'QWEN3.8-27B-FP8-256K');
  await poll(() => input().inputValue(), 'AI Pro 초안');
  await tab('AI Pro').focus(); await page.keyboard.press('ArrowRight');
  await poll(async () => (await state()).activeProvider, 'chatgpt');
  await poll(() => tab('ChatGPT').evaluate(el => document.activeElement === el), true).catch(async error => {console.log('FOCUS', await picker().evaluate(el => ({active: document.activeElement?.outerHTML, tabs: [...el.querySelectorAll('[role="tab"]')].map(t => ({selected: t.getAttribute('aria-selected'), disabled: t.disabled, id: t.id}))}))); throw error;});
  await page.keyboard.press('End'); await poll(async () => (await state()).activeProvider, 'fabrix');
  await poll(() => tab('FabriX').evaluate(el => document.activeElement === el), true);
  await poll(() => input().inputValue(), 'FabriX 초안');
  assert.equal(authCount, authenticated);
  await page.keyboard.press('Escape'); await picker().waitFor({state: 'hidden'});
  assert.equal(await button('모델 변경').evaluate(el => document.activeElement === el), true);
  check('three icon tabs fit 320–1100px; FabriX supports cancel, test and connect; keyboard tabs restore focus and never mix provider messages');
  if (process.env.NUBI_PROVIDER_TRACE === '1') await page.evaluate(() => {
    globalThis.providerTrace = [];
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async message => {
      const entry = {type: message.type, ui: !!message.clientId, provider: message.provider, conversationId: message.conversationId, issuedAt: performance.now()};
      const result = await original(message);
      Object.assign(entry, {returnedAt: performance.now(), ok: result.ok, error: result.error, activeProvider: result.data?.activeProvider, sessionId: result.data?.chat?.sessionId});
      providerTrace.push(entry); return result;
    };
  });
  await button('설정').click(); await button('로그아웃').click(); await picker().waitFor();
  const afterLogout = await state();
  assert.equal(afterLogout.connections.fabrix.present, false); assert.equal(afterLogout.connections.aipro.present, true); assert.equal(afterLogout.connections.chatgpt.present, true);
  assert.equal(afterLogout.chat.draft, 'FabriX 초안');
  await tab('ChatGPT').click(); await poll(async () => (await state()).auth.provider, 'chatgpt');
  // A worker RPC sees committed storage before React necessarily renders the
  // new conversation. Do not inject an out-of-band expiry into that transition.
  await poll(() => input().inputValue(), 'ChatGPT 초안');
  await worker.evaluate(async () => {const {providerSessions} = await chrome.storage.session.get('providerSessions'); providerSessions.aipro.credential.expiresAt = 1; await chrome.storage.session.set({providerSessions});});
  await poll(async () => (await state()).connections.aipro.expired, true);
  // Exercise the expired-account entry state with an actual re-entry, not a
  // click using the previous view's connection snapshot before its notification.
  await page.reload(); await input().waitFor(); await openPicker();
  await tab('AI Pro').click(); await picker().getByText('다시 연결해 주세요.', {exact: true}).waitFor();
  await picker().getByRole('button', {name: 'AI Pro 로그아웃', exact: true}).click();
  await poll(async () => (await state()).connections.aipro.present, false);
  assert.equal((await state()).auth.provider, 'chatgpt'); assert.equal((await state()).auth.present, true);
  check('settings logout opens provider choices immediately; expired inactive connections can be removed without logging out another provider');
  await picker().getByRole('button', {name: '로그인', exact: true}).click();
  await poll(async () => (await state()).auth.provider, 'aipro'); await picker().waitFor({state: 'hidden'});
  await poll(async () => (await state()).catalog?.models?.length, 2);
  replyGate = true; await input().fill('전환 중복 방지 확인'); await button('전송').click();
  await poll(() => Promise.resolve(typeof replyGate), 'function');
  assert.equal(await button('모델 변경').isDisabled(), true);
  await button('설정').click(); assert.equal(await button('로그아웃').isDisabled(), true);
  await page.getByRole('dialog', {name: '설정', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  assert.equal((await rpc('SELECT_PROVIDER', {provider: 'chatgpt'})).error, 'busy');
  assert.equal((await rpc('LOGOUT', {provider: 'aipro'})).error, 'busy');
  replyGate(); replyGate = null;
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  await page.reload(); await input().waitFor(); await openPicker(); await tab('ChatGPT').click();
  const safe = JSON.stringify({state: await state(), local: await worker.evaluate(() => chrome.storage.local.get(null))});
  for (const secret of [aiproToken, gptToken, connection.token, connection.clientKey, 'synthetic-refresh']) assert(!safe.includes(secret));
  check('running replies block both UI and RPC switching; refresh preserves connections while UI state and local storage contain no credentials');
  await assertNoLoginDebugger(page); await context.close(); await launch();
  assert(Object.values((await state()).connections).every(connection => !connection.present));
  assert((await state()).conversations.length >= 3);
  await button('설정').click(); await button('로그인').click(); await picker().waitFor();
  for (const name of ['AI Pro', 'ChatGPT', 'FabriX']) {await tab(name).click(); assert.equal(await picker().getByRole('button', {name: `${name} 로그아웃`, exact: true}).count(), 0);}
  check('browser restart clears all provider credentials but preserves each conversation and draft');
  await assertNoLoginDebugger(page);
  check('AI Pro, ChatGPT and FabriX login, switching and logout make zero debugger calls');
  assert.deepEqual(errors, []);
  await writeFile('verification/provider-switch-browser.json', JSON.stringify({version: manifest.version, checks, errors, authCount, exchangeCount, chatRequests: requests.map(r => r.provider), syntheticUpstreams: true, liveProvidersVerified: false}, null, 2) + '\n');
} catch (error) {if (process.env.NUBI_PROVIDER_TRACE === '1') console.log('PROVIDER_TRACE', JSON.stringify(await page?.evaluate(() => globalThis.providerTrace))); await page?.screenshot({path: 'verification/provider-switch-failure.png'}).catch(() => {}); throw error;}
finally {if (typeof replyGate === 'function') replyGate(); await held?.abort().catch(() => {}); await context?.close().catch(() => {}); await rm(profile, {recursive: true, force: true});}

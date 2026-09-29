import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

// Real installed Chrome extension, synthetic upstream HTTPS only. No loopback server.
const origin = 'https://aipro.sdsdev.co.kr', extension = resolve('dist');
const profile = await mkdtemp(resolve(tmpdir(), 'aipro-redirect-probe-'));
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600, sub: 'synthetic-exchange-browser'})).toString('base64url')}.signature`;
const code = 'synthetic-opaque-code+/_=';
const assertions = [], errors = [];
let context, ui, mode = 'hold', exchangeCount = 0, modelCount = 0, chatCount = 0, heldRoute;
async function poll(fn, expected) {
  let actual;
  for (let i = 0; i < 200; i++) {
    actual = await fn();
    if (actual === expected) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(actual, expected);
}
const state = () => rpc('GET_STATE');
async function rpc(type) {
  const result = await ui.evaluate(type => chrome.runtime.sendMessage({type}), type);
  assert.equal(result.ok, true);
  return result.data;
}
function check(label) { assertions.push(label); console.log(`PASS ${label}`); }
async function cleanStorage() {
  const stored = await ui.evaluate(async () => ({local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null)}));
  const {credential, ...sessionWithoutCredential} = stored.session;
  assert(!JSON.stringify(stored).includes(code));
  assert(!JSON.stringify(stored.local).includes(token));
  assert(!JSON.stringify(sessionWithoutCredential).includes(token));
  assert(!JSON.stringify(stored).includes('private-upstream-body'));
  return stored;
}

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', executablePath: process.env.CHROME_BINARY || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', page => page.on('pageerror', error => errors.push(error.name)));
  await context.route(`${origin}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/auth/vscode/login') {
      const callback = new URL(`http://localhost:${url.searchParams.get('port')}/auth`);
      callback.searchParams.set('code', code);
      callback.searchParams.set('status', '00');
      if (mode === 'jwt') callback.searchParams.set('jwt', token);
      return route.fulfill({status: 302, headers: {location: callback.href}, body: ''});
    }
    if (url.pathname === '/auth/exchange') {
      exchangeCount++;
      assert(request.serviceWorker(), 'exchange runs in extension service worker');
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers()['content-type'], 'application/x-www-form-urlencoded');
      assert.equal(request.headers().authorization, undefined);
      assert.equal(request.headers().cookie, undefined);
      assert.equal(request.postData(), new URLSearchParams({code}).toString());
      assert.notEqual(request.headers()['user-agent'], 'node');
      if (mode === 'hold') { heldRoute = route; return; }
      if (mode === 'rejected') return route.fulfill({status: 400, body: 'private-upstream-body'});
      if (mode === 'invalid') return route.fulfill({contentType: 'application/json', body: '{"token":"opaque-invalid"}'});
      return route.fulfill({contentType: 'application/json', body: JSON.stringify({token})});
    }
    if (url.pathname === '/api/models') {
      modelCount++;
      assert.equal(request.headers().authorization, `Bearer ${token}`);
      return route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{id: 42, name: 'GLM-5.2-NVFP4', display_name: 'GLM_5.2-512K', target: 'chat', is_agent: false, sort_seq: 2, max_input_tokens: 460800, context_length: 525288}]})});
    }
    if (url.pathname === '/api/v1/chat/completions') {
      chatCount++;
      assert.equal(request.headers().authorization, `Bearer ${token}`);
      assert.equal(request.postDataJSON().model, 'GLM-5.2-NVFP4');
      return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta: {content: '코드 교환 후 합성 채팅 응답'}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}})}\n\ndata: [DONE]\n\n`});
    }
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  ui = await context.newPage();
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.setViewportSize({width: 420, height: 800});
  await ui.getByRole('button', {name: 'AI Pro', exact: true}).click();
  await poll(() => exchangeCount, 1);
  await poll(async () => (await state()).pending?.phase, 'exchanging');
  assert.equal((await state()).auth.present, false);
  assert.equal(modelCount, 0);
  const callback = context.pages().find(page => page.url().startsWith('http://localhost:'));
  assert(callback);
  assert((await callback.locator('body').innerText()).includes('로그인을 확인'));
  assert((await state()).events.some(e => e.event === 'callback_received' && e.status === 200 && e.field === 'code'));
  await ui.getByRole('button', {name: '인증 확인 중', exact: true}).waitFor();
  await cleanStorage();
  check('HTTP 302 code callback receives HTML 200 without a local server and waits for exchange before authentication');
  // Duplicate navigation must not consume the same code twice.
  await callback.reload();
  assert.equal(exchangeCount, 1);
  assert((await callback.locator('body').innerText()).includes('login already in progress'));
  check('duplicate callback is answered without a second exchange request');
  await heldRoute.fulfill({contentType: 'application/json', body: JSON.stringify({token})});
  heldRoute = null;
  await poll(async () => (await state()).auth.present, true);
  await poll(async () => (await state()).catalog?.models?.length, 1);
  assert.equal(exchangeCount, 1);
  assert((await state()).events.some(e => e.event === 'code_exchange_succeeded' && e.status === 200 && e.field === 'token'));
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('로그인 후 첫 메시지');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(chatCount, 1);
  assert((await state()).auth.verifiedAt);
  assert.equal((await state()).chat.messages.at(-1).usage.total_tokens, 120);
  await ui.screenshot({path: resolve('verification/exchange-chat-panel.png'), fullPage: true});
  check('returned token authenticates automatic model retrieval and the first streaming chat with usage');
  await ui.reload();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal((await state()).auth.present, true);
  await cleanStorage();
  await poll(() => callback.isClosed(), true);
  check('chat and login survive UI re-entry, secrets stay out of diagnostics and the callback tab closes');

  for (const [variant, error] of [['rejected', 'exchange_rejected'], ['invalid', 'exchange_invalid_response']]) {
    await rpc('LOGOUT'); mode = variant;
    const before = exchangeCount;
    await rpc('START_LOGIN');
    await poll(async () => (await state()).report.stage, error);
    assert.equal((await state()).auth.present, false);
    assert.equal((await state()).pending, null);
    assert.equal(exchangeCount, before + 1);
    await cleanStorage();
    check(`${variant} exchange response never authenticates and returns to retryable login`);
  }
  mode = 'hold';
  await rpc('START_LOGIN');
  await poll(() => Boolean(heldRoute), true);
  await rpc('CANCEL_LOGIN');
  assert.equal((await state()).auth.present, false);
  assert.equal((await state()).pending, null);
  await heldRoute.fulfill({contentType: 'application/json', body: JSON.stringify({token})}).catch(() => {});
  heldRoute = null;
  await cleanStorage();
  check('cancelling during exchange removes the pending attempt and rejects a late success');
  const before = exchangeCount;
  mode = 'jwt';
  await rpc('START_LOGIN');
  await poll(async () => (await state()).auth.present, true);
  assert.equal(exchangeCount, before);
  assert((await state()).events.some(e => e.event === 'credential_received' && e.transport === 'http'));
  check('legacy explicit JWT callbacks still succeed without code exchange');
  assert.deepEqual(errors, []);
  await mkdir('verification', {recursive: true});
  await writeFile('verification/redirect-probe-results.json', JSON.stringify({synthetic: true, realAiProVerified: false,
    extensionVersion: await ui.evaluate(() => chrome.runtime.getManifest().version), loopbackServerStarted: false, assertions}, null, 2) + '\n');
} finally {
  await heldRoute?.abort().catch(() => {});
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}

import {completionIntentReply, completionIntentResponse} from './fixtures/completion-intent.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, cp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {chatgptToken, responsesSSE} from './fixtures/chatgpt.mjs';

// Real installed extension, API/SSE fixtures only. Never uses a real account.
const profile = await mkdtemp(resolve(tmpdir(), 'aipro-usage-'));
const extension = resolve(profile, 'extension'), output = resolve('verification');
const token = chatgptToken(), checks = [], errors = [];
let context, ui, finishAipro, quotaCalls = 0, quotaMode = 'normal', chatMode = 'normal';
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const rpc = (type, values = {}) => ui.evaluate(async ({type, values}) => chrome.runtime.sendMessage({type, ...values}), {type, values});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {
  let actual;
  for (let i = 0; i < 240; i++) {actual = await fn(); if (actual === expected) return; await new Promise(resolve => setTimeout(resolve, 50));}
  assert.equal(actual, expected);
}
async function send(text) {
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text);
  await ui.getByRole('button', {name: '전송', exact: true}).click();
}
const usageButton = () => ui.getByRole('button', {name: '사용량', exact: true});
const dialog = () => ui.getByRole('dialog', {name: '사용량', exact: true});
async function closePanel() {await ui.keyboard.press('Escape'); await dialog().waitFor({state: 'hidden'});}
try {
  await mkdir(output, {recursive: true});
  await cp(resolve('dist'), extension, {recursive: true});
  // Grant only the disposable fixture copy so the current agent send flow
  // does not wait for a native site-permission prompt in headless Chrome.
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', context_length: 524288, max_input_tokens: 460800}]})}));
  await context.route('https://chatgpt.com/**', route => {
    const request = route.request();
    assert.equal(request.headers().authorization, `Bearer ${token}`);
    assert.equal(request.headers()['chatgpt-account-id'], 'synthetic-account');
    assert.equal(request.headers().cookie, undefined);
    if (request.url().endsWith('/wham/usage')) {
      quotaCalls++; assert.equal(request.method(), 'GET');
      if (quotaMode === 'forbidden') return route.fulfill({status: 403, body: 'private-quota-response'});
      return route.fulfill({contentType: 'application/json', body: JSON.stringify({email: 'private-fixture@example.invalid', rate_limit: {
        primary_window: {used_percent: quotaMode === 'missing' ? null : 25, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 7200},
        secondary_window: {used_percent: 60, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 604800},
      }})});
    }
    assert(request.url().endsWith('/codex/responses'));
    const intent = completionIntentReply(request.postDataJSON()); if (intent) return route.fulfill({contentType:'text/event-stream',body:responsesSSE({text:intent,usage:null})});
    const options = chatMode === 'missing' ? {usage: null} : chatMode === 'zero' ? {usage: {input_tokens: 0, output_tokens: 0, total_tokens: 0}} : {};
    return route.fulfill({contentType: 'text/event-stream', body: responsesSSE(options)});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 11}}), token);
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  // Intercept the upstream request, not window.fetch: the current harness
  // runs in the extension worker and survives the chat page's lifecycle.
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', route => {
    const intent = completionIntentResponse(route.request().postDataJSON());
    if (intent) return route.fulfill({json:intent});
    return new Promise(resolve => {
      finishAipro = async usage => {
        const frames = [{choices:[{delta:{content:'사용량 테스트 응답'},finish_reason:'stop'}]}];
        if (usage) frames.push({choices:[],usage},{choices:[],usage});
        const body = frames.map(frame=>`data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n';
        finishAipro = null;
        await route.fulfill({contentType:'text/event-stream',body}); resolve();
      };
    });
  });
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async () => (await state()).catalog?.models?.length, 1);
  await send('실측 토큰'); await poll(async () => !!finishAipro, true);
  await finishAipro({prompt_tokens: 250, completion_tokens: 50, total_tokens: 300, prompt_tokens_details: {cached_tokens: 100}, completion_tokens_details: {reasoning_tokens: 20}});
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  await poll(async () => (await state()).usage.total.aipro.total, 300);
  // Each turn has one answer call and one completion-intent call without usage.
  assert.equal((await state()).usage.total.aipro.calls, 2);
  await send('사용량 없는 응답'); await poll(async () => !!finishAipro, true);
  await finishAipro(null);
  await poll(async () => (await state()).usage.total.aipro.calls, 4);
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  await send('새로고침 후 이어가기'); await poll(async () => !!finishAipro, true);
  await poll(async () => (await state()).usage.total.aipro.pending, 1);
  await ui.reload();
  assert.equal((await state()).usage.total.aipro.pending, 1);
  await finishAipro(null);
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  await poll(async () => (await state()).usage.total.aipro.pending, 0);
  assert.equal((await state()).usage.total.aipro.calls, 6);
  assert.equal((await state()).usage.total.aipro.measured, 1);
  check('AI Pro repeated usage frames count once; missing usage stays unmeasured and worker requests survive page reload');
  await rpc('CLEAR_CHAT'); await rpc('LOGOUT');
  assert.equal((await state()).usage.total.aipro.total, 300);
  await worker.evaluate(token => chrome.storage.session.set({providerSessions: {chatgpt: {credential: {provider: 'chatgpt', mode: 'browser', token, expiresAt: Date.now() + 3600000, receivedAt: 22}}}}), token);
  const switched = await rpc('SELECT_PROVIDER', {provider: 'chatgpt'});
  assert.equal(switched.ok, true, switched.error);
  await poll(async () => !!(await state()).catalog?.models?.length, true);
  for (const mode of ['normal', 'zero', 'missing']) {
    chatMode = mode; const count = (await state()).usage.total.chatgpt.calls;
    await send(`ChatGPT ${mode}`);
    await poll(async () => (await state()).usage.total.chatgpt.calls, count + 2);
    await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  }
  assert.equal((await state()).usage.total.chatgpt.total, 140);
  assert.equal((await state()).usage.total.chatgpt.measured, 2);
  assert.equal((await state()).usage.total.chatgpt.cached, 40);
  assert.equal((await state()).usage.total.aipro.total, 300);
  check('provider totals survive clear and logout; real zero and absent ChatGPT usage remain distinct');
  assert.equal(await usageButton().innerText(), '');
  await usageButton().click();
  await poll(() => quotaCalls, 1);
  await dialog().getByText('75% 남음', {exact: true}).waitFor();
  await dialog().getByText('40% 남음', {exact: true}).waitFor();
  assert.equal(await dialog().getByRole('meter', {name: '5시간 잔여 한도'}).getAttribute('aria-valuenow'), '75');
  await dialog().getByRole('heading', {name: 'ChatGPT 잔여 한도'}).waitFor();
  await dialog().getByText('AI Pro', {exact: true}).click();
  await dialog().getByText('5회 미집계', {exact: true}).waitFor();
  await dialog().getByRole('tab', {name: '전체', exact: true}).click();
  const panel = dialog().getByRole('tabpanel');
  assert.equal(await panel.getAttribute('aria-labelledby'), await dialog().getByRole('tab', {name: '전체', exact: true}).getAttribute('id'));
  for (const [width, height, suffix] of [[360, 900, 'panel'], [1100, 900, 'desktop']]) {
    await ui.setViewportSize({width, height}); await ui.evaluate(() => document.fonts.ready);
    assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const metrics = await dialog().evaluate(root => {
      const font = selector => {const style = getComputedStyle(root.querySelector(selector)); return {family: style.fontFamily, size: style.fontSize};};
      return {caption: font('.usage-metadata'), detail: font('.usage-provider-detail .usage-caption'), value: font('.usage-total strong'), body: font('.usage-provider h3'), overflow: root.scrollWidth > root.clientWidth};
    });
    assert.equal(metrics.overflow, false); assert.equal(metrics.caption.size, '12px'); assert.equal(metrics.detail.size, '14px'); assert.equal(metrics.body.size, '14px'); assert.equal(metrics.value.size, '14px');
    assert(metrics.body.family.includes('Noto Sans KR'));
    await ui.screenshot({path: resolve(output, `usage-${suffix}.png`), fullPage: true});
  }
  await closePanel(); assert(await usageButton().evaluate(element => element === document.activeElement));
  await usageButton().click(); await dialog().waitFor();
  assert.equal(quotaCalls, 1);
  check('CX icon-only usage opens readable 360px/desktop totals and account limits with cached refresh, tab labels and focus return');
  quotaMode = 'forbidden'; await dialog().getByRole('button', {name: '계정 한도 새로고침', exact: true}).click();
  await poll(async () => (await state()).accountUsage?.error, 'quota_unauthorized');
  await dialog().getByText('조회 실패. 이전 결과입니다.', {exact: true}).waitFor();
  assert.equal((await state()).auth.rejected, false);
  assert(!(await dialog().innerText()).includes('private-quota-response'));
  quotaMode = 'missing'; await dialog().getByRole('button', {name: '계정 한도 새로고침', exact: true}).click();
  await dialog().getByText('미제공', {exact: true}).waitFor();
  assert.equal(await dialog().getByRole('meter').count(), 1);
  quotaMode = 'normal'; await dialog().getByRole('button', {name: '계정 한도 새로고침', exact: true}).click();
  await dialog().getByText('75% 남음', {exact: true}).waitFor();
  check('quota failure preserves stale values without rejecting login; unknown remaining quota is never shown as 100%');
  await closePanel(); await ui.reload(); await usageButton().click();
  await dialog().getByText('75% 남음', {exact: true}).waitFor(); assert.equal(quotaCalls, 4);
  await closePanel(); chatMode = 'normal'; await send('한도 오류 이후 정상 채팅');
  await poll(async () => (await state()).usage.total.chatgpt.total, 280);
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  const storage = await ui.evaluate(async () => ({local: await chrome.storage.local.get(null), session: await chrome.storage.session.get('accountUsage')}));
  assert(!JSON.stringify(storage).includes('private-fixture@example.invalid')); assert(!JSON.stringify(storage.local).includes(token));
  assert.deepEqual(errors, []);
  check('quota cache and token totals survive re-entry; chat still works and aggregate storage excludes credentials and account identity');
  await writeFile(resolve(output, 'usage-browser.json'), JSON.stringify({version:manifest.version, checks, syntheticUpstreams: true, actualAccountsVerified: false, pageErrors: errors}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

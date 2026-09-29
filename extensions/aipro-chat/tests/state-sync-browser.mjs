import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {completionIntentResponse} from './fixtures/completion-intent.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-state-sync-')), extension = resolve(profile, 'extension');
let context, inference = 0;
const errors = [], checks = [];
async function until(test) {for (let i = 0; i < 300; i++) {if (await test()) return; await new Promise(resolve => setTimeout(resolve, 40));} assert.fail('Expected state not reached');}
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.addInitScript(() => {
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    const raw = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.statusTest = {fail: location.hash === '#status-failed', reads: 0, mutations: [], raw};
    chrome.runtime.sendMessage = async (message, ...rest) => {
      if (message.type === 'GET_STATE') {statusTest.reads++; if (statusTest.fail) throw new Error('Synthetic state read failure');}
      if (['START_AGENT', 'START_CHAT', 'RUN_TOOL', 'APPLY_FILL', 'FINISH_CHAT', 'CANCEL_BROWSER'].includes(message.type)) statusTest.mutations.push(message.type);
      return raw(message, ...rest);
    };
  });
  await context.route('https://aipro.sdsdev.co.kr/**', route => {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144}]}});
    inference++;
    const review = completionIntentResponse(route.request().postDataJSON());
    if (review) return route.fulfill({json: review});
    return route.fulfill({json: {choices: [{message: {content: '보관된 답변입니다.'}, finish_reason: 'stop'}], usage: {prompt_tokens: 30, completion_tokens: 5, total_tokens: 35}}});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 23}}));
  const url = `chrome-extension://${new URL(worker.url()).hostname}/index.html`, ui = await context.newPage();
  await ui.goto(url); await ui.setViewportSize({width: 360, height: 800});
  const read = () => ui.evaluate(async () => (await statusTest.raw({type: 'GET_STATE'})).data);
  await until(async () => (await read()).catalog?.models?.length === 1);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('안녕하세요.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await ui.getByText('보관된 답변입니다.', {exact: true}).waitFor();
  await until(async () => (await read()).chat.messages.at(-1)?.state === 'done');
  await ui.waitForTimeout(300);
  const mutations = await ui.evaluate(() => [...statusTest.mutations]), requests = inference;
  await ui.evaluate(() => {statusTest.fail = true; statusTest.reads = 0;});
  await worker.evaluate(() => chrome.storage.local.set({statusTestMarker: 1}));
  await ui.getByText('진행 상태를 확인할 수 없습니다.', {exact: true}).waitFor();
  assert.equal(await ui.evaluate(() => statusTest.reads), 3);
  await ui.getByText('보관된 답변입니다.', {exact: true}).waitFor();
  await ui.clock.install();
  for (let i = 0; i < 5; i++) await worker.evaluate(i => chrome.storage.local.set({statusTestMarker: i + 2}), i);
  await ui.clock.runFor(120000);
  assert.equal(await ui.evaluate(() => statusTest.reads), 3, 'Timers and storage events cannot restart exhausted reads');
  assert.deepEqual(await ui.evaluate(() => statusTest.mutations), mutations); assert.equal(inference, requests);
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir('verification', {recursive: true});
  await ui.screenshot({path: resolve('verification/state-recovery-panel.png'), fullPage: true});
  checks.push('Three failed status reads stop automatic retries and retain the last reply', 'Storage changes and two minutes of timer ticks cannot restart an exhausted query or Agent actions');
  await ui.setViewportSize({width: 1100, height: 850});
  await ui.screenshot({path: resolve('verification/state-recovery-desktop.png'), fullPage: true});
  await ui.evaluate(() => {statusTest.fail = false;});
  await ui.getByRole('button', {name: '진행 상태 다시 확인', exact: true}).click();
  await ui.getByText('진행 상태를 확인할 수 없습니다.', {exact: true}).waitFor({state: 'hidden'});
  assert.deepEqual(await ui.evaluate(() => statusTest.mutations), mutations); assert.equal(inference, requests);
  await ui.getByText('보관된 답변입니다.', {exact: true}).waitFor();
  checks.push('Icon-only reconnect reads saved state without another model call, click or chat request');
  const first = await context.newPage(); await first.goto(url + '#status-failed'); await first.setViewportSize({width: 360, height: 800});
  await first.getByText('화면을 불러오지 못했습니다.', {exact: true}).waitFor();
  assert.equal(await first.evaluate(() => statusTest.reads), 3);
  assert.equal(await first.locator('.status-spinner.loading').count(), 0);
  await first.evaluate(() => {statusTest.fail = false;});
  await first.getByRole('button', {name: '진행 상태 다시 확인', exact: true}).click();
  await first.getByText('보관된 답변입니다.', {exact: true}).waitFor();
  assert.deepEqual(await first.evaluate(() => statusTest.mutations), []); assert.equal(inference, requests);
  checks.push('Initial loading failure becomes a persistent recovery control and reconnect restores history');
  assert.deepEqual(errors, []);
  await writeFile('verification/state-sync-browser.json', JSON.stringify({checks, errors, realChrome: true, syntheticInference: true, actualProvider: false}, null, 2));
  checks.forEach(text => console.log(`PASS ${text}`));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

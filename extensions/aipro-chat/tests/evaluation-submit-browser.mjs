import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, rm, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {evaluationComposer, prepareEvaluationTrial, submitEvaluationTask, waitForEvaluationUI} from '../scripts/evaluation-reset.mjs';
import {completionIntentResponse} from './fixtures/completion-intent.mjs';

// Real packaged App and Chrome with synthetic provider responses. No live
// account, evaluation profile, force click or replay is used by this fixture.
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-evaluation-submit-'));
const extension = resolve(profile, 'extension');
let context;
const checks = [];
async function until(test) {
  for (let i = 0; i < 150; i++) {if (await test()) return; await new Promise(done => setTimeout(done, 40));}
  assert.fail('Expected fixture state not reached');
}
try {
  await cp(resolve('dist'), extension, {recursive: true});
  // The isolated transport fixture pregrants the same declared optional page
  // origins as the other App fixtures. Native permission prompts are a separate
  // test boundary and cannot be answered by a headless acknowledgement test.
  const manifestPath = resolve(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...manifest.host_permissions, 'http://*/*', 'https://*/*'])];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  await context.addInitScript(() => {
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    const raw = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.submitProbe = {raw, holdState: false, holdDraft: false, blockedState: 0, blockedDraft: 0, starts: 0};
    chrome.runtime.sendMessage = async (message, ...rest) => {
      if (message.type === 'GET_STATE' && submitProbe.holdState) {
        submitProbe.blockedState++;
        while (submitProbe.holdState) await new Promise(done => setTimeout(done, 20));
      }
      if (message.type === 'DRAFT' && submitProbe.holdDraft) {
        submitProbe.blockedDraft++;
        while (submitProbe.holdDraft) await new Promise(done => setTimeout(done, 20));
      }
      if (message.type === 'START_AGENT') submitProbe.starts++;
      return raw(message, ...rest);
    };
  });
  await context.route('https://aipro.sdsdev.co.kr/**', route => {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144}]}});
    const review = completionIntentResponse(route.request().postDataJSON());
    return route.fulfill({json: review || {choices: [{message: {content: '합성 전송 확인입니다.'}, finish_reason: 'stop'}]}});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({origins: ['http://*/*', 'https://*/*']})), true, 'Synthetic App transport fixture requires its isolated page permissions before sending');
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 23}}));
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const rpc = message => ui.evaluate(message => submitProbe.raw(message), message);
  const state = async () => (await rpc({type: 'GET_STATE'})).data;
  const wait = ms => ui.waitForTimeout(ms), composer = evaluationComposer(ui);
  await until(async () => (await state()).catalog?.models?.length === 1);
  const previous = (await state()).chat.sessionId;
  await waitForEvaluationUI({composer, state, sessionId: previous, wait});
  await ui.evaluate(() => {submitProbe.holdState = true;});
  let resetFinished = false;
  const pendingReset = prepareEvaluationTrial({state, rpc, wait,
    waitForUI: sessionId => waitForEvaluationUI({composer, state, sessionId, wait})}).then(value => {resetFinished = true; return value;});
  await until(async () => (await state()).chat.sessionId !== previous && await ui.evaluate(() => submitProbe.blockedState > 0));
  assert.equal((await composer.inspect()).conversationId, previous, 'The actual rendered App must still show the old conversation while state reads are delayed');
  assert.equal(resetFinished, false);
  assert.equal((await composer.inspect()).inputValue, '');
  await ui.evaluate(() => {submitProbe.holdState = false;});
  const reset = await pendingReset;
  assert.equal((await composer.inspect()).conversationId, reset.chat.sessionId);
  checks.push('NEW_CHAT waits for the delayed real App session attribute before any input');

  await ui.evaluate(() => {submitProbe.holdDraft = true;});
  const text = '안녕하세요. 합성 전송 확인만 해 주세요.';
  const pendingSubmission = submitEvaluationTask({composer, state, sessionId: reset.chat.sessionId, text, wait});
  await until(() => ui.evaluate(() => submitProbe.blockedDraft > 0));
  assert.equal((await composer.inspect()).inputValue, text);
  assert.notEqual((await state()).chat.draft, text);
  assert.equal(await ui.evaluate(() => submitProbe.starts), 0, 'Visible input without its matching persisted draft cannot send');
  await ui.evaluate(() => {submitProbe.holdDraft = false;});
  const receipt = await pendingSubmission;
  assert.equal(receipt.acknowledged, true); assert.equal(receipt.clickAttempts, 1);
  assert.equal(await ui.evaluate(() => submitProbe.starts), 1);
  const accepted = await state();
  assert.equal(accepted.chat.sessionId, reset.chat.sessionId);
  assert.equal(accepted.chat.messages.filter(item => item.role === 'user' && item.content === text).length, 1);
  assert(accepted.chat.messages.some(item => item.role === 'assistant' && item.id === receipt.requestId));
  checks.push('Delayed real draft persistence blocks sending, then one normal UI click receives a same-session user and assistant acknowledgement');
  await until(async () => !(await state()).busy);
  await mkdir('verification/browser-30', {recursive: true});
  await writeFile('verification/browser-30/evaluation-submit-browser.json', JSON.stringify({checks, actualBrowser: true, actualApp: true,
    actualModel: false, syntheticProvider: true, isolatedPagePermissionsPregranted: true, sendAttempts: 1, acknowledged: receipt.acknowledged}, null, 2));
  checks.forEach(check => console.log(`PASS ${check}`));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

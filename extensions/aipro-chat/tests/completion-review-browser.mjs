import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {inspectEvaluationTarget, inspectEvaluationPage, sameEvaluationState} from '../scripts/evaluation-target.mjs';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const report = {actualBrowser: true, syntheticSite: true, actualModel: false, cases: []};
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-completion-')), extension = resolve(profile, 'extension');
const server = createServer((_req, res) => {
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  res.end('<!doctype html><meta charset="utf-8"><title>평가용 초안</title><label>본문<textarea id="body" oninput="writes++"></textarea></label><a href="/child" target="_blank">다음 화면</a><button onclick="submits++">등록</button><output>초안 화면</output><script>window.writes=0;window.titleWrites=0;window.submits=0</script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const work = {decision: 'work', scope: 'browser', next_step: '현재 페이지 본문에 요청한 초안을 입력하고 확인하세요.'};
const reply = {decision: 'reply', scope: 'conversation', next_step: ''};
const claim = '본문을 모두 입력하고 등록까지 완료했습니다.';
const completion = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}});
const ref = (result, name) => (result.observation || result).frames.flatMap(frame => frame.elements || []).find(element => element.name === name).ref;
let context, worker, ui, routeError, scenario, turn = 0, intentCalls = 0, goalReviews = 0, sourceTabId;
const errors = [];
async function until(check) {
  for (let i = 0; i < 700; i++) {if (routeError) throw routeError; if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50));}
  throw new Error('Completion regression timed out');
}
try {
  await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY || chromium.executablePath(),
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  context.setDefaultTimeout(15000);
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', async route => {
    try {
      const body = route.request().postDataJSON(), plan = planCompletion(body), review = goalReviewPayload(body.messages);
      if (plan) return route.fulfill({json: plan});
      if (review) {goalReviews++; return route.fulfill({json: reviewCompletion(review)});}
      if (body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT)) {
        intentCalls++;
        assert.equal(body.model, 'QWEN3.8-27B-FP8-256K'); if(scenario==='invalid'&&intentCalls===2)assert.deepEqual(body.tools.map(t=>t.function.name),['report_completion_intent']);else assert(!body.tools?.length);
        assert(!(await ui.locator('main').innerText()).includes(claim), 'Unverified candidate flashed in chat');
        const response = scenario === 'conversation' ? reply : scenario === 'question' ?
          {decision: 'question', scope: 'browser', next_step: '어떤 내용으로 본문을 작성할까요?', question: {question: '어떤 내용으로 본문을 작성할까요?', input_mode: 'long_text'}} : work;
        return route.fulfill({json: completion(null, {}, scenario === 'invalid' ? 'not JSON' : JSON.stringify(response))});
      }
      if (scenario === 'conversation') return route.fulfill({json: completion(null, {}, '안녕하세요!')});
      if (scenario === 'repeat' && body.tools?.length === 1 && body.tools[0].function.name === 'ask_user') return route.fulfill({json: completion('ask_user', {question: '어느 페이지의 본문을 편집할까요?'})});
      if (['repeat', 'question', 'invalid'].includes(scenario) || scenario === 'repair' && turn++ === 0) return route.fulfill({json: completion(null, {}, claim)});
      const resultText = body.messages.findLast(message => message.role === 'tool')?.content;
      const result = resultText ? JSON.parse(resultText) : null;
      const lastCall = body.messages.findLast(message => message.role === 'assistant' && message.tool_calls)?.tool_calls.at(-1).function.name;
      let response;
      if (!lastCall) response = completion('browser_snapshot');
      else if (lastCall === 'browser_snapshot' && scenario === 'popup') response = completion('click_element', {ref: ref(result, '다음 화면')});
      else if (['browser_snapshot', 'click_element'].includes(lastCall)) {
        assert(!result.error, JSON.stringify(result));
        response = completion('fill_form', {fields: [{field_id: ref(result, '본문'), value: '평가용 초안'}]});
      } else if (lastCall === 'fill_form') response = completion('verify_page', {checks: [{kind: 'field_value', ref: ref(result, '본문'), expected: '평가용 초안'}]});
      else {assert.equal(lastCall, 'verify_page'); assert.equal(result.verified, true); response = completion(null, {}, '초안을 입력하고 확인했습니다.');}
      await route.fulfill({json: response});
    } catch (error) {routeError = error; await route.abort();}
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source = await context.newPage(); await source.goto(origin + '/source');
  sourceTabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, source.url());
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button', {name: 'AI Pro', exact: true}).waitFor();
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 123}}));
  const rpc = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  const state = async () => (await rpc({type: 'GET_STATE'})).data;
  await until(async () => (await state()).catalog?.models?.length === 1);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  for (const [name, mode] of [['repair', 'window'], ['conversation', 'window'], ['question', 'window'], ['repeat', 'window'], ['invalid', 'window'], ['direct', 'current'], ['popup', 'window']]) {
    scenario = name; turn = 0; intentCalls = 0; goalReviews = 0;
    await rpc({type: 'NEW_CHAT'}); await ui.locator('article.message').first().waitFor({state: 'hidden'}); await source.reload();
    await worker.evaluate(async ({uiId, sourceTabId, mode}) => {
      await chrome.storage.local.set({browserWorkMode: mode});
      await chrome.storage.session.set({chatSourceTabs: {[uiId]: sourceTabId}});
    }, {uiId, sourceTabId, mode});
    await ui.reload(); await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
    const before = await inspectEvaluationPage(worker, {tabId: sourceTabId}, origin);
    const goal = name === 'conversation' ? '안녕' : name === 'question' ? '본문을 작성해줘' : name === 'popup' ? '다음 화면을 열고 본문에 평가용 초안을 입력해줘. 등록하지 마.' : '현재 페이지 본문에 평가용 초안을 입력해줘. 등록하지 마.';
    await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(goal); await ui.getByRole('button', {name: '전송', exact: true}).click();
    await until(async () => {const current = await state(); return !current.busy && current.chat.messages.at(-1)?.role === 'assistant' && ['done', 'error'].includes(current.chat.messages.at(-1)?.state);});
    const current = await state(), message = current.chat.messages.at(-1);
    const {target, observed} = await inspectEvaluationTarget(worker, {conversationId: current.chat.sessionId, sourceTabId, mode, origin});
    const after = await inspectEvaluationPage(worker, {tabId: sourceTabId}, origin);
    if (mode === 'window') assert(sameEvaluationState(before, after), 'Original source changed');
    assert(!message.content.includes(claim)); assert.equal(observed.submits, 0);
    if (['repair', 'direct', 'popup'].includes(name)) {
      assert.equal(message.state, 'done'); assert.equal(observed.body, '평가용 초안'); assert.equal(observed.writes, 1);
      assert.equal(current.chat.task.goalReview.status, 'complete'); assert(target.observed);
      assert.equal(target.kind, mode === 'window' ? 'workspace' : 'current'); assert(goalReviews > 0);
      assert.equal(intentCalls, name === 'repair' ? 1 : 0);
      if (name === 'popup') assert.equal(new URL(observed.url).pathname, '/child');
    } else {
      assert.equal(observed.writes, 0); assert.equal(goalReviews, 0); assert.equal(target.observed, false);
      if (name === 'conversation') {assert.equal(message.content, '안녕하세요!'); assert.equal(current.chat.task?.plan?.length || 0, 0); assert.equal(intentCalls, 1);}
      else if (name === 'invalid') {
        assert.equal(message.state,'done');assert.equal(current.chat.task.status,'awaiting_user');assert(message.question);assert.equal(intentCalls,2);
        await ui.reload();await until(async()=>!(await state()).busy);
        assert.equal((await state()).chat.task.status,'awaiting_user');assert((await state()).chat.messages.at(-1).question);
        assert.equal(intentCalls,2);
        await ui.emulateMedia({reducedMotion:'reduce'});
        await ui.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
        await ui.screenshot({path:'verification/review-recovery-question.png',animations:'disabled'});
      }
      else {assert.equal(current.chat.task.status, 'awaiting_user'); assert(message.question); assert.equal(intentCalls, name === 'repeat' ? 2 : 1);}
    }
    report.cases.push({id: name, mode, passed: true, intentCalls, goalReviews, target, observed, sourcePreserved: mode === 'window' ? sameEvaluationState(before, after) : null});
    console.log('PASS ' + name);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify({scenario, turn, intentCalls, goalReviews, routeError: routeError?.message,
    state: await ui?.evaluate(async () => {const {data} = await chrome.runtime.sendMessage({type: 'GET_STATE'}); return {busy: data.busy, task: data.chat.task, last: data.chat.messages.at(-1)};}).catch(() => null)}));
  throw error;
} finally {
  report.errors = errors;
  await writeFile('verification/completion-review-browser.json', JSON.stringify(report, null, 2));
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive: true, force: true});
}

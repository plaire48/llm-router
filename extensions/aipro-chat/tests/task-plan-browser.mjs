import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {PLAN_PROMPT} from '../task-plan.js';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-task-plan-')), extension = resolve(profile, 'extension');
const labels = ['작성 화면 확인', '교육 안내 초안 작성', '입력 결과 확인'];
const steps = active => labels.map((text, index) => ({text, status: index < active ? 'completed' : index === active ? 'in_progress' : 'pending'}));
// A new plan must give every step an acceptance condition (src/api.js requires expected_outcome).
const outcomes = ['제목 입력란이 있는 작성 화면 확인', '제목 입력란에 요청한 제목이 반영됨', '입력 결과가 화면에 표시되고 등록하지 않음'];
const initialSteps = () => steps(0).map((step, index) => ({...step, expected_outcome: outcomes[index]}));
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const reply = (calls, content = '') => ({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}]});
const checks = [], errors = []; let context, ui, target, worker, failure, mode = 'work', round = 0, held, reviewHeld;
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const check = text => {checks.push(text); console.log('PASS ' + text);};
async function poll(read, expected) {let actual; for (let i = 0; i < 500; i++) {if (failure) throw failure; actual = await read(); if (actual === expected) return; await new Promise(resolve => setTimeout(resolve, 40));} assert.equal(actual, expected);}
async function send(text) {await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text); await ui.getByRole('button', {name: '전송', exact: true}).click();}
const plan = () => ui.locator('.message-assistant').last().getByRole('region', {name: '작업 계획'});
async function next() {const release = held; held = null; release();}
try {
  await mkdir('verification', {recursive: true});
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY, recordVideo: {dir: resolve('verification/task-plan-video'), size: {width: 1100, height: 850}},
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://plan.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>교육 안내</title><h1>교육 안내 초안</h1><label>제목<input></label><output>작성 중</output><script>window.writes=0;document.querySelector("input").oninput=()=>{writes++;document.querySelector("output").textContent="초안 반영됨"}</script>'}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2', context_length: 524288}]}});
    const body = route.request().postDataJSON();
    if (body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT)) {
      assert.equal(mode, 'chat');
      return route.fulfill({json: reply(null, JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''}))});
    }
    if (body.messages[0].content.startsWith(PLAN_PROMPT)) {
      assert.equal(await target.evaluate(() => writes), mode === 'work' ? 0 : 1);
      assert.deepEqual(body.tools.map(tool => tool.function.name).sort(), ['ask_user', 'update_plan']);
      return route.fulfill({json: reply([call('update_plan', {steps: initialSteps()})])});
    }
    const review = goalReviewPayload(body.messages);
    if (review) {if(review.phase!=='plan_step')await new Promise(resolve => {reviewHeld = resolve;}); return route.fulfill({json: reviewCompletion(review)});}
    if (mode === 'chat') return route.fulfill({json: reply(null, '네, 다음 작업도 도와드릴게요.')});
    const result = body.messages.findLast(message => message.role === 'tool');
    const output = result && JSON.parse(result.content);
    round++;
    if (round === 1) return route.fulfill({json: reply([call('read_page', {progress: '교육 안내 읽기'})], '작성 화면의 입력란부터 확인하겠습니다.')}); // Deliberately omit the plan.
    await new Promise(resolve => {held = resolve;});
    if (mode === 'question') return route.fulfill({json: reply([call('ask_user', {question: '어느 팀의 초안을 작성할까요?', choices: [{label: '개발팀'}, {label: '디자인팀'}]})])});
    const ref = (output.observation || output).frames?.flatMap(frame => frame.elements || []).find(element => element.name === '제목')?.ref;
    if (round === 2) {labels[2]='제목과 반영 상태 확인';return route.fulfill({json: reply([call('update_plan', {steps: steps(1), explanation:'화면에 반영 상태가 표시되어 제목과 함께 확인합니다.'}), call('fill_form', {fields: [{field_id: ref, value: '10월 교육 안내'}], progress: '교육 안내 제목 입력'})], '제목 입력란을 확인했습니다. 초안을 반영하겠습니다.')});}
    if (round === 3) return route.fulfill({json: reply([call('update_plan', {steps: steps(2)}), call('verify_page', {checks: [{kind: 'field_value', ref, expected: '10월 교육 안내'}, {kind: 'text_present', expected: '초안 반영됨'}], progress: '변경한 제목 검증'})], '입력한 제목과 화면의 반영 결과를 확인하겠습니다.')});
    if (round === 4) {
      assert.equal(output.verified, true);
      assert(body.messages.some(message => message.role === 'tool' && JSON.parse(message.content).reason === 'verification_required'));
      assert.match(body.messages[0].content, /Compare the actual input and output/);
      return route.fulfill({json: reply([call('update_plan', {steps: steps(2)})], '제목과 반영 안내를 확인했습니다. 요청한 내용과 마지막으로 비교하겠습니다.')});
    }
    assert.equal(round, 5);
    return route.fulfill({json: reply(null, '교육 안내 제목을 입력하고 반영된 내용을 확인했습니다.')});
  } catch (error) {failure = error; await route.fulfill({status: 500, body: 'Fixture assertion failed'});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This fixture asserts the original tab; owned-window behavior has dedicated suites.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current', debugMode: true}));
  await worker.evaluate(() => {
    globalThis.planChecks = [];
    const execute = chrome.scripting.executeScript.bind(chrome.scripting);
    chrome.scripting.executeScript = async (...args) => {
      const {chat} = await chrome.storage.local.get('chat');
      planChecks.push(!!chat.messages.at(-1)?.progress?.plan?.length);
      if (!globalThis.firstReadStarted) {globalThis.firstReadStarted = true; await new Promise(resolve => {globalThis.releasePageRead = resolve;});}
      return execute(...args);
    };
  });
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 19}}));
  target = await context.newPage(); await target.goto('https://plan.example.test/');
  ui = await context.newPage(); await ui.setViewportSize({width: 360, height: 800});
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  await poll(async () => (await state()).catalog?.models?.length, 1);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiId => {const page = (await chrome.tabs.query({})).find(tab => tab.url === 'https://plan.example.test/'); await chrome.storage.session.set({chatSourceTabs: {[uiId]: page.id}});}, uiId);
  await send('교육 안내 제목에 10월 교육 안내를 입력하고 반영됐는지 확인해줘. 등록하지 마.');
  await poll(() => worker.evaluate(() => typeof releasePageRead === 'function'), true);
  // The host also records its own source capture as a read_page row ('출처 본문 확보').
  const reading = ui.locator('.agent-trace li[data-tool=read_page]').filter({hasText: '교육 안내 읽기'});
  await poll(() => reading.getAttribute('data-status'), 'running');
  assert(await reading.isVisible()); assert.match(await reading.innerText(), /교육 안내 읽기.*중/s);
  await reading.evaluate(element => {window.activeTraceRow = element;});
  await ui.waitForTimeout(450); await ui.screenshot({path: resolve('verification/task-plan-live-reading.png')});
  await worker.evaluate(() => releasePageRead());
  await poll(() => !!held, true); await plan().waitFor();
  // The next model request can start before React consumes the storage event.
  // Assert the actual rendered transition, not the request's timing.
  await poll(() => reading.getAttribute('data-status'), 'done');
  assert.match(await reading.innerText(), /교육 안내 읽기.*완료/s);
  assert(await reading.evaluate(element => element === window.activeTraceRow));
  assert(await ui.getByText('작성 화면의 입력란부터 확인하겠습니다.', {exact: true}).isVisible());
  check('live tool row changes from spinner to completion in place and public progress text remains visible');
  assert.equal(await plan().locator('.task-plan-count').innerText(), '0/3');
  assert.equal((await plan().locator('[aria-current=step]').innerText()).replace(/\s+/g, ' '), '진행 중: 작성 화면 확인');
  const initial = await worker.evaluate(() => planChecks);
  assert(initial.length > 0 && initial.every(Boolean)); assert.equal(await target.evaluate(() => writes), 0);
  check('a missing model plan is generated and durably displayed before the first browser read');
  await ui.waitForTimeout(450); await ui.screenshot({path: resolve('verification/task-plan-start-panel.png')});
  await next(); await poll(() => !!held, true);
  await poll(async () => plan().locator('.task-plan-count').innerText(), '1/3');
  assert.equal(await target.getByLabel('제목').inputValue(), '10월 교육 안내');
  assert.equal(await target.evaluate(() => writes), 1);
  assert((await state()).chat.task.steps.find(step => step.tool === 'fill_form').planStep === labels[1]);
  check('plan steps advance before their tools and track actual input without repeating writes');
  await plan().locator('[data-plan-overview] > summary').focus(); await ui.keyboard.press('Enter');
  assert.equal(await plan().locator('[data-plan-overview]').getAttribute('open'), null);
  assert.match(await plan().locator('.task-plan-current').innerText(), /교육 안내 초안 작성/);
  assert.equal(await plan().locator('.task-plan-update-caption').isVisible(),false);
  assert.match(await plan().locator('.task-plan-update > summary').getAttribute('aria-label'), /계획 수정/);
  await plan().locator('.task-plan-update > summary').click();
  assert.equal(await plan().locator('.task-plan-update-caption').innerText(),'화면에 반영 상태가 표시되어 제목과 함께 확인합니다.');
  assert.match(await plan().locator('.task-plan-diff').innerText(), /추가.*제목과 반영 상태 확인.*제외.*입력 결과 확인/s);
  assert.equal(await plan().locator('.task-plan-diff-icon[title="추가"] svg').count(), 1);
  assert.equal(await plan().locator('.task-plan-diff-icon[title="제외"] svg').count(), 1);
  const captionBox = await plan().locator('.task-plan-update-caption').boundingBox(), diffBox = await plan().locator('.task-plan-diff').boundingBox();
  assert(captionBox.y + captionBox.height <= diffBox.y);
  await ui.screenshot({path:resolve('verification/task-plan-revised-panel.png')});
  await plan().locator('.task-plan-context > summary').click();
  const contextText = await plan().locator('.task-plan-context').innerText();
  // The current step keeps the planner's acceptance condition through a status-only update.
  assert.match(contextText, /완료 기준.*제목 입력란에 요청한 제목이 반영됨/s);
  assert.match(contextText, /최근 실행.*교육 안내 제목 입력.*도구 실행 완료/s);
  assert.match(contextText, /다음 계획.*제목과 반영 상태 확인/s);
  await ui.setViewportSize({width: 320, height: 800});
  assert(await plan().evaluate(element => element.scrollWidth <= element.clientWidth));
  await ui.screenshot({path:resolve('verification/task-plan-context-panel.png')});
  await plan().locator('.task-plan-context > summary').click();
  await ui.setViewportSize({width: 360, height: 800});
  check('step details connect the actual tool result and next plan, distinguish missing acceptance criteria, and fit 320px with labelled icons');
  await plan().locator('.task-plan-update > summary').click();
  check('a revised plan exposes its reason, added and removed steps, and current work while the main list stays collapsed');
  await next(); await poll(() => !!held, true);
  assert.equal(await plan().locator('[data-plan-overview]').getAttribute('open'), null);
  await plan().locator('[data-plan-overview] > summary').focus(); await ui.keyboard.press('Enter');
  assert.equal(await plan().locator('.task-plan-count').innerText(), '1/3');
  assert.equal(await ui.locator('.agent-trace [data-status=error]').count(), 0);
  assert.equal(await target.evaluate(() => writes), 1);
  check('a premature completed step stays active until its real check returns to a new model decision');
  await next(); await poll(() => !!held, true);
  await poll(async () => plan().locator('.task-plan-count').innerText(), '2/3');
  // The step added by the executor's revision has no acceptance condition, and the panel says so.
  await plan().locator('.task-plan-context > summary').click();
  assert.match(await plan().locator('.task-plan-context').innerText(), /완료 기준.*구체적인 완료 기준이 아직 없습니다/s);
  await plan().locator('.task-plan-context > summary').click();
  await ui.setViewportSize({width: 1100, height: 850});
  await ui.waitForTimeout(450); await ui.screenshot({path: resolve('verification/task-plan-progress-desktop.png')});
  await next(); await poll(() => !!reviewHeld, true);
  await poll(async () => plan().locator('.task-plan-count').innerText(), '3/3');
  assert.equal(await plan().locator('.task-plan-pause').innerText(), '답변 확인 중');
  assert.equal((await state()).chat.messages.at(-1).state,'pending');
  await ui.setViewportSize({width:320,height:800});
  assert(await plan().evaluate(element=>element.scrollWidth<=element.clientWidth));
  await ui.screenshot({path:resolve('verification/task-plan-final-review-panel.png'),animations:'disabled'});
  await ui.setViewportSize({width:1100,height:850});
  reviewHeld(); reviewHeld = null;
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  await poll(async () => plan().locator('.task-plan-count').innerText(), '3/3');
  assert.equal(await plan().locator('[aria-current=step]').count(), 0);
  await ui.locator('.message-assistant').last().locator('.agent-trace > summary').click();
  await poll(async()=>await ui.locator('.agent-trace-plan').count() >= 2,true);
  check('completion waits for result review and tool records remain grouped by goal step');
  await ui.waitForTimeout(450); await ui.screenshot({path: resolve('verification/task-plan-done-desktop.png')});
  const conversation = (await state()).chat.sessionId;
  mode = 'chat'; await send('고마워'); await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(await plan().count(), 0); assert.equal(await ui.locator('.task-plan-count').first().innerText(), '3/3');
  await ui.reload(); await poll(async () => ui.locator('.task-plan-count').count(), 1);
  await ui.locator('.task-plan-update > summary').first().click();
  assert.equal(await ui.locator('.task-plan-update-caption').first().innerText(),'화면에 반영 상태가 표시되어 제목과 함께 확인합니다.');
  await ui.locator('.task-plan-history > summary').first().click();
  assert.match(await ui.locator('.task-plan-history').first().innerText(), /계획 수정/);
  check('revision reasons and history survive completion, a later reply, and reload');
  await ui.evaluate(async () => chrome.runtime.sendMessage({type: 'NEW_CHAT'}));
  await poll(async () => ui.locator('.task-plan').count(), 0);
  await ui.evaluate(async conversationId => chrome.runtime.sendMessage({type: 'SELECT_CONVERSATION', id: conversationId}), conversation);
  await poll(async () => ui.locator('.task-plan-count').count(), 1);
  check('completed plans survive the next reply, reload, and conversation selection without appearing on ordinary chat');
  mode = 'question'; round = 0;
  await ui.setViewportSize({width: 320, height: 740});
  await send('팀을 먼저 확인해서 다음 초안을 작성해줘.');
  await poll(() => !!held, true); await next();
  await poll(async () => (await state()).chat.task?.status, 'awaiting_user');
  await poll(async () => plan().getAttribute('data-status'), 'awaiting_user');
  assert.equal(await plan().locator('.task-plan-pause').innerText(), '답변 대기');
  assert.equal(await plan().locator('.status-spinner').count(), 0);
  assert.equal(await plan().locator('.task-plan-count').innerText(), '0/3');
  await ui.reload(); await plan().waitFor();
  assert.equal(await plan().locator('.task-plan-count').innerText(), '0/3');
  await ui.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await plan().evaluate(element => getComputedStyle(element).animationName), 'none');
  assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ui.waitForTimeout(450); await ui.screenshot({path: resolve('verification/task-plan-question-panel.png')});
  check('waiting for the user preserves pending steps, stops progress motion, and fits 320px with reduced motion');
  // An interrupted owner uses the same durable plan and never marks it done.
  await ui.evaluate(async () => {
    const {chat} = await chrome.storage.local.get('chat');
    const message = chat.messages.at(-1); message.progress.status = 'paused'; message.state = 'error'; message.error = 'interrupted'; delete message.question;
    chat.task.status = 'paused'; await chrome.storage.local.set({chat});
  });
  await poll(async () => plan().getAttribute('data-status'), 'paused');
  assert.equal(await plan().locator('.task-plan-pause').innerText(), '일시 중단');
  assert.equal(await plan().locator('.task-plan-count').innerText(), '0/3');
  await ui.reload(); await plan().waitFor();
  assert.equal(await plan().getAttribute('data-status'), 'paused');
  check('paused plan rendering and reload never turn unfinished work into completion (seeded interruption state)');
  assert.deepEqual(errors, []);
  await writeFile('verification/task-plan-browser.json', JSON.stringify({checks, errors, realBrowser: true, syntheticModel: true, actualModelAccuracy: false}, null, 2));
} catch (error) {console.error(JSON.stringify({round, errors, failure: failure?.message, last: ui ? (await state())?.chat?.messages.at(-1) : null, screen: ui ? (await ui.locator('body').innerText()).slice(-1500) : ''})); throw error;} finally {held?.(); reviewHeld?.(); await context?.close(); if (ui?.video()) await cp(await ui.video().path(), resolve('verification/task-plan-demo.webm')); await rm(profile, {recursive: true, force: true});}

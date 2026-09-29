import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {goalReviewPayload} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-analysis-recovery-')), extension = resolve(profile, 'extension');
let context, ui, target, failure, round = 0, checkpoints = 0, finals = 0, stepReviews = 0, stageTurns = 0;
const errors = [], checks = [];
const goal = '교육 안내에서 신청 마감일, 담당 팀, 장소를 읽어서 알려줘. 입력하거나 등록하지 마.';
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const reply = (calls, content = '') => ({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}]});
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://analysis-recovery.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>교육 안내</title><p>신청 마감일 <strong>2026년 10월 8일</strong></p><p>담당 팀 개발팀</p><p>장소 서울 A 강의실</p><label>의견<input></label><script>window.writes=0;addEventListener("input",()=>writes++);</script>'}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', context_length: 524288}]}});
    const body = route.request().postDataJSON(), review = goalReviewPayload(body.messages);
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    if (review) {
      assert.equal(review.goal, goal); assert(!body.tools?.length);
      if (review.phase === 'checkpoint') {
        checkpoints++; assert.equal(review.evidence.filter(item => item.result?.error === 'script_api').length, 2);
        return route.fulfill({json: reply(null, JSON.stringify({status: 'revise', checks: [{requirement: '세 항목 읽기', status: 'unknown', evidence_ids: []}], next_step: '페이지 읽기에는 코드 실행이 필요 없습니다. read_page로 세 항목을 읽으세요.'}))});
      }
      const proof = review.evidence.findLast(item => item.usable && ['read_page', 'browser_snapshot'].includes(item.tool));
      assert(proof); assert.equal(await target.evaluate(() => writes), 0);
      if (review.phase === 'plan_step') {
        stepReviews++; assert.equal(review.evaluation_contract.scope, 'step_outcomes_only');
        assert(!Object.hasOwn(review, 'proposed_answer'));
        assert(JSON.stringify(proof.result).includes('서울 A 강의실'));
        return route.fulfill({json: reply(null, JSON.stringify({status: 'complete', checks: [
          {requirement: '페이지의 세 항목 확인', status: 'met', evidence_ids: [proof.id]},
        ], next_step: ''}))});
      }
      assert.equal(review.phase, 'final'); finals++;
      const missing = !review.proposed_answer.includes('서울 A 강의실');
      assert.equal(missing, finals === 1);
      return route.fulfill({json: reply(null, JSON.stringify({status: missing ? 'revise' : 'complete', checks: [
        {requirement: '마감일과 담당 팀', status: 'met', evidence_ids: [proof.id]},
        {requirement: '장소', status: missing ? 'unmet' : 'met', evidence_ids: missing ? [] : [proof.id]},
      ], next_step: missing ? '원래 요청의 장소가 빠졌습니다. 장소를 확인해서 답변에 포함하세요.' : ''}))});
    }
    // Stage-by-stage plan review: after an answer passes one stage review the
    // host asks for the next stage. Restate the same answer; it is not a new
    // executor round and the final review still judges the whole answer.
    if (String(body.messages.at(-1)?.content || '').startsWith('The current stage passed independent review')) {
      stageTurns++; return route.fulfill({json: reply(null, body.messages.findLast(message => message.role === 'assistant' && message.content)?.content || '')});
    }
    const result = body.messages.findLast(message => message.role === 'tool');
    const output = result && JSON.parse(result.content);
    if (++round === 1) return route.fulfill({json: reply([call('run_playwright', {code: 'return await page.evaluate(() => document.title);'}), call('fill_form', {fields: [{field_id: 'unobserved', value: 'DO_NOT_WRITE'}]})])});
    if (round === 2) {assert.equal(output.error, 'tool_replan_required'); return route.fulfill({json: reply([call('run_playwright', {code: 'return await page.evaluate(() => document.body.innerText);'})])});}
    if (round === 3) {assert.equal(checkpoints, 1); assert.match(body.messages.at(-1).content, /Intermediate requirement review/); return route.fulfill({json: reply([call('read_page')])});}
    if (round === 4) {assert(output.frames[0].text.includes('서울 A 강의실')); return route.fulfill({json: reply(null, '마감일은 2026년 10월 8일이며 담당 팀은 개발팀입니다.')});}
    if (round === 5) {assert.match(body.messages.at(-1).content, /Independent requirement review/); return route.fulfill({json: reply([call('browser_snapshot', {query: '장소'})])});}
    assert.equal(round, 6); assert(output.frames[0].textFiltered); return route.fulfill({json: reply(null, '마감일은 2026년 10월 8일, 담당 팀은 개발팀, 장소는 서울 A 강의실입니다.')});
  } catch (error) {failure = error; await route.fulfill({status: 500, body: 'Fixture assertion failed'});}});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This fixture asserts the original tab; owned-window behavior has dedicated suites.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  await worker.evaluate(() => {globalThis.attachCount = 0; const original = chrome.debugger.attach.bind(chrome.debugger); chrome.debugger.attach = (...args) => {attachCount++; return original(...args);};});
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 15}}));
  target = await context.newPage(); await target.goto('https://analysis-recovery.example.test/');
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  for (let i = 0; i < 200 && !(await state()).catalog?.models?.length; i++) await ui.waitForTimeout(50);
  assert.equal((await state()).catalog?.models?.length, 1);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiId => {const target = (await chrome.tabs.query({})).find(tab => tab.url === 'https://analysis-recovery.example.test/'); await chrome.storage.session.set({chatSourceTabs: {[uiId]: target.id}});}, uiId);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(goal); await ui.getByRole('button', {name: '전송', exact: true}).click();
  for (let i = 0; i < 600; i++) {if (failure) throw failure; if (['done', 'error'].includes((await state()).chat.messages.at(-1)?.state)) break; await new Promise(resolve => setTimeout(resolve, 50));}
  const chat = (await state()).chat;
  assert.equal(chat.messages.at(-1)?.state, 'done', JSON.stringify({round, checkpoints, finals, message: chat.messages.at(-1), screen: await ui.locator('body').innerText()}));
  assert(chat.messages.at(-1).content.includes('서울 A 강의실')); assert.equal(chat.task.goalReview.status, 'complete');
  assert.equal(round, 6); assert.equal(checkpoints, 1); assert.equal(finals, 2);
  assert(stepReviews > 0, 'Step review must not replace the independent final-answer gate');
  assert.equal(stageTurns, stepReviews - 1);
  assert.equal(await target.evaluate(() => writes), 0); assert.equal(await worker.evaluate(() => attachCount), 0);
  checks.push('failed batches do not execute later writes', 'independent checkpoint redirects failed scripts to passive reading', 'final review catches an omitted requirement and repairs only the answer', 'reading completes without debugger attachment, page writes or redundant verify_page');
  assert.deepEqual(errors, []); await mkdir('verification', {recursive: true});
  await writeFile('verification/analysis-recovery-browser.json', JSON.stringify({checks, errors, checkpoints, stepReviews, finalReviews: finals, realBrowser: true, syntheticModel: true, actualModelAccuracy: false}, null, 2));
  for (const text of checks) console.log('PASS ' + text);
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

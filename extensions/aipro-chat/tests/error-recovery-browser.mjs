import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir, appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-error-recovery-')), extension = resolve(profile, 'extension');
let context, ui, target, failure, stage = 0, retryStage = 0, finalReviews = 0, requests = 0, rateAt, originalRef, recoveredRef, cancelMode = false, cycleMode = false, cycleReads = 0, cycleQuestions = 0;
const errors = [], checks = [];
let cycleAnalystCalls = 0;
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const reply = (calls, content = '') => ({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}});
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const control = result => result.frames.flatMap(frame => frame.elements || []).find(element => element.name === '미리보기');
async function until(predicate) {
  for (let i = 0; i < 1000; i++) {if (failure) throw failure; if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40));}
  assert.fail('Recovery did not reach the expected state');
}
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),`
const fixtureHandle=handle;let fixtureLost=false;handle=async(message,sender,...rest)=>{const result=await fixtureHandle(message,sender,...rest);if(!fixtureLost&&message.type==='RUN_TOOL'&&message.name==='click_element'&&result?.ok){fixtureLost=true;throw new Error('PRIVATE_RECEIPT_LOST');}return result;};
`);
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://recovery.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body:
    '<title>미리보기 설정</title><button aria-pressed="false">미리보기</button><output>꺼짐</output><script>window.clicks=0;document.querySelector("button").onclick=event=>{clicks++;const enabled=event.currentTarget.getAttribute("aria-pressed")!=="true";event.currentTarget.setAttribute("aria-pressed",String(enabled));document.querySelector("output").textContent=enabled?"미리보기 켜짐":"꺼짐";};</script>'}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    requests++;
    const body = route.request().postDataJSON();
    // The focused-question request adds its own schema instructions.
    if (!(cycleMode && body.tools?.every(tool => tool.function.name === 'ask_user'))) assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    if (cancelMode) return route.fulfill({status: 429, headers: {'Retry-After': '30'}, body: 'PRIVATE_LIMIT'});
    const plan = planCompletion(body); if (plan) return route.fulfill({json: plan});
    const review = goalReviewPayload(body.messages);
    if (review) {
      if (cycleMode) return route.fulfill({json: reviewCompletion(review)});
      if (review.phase === 'checkpoint') return route.fulfill({json: reviewCompletion(review)});
      finalReviews++;
      assert.equal(await target.evaluate(() => clicks), 1);
      return route.fulfill({json: finalReviews === 1 ? reply(null, '{"status":') : reviewCompletion(review)});
    }
    if (cycleMode) {
      if (/isolated recovery analyst/.test(body.messages[0].content)) {
        cycleAnalystCalls++;
        assert.deepEqual(body.tools.map(tool => tool.function.name), ['read_analysis_evidence']);
        const brief = JSON.parse(body.messages[1].content), id = brief.evidence[0].evidence_id;
        assert.match(brief.task, /Repeated reading or navigation/);
        if (!body.messages.some(message => message.role === 'tool')) return route.fulfill({json: reply([call('read_analysis_evidence', {evidence_id: id})])});
        return route.fulfill({json: reply(null, JSON.stringify({status: 'complete', summary: '같은 검색 화면을 재방문했습니다.',
          findings: [{text: '검색 화면에는 추가 결과가 없습니다.', evidence_ids: [id]}], uncertainties: ['목표 결과 미확인'], next_step: '같은 재조회 대신 다른 근거를 확인하세요.'}))});
      }
      if (body.tools?.every(tool => tool.function.name === 'ask_user')) {
        cycleQuestions++;
        return route.fulfill({json: reply([call('ask_user', {question: '현재 페이지에서 원하는 최종 표시 내용을 알려주세요.', input_mode: 'long_text'})])});
      }
      assert(cycleReads < 10, 'Previously seen A/B states must not reset loop detection forever');
      // External page changes between real extension snapshots. The model
      // issues reads only; no generated action or new result is introduced.
      await target.locator('output').evaluate((el, text) => {el.textContent = text;}, ++cycleReads % 2 ? '검색 화면 A' : '검색 화면 B');
      return route.fulfill({json: reply([call('browser_snapshot')])});
    }
    const last = body.messages.findLast(message => message.role === 'tool'), result = last && JSON.parse(last.content);
    if (stage === 0) {stage++; return route.fulfill({json: reply([call('browser_snapshot')])});}
    if (stage === 1) {stage++; originalRef = control(result).ref; return route.fulfill({json: reply([call('invented_browser_click', {ref: originalRef})])});}
    if (stage === 2) {stage++; assert.equal(result.error, 'tool_unavailable'); return route.fulfill({json: reply([call('click_element', {ref: originalRef})])});}
    if (stage === 3) {
      stage++; assert.equal(result.recovery.execution, 'unknown'); assert(!JSON.stringify(result).includes('PRIVATE_RECEIPT'));
      assert.equal(await target.evaluate(() => clicks), 1);
      return route.fulfill({json: reply([call('click_element', {ref: originalRef})])});
    }
    if (stage === 4) {
      assert.equal(result.error, 'action_outcome_unknown'); assert.equal(await target.evaluate(() => clicks), 1);
      if (++retryStage === 1) {rateAt = performance.now(); return route.fulfill({status: 429, headers: {'Retry-After': '1'}, body: 'PRIVATE_LIMIT'});}
      assert(performance.now() - rateAt >= 980);
      if (retryStage === 2) return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta: {tool_calls: [{index: 0, ...call('click_element', {ref: originalRef})}]}}]})}\n\n`});
      if (retryStage === 3) return route.fulfill({contentType: 'text/event-stream', body: 'data: {"error":{"code":"server_error","message":"PRIVATE_STREAM_FAILURE"}}\n\n'});
      assert.equal(retryStage, 4); stage++; return route.fulfill({json: reply([call('browser_snapshot')])});
    }
    if (stage === 5) {
      stage++; assert.equal(await target.getByRole('button', {name: '미리보기'}).getAttribute('aria-pressed'), 'true');
      recoveredRef=control(result).ref;
      return route.fulfill({json:reply([call('click_element',{ref:recoveredRef})])});
    }
    if(stage===6) {
      stage++;assert.equal(result.error,'action_outcome_unknown');assert.equal(await target.evaluate(()=>clicks),1);
      return route.fulfill({json:reply([call('verify_page',{checks:[{kind:'text_present',expected:'미리보기 켜짐'}]})])});
    }
    if(stage===7){stage++;assert.equal(result.verified,true);assert.equal(result.unresolvedAction,true);recoveredRef=control(result.observation).ref;return route.fulfill({json:reply([call('click_element',{ref:recoveredRef})])});}
    if(stage===8){stage++;assert.equal(result.error,'action_outcome_unknown');assert.equal(await target.evaluate(()=>clicks),1);return route.fulfill({json:reply([call('verify_page',{checks:[{kind:'control_state',ref:recoveredRef,expected:'true'}]})])});
    }
    assert.equal(stage++, 9); assert.equal(result.verified, true);
    return route.fulfill({json: reply(null, '미리보기를 켜고 상태를 확인했습니다.')});
  } catch (error) {failure = error; await route.fulfill({status: 400, body: 'Synthetic assertion failed'});}});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This fault-injection scenario verifies the original tab explicitly.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 21}}));
  target = await context.newPage(); await target.goto('https://recovery.example.test/');
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  await until(async () => (await state()).catalog?.models?.length === 1);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiId => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === 'https://recovery.example.test/');
    await chrome.storage.session.set({chatSourceTabs: {[uiId]: tab.id}});
  }, uiId);
  // The real action receipt is dropped at the worker execution boundary.
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('현재 페이지의 미리보기를 켜고 실제 상태를 확인해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => ['done', 'error'].includes((await state()).chat.messages.at(-1)?.state));
  const saved = await state(), answer = saved.chat.messages.at(-1);
  assert.equal(answer.state, 'done', JSON.stringify(answer)); assert.equal(stage, 10); assert.equal(finalReviews, 2);
  assert.equal(saved.chat.task.goalReview.status, 'complete'); assert.equal(saved.usage.total.aipro.calls, requests);
  assert.equal(await target.evaluate(() => clicks), 1);
  assert(answer.trace.some(step => step.tool === 'recover_tool'));
  assert(answer.trace.some(step => step.tool === 'recover_model' && step.status === 'done'));
  assert(!JSON.stringify(await ui.evaluate(() => chrome.storage.local.get(null))).includes('PRIVATE_'));
  checks.push('unknown tools feed back to Qwen and never execute', 'a real click with a lost receipt is not replayed; fresh read still blocks a duplicate click, then control-state verification completes it',
    '429 cooldown, incomplete SSE and HTTP 200 server-error events retry inference only and count every physical request', 'invalid final-review JSON is corrected without browser replay');
  await ui.reload(); assert.equal((await state()).chat.messages.at(-1).state, 'done'); assert.equal(await target.evaluate(() => clicks), 1);
  checks.push('verified result and progress survive reload');
  cancelMode = true; const previousRequests = requests;
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('미리보기 상태를 다시 읽어줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(() => requests > previousRequests);
  await ui.getByRole('button', {name: '중지', exact: true}).click();
  await until(async () => (await state()).chat.messages.at(-1)?.error === 'cancelled');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(requests, previousRequests + 1); assert.equal(await target.evaluate(() => clicks), 1);
  checks.push('user cancellation interrupts server cooldown without restarting work');
  cancelMode = false; cycleMode = true;
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('현재 페이지의 결과를 읽고 확인해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => (await state()).chat.messages.some(message => message.question?.text?.includes('같은 내용을 반복')));
  await ui.getByText('같은 내용을 반복해서 확인하고 있습니다. 현재 근거를 유지하고 다른 방법으로 다시 확인할까요?', {exact: true}).waitFor();
  assert.equal(cycleReads, 6);
  assert.equal(cycleQuestions, 0); assert.equal(cycleAnalystCalls, 2);
  assert((await state()).chat.messages.some(message => message.trace?.some(step => step.tool === 'analysis_recovery' && step.analysis?.delivered)));
  const pausedRequests = requests;
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(requests, pausedRequests); assert.equal(await target.evaluate(() => clicks), 1);
  checks.push('real A/B snapshots run one readonly recovery worker before a technical pause after six reads; no invented requirement question or replayed write');
  assert.deepEqual(errors, []); await mkdir('verification', {recursive: true});
  await writeFile('verification/error-recovery-browser.json', JSON.stringify({checks, errors, requests, cycleReads, cycleQuestions, cycleAnalystCalls, actualBrowser: true, syntheticModel: 'QWEN3.8-27B-FP8-256K', actualModelAccuracy: false}, null, 2));
  for (const text of checks) console.log('PASS ' + text);
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

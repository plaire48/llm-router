import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-review-recovery-')), extension = resolve(profile, 'extension');
const restriction = '검토용 초안만 작성하고 보내거나 등록하지 마세요. 제목과 본문을 모두 확인하세요.';
const fields = ['제목', '본문', '담당', '기한', '참고'];
const values = ['검토 초안', '교육 내용 확인', '개발팀', '금요일', '교육 안내'];
const server = createServer((_, response) => {response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); response.end(`<!doctype html><html lang="ko"><title>검토 초안</title>
  ${fields.map((name, i) => `<label>${name}<input id="field-${i}" aria-label="${name}"></label>`).join('')}
  <button onclick="window.submits++">등록</button><output>초안 작성 중</output>
  <p>${'교육 참고 설명입니다. '.repeat(600)}</p>
  <script>window.submits=0;window.writes=[];document.addEventListener('input',e=>{writes.push(e.target.id);document.querySelector('output').textContent='초안 '+writes.length+'개 반영됨';});</script></html>`);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const checks = [], errors = [], reviewSizes = [];
let context, ui, source, worker, failure, lastToolError, stage = 0, checkpointCount = 0, finalCount = 0, continuations = 0;
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const reply = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}});
const elements = result => (result.observation || result).frames.flatMap(frame => frame.elements || []);
const fieldRef = (result, name) => {const field = elements(result).find(element => element.name === name); assert(field, name); return field.ref;};
async function until(predicate) {
  for (let i = 0; i < 1500; i++) {if (failure) throw failure; if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40));}
  assert.fail('Review context scenario did not complete');
}
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Only the isolated fixture pregrants origins. Production permissions and
  // real model quality are outside this deterministic Chrome regression.
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    const body = route.request().postDataJSON();
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    const review = goalReviewPayload(body.messages);
    if (review) {
      assert(review.conversation.some(message => message.role === 'user' && message.content === restriction), 'Original restriction must survive a long sequence of observations');
      assert(review.evidence.filter(item => item.superseded).every(item => item.usable === false && !item.result.frames && !item.result.observation && !item.arguments));
      assert(review.omitted);
      reviewSizes.push({phase: review.phase, characters: JSON.stringify(review).length, receipts: review.evidence.filter(item => item.superseded).length});
      if (review.phase === 'plan_step') return route.fulfill({json:reviewCompletion(review)});
      if (review.phase === 'checkpoint') {checkpointCount++; assert.equal(stage, 6);}
      else {
        finalCount++; assert.equal(stage, finalCount<=2?8:11);
        if(finalCount===1)return route.fulfill({json:reply(null,{},'invalid review JSON')});
        if(finalCount===2){assert.deepEqual(body.tools.map(t=>t.function.name),['report_goal_review']);return route.fulfill({json:reply(null,{},'still invalid')});}
        const verified = review.evidence.findLast(item => item.tool === 'verify_page');
        assert(verified?.usable && verified.result.verified);
        assert.equal(verified.arguments.checks.length, fields.length);
        const work = context.pages().find(page => page !== source && page.url() === `${origin}/draft`); assert(work);
        assert.deepEqual(await work.locator('input').evaluateAll(inputs => inputs.map(input => input.value)), values);
        assert.equal(await work.evaluate(() => window.submits), 0);
      }
      return route.fulfill({json: reviewCompletion(review)});
    }
    const last = body.messages.findLast(message => message.role === 'tool'), result = last && JSON.parse(last.content);
    lastToolError = result?.error || result?.reason;
    // The fixture plan has two stages; a text answer closes one reviewed stage at a
    // time (agent-runtime.js). The executor restates its verified answer for the
    // remaining stage, which does not advance this scenario's stages.
    if (typeof body.messages.at(-1).content === 'string' && body.messages.at(-1).content.startsWith('The current stage passed independent review')) {
      continuations++; assert.equal(stage, 8);
      return route.fulfill({json: reply(null, {}, '초안의 다섯 항목을 확인했습니다. 등록하지 않았습니다.')});
    }
    let answer;
    if (stage === 0) answer = reply('browser_snapshot');
    else if (stage <= 5) {
      if (stage > 1) {assert.equal(result.applied, 1); assert(!result.error);}
      answer = reply('fill_form', {fields: [{field_id: fieldRef(result, fields[stage - 1]), value: values[stage - 1]}]});
    } else if (stage === 6) {
      assert.equal(checkpointCount, 1);
      answer = reply('verify_page', {checks: fields.map((name, index) => ({kind: 'field_value', ref: fieldRef(result, name), expected: values[index]}))});
    } else if(stage===8){
      assert(!body.tools.some(t=>['fill_form','run_playwright','request_approval'].includes(t.function.name)));
      answer=reply('fill_form',{fields:[{field_id:'stale',value:'MUST NOT WRITE'}]});
    } else if(stage===9){
      assert.equal(result.reason,'review_recovery_read_only');assert.equal(result.deferred,true);
      answer=reply('browser_snapshot');
    } else if(stage===10){
      assert(result.frames?.length);answer=reply(null,{},'현재 초안의 다섯 항목을 다시 확인했습니다. 등록하지 않았습니다.');
    } else {
      assert.equal(stage, 7); assert.equal(result.verified, true);
      answer = reply(null, {}, '초안의 다섯 항목을 확인했습니다. 등록하지 않았습니다.');
    }
    stage++;
    return route.fulfill({json: answer});
  } catch (error) {failure = error; return route.fulfill({status: 500, body: 'fixture assertion failed'}).catch(() => {});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async ({restriction}) => {
    await chrome.storage.local.set({chat: {messages: [{id: 'restriction', role: 'user', content: restriction}, {id: 'ack', role: 'assistant', content: '초안만 작성하겠습니다.', state: 'done'}], draft: ''}});
    await chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic-review-context', receivedAt: 1}});
  }, {restriction});
  source = await context.newPage(); await source.goto(`${origin}/draft`);
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await until(async () => (await state()).catalog?.models?.length === 1);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async ({uiId, origin}) => {const tab = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/draft`); await chrome.storage.session.set({chatSourceTabs: {[uiId]: tab.id}});}, {uiId, origin});
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(`다섯 항목을 차례로 작성해줘. ${fields.map((name, index) => `${name}: ${values[index]}`).join(', ')}.`);
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => (await state()).chat.messages.at(-1)?.state === 'done' && !(await state()).busy);
  const current = await state(), work = context.pages().find(page => page !== source && page.url() === `${origin}/draft`);
  assert(work); assert.equal(checkpointCount, 1); assert.equal(finalCount, 3); assert.equal(continuations, 1);
  assert.deepEqual(await work.evaluate(() => writes), fields.map((_, index) => `field-${index}`));
  assert.deepEqual(await source.evaluate(() => writes), []); assert.equal(await source.evaluate(() => submits), 0);
  assert.equal(current.chat.task.goalReview.status, 'complete');
  assert(current.events.some(event => event.event === 'agent_review_result' && event.scope === 'final' && event.status === 'complete'));
  assert(current.events.some(event => event.event === 'agent_run_result' && event.outcome === 'answer' && event.verification === 'passed'));
  const durable = await ui.evaluate(owner => chrome.runtime.sendMessage({type: 'GET_AGENT_DIAGNOSTICS', ...owner}),
    {provider: current.chat.provider, conversationId: current.chat.sessionId, requestId: current.chat.messages.at(-1).id});
  assert.equal(durable.ok, true);
  assert(durable.data.events.some(event => event.phase === 'review_result' && event.scope === 'final' && event.status === 'complete'));
  assert(durable.data.events.some(event => event.phase === 'run_result' && event.outcome === 'answer' && event.verification === 'passed'));
  checks.push('actual host review and termination messages reach the owner-bound persistent diagnostic journal');
  assert(current.events.filter(event => event.event.startsWith('agent_')).every(event => !('checks' in event) && !('nextStep' in event) && !('content' in event)));
  assert.equal(current.chat.messages[0].content, restriction);
  checks.push('two invalid final reviews lead to a restricted evidence pass and a subsequent valid independent review',
    'a proposed duplicate write is blocked by the host during recovery, not merely hidden from the tool list',
    'original requirements remain in both intermediate and final review despite large stale observations',
    'five real DOM inputs occur once each in the owned browser window and all five are verified',
    'source tab is unchanged, final transaction is not issued, and stale snapshots cannot be cited as current evidence');
  await ui.reload(); await until(async () => !(await state()).busy);
  assert.equal((await state()).chat.messages[0].content, restriction);
  assert((await state()).events.some(event => event.event === 'agent_run_result' && event.verification === 'passed'));
  assert.deepEqual(await work.evaluate(() => writes), fields.map((_, index) => `field-${index}`));
  await ui.screenshot({path:'verification/review-recovery-browser.png'});
  checks.push('re-entry preserves the original instruction and does not replay completed inputs');
  assert.deepEqual(errors, []); if (failure) throw failure;
  await mkdir('verification', {recursive: true});
  await writeFile('verification/review-recovery-browser.json', JSON.stringify({checks, reviewSizes, errors, actualBrowser: true, actualModel: false, liveAccount: false}, null, 2));
  for (const check of checks) console.log(`PASS ${check}`);
} catch (error) {console.error(JSON.stringify({stage, lastToolError, failure: failure?.message, error: error.message})); throw error;}
finally {await context?.close(); server.close(); await rm(profile, {recursive: true, force: true});}

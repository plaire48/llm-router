import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {planCompletion, fixturePlan} from './fixtures/task-plan.mjs';
import {goalReviewPayload} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-analysis-delivery-')), extension = resolve(profile, 'extension');
const server = createServer((_, response) => {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end('<!doctype html><html lang="ko"><title>교육 신청 초안</title><h1>교육 안내</h1><p>승인 담당팀은 개발팀입니다.</p><p>마감일은 10월 8일입니다.</p><label>담당 팀<input></label><button onclick="submits++">등록</button><script>window.writes=0;window.submits=0;addEventListener("input",()=>writes++);</script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context, ui, worker, source, failure, round = 0, calls = 0, finalReviews = 0, stepReviews = 0, stageTurns = 0, releaseReview, reviewReleased = false;
const reviewGate = new Promise(resolve => {releaseReview = () => {reviewReleased = true; resolve();};});
const errors = [], checks = [], packets = [], roleStarts = new Set();
const usage = {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120};
const reply = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}], usage});
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const field = result => {const item = (result.observation || result).frames.flatMap(frame => frame.elements || []).find(item => item.name === '담당 팀' && item.ref); assert(item); return item.ref;};
async function until(predicate) {
  for (let i = 0; i < 1200; i++) {if (failure) throw failure; if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40));}
  assert.fail('Analysis delivery scenario did not complete');
}
try {
  await mkdir('verification', {recursive: true});
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Only the fixture pregrants sites; production permissions stay unchanged.
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    calls++;
    const body = route.request().postDataJSON();
    assert.equal(body.model, 'QWEN3.8-27B-FP8-256K');
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    const planning = planCompletion(body); if (planning) return route.fulfill({json: {...planning, usage}});
    const review = goalReviewPayload(body.messages);
    if (review) {
      if(review.phase==='plan_step')stepReviews++;else finalReviews++;
      const receipts=review.evidence.filter(item=>item.tool==='analysis_receipt');
      assert.equal(receipts.length,2);
      assert(receipts.every(item=>item.usable && !item.superseded && item.result.delivered && item.result.dataKind==='analysis_execution' && !item.result.findings));
      assert(!review.evidence.some(item => ['delegate_analysis', 'collect_analysis'].includes(item.tool)));
      const proof = review.evidence.findLast(item => item.tool === 'verify_page' && item.usable && item.result.verified); assert(proof);
      const work = context.pages().find(page => page !== source && page.url() === `${origin}/draft`); assert(work);
      assert.equal(await work.getByRole('textbox', {name: '담당 팀'}).inputValue(), '개발팀');
      assert.equal(await work.evaluate(() => writes), 1); assert.equal(await work.evaluate(() => submits), 0);
      return route.fulfill({json: reply(null, {}, JSON.stringify({status: 'complete', checks: [{requirement: '담당 팀 초안과 안내 확인', status: 'met', evidence_ids: [proof.id]}], next_step: ''}))});
    }
    const role = /isolated (\w+) analyst/.exec(body.messages[0].content)?.[1];
    if (role) {
      roleStarts.add(role);
      assert(!JSON.stringify(body).includes('PRIVATE_PARENT_HISTORY'));
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['read_analysis_evidence']);
      if (role === 'review') await reviewGate;
      const last = body.messages.findLast(message => message.role === 'tool');
      if (!last) return route.fulfill({json: reply('read_analysis_evidence', {evidence_id: 'ev_1', query: role === 'page' ? '승인 담당팀' : '마감일'})});
      const evidence = JSON.parse(last.content);
      assert.equal(evidence.selection, 'query'); assert(evidence.ranges.length);
      assert.equal(evidence.source_status, 'observed');
      assert.equal(JSON.parse(body.messages[1].content).allocation.turns, 3);
      return route.fulfill({json: reply(null, {}, JSON.stringify({status: 'complete', summary: role === 'page' ? '담당 팀 확인' : '마감일 확인',
        findings: [{text: role === 'page' ? '담당 팀은 개발팀입니다.' : '마감일은 10월 8일입니다.', evidence_ids: [evidence.evidence_id]}], uncertainties: [], next_step: ''}))});
    }
    // One plan stage is reviewed per text answer; the host then asks for the
    // next stage. Restate the same answer: it is not a new executor round and
    // the final review still judges the whole answer against the page.
    if (String(body.messages.at(-1)?.content || '').startsWith('The current stage passed independent review')) {
      stageTurns++; return route.fulfill({json: reply(null, {}, body.messages.findLast(message => message.role === 'assistant' && message.content)?.content || '')});
    }
    const last = body.messages.findLast(message => message.role === 'tool'), result = last && JSON.parse(last.content);
    const delivered = body.messages.filter(message => message.role === 'user' && String(message.content).startsWith('Delegated analysis returned.'))
      .map(message => JSON.parse(message.content.split('\n').slice(1).join('\n')));
    round++;
    if (round === 1) return route.fulfill({json: reply('read_page')});
    if (round === 2) return route.fulfill({json: reply('delegate_analysis', {tasks: [
      {role: 'page', effort: 'quick', task: '승인 담당팀 확인', constraints: '화면 읽기만', done_when: '담당 팀 명칭의 근거 확보', evidence_ids: ['ev_1']},
      {role: 'review', effort: 'quick', task: '안내의 마감일 확인', constraints: '날짜만 조사', done_when: '관찰된 마감일의 근거 확보', evidence_ids: ['ev_1']},
    ]})});
    if (round === 3) {
      await until(async () => (await state()).chat.messages.at(-1).trace?.some(item => item.tool === 'analysis_page' && item.status === 'done'));
      return route.fulfill({json: reply('browser_snapshot')});
    }
    if (round === 4) {
      assert.equal(delivered.length, 1); assert.equal(delivered[0].results[0].role, 'page');
      assert.equal(delivered[0].pending[0].role, 'review'); assert.equal(reviewReleased, false);
      const advice = delivered[0].results[0]; assert.equal(advice.effort, 'quick');
      assert.equal(advice.context.model_turns, 2); assert.equal(advice.report.status, 'complete');
      assert.match(advice.evidence[0].read_excerpt, /개발팀/); assert(advice.evidence[0].read_excerpt.length <= 320);
      assert.deepEqual([...roleStarts].sort(), ['page', 'review']); packets.push(delivered[0]);
      await ui.setViewportSize({width: 380, height: 820});
      await ui.locator('[data-tool="analysis_review"][data-status="running"]').waitFor();
      await ui.screenshot({path: 'verification/analysis-delivery-running.png'});
      return route.fulfill({json: reply('fill_form', {fields: [{field_id: field(result), value: '개발팀'}]}, '담당 팀을 확인했습니다. 초안에 반영하겠습니다.')});
    }
    if (round === 5) {
      assert.equal(result.applied, 1); assert.equal(reviewReleased, false);
      return route.fulfill({json: reply('verify_page', {checks: [{kind: 'field_value', ref: field(result), expected: '개발팀'}]})});
    }
    if (round === 6) {
      assert.equal(result.verified, true); releaseReview();
      return route.fulfill({json: reply('collect_analysis')});
    }
    assert.equal(round, 7);
    const completed = [...delivered.flatMap(packet => packet.results), ...(result.results || [])];
    const reviewAdvice = completed.find(item => item.role === 'review'); assert(reviewAdvice);
    assert.equal(reviewAdvice.evidence[0].stale, true);
    assert.equal(delivered.flatMap(packet => packet.results).filter(item => item.role === 'page').length, 1);
    return route.fulfill({json: reply(null, {}, '담당 팀은 개발팀, 마감일은 10월 8일입니다. 초안을 작성하고 확인했습니다.')});
  } catch (error) {failure = error; releaseReview(); await route.fulfill({status: 500, body: 'Fixture assertion failed'}).catch(() => {});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.set({chat: {messages: [{id: 'previous', role: 'user', content: 'PRIVATE_PARENT_HISTORY'}, {id: 'ack', role: 'assistant', content: '확인했습니다.', state: 'done'}], draft: ''}});
    await chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic-analysis-delivery', receivedAt: 1}});
  });
  source = await context.newPage(); await source.goto(`${origin}/draft`);
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await until(async () => (await state()).catalog?.models?.length === 1);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async ({uiId, origin}) => {const tab = (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/draft`); await chrome.storage.session.set({chatSourceTabs: {[uiId]: tab.id}});}, {uiId, origin});
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('안내의 담당 팀과 마감일을 각각 확인하고 담당 팀을 초안에 입력해줘. 등록하지 마.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => ['done', 'error'].includes((await state()).chat.messages.at(-1)?.state) && !(await state()).busy);
  const final = await state(); assert.equal(final.chat.messages.at(-1).state, 'done'); assert.equal(finalReviews, 1); assert.equal(stepReviews, fixturePlan.length); assert.equal(stageTurns, stepReviews - 1);
  assert.equal(final.chat.task.goalReview.status, 'complete');
  assert.equal(final.usage.total.aipro.calls, calls); assert.equal(final.usage.total.aipro.total, calls * 120);
  assert.equal(await source.evaluate(() => writes), 0); assert.equal(await source.evaluate(() => submits), 0);
  const work = context.pages().find(page => page !== source && page.url() === `${origin}/draft`); assert(work);
  await ui.reload(); await until(async () => !(await state()).busy);
  assert.equal(await work.evaluate(() => writes), 1); assert.equal(await work.evaluate(() => submits), 0);
  assert((await state()).chat.messages.at(-1).trace.filter(item => item.tool.startsWith('analysis_')).every(item => item.status === 'done'));
  assert.deepEqual(errors, []);
  checks.push('two isolated analysts share the selected Qwen connection without parent history or browser write tools',
    'the first completed report is automatically delivered once before the slow analyst finishes',
    'the leader writes one field and verifies it in the owned window while the other analyst runs',
    'stale analysis remains advisory and final review uses actual browser verification',
    'focused analysts finish in two calls and return a small excerpt from actually observed evidence',
    'all synthetic response usage is counted; source tab, final transaction and reload do not introduce extra writes');
  await writeFile('verification/analysis-delivery-browser.json', JSON.stringify({checks, modelCalls: calls, parentRounds: round, finalReviews,
    packets, errors, actualBrowser: true, syntheticModel: true, actualModelAccuracy: false, liveAccount: false}, null, 2));
  for (const check of checks) console.log(`PASS ${check}`);
} catch (error) {console.error(JSON.stringify({round, failure: failure?.message, error: error.message})); throw error;}
finally {releaseReview(); await context?.close(); server.close(); await rm(profile, {recursive: true, force: true});}

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-outcome-recovery-')), extension = resolve(profile, 'extension');
let context, ui, target, failure, stage = 0, checkpoints = 0, firstRef, analystCalls = 0;
const errors = [], checks = [], reasons = [], reviewPhases = [];
const reply = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}});
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const ref = (result, name) => {const found = (result.observation || result).frames.flatMap(frame => frame.elements || []).find(element => element.name === name); assert(found, name); return found.ref;};
async function until(predicate) {
  for (let i = 0; i < 1300; i++) {if (failure) throw failure; if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40));}
  assert.fail('Recovery did not complete');
}
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://search.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ko"><title>문서 검색</title>
    <label>검색어<input id="query"></label><label>검색 범위<select><option value="recent">최근 문서</option><option value="all">전체 문서</option></select></label>
    <button id="search">검색</button><output aria-live="polite">검색어와 범위를 선택하세요.</output>
    <script>window.events=[];document.addEventListener('input',e=>{if(e.target.id==='query')events.push({kind:'input',trusted:e.isTrusted});});
    document.addEventListener('change',e=>{if(e.target.matches('select'))events.push({kind:'scope',trusted:e.isTrusted});});
    document.addEventListener('click',e=>{if(e.target.id!=='search')return;events.push({kind:'search',trusted:e.isTrusted});
      document.querySelector('output').textContent=document.querySelector('select').value==='all'&&document.querySelector('input').value==='표준 안내'?'표준 안내 문서 1건':'검색 결과 0건. 검색 범위를 확인하세요.';});
    window.rerender=()=>{const old=document.querySelector('button');old.replaceWith(old.cloneNode(true));};</script></html>`}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    const body = route.request().postDataJSON();
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    const plan = planCompletion(body); if (plan) return route.fulfill({json: plan});
    const review = goalReviewPayload(body.messages);
    if (review) {
      if (review.phase === 'checkpoint') {checkpoints++; assert.equal(stage, 4, 'Diagnosis must happen after the second failure despite the successful read');}
      else {reviewPhases.push([review.phase, stage]); assert.equal(await target.locator('output').textContent(), '표준 안내 문서 1건');}
      return route.fulfill({json: reviewCompletion(review)});
    }
    // The second identical stale-target failure starts one read-only recovery
    // analyst (action-recovery-analysis.js). It never acts in the browser.
    if (/isolated recovery analyst/.test(body.messages[0].content)) {
      analystCalls++; assert(stage >= 4, 'Analysis starts only after the second stale failure');
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['read_analysis_evidence']);
      const brief = JSON.parse(body.messages[1].content), id = brief.evidence[0].evidence_id;
      assert.match(brief.task, /repeated browser_stale result from click_element/);
      if (!body.messages.some(message => message.role === 'tool')) return route.fulfill({json: reply('read_analysis_evidence', {evidence_id: id})});
      return route.fulfill({json: reply(null, {}, JSON.stringify({status: 'complete', summary: '검색 버튼이 다시 그려져 이전 참조가 만료되었습니다.',
        findings: [{text: '새 관찰의 검색 버튼 참조를 사용해야 합니다.', evidence_ids: [id]}], uncertainties: [], next_step: '새 관찰의 참조로 검색어를 입력하고 검색하세요.'}))});
    }
    const last = body.messages.findLast(message => message.role === 'tool'), result = last && JSON.parse(last.content);
    const current = stage++;
    let name, args = {}, content = '';
    if (current === 0) name = 'browser_snapshot';
    if (current === 1 || current === 3) {
      const button = ref(result, '검색');
      if (current === 1) firstRef = button; else assert.notEqual(button, firstRef);
      // A real re-render between observation and action with unchanged visible
      // content. Neither the executor nor its error is mocked.
      await target.evaluate(() => window.rerender());
      name = 'click_element'; args = {ref: button};
    }
    if (current === 2) {
      assert.equal(result.reason, 'browser_stale'); reasons.push(result.reason);
      // A stale ref already returns a fresh observation; no screenshot is taken (agent-runtime.js visual recovery).
      assert(!result.visualRecovery && !result.image); assert.notEqual(ref(result, '검색'), firstRef);
      assert.equal((await target.evaluate(() => events)).length, 0);
      name = 'browser_snapshot';
    }
    if (current === 4) {
      assert.equal(result.reason, 'browser_stale'); reasons.push(result.reason); assert.equal(checkpoints, 1);
      assert.match(body.messages[0].content, /failures without changed evidence: 2/);
      name = 'fill_form'; args = {fields: [{field_id: ref(result, '검색어'), value: '표준 안내'}]};
      content = '페이지가 갱신되어 대상을 다시 확인했습니다. 검색어를 입력하고 결과를 확인하겠습니다.';
    }
    if (current === 5) {assert.equal(result.verified, true); name = 'click_element'; args = {ref: ref(result, '검색')};}
    if (current === 6) {name = 'verify_page'; args = {checks: [{kind: 'text_present', expected: '표준 안내 문서 1건'}]};}
    if (current === 7) {
      assert.equal(result.error, 'verification_failed'); reasons.push(result.error);
      assert.match(body.messages[0].content, /Compare the failed checks/);
      name = 'select_option'; args = {ref: ref(result, '검색 범위'), values: ['all']};
      content = '최근 문서에서는 결과가 없습니다. 전체 문서로 범위를 바꿔 다시 확인하겠습니다.';
    }
    if (current === 8) {name = 'click_element'; args = {ref: ref(result, '검색')};}
    if (current === 9) {name = 'verify_page'; args = {checks: [{kind: 'field_value', ref: ref(result, '검색어'), expected: '표준 안내'}, {kind: 'text_present', expected: '표준 안내 문서 1건'}]};}
    if (current === 10) {assert.equal(result.verified, true); content = '전체 문서에서 표준 안내 문서 1건을 확인했습니다.';}
    // The first plan stage passed its review; the last stage reports without another action.
    if (current === 11) {assert.match(body.messages.at(-1).content, /Later stages remain unfinished/); content = '전체 문서에서 표준 안내 문서 1건을 확인했습니다.';}
    assert(current <= 11, 'No unexpected replay or clarification');
    return route.fulfill({json: reply(name, args, content)});
  } catch (error) {failure = error; await route.fulfill({status: 400, body: 'Synthetic assertion failed'});}});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 22}}));
  target = await context.newPage(); await target.goto('https://search.example.test/');
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  await until(async () => (await state()).catalog?.models?.length === 1);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiId => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === 'https://search.example.test/');
    await chrome.storage.session.set({chatSourceTabs: {[uiId]: tab.id}});
  }, uiId);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('표준 안내 문서를 검색하고 결과를 확인해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => ['done', 'error'].includes((await state()).chat.messages.at(-1)?.state));
  const saved = await state(), answer = saved.chat.messages.at(-1);
  assert.equal(answer.state, 'done', JSON.stringify(answer)); assert.equal(stage, 12); assert.equal(checkpoints, 1); assert.equal(analystCalls, 2);
  assert.deepEqual(reviewPhases, [['plan_step', 11], ['plan_step', 12], ['final', 12]]);
  assert.deepEqual(reasons, ['browser_stale', 'browser_stale', 'verification_failed']);
  const events = await target.evaluate(() => window.events);
  assert.deepEqual(events.filter(event => event.kind === 'input'), [{kind: 'input', trusted: true}]);
  assert.equal(events.filter(event => event.kind === 'search').length, 2); assert.equal(events.filter(event => event.kind === 'scope').length, 1);
  // Playwright selectOption dispatches change/input events in the page. Check
  // the selected value; real pointer/text events must remain trusted.
  assert(events.filter(event => event.kind !== 'scope').every(event => event.trusted));
  assert.equal(await target.getByLabel('검색 범위').inputValue(), 'all');
  assert.equal(await target.getByLabel('검색어').inputValue(), '표준 안내');
  assert.equal(saved.chat.task.goalReview.status, 'complete');
  assert.equal(answer.trace.filter(step => step.status === 'error').length, 3);
  assert(answer.trace.some(step => step.tool === 'progress_note' && step.content.includes('전체 문서')));
  checks.push('Real stale references return fresh refs without a screenshot and trigger one read-only recovery analyst and independent diagnosis despite successful rereads',
    'A failed result check reaches the next model turn, which changes scope before another search',
    'Exactly one trusted input and two purposeful searches complete the goal without replaying input',
    'Qwen receives one system message and fresh evidence on each corrective turn');
  await ui.reload(); assert.equal((await state()).chat.messages.at(-1).state, 'done');
  assert.deepEqual(await target.evaluate(() => window.events), events);
  checks.push('Recovery and original error receipts survive reload without executing again');
  await mkdir('verification', {recursive: true}); assert.deepEqual(errors, []);
  await writeFile('verification/outcome-recovery-browser.json', JSON.stringify({checks, errors, reasons, syntheticModelResponses: true, realBrowserActions: true, actualCompanyPageVerified: false}, null, 2));
  checks.forEach(text => console.log(`PASS ${text}`));
} catch (error) {console.error({stage, checkpoints, reason: failure?.message}); throw error;}
finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

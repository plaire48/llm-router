import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-harness-')), extension = resolve(profile, 'extension');
await cp(resolve('dist'), extension, {recursive: true});
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
// Pregrant fixture access only in the temporary test extension copy.
manifest.host_permissions.push('http://*/*', 'https://*/*');
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
const errors = [], checks = [], requests = []; let stage = 0, routeError, ui, page, reviews = 0;
const check = text => {checks.push(text); console.log('PASS ' + text);};
const ref = (value, name) => (value.observation || value).frames.flatMap(f => f.elements || []).find(e => e.name === name).ref;
const sse = (name, args, content = '') => `data: ${JSON.stringify({choices: [{delta: name ? {tool_calls: [{index: 0, id: 'h' + stage, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content}, finish_reason: name ? 'tool_calls' : 'stop'}]})}\n\ndata: [DONE]\n\n`;
try {
  await mkdir('verification', {recursive: true});
  // This fixture exercises draft autosave recovery. Final Save is covered by
  // approval tests and must not bypass the product's final-action guard.
  await context.route('https://harness.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<title>신청서</title><label>제목<input aria-label="제목"></label><label>본문<textarea aria-label="본문"></textarea></label><button onclick="save()">초안 저장</button><output>작성 중</output><script>window.saves=0;window.value=null;window.body=null;window.titleWrites=0;document.querySelector('input').addEventListener('input',()=>titleWrites++);function save(){saves++;if(saves===1){document.querySelector('output').textContent='저장 실패. 다시 시도하세요';return;}setTimeout(()=>{window.value=document.querySelector('input').value;window.body=document.querySelector('textarea').value;document.querySelector('output').textContent='신청서 저장됨'},400)}</script>`}));
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4'}]})}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', async route => {
    try {
      const body = route.request().postDataJSON();
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning}); requests.push(body);
      const review = goalReviewPayload(body.messages);
      if (review) {
        if (review.phase === 'checkpoint') return route.fulfill({json: reviewCompletion(review)});
        reviews++; assert(!body.tools?.length); assert.match(review.goal, /본문/);
        const proof = review.evidence.findLast(item => item.tool === 'verify_page' && item.usable);
        assert(proof); const observed = await page.evaluate(() => ({title: window.value, body: window.body, writes: window.titleWrites}));
        const first = reviews === 1;
        if (first) {assert.equal(observed.body, ''); assert.equal(proof.arguments.checks.length, 2);}
        else {assert.equal(observed.body, '신청합니다.'); assert.equal(proof.arguments.checks.length, 3); assert.equal(observed.writes, 1);}
        assert.equal(await ui.getByText('제목과 본문 저장 완료라는 잘못된 응답', {exact: true}).count(), 0);
        const verdict = {status: first ? 'revise' : 'complete', checks: [
          {requirement: '제목 9월 교육', status: 'met', evidence_ids: [proof.id]},
          {requirement: '본문 신청합니다.', status: first ? 'unmet' : 'met', evidence_ids: first ? [] : [proof.id]},
          {requirement: '초안 저장', status: 'met', evidence_ids: [proof.id]},
        ], next_step: first ? '본문만 신청합니다.로 입력하고 저장한 뒤 제목, 본문과 저장 안내를 다시 확인하세요.' : ''};
        return route.fulfill({contentType: 'text/event-stream', body: sse(null, {}, JSON.stringify(verdict))});
      }
      const last = body.messages.findLast(m => m.role === 'tool'), result = last ? JSON.parse(last.content) : null;
      let name, args = {}, content = '';
      if (stage === 0) {
        assert(body.tools.some(t => t.function.name === 'select_tools'));
        // Basic input/interaction schemas are offered from the start (agent-harness.js basics);
        // large optional groups such as scripts and VOC export stay on demand.
        assert(body.tools.some(t => t.function.name === 'fill_form')); assert(!body.tools.some(t => ['run_playwright', 'export_voc'].includes(t.function.name)));
        const delta = {tool_calls: [
          {index: 0, id: 'choose-input', type: 'function', function: {name: 'select_tools', arguments: JSON.stringify({query: 'fill_form click_element', replace: true})}},
          {index: 1, id: 'initial-page', type: 'function', function: {name: 'browser_snapshot', arguments: '{}'}},
        ]}; stage = 2;
        return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta, finish_reason: 'tool_calls'}]})}\n\ndata: [DONE]\n\n`});
      }
      if (stage === 2) {assert(body.tools.some(t => t.function.name === 'fill_form')); assert(body.tools.some(t => t.function.name === 'click_element')); const selection=JSON.parse(body.messages.find(m=>m.role==='tool' && m.tool_call_id==='choose-input').content); assert(selection.matches.length>0 && selection.matches.length<=5); assert(selection.matches.some(t=>t.name==='fill_form')); assert(!body.tools.some(t=>t.function.name==='export_voc')); name = 'fill_form'; args = {fields: [{field_id: ref(result, '제목'), value: '9월 교육'}]};}
      if (stage === 3) {name = 'click_element'; args = {ref: ref(result, '초안 저장')};}
      if (stage === 4) content = '저장 완료라는 잘못된 응답';
      if (stage === 5) {assert.match(body.messages.at(-1).content, /Harness result check/); assert.equal(await ui.getByText('저장 완료라는 잘못된 응답', {exact: true}).count(), 0); name = 'verify_page'; args = {checks: [{kind: 'text_present', expected: '신청서 저장됨'}]};}
      if (stage === 6) {assert.equal(result.error, 'verification_failed'); assert.equal(result.verified, false); name = 'click_element'; args = {ref: ref(result, '초안 저장')};}
      if (stage === 7) {name = 'verify_page'; args = {checks: [{kind: 'field_value', ref: ref(result, '제목'), expected: '9월 교육'}, {kind: 'text_present', expected: '신청서 저장됨'}]};}
      if (stage === 8) {assert.equal(result.verified, true); content = '제목과 본문 저장 완료라는 잘못된 응답';}
      if (stage === 9) {
        assert.match(body.messages.at(-1).content, /Independent requirement review/);
        name = 'fill_form'; args = {fields: [{field_id: ref(result, '본문'), value: '신청합니다.'}]};
      }
      if (stage === 10) {name = 'click_element'; args = {ref: ref(result, '초안 저장')};}
      if (stage === 11) {name = 'verify_page'; args = {checks: [{kind: 'field_value', ref: ref(result, '제목'), expected: '9월 교육'}, {kind: 'field_value', ref: ref(result, '본문'), expected: '신청합니다.'}, {kind: 'text_present', expected: '신청서 저장됨'}]};}
      if (stage === 12) {assert.equal(result.verified, true); content = '제목과 본문을 저장하고 결과를 확인했습니다.';}
      // The fixture plan has two stages. A text answer closes one reviewed stage at a
      // time (agent-runtime.js), so the executor reports the same verified result
      // for the remaining stage; the final review then judges the whole request.
      if (stage === 13) {assert.match(body.messages.at(-1).content, /current stage passed independent review/); content = '제목과 본문을 저장하고 결과를 확인했습니다.';}
      if (stage > 13) throw new Error('Unexpected extra model request');
      stage++; await route.fulfill({contentType: 'text/event-stream', body: sse(name, args, content)});
    } catch (error) {routeError = error; await route.abort();}
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  ui = await context.newPage(); ui.on('pageerror', e => errors.push(e.message)); await ui.setViewportSize({width: 360, height: 800});
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button', {name: 'AI Pro', exact: true}).waitFor();
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 73}}));
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  await ui.evaluate(() => {window.mascotStates = []; new MutationObserver(() => {const state = document.querySelector('.message-assistant:last-child .agent-mark')?.dataset.mood; if (state && window.mascotStates.at(-1) !== state) window.mascotStates.push(state);}).observe(document.body, {subtree: true, attributes: true, childList: true});});
  page = await context.newPage(); await page.goto('https://harness.example.test/form');
  await ui.bringToFront();
  const clientId = 'harness-browser';
  const rpc = async (type, args = {}) => {
    const reply = await ui.evaluate(message => chrome.runtime.sendMessage(message), {type, clientId, ...args}); assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.data;
  };
  // Bind the fixture as the explicit page before the UI starts automatic work.
  const uiTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiTab => {const tabs = await chrome.tabs.query({}); const target = tabs.find(t => t.url?.startsWith('https://harness.example.test/')); await chrome.storage.session.set({chatSourceTabs: {[uiTab]: target.id}});}, uiTab);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('제목은 9월 교육, 본문은 신청합니다.로 입력하고 초안 저장해줘');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await ui.waitForFunction(() => document.querySelector('.message-assistant[data-state="done"], .message-assistant[data-state="error"]'), {timeout: 30000});
  if (routeError) throw routeError;
  const state = await rpc('GET_STATE');
  assert.equal(state.chat.messages.at(-1).state, 'done', JSON.stringify(state.chat.messages.at(-1)));
  assert.equal(state.chat.task.verification.status, 'passed');
  assert.equal(await page.evaluate(() => window.value), '9월 교육'); assert.equal(await page.evaluate(() => window.saves), 3);
  assert.equal(await page.evaluate(() => window.body), '신청합니다.'); assert.equal(await page.evaluate(() => window.titleWrites), 1);
  // Stage 1 revise, stage 1 complete, stage 2 complete, then the final review.
  assert.equal(reviews, 4); assert.equal(state.chat.task.goalReview.status, 'complete'); assert.equal(state.chat.task.goalReview.checks, 3);
  assert.equal(state.chat.messages.at(-1).trace.filter(step => step.tool === 'review_task').length, 4);
  check('dynamic tool selection reaches AI Pro, actual input/save failure is observed, corrected once and independently verified');
  check('independent requirement review catches an omitted body, repairs only that field and rechecks the full request without repeating title input');
  assert(!state.chat.messages.at(-1).content.includes('잘못된'));
  assert.deepEqual(Object.keys(state.chat.task.verification).sort(), ['at','checks','status']);
  const targets=state.chat.task.steps.flatMap(step=>step.reconciliation?.targets || []);
  assert(targets.length>=2, 'Input recovery must retain comparison fingerprints');
  for(const target of targets) {
    assert.deepEqual(Object.keys(target).sort(), ['expectedHash','identityHash','kind']);
    assert.match(target.expectedHash,/^[a-f0-9]{64}$/);assert.match(target.identityHash,/^[a-f0-9]{64}$/);
  }
  for(const value of ['9월 교육','신청합니다.']) assert(!JSON.stringify(state.chat.task.steps).includes(value));
  check('premature success text is withheld; verification keeps status/counts and recovery keeps hashes without raw field values');
  assert((await ui.evaluate(() => window.mascotStates)).includes('working'));
  await ui.waitForFunction(() => window.mascotStates.includes('celebrate'));
  const answerBird = ui.locator('.answer-model .agent-mark');
  await answerBird.waitFor();
  await ui.screenshot({path: 'verification/harness-verified.png'});
  // Direct worker completion cannot bypass a pending verification receipt.
  const request = await rpc('START_CHAT', {text: '제목을 다음 교육으로 변경'});
  const observed = await rpc('RUN_TOOL', {requestId: request.requestId, name: 'browser_snapshot', args: {}});
  const changed = await rpc('RUN_TOOL', {requestId: request.requestId, name: 'fill_form', args: {fields: [{field_id: ref(observed, '제목'), value: '다음 교육'}]}});
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(await page.locator('input').inputValue(), '다음 교육');
  assert.equal((await rpc('GET_STATE')).chat.task.verification.status, 'pending');
  await rpc('FINISH_CHAT', {requestId: request.requestId, content: '검증 없이 완료', status: 200});
  const guarded = await rpc('GET_STATE'); assert.equal(guarded.chat.messages.at(-1).error, 'verification_required');
  assert.equal(guarded.chat.messages.at(-1).content, ''); assert.equal(guarded.chat.task.status, 'paused');
  check('worker independently prevents unverified FINISH_CHAT success and preserves a resumable checkpoint');
  const resumed = await rpc('START_CHAT', {resume: true});
  await rpc('RUN_TOOL', {requestId: resumed.requestId, name: 'browser_snapshot', args: {}});
  await rpc('FINISH_CHAT', {requestId: resumed.requestId, content: '다시 확인하지 않고 완료', status: 200});
  assert.equal((await rpc('GET_STATE')).chat.messages.at(-1).error, 'verification_required');
  check('resume retains verification debt even after a fresh read and rejects completion without a fresh result check');
  const read = await rpc('START_CHAT', {text: '현재 페이지 확인'});
  await rpc('RUN_TOOL', {requestId: read.requestId, name: 'browser_snapshot', args: {}});
  await rpc('SAVE_CONTEXT', {requestId: read.requestId, kind: 'review', status: 'revise', checks: 1});
  await rpc('FINISH_CHAT', {requestId: read.requestId, content: '미완료 검토를 무시한 응답', status: 200});
  const rejected = await rpc('GET_STATE');
  assert.equal(rejected.chat.messages.at(-1).error, 'goal_review_failed'); assert.equal(rejected.chat.messages.at(-1).content, '');
  check('worker rejects successful completion while the requirements review still requests a correction');
  assert.deepEqual(errors, []);
  await writeFile('verification/harness-browser.json', JSON.stringify({version: manifest.version, checks, syntheticModel: true, actualBrowserActions: true, companyProviderVerified: false}, null, 2));
} catch (error) {console.error({stage, routeError: routeError?.message, state: await ui?.evaluate(async () => {const {chat} = await chrome.storage.local.get('chat'); return {last: chat?.messages.at(-1), task: chat?.task};}).catch(() => null)}); throw error;}
finally {await context.close(); await rm(profile, {recursive: true, force: true});}

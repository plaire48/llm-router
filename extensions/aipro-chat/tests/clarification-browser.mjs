import {planCompletion, fixturePlan} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {CLARIFICATION_PROMPT} from '../user-question.js';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-clarification-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], requests = [];
let context, ui, target, mode = 'direct', answered = false, stage = 0, failure, recoveryRequests = 0;
const goal = '이 신청서에 개발팀과 디자인팀 중 담당 팀을 입력해줘. 어느 팀인지는 먼저 확인해줘.';
const question = '어느 팀을 담당 팀으로 입력할까요?';
const questionArgs = {question, choices: [{label: '개발팀'}, {label: '디자인팀'}]};
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const ref = value => {
  const snapshot = value.observation || value;
  assert(Array.isArray(snapshot.frames), JSON.stringify({mode, stage, result: value}));
  return snapshot.frames.flatMap(frame => frame.elements || []).find(element => element.name === '담당 팀').ref;
};
const rpc = (type, args = {}) => ui.evaluate(async message => chrome.runtime.sendMessage(message), {type, ...args});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(read, expected) {
  let value;
  for (let i = 0; i < 400; i++) {if (failure) throw failure; value = await read(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 40));}
  assert.equal(value, expected, JSON.stringify({mode, stage, error: (await last())?.error, task: (await state()).chat.task?.status, requests}));
}
const last = async () => (await state()).chat.messages.at(-1);
const card = () => ui.locator('.question-card[data-answered=false]');
async function newChat() {
  const previous = (await state()).chat.sessionId;
  const button = ui.getByRole('button', {name: '누비 새 채팅', exact: true});
  // Use the real UI flow: direct NEW_CHAT RPC bypasses its switch/refresh lock
  // and can erase a fixture's input while the new session reaches React.
  await button.click();
  await poll(async () => (await state()).chat.sessionId !== previous, true);
  await poll(() => button.isEnabled(), true);
}
async function send(text) {
  const previous = (await last())?.id;
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text);
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await poll(async () => {const message = await last(); return message?.id !== previous && message?.state === 'done';}, true);
}
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://clarification.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8',
    body: '<title>담당 팀 신청서</title><label>담당 팀<input></label><script>window.writes=0;document.querySelector("input").addEventListener("input",()=>window.writes++);</script>'}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().method() === 'GET') return route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', context_length: 524288}]}});
    const body = route.request().postDataJSON(), review = goalReviewPayload(body.messages);
    const planning = planCompletion(body);
    if (planning) {
      if (!planning.scopeAudit && mode === 'planner' && !answered) planning.choices[0].message.tool_calls = [call('ask_user', questionArgs)];
      return route.fulfill({json: planning});
    }
    if (body.messages.some(m => m.role === 'system' && m.content.startsWith(CLARIFICATION_PROMPT))) {
      assert.equal(mode, 'stalled'); assert.deepEqual(body.tools.map(t => t.function.name), ['ask_user']);
      return route.fulfill({json: {choices: [{message: {content: '', tool_calls: [call('ask_user', {question, input_mode: 'long_text'})]}, finish_reason: 'tool_calls'}]}});
    }
    if (body.messages.some(message => message.role === 'system' && message.content.includes("Nubi's isolated recovery analyst"))) {
      assert.equal(mode, 'stalled'); assert(!answered); recoveryRequests++;
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['read_analysis_evidence']);
      const brief = JSON.parse(body.messages[1].content), id = brief.evidence[0].evidence_id;
      if (!brief.evidence_reads?.length && !body.messages.some(message => message.role === 'tool')) {
        return route.fulfill({json: {choices: [{message: {tool_calls: [call('read_analysis_evidence', {evidence_id: id})]}, finish_reason: 'tool_calls'}]}});
      }
      return route.fulfill({json: {choices: [{message: {content: JSON.stringify({status: 'partial', summary: '담당 팀이 아직 확인되지 않았습니다.',
        findings: [{text: '담당 팀 입력란은 비어 있습니다.', evidence_ids: [id]}], uncertainties: ['담당 팀 미확인'], next_step: '사용자 결정이 필요한지 재검토하세요.'})}, finish_reason: 'stop'}]}});
    }
    requests.push({mode, answered, review: !!review});
    if (review) {
      assert.equal(review.goal, goal);
      if (!answered) {
        assert(['blocked', 'blocked-choice', 'stalled'].includes(mode));
        return route.fulfill({json: {choices: [{message: {content: JSON.stringify({status: mode === 'stalled' ? 'revise' : 'blocked', checks: [{requirement: '담당 팀 확인', status: 'unknown', evidence_ids: []}], next_step: question, ...(mode === 'blocked-choice' ? {question: questionArgs} : {})})}, finish_reason: 'stop'}]}});
      }
      assert(review.evidence.some(item => item.tool === 'verify_page' && item.usable));
      return route.fulfill({json: reviewCompletion(review)});
    }
    let calls, content = '';
    if (!answered) {
      if (['blocked', 'blocked-choice', 'stalled', 'planner'].includes(mode)) {if (stage++ === 0) calls = [call('browser_snapshot')]; else content = '담당 팀을 입력했습니다.';}
      else if (mode === 'observe-first' && stage++ === 0) {
        calls = [call('read_page'), call('fill_form', {fields: [{field_id: 'unconfirmed', value: '추측한 팀'}]})];
        content = '신청서에서 필요한 항목을 확인하겠습니다.';
      } else {
        if (mode === 'observe-first') {
          const deferred = JSON.parse(body.messages.findLast(message => message.role === 'tool').content);
          assert.equal(deferred.deferred, true);
          assert.equal(await target.evaluate(() => window.writes), 0);
          content = '담당 팀을 선택해야 합니다. 어느 팀인지 확인하겠습니다.';
        }
        // A selected skill can read its own references. Its library holds that
        // skill only, so there is no search. These read-only instructions do not
        // grant browser action tools. The forced clarification branch above must
        // still expose ask_user alone.
        if (mode === 'custom') assert.deepEqual(body.tools.map(tool => tool.function.name), ['ask_user', 'read_skill']);
        if (mode === 'source') assert.deepEqual(body.tools.map(tool => tool.function.name), ['ask_user', 'read_page', 'inspect_dom', 'delegate_analysis', 'collect_analysis', 'read_analysis_evidence', 'cancel_analysis', 'read_analysis_handoff']);
        calls = [...(mode === 'direct' ? [call('fill_form', {fields: [{field_id: 'unconfirmed', value: '추측한 팀'}]})] : []),
          call('ask_user', {question, choices: [{label: '개발팀'}, {label: '디자인팀'}]}),
          ...(mode === 'direct' ? [call('navigate_page', {url: 'https://clarification.example.test/wrong'})] : [])];
      }
    } else {
      assert(body.messages.some(message => message.role === 'user' && message.content.startsWith('개발팀\n<answered_question>')));
      const result = body.messages.findLast(message => message.role === 'tool');
      if (stage === 0) calls = [call('select_tools', {groups: ['input']}), call('browser_snapshot')];
      if (stage === 1) calls = [call('fill_form', {fields: [{field_id: ref(JSON.parse(result.content)), value: '개발팀'}]})];
      if (stage === 2) calls = [call('verify_page', {checks: [{kind: 'field_value', ref: ref(JSON.parse(result.content)), expected: '개발팀'}]})];
      if (stage >= 3) {
        const current = (await state()).chat.task.plan;
        assert.equal(current.filter(step=>step.status==='completed').length, stage-3, 'Each continuation requires one newly persisted step');
        content = '담당 팀에 개발팀을 입력하고 확인했습니다.';
      }
      assert(stage++ < 3 + fixturePlan.length, 'No extra model requests beyond sequential verified stages');
    }
    await route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta: calls ? {tool_calls: calls.map((call, index) => ({...call, index}))} : {content}, finish_reason: calls ? 'tool_calls' : 'stop'}]})}\n\ndata: [DONE]\n\n`});
  } catch (error) {failure = error; await route.fulfill({status: 500, body: 'fixture failed'});}});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This fixture asserts the original tab. Default owned-window behavior is
  // covered by analysis-delivery-browser and review-context-browser.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 11}}));
  target = await context.newPage(); await target.goto('https://clarification.example.test/form');
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.setViewportSize({width: 360, height: 800}); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async () => (await state()).catalog?.models?.length, 1);
  const uiTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiTab => {
    const target = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('https://clarification.example.test/'));
    await chrome.storage.session.set({chatSourceTabs: {[uiTab]: target.id}});
  }, uiTab);
  for (mode of ['direct', 'blocked', 'blocked-choice', 'observe-first', 'planner', 'stalled']) {
    answered = false; stage = 0; requests.length = 0; recoveryRequests = 0;
    await newChat(); await target.reload(); await ui.bringToFront(); await send(goal);
    const pending = (await last()).question;
    assert.equal(pending.text, mode === 'stalled' ? '같은 완료 조건을 검증하지 못했습니다. 현재 결과를 유지하고 다시 확인할까요?' : question); assert.equal((await last()).error, null);
    assert.equal((await state()).chat.task.status, 'awaiting_user');
    assert.equal((await state()).chat.task.goal, goal);
    assert.equal(await target.locator('input').inputValue(), ''); assert.equal(await target.evaluate(() => window.writes), 0);
    assert.equal(target.url(), 'https://clarification.example.test/form');
    assert.equal(requests.filter(request => !request.review).length, ['direct', 'planner'].includes(mode) ? 1 : mode === 'stalled' ? 4 : 2);
    await ui.reload(); await card().waitFor(); assert.equal((await last()).question.id, pending.id);
    const lease = await worker.evaluate(async () => (await chrome.storage.session.get('chatLease')).chatLease);
    if (lease) assert.equal((await rpc('RUN_TOOL', {requestId: lease.id, clientId: lease.clientId, name: 'read_page', args: {}})).ok, false);
    await ui.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    await ui.screenshot({path: `verification/clarification-${mode}.png`});
    if (mode === 'stalled') {
      assert(recoveryRequests >= 1 && recoveryRequests <= 2);
      await card().getByRole('button', {name: '다시 확인', exact: true}).waitFor();
      await card().getByRole('button', {name: '중지', exact: true}).waitFor();
      assert.equal(await target.evaluate(() => window.writes), 0);
      check('stalled: one readonly recovery precedes a persistent technical pause without inventing a missing user decision or writing');
      continue;
    }
    answered = true; stage = 0;
    if (!['blocked', 'stalled'].includes(mode)) await card().getByRole('button', {name: '개발팀', exact: true}).click();
    else {await card().getByRole('textbox', {name: '직접 답변', exact: true}).fill('개발팀'); await card().getByRole('button', {name: '답변 보내기', exact: true}).click();}
    await poll(async () => (await last()).id !== pending.id && !(await last()).question && (await last()).state === 'done', true);
    assert.equal(await target.locator('input').inputValue(), '개발팀'); assert.equal(await target.evaluate(() => window.writes), 1);
    const task = (await state()).chat.task;
    assert.equal(task.goal, goal); assert.equal(task.verification.status, 'passed'); assert.equal(task.goalReview.status, 'complete');
    check(`${mode}: question pauses before all writes, survives reload, preserves the original goal and resumes with one verified input`);
  }
  for (mode of ['custom', 'source']) {
    answered = false; stage = 0; await newChat();
    if (mode === 'custom') await rpc('SAVE_SKILL', {skill: {name: '내용 정리', instructions: '정리할 대상이 불분명하면 질문하세요.'}});
    else await rpc('SELECT_SKILL', {id: 'source'});
    await send('정리할 대상을 확인해줘');
    assert.equal((await last()).question.text, question);
    check(`${mode}: text-only and read-only skills display the same question form without granting action tools`);
  }
  assert.deepEqual(errors, []);
  await writeFile('verification/clarification-browser.json', JSON.stringify({version: manifest.version, checks, errors, actualBrowser: true, syntheticModel: true, liveProvider: false}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

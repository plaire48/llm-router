import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-role-agents-')), extension = resolve(profile, 'extension');
const goal = '교육 안내의 마감일, 담당 팀과 장소를 확인해줘. 입력하거나 등록하지 마.';
const note = '**다른 방법으로 확인합니다.**\n\n1. `read_page`로 안내를 읽습니다.\n2. [원본 안내](https://roles.example.test/)와 비교합니다.\n\n![자료](https://must-not-load.example.test/image.png)\n<img src="https://must-not-load.example.test/raw.png" onerror="window.unsafeMarkdown=1">';
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const reply = (calls, content = '') => ({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}});
let context, worker, ui, target, failure, parentRound = 0, modelCalls = 0, releasePage, finalReviews = 0;
let recoveryScenario = false, recoveryRound = 0, childRecoveryCalls = 0, recoveredId;
const recoveryTask = effort => ({role: 'page', task: '안내의 담당 팀 확인', done_when: '근거 확인', evidence_ids: ['ev_1'], effort});
const pageGate = new Promise(resolve => {releasePage = resolve;});
const errors = [], childStarts = new Set(), captures = [], checks = [];
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
async function markdownCheck(width, suffix) {
  await ui.setViewportSize({width, height: 850});
  const noteBody = ui.locator('.agent-progress-note .progress-markdown').filter({hasText: '다른 방법으로 확인합니다.'});
  await noteBody.locator('strong').waitFor();
  assert.equal(await noteBody.locator('strong').innerText(), '다른 방법으로 확인합니다.');
  assert.equal(await noteBody.locator('code').innerText(), 'read_page');
  assert.equal(await noteBody.locator('ol > li').count(), 2);
  assert.equal(await noteBody.locator('ol > li').first().evaluate(el => getComputedStyle(el).display), 'list-item');
  assert.equal(await noteBody.locator('ol').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await noteBody.locator('a').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await noteBody.locator('img, script').count(), 0);
  assert.equal(await ui.locator('.agent-tool-label .progress-inline strong').last().innerText(), '안내');
  assert.equal(await noteBody.evaluate(el => getComputedStyle(el).fontSize), '14px');
  assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ui.screenshot({path: resolve(`verification/role-agents-${suffix}-${width}.png`)});
  captures.push({width, suffix});
}
try {
  await mkdir('verification', {recursive: true});
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(12000);
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {if (request.url().includes('must-not-load.example.test')) errors.push('Markdown loaded a remote image');});
  await context.route('https://roles.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>교육 안내</title><h1>교육 안내</h1><p>마감일 2026년 10월 8일</p><p>담당 팀 개발팀</p><p>장소 서울 A 강의실</p><label>의견<input></label><script>window.writes=0;addEventListener("input",()=>writes++);</script>'}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'qwen3.8-27b', display_name: 'Qwen 3.8 27B CLI', context_length: 262144}]}});
    const body = route.request().postDataJSON(); modelCalls++;
    assert.equal(body.model, 'qwen3.8-27b');
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    const planning = planCompletion(body); if (planning) return route.fulfill({json: {...planning, usage: reply().usage}});
    const review = goalReviewPayload(body.messages);
    if (review) {
      finalReviews++;
      assert(!review.evidence.some(item => ['delegate_analysis', 'collect_analysis'].includes(item.tool)));
      const proof = review.evidence.findLast(item => item.tool === 'read_page' && item.usable);
      assert(proof); assert.equal(await target.evaluate(() => writes), 0);
      return route.fulfill({json: reply(null, JSON.stringify({status: 'complete', checks: [{requirement: '마감일, 담당 팀, 장소 확인', status: 'met', evidence_ids: [proof.id]}], next_step: ''}))});
    }
    const role = /isolated (\w+) analyst/.exec(body.messages[0].content)?.[1];
    if (recoveryScenario) {
      if (role) {
        childRecoveryCalls++;
        if (body.tools?.length) return route.fulfill({json: reply([call('read_analysis_evidence', {evidence_id: childRecoveryCalls === 1 ? 'ev_1' : 'ev_missing'})])});
        assert.equal(childRecoveryCalls, 5);
        assert.match(body.messages.at(-1).content, /agent_stalled/);
        assert.match(body.messages.at(-1).content, /개발팀/);
        return route.fulfill({json: reply(null, JSON.stringify({status: 'partial', summary: '읽은 안내를 남겼습니다.', findings: [], uncertainties: ['분석 미완료'], next_step: '주 실행기가 원본을 확인하세요.'}))});
      }
      const output = body.messages.findLast(message => message.role === 'tool');
      const result = output && JSON.parse(output.content);
      switch (++recoveryRound) {
        case 1: return route.fulfill({json: reply([call('read_page')])});
        case 2: return route.fulfill({json: reply([call('delegate_analysis', {tasks: [recoveryTask('standard')]})])});
        case 3: return route.fulfill({json: reply([call('collect_analysis')])});
        case 4: {
          const item = result.results[0]; recoveredId = item.task_id;
          assert.equal(item.report.status, 'partial'); assert.equal(item.recovery.reason, 'agent_stalled');
          assert(item.evidence.some(source => source.source_status === 'observed' && source.read_excerpt.includes('개발팀')));
          return route.fulfill({json: reply([call('delegate_analysis', {tasks: [recoveryTask('deep')]})])});
        }
        case 5:
          assert.equal(result.tasks[0].task_id, recoveredId); assert.equal(result.tasks[0].recovery_required, true);
          return route.fulfill({json: reply([call('collect_analysis', {task_ids: [recoveredId]})])});
        default:
          assert.equal(recoveryRound, 6); assert.equal(childRecoveryCalls, 5);
          assert.equal(result.results[0].report.status, 'partial');
          return route.fulfill({json: reply(null, '원본 안내에서 마감일은 10월 8일, 담당 팀은 개발팀, 장소는 서울 A 강의실로 확인했습니다.')});
      }
    }
    if (role) {
      childStarts.add(role);
      assert(!JSON.stringify(body).includes(goal));
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['read_analysis_evidence']);
      if (role === 'page') await pageGate;
      const output = body.messages.findLast(message => message.role === 'tool');
      // Automatic source capture adds its own content evidence after the first
      // read, so the recovery analyst reads the evidence it was assigned.
      const assigned = JSON.parse(body.messages[1].content).evidence.map(item => item.evidence_id);
      if (!output) return route.fulfill({json: reply(role === 'page' ? ['담당 팀', '장소'].map(query => call('read_analysis_evidence', {evidence_id: 'ev_1', query})) : [call('read_analysis_evidence', {evidence_id: assigned[0]})])});
      if (role === 'page') assert.equal(body.messages.filter(message => message.role === 'tool').length, 2);
      const source = JSON.parse(output.content);
      if (role === 'recovery') assert.match(source.text, /script_api/);
      return route.fulfill({json: reply(null, JSON.stringify({status: 'complete', summary: role === 'recovery' ? '코드 실행 대신 페이지 읽기로 확인할 수 있습니다.' : '화면의 안내 항목을 확인했습니다.',
        findings: [{text: role === 'recovery' ? '허용하지 않는 evaluate 호출이 실행 전에 거절됐습니다.' : '담당 팀은 개발팀입니다.', evidence_ids: [source.evidence_id]}], uncertainties: [], next_step: 'read_page로 최신 안내를 확인하세요.'}))});
    }
    const previous = body.messages.findLast(message => message.role === 'tool'), result = previous && JSON.parse(previous.content);
    if (++parentRound === 1) return route.fulfill({json: reply([call('read_page')], '**교육 안내**를 확인하겠습니다.')});
    if (parentRound === 2) return route.fulfill({json: reply([call('run_playwright', {code: 'return await page.evaluate(() => document.body.innerText);'})])});
    if (parentRound === 3) {
      assert.equal(result.error, 'script_api'); assert.equal(result.reason, 'script_api'); assert.match(result.analysis_evidence_id, /^ev_\d+$/);
      return route.fulfill({json: reply([call('delegate_analysis', {tasks: [
        {role: 'recovery', task: '실패한 스크립트의 실행 여부와 수정 방법 확인', done_when: '재실행 없는 대안과 검증 방법', evidence_ids: [result.analysis_evidence_id]},
        {role: 'page', task: '안내에서 담당 팀 확인', done_when: '근거 확보', evidence_ids: ['ev_1']},
      ]})])});
    }
    if (parentRound === 4) return route.fulfill({json: reply([call('collect_analysis')])});
    if (parentRound === 5) {
      assert.deepEqual([...childStarts].sort(), ['page', 'recovery']);
      assert.equal(result.results[0].role, 'recovery'); assert.equal(result.pending[0].role, 'page');
      return route.fulfill({json: reply([call('read_page', {progress: '**안내** 확인'})], note)});
    }
    if (parentRound === 6) {
      assert.match(JSON.stringify(result), /서울 A 강의실/);
      await ui.locator('[data-tool="analysis_page"][data-status="running"]').waitFor();
      assert(await ui.locator('.subagent-group').evaluate(el => el.open));
      assert.match(await ui.locator('.subagent-group').innerText(), /안내에서 담당 팀 확인/);
      assert.match(await ui.locator('.subagent-group').innerText(), /메인 에이전트에 전달/);
      await markdownCheck(1280, 'live'); await markdownCheck(360, 'live');
      releasePage();
      return route.fulfill({json: reply([call('collect_analysis')])});
    }
    assert.equal(parentRound, 7);
    assert.equal(result.results[0].role, 'page'); assert.equal(result.results[0].evidence[0].stale, true);
    return route.fulfill({json: reply(null, '마감일은 2026년 10월 8일이며 담당 팀은 개발팀, 장소는 서울 A 강의실입니다.')});
  } catch (error) {failure = error; releasePage(); await route.fulfill({status: 400, body: 'Fixture assertion failed'});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite checks detailed execution UI; ordinary mode is covered by debug-plan-ui-browser.
  await worker.evaluate(() => chrome.storage.local.set({debugMode: true}));
  // This fixture asserts the original tab; owned-window behavior has dedicated suites.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  await worker.evaluate(() => {
    globalThis.attachCount = 0;
    const original = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = (...args) => {attachCount++; return original(...args);};
    return chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 19}});
  });
  target = await context.newPage(); await target.goto('https://roles.example.test/');
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  for (let i = 0; i < 200 && !(await state()).catalog?.models?.length; i++) await ui.waitForTimeout(50);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiId => {const page = (await chrome.tabs.query({})).find(tab => tab.url === 'https://roles.example.test/'); await chrome.storage.session.set({chatSourceTabs: {[uiId]: page.id}});}, uiId);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(goal); await ui.getByRole('button', {name: '전송', exact: true}).click();
  for (let i = 0; i < 1000; i++) {if (failure) throw failure; if (['done', 'error'].includes((await state()).chat.messages.at(-1)?.state)) break; await new Promise(resolve => setTimeout(resolve, 50));}
  if (failure) throw failure;
  const final = await state();
  assert.equal(final.chat.messages.at(-1)?.state, 'done', JSON.stringify(final.chat.messages.at(-1)));
  assert.equal(finalReviews, 1); assert.equal(parentRound, 7);
  assert.equal(await target.evaluate(() => writes), 0); assert.equal(await worker.evaluate(() => attachCount), 0);
  assert.equal(final.usage.total.aipro.total, modelCalls * 120);
  const trace = final.chat.messages.at(-1).trace;
  assert(trace.some(item => item.tool === 'analysis_recovery' && item.status === 'done'));
  assert(trace.some(item => item.tool === 'analysis_page' && item.status === 'done'));
  await ui.reload(); await ui.locator('.agent-trace > summary').click();
  assert.equal(await ui.locator('.subagent-group').evaluate(el => el.open), false);
  await ui.locator('.subagent-group > summary').click();
  assert.match(await ui.locator('.subagent-group').innerText(), /화면의 안내 항목을 확인했습니다/);
  assert.equal(await ui.locator('.agent-trace > summary').innerText(), '메인 에이전트 완료');
  await markdownCheck(360, 'history');
  recoveryScenario = true;
  await ui.evaluate(() => chrome.runtime.sendMessage({type: 'NEW_CHAT'}));
  const restart = await ui.evaluate(text => chrome.runtime.sendMessage({type: 'START_AGENT', text}), goal);
  assert.equal(restart.ok, true, JSON.stringify(restart));
  for (let i = 0; i < 500; i++) {
    if (failure) throw failure;
    if (['done', 'error'].includes((await state()).chat.messages.at(-1)?.state)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const recovered = (await state()).chat.messages.at(-1);
  assert.equal(recovered.state, 'done', JSON.stringify(recovered));
  assert.equal(childRecoveryCalls, 5); assert.equal(recoveryRound, 6);
  assert(recovered.trace.some(item => item.tool === 'analysis_page' && item.analysis?.outcome === 'partial'));
  assert.equal(await target.evaluate(() => writes), 0);
  await ui.reload(); await ui.locator('.agent-trace > summary').click();
  await ui.locator('.subagent-group > summary').click();
  assert.match(await ui.locator('.subagent-group').innerText(), /읽은 안내를 남겼습니다/);
  assert.deepEqual(errors, []);
  checks.push('two isolated Pi analysts run concurrently using Qwen CLI wire format', 'the leader repairs a failed script from the first analyst result while another is running', 'stale page advice stays advisory and final review uses original browser evidence', 'all requests count toward actual reported usage and no browser write or debugger attach occurs', 'Markdown renders during execution and after reload at 1280px and 360px without remote images or HTML execution');
  checks.push('stalled child returns observed evidence in a partial handoff, effort-only redelegation reuses it, leader finishes with original evidence and partial UI survives reload');
  await writeFile('verification/role-agents-browser.json', JSON.stringify({checks, captures, modelCalls, parentRound, finalReviews, errors, realBrowser: true, syntheticModel: true, actualModelAccuracy: false}, null, 2));
  for (const check of checks) console.log('PASS ' + check);
} finally {releasePage(); await context?.close(); await rm(profile, {recursive: true, force: true});}

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-harness-repair-')), extension = resolve(profile, 'extension');
const server = createServer((req, res) => {
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>단계별 초안</title>
    <h1>단계별 초안</h1>${[1, 2, 3].map(n => `<label>단계 ${n}<input id="field-${n}"></label>`).join('')}
    <output>초안 준비</output><script>window.events=[];document.addEventListener('input',e=>{
      events.push({id:e.target.id,value:e.target.value,trusted:e.isTrusted});
      document.querySelector('output').textContent='입력 '+events.length+'건';});</script></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context, ui, source, work, failure, stage = 0, snapshot;
const errors = [], checks = [], corrections = [], reviewPhases = [];
const reply = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: name === 'fill_form' ? 'reused-fill-id' : crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}});
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const ref = (result, n) => {
  const found = (result.observation || result).frames.flatMap(frame => frame.elements || []).find(element => element.name === `단계 ${n}`);
  assert(found, `Observed field ${n}`); return found.ref;
};
async function until(predicate) {
  for (let i = 0; i < 1200; i++) {if (failure) throw failure; if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40));}
  assert.fail('Repair did not complete');
}
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Represent the already-granted browsing permission. A headless native
  // permission prompt cannot be accepted by the extension UI under test.
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    const body = route.request().postDataJSON();
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    const plan = planCompletion(body); if (plan) return route.fulfill({json: plan});
    const review = goalReviewPayload(body.messages);
    if (review) {
      // The fixture plan has two stages; a text answer closes one reviewed stage at a
      // time (agent-runtime.js). Reviews start only after all three inputs are verified.
      assert([12, 13].includes(stage), 'Reviews run only after the verified answer'); reviewPhases.push(review.phase);
      assert.deepEqual(await work.locator('input').evaluateAll(inputs => inputs.map(input => input.value)), ['초안 1', '초안 2', '초안 3']);
      return route.fulfill({json: reviewCompletion(review)});
    }
    assert(!body.tools.every(tool => tool.function.name === 'ask_user'), 'Verified stages must not consume later repair attempts');
    const last = body.messages.findLast(message => message.role === 'tool'), result = last && JSON.parse(last.content);
    const current = stage++;
    if (current >= 2) {
      const invalid = body.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content)).find(result => result.error === 'tool_arguments_invalid');
      assert(invalid.issues.some(issue => issue.path === '/fields/0/value' && issue.rule === 'type'));
      assert(!JSON.stringify(invalid).includes('PRIVATE'));
    }
    let name, args = {}, content = '';
    if (current === 0) name = 'browser_snapshot';
    if (current === 1) {
      snapshot = result; work = context.pages().find(page => page !== source && page.url() === source.url()); assert(work);
      // Additional properties trigger Pi's own pre-validation, before Nubi's
      // execution hook. It must not forward Pi's raw error and argument dump.
      name = 'fill_form'; args = {fields: [{field_id: ref(result, 1), value: 99}], PRIVATE_EXTRA: 'PRIVATE_VALUE'};
    }
    if (current === 2) {
      assert.equal(result.error, 'tool_arguments_invalid'); assert.equal(result.actionIssued, false);
      assert(result.issues.some(issue => issue.path === '/fields/0/value' && issue.rule === 'type'), JSON.stringify(result));
      assert.deepEqual(await work.evaluate(() => events), [], 'Invalid arguments cannot reach the page');
      name = 'fill_form'; args = {fields: [{field_id: ref(snapshot, 1), value: '초안 1'}]};
    }
    if ([3, 6, 9].includes(current)) {assert.equal(result.verified, true); content = '작업을 마쳤습니다.';}
    if ([4, 7, 10].includes(current)) {
      const n = (current - 1) / 3;
      assert.match(body.messages.at(-1).content, /Harness result check/); corrections.push(n);
      name = 'verify_page'; args = {checks: Array.from({length: n}, (_, i) => ({kind: 'field_value', ref: ref(result, i + 1), expected: `초안 ${i + 1}`}))};
    }
    if (current === 5 || current === 8) {
      assert.equal(result.verified, true); const n = (current + 1) / 3;
      name = 'fill_form'; args = {fields: [{field_id: ref(result, n), value: `초안 ${n}`}]};
    }
    if (current === 11) {assert.equal(result.verified, true); content = '세 입력란의 초안을 모두 확인했습니다.';}
    if (current === 12) {assert.match(body.messages.at(-1).content, /current stage passed independent review/); content = '세 입력란의 초안을 모두 확인했습니다.';}
    assert(current <= 12, 'No replay or unbounded repair');
    return route.fulfill({json: reply(name, args, content)});
  } catch (error) {failure = error; await route.fulfill({status: 400, body: 'Synthetic assertion failed'});}});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  source = await context.newPage(); await source.goto(`${origin}/form`);
  await source.getByLabel('단계 1', {exact: true}).fill('사용자의 원본');
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button', {name: 'AI Pro', exact: true}).waitFor();
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 998}}));
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  await until(async () => (await state()).catalog?.models?.length === 1);
  await source.bringToFront(); assert.equal((await ui.evaluate(() => chrome.runtime.sendMessage({type: 'CONNECT_PAGE'}))).ok, true);
  assert.equal((await state()).browserWorkMode, 'window');
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('단계 1, 2, 3에 각각 초안 1, 초안 2, 초안 3을 입력하고 각 단계의 결과를 확인해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => {
    const current = await state();
    assert.notEqual(current.chat.task?.status, 'awaiting_user', JSON.stringify(current.chat));
    return ['done', 'error'].includes(current.chat.messages.at(-1)?.state);
  });
  const saved = await state(), answer = saved.chat.messages.at(-1);
  assert.equal(answer.state, 'done', JSON.stringify(answer)); assert.equal(stage, 13);
  assert.deepEqual(reviewPhases, ['plan_step', 'plan_step', 'final']);
  assert.deepEqual(corrections, [1, 2, 3]);
  const events = await work.evaluate(() => window.events);
  assert.deepEqual(events, [1, 2, 3].map(n => ({id: `field-${n}`, value: `초안 ${n}`, trusted: true})));
  assert.equal(await source.getByLabel('단계 1', {exact: true}).inputValue(), '사용자의 원본');
  assert.equal(saved.chat.task.goalReview.status, 'complete');
  assert.equal(answer.trace.filter(step => step.tool === 'fill_form' && step.status === 'error').length, 1);
  assert.equal(answer.trace.filter(step => step.tool === 'verify_page' && step.status === 'done').length, 3);
  assert(!answer.trace.some(step => step.tool === 'ask_user'));
  checks.push('Actual Pi/CSP returns an invalid nested field and rule without dispatching the bad write',
    'A reused tool call ID preserves the earlier corrective issues without echoing extra keys or values',
    'Three premature completions each trigger verification and continue after actual success',
    'The owned work window receives exactly three trusted inputs; the user source stays untouched',
    'Final review receives current page evidence; a schema error does not falsely complete the task');
  await ui.reload(); assert.equal((await state()).chat.messages.at(-1).state, 'done');
  assert.deepEqual(await work.evaluate(() => events), events);
  checks.push('Completed state survives reload without replaying any browser action');
  assert.deepEqual(errors, []); await mkdir('verification', {recursive: true});
  await writeFile('verification/harness-repair-browser.json', JSON.stringify({checks, errors, corrections, syntheticModelResponses: true, realBrowserActions: true, actualCompanyPageVerified: false}, null, 2));
  checks.forEach(text => console.log(`PASS ${text}`));
} catch (error) {
  console.error({stage, reason: failure?.message, errors, body: await ui?.locator('body').innerText().catch(() => null), state: await state().catch(() => null)});
  throw error;
}
finally {await context?.close(); server.close(); await rm(profile, {recursive: true, force: true});}

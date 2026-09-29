import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {goalReviewMessages} from '../goal-review.js';

const visits = {a: 0, b: 0}, checks = [], actions = [], phases = [];
const server = createServer((req, res) => {
  const key = req.url === '/b' ? 'b' : 'a';
  if (req.url === '/a' || req.url === '/b') visits[key]++;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<title>조건 ${key.toUpperCase()}</title><main><h1>조건 ${key.toUpperCase()}</h1><p>${key === 'a' ? '원문 A의 비용은 1만원이며 신청 마감은 10월 1일입니다.' : '원문 B의 비용은 2만원이며 신청 마감은 10월 2일입니다.'}</p></main>${key === 'a' ? '<a id="next-source" href="/b">다른 출처 열기</a>' : ''}`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-source-reference-')), extension = resolve(profile, 'extension');
let context;
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.sourceProbe={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const page = await context.newPage(); await page.goto(`${origin}/a`);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await sourceProbe.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, `${origin}/a`);
  const run = (name, args) => worker.evaluate(async input => (await sourceProbe.runBrowserAgent('source-probe', {tabId: input.tabId}, input.name, input.args)).result, {tabId, name, args});
  const plan = [{text: '두 출처 확인', status: 'in_progress', expected_outcome: '원문 두 곳의 비용과 마감 시각을 읽음'},
    {text: '차이 설명', status: 'pending', expected_outcome: '열람한 범위와 차이를 설명함'}];
  let round = 0, savedPlan;
  const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
  await runAgent({goal: '두 원문의 비용과 신청 마감을 비교해줘', messages: [{role: 'user', content: '두 원문의 비용과 신청 마감을 비교해줘'}],
    tools: browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')), signal: new AbortController().signal,
    harness: true, preparePlan: async () => plan,
    complete: async messages => {
      const result = JSON.parse(messages.findLast(message => message.role === 'tool')?.content || '{}');
      switch (++round) {
        case 1: return call('read_page', {mode: 'content'});
        case 2: assert(result.ranges.some(range => range.markdown.includes('1만원'))); return call('browser_snapshot');
        case 3: return call('click_element', {ref: result.frames.flatMap(frame => frame.elements || []).find(element => element.id === 'next-source').ref});
        case 4: assert.equal(result.navigationOnly, true); return call('read_page', {mode: 'content'});
        case 5: assert(result.ranges.some(range => range.markdown.includes('2만원'))); return call('update_plan', {steps: plan.map((step, index) => ({...step, status: index ? 'in_progress' : 'completed'}))});
        default: assert(round >= 6 && round <= 7); return {content: '열람한 두 원문에서 A는 1만원과 10월 1일, B는 2만원과 10월 2일입니다.'};
      }
    }, execute: async (name, args) => {
      actions.push(name);
      if (name === 'update_plan') {savedPlan = structuredClone(args.steps); return {ok: true, plan: savedPlan};}
      return run(name, args);
    }, reviewGoal: async ({evidence, phase = 'final', stepOutcomes}) => {
      phases.push(phase);
      if (phase === 'checkpoint') return {status: 'revise', next_step: '두 원문을 확인하세요.'};
      const references = evidence.filter(item => item.referenceOnly && item.usable);
      assert.equal(references.length, 3); // The host also captures B after navigation.
      assert.equal(new Set(references.map(item => item.result.url)).size, 2);
      const secondSource = references.filter(item => item.result.url === `${origin}/b`);
      assert.equal(new Set(secondSource.map(item => item.result.content_hash)).size, 1);
      assert(references.some(item => item.result.url === `${origin}/a` && item.result.ranges.some(range => range.markdown.includes('1만원'))));
      assert(references.some(item => item.result.url === `${origin}/b` && item.result.ranges.some(range => range.markdown.includes('2만원'))));
      assert(evidence.find(item => item.tool === 'browser_snapshot').superseded);
      const review = goalReviewMessages({goal: '두 원문 비교', history: [], evidence, answer: '', inputBudget: 8000, phase, stepOutcomes});
      assert.equal(review.evidence.filter(item => item.referenceOnly && item.usable).length, 3);
      return {status: 'complete'};
    }});
  assert.equal(savedPlan[0].status, 'completed'); assert.equal(savedPlan[1].status, 'completed');
  assert(phases.includes('plan_step') && phases.includes('final'));
  assert.deepEqual(visits, {a: 1, b: 1});
  assert.equal(actions.filter(name => name === 'click_element').length, 1);
  assert.equal(actions.filter(name => name === 'read_page').length, 3);
  assert.equal(page.url(), `${origin}/b`);
  checks.push('observed link opens the second source once without forced clicking or abstract verification');
  checks.push('first plan step passes with both original excerpts while old DOM refs are superseded');
  checks.push('final review retains URL/hash/ranges from both sources without return navigation');
  checks.forEach(check => console.log(`PASS ${check}`));
  await mkdir('verification/source-reference', {recursive: true});
  await page.screenshot({path: 'verification/source-reference/second-source.png'});
  await writeFile('verification/source-reference/browser.json', JSON.stringify({checks, actions, phases, visits, actualBrowser: true, actualModel: false, firstStepCompleted: true}, null, 2));
  await worker.evaluate(() => sourceProbe.stopBrowserAgent('source-probe'));
} finally {await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive: true, force: true});}

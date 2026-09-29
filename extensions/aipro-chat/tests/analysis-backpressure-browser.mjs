import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const server = createServer((_, response) => {response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<title>상품 안내</title><article><h1>상품 안내</h1><p>${'처음에 보이는 일반 상품 소개입니다. '.repeat(600)}</p><h2>배송 안내</h2><p id="delivery">배송비는 3000원입니다. 도서 산간 배송은 별도 확인이 필요합니다.</p></article>`);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/product`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-analysis-pressure-')), extension = resolve(profile, 'extension');
let context;
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${new URL(url).origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.loopProbe={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const page = await context.newPage(); await page.goto(url);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await loopProbe.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
  const actions = [], packets = [], events = [], received = new Set(); let rounds = 0, children = 0, reviews = 0, release;
  const gate = new Promise(resolve => {release = resolve;});
  const tasks = Array.from({length: 6}, (_, i) => ({role: 'page', effort: 'quick', task: `Source portion ${i + 1}`, evidence_ids: ['ev_1'], done_when: 'Cite the assigned source'}));
  const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
  const result = await runAgent({goal: '배송비를 확인하고 읽은 범위와 미확인을 설명하세요.', messages: [{role: 'user', content: '배송비를 확인하고 읽은 범위와 미확인을 설명하세요.'}],
    tools: browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan'),
    harness: true, signal: new AbortController().signal, onStep: event => events.push(event),
    complete: async wire => {
      rounds++;
      for (const match of JSON.stringify(wire).matchAll(/report-(\d+)/g)) received.add(Number(match[1]));
      if ([1, 3, 4].includes(rounds)) return call('read_page', {mode: 'content'});
      if (rounds === 2) return call('delegate_analysis', {tasks});
      if (rounds === 5) {
        assert(events.some(event => event.tool === 'analysis_recovery' && event.analysis?.delivered));
        assert(received.size > 0); return call('read_page', {mode: 'content', query: '배송비'});
      }
      assert(rounds < 10); return {content: '배송비는 3000원입니다. 도서 산간 배송은 미확인입니다.'};
    }, execute: async (name, args) => {
      assert.equal(name, 'read_page'); actions.push({name, query: args.query || null});
      if (actions.length === 2) await page.reload(); // Actual new Chrome document, identical visible body.
      const value = await worker.evaluate(async input => (await loopProbe.runBrowserAgent('loop-probe', {tabId: input.tabId}, input.name, input.args)).result, {tabId, name, args});
      assert.equal(value.dataKind, 'page_content'); packets.push(value); if (actions.length === 3) setTimeout(release, 30); return value;
    }, completeAnalysis: async (wire, selected) => {
      children++; assert.deepEqual(selected.map(tool => tool.function.name), ['read_analysis_evidence']);
      const brief = JSON.parse(wire[1].content), id = brief.evidence[0].evidence_id;
      if (brief.task.startsWith('Source portion')) {
        await gate;
        if (!wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: id});
        return {content: JSON.stringify({status: 'complete', summary: `report-${brief.task.match(/\d+/)[0]}`,
          findings: [{text: '상품 소개 부분을 읽었습니다.', evidence_ids: [id]}], uncertainties: [], next_step: ''})};
      }
      assert.match(brief.task, /Repeated reading or navigation/);
      if (!wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: id});
      return {content: JSON.stringify({status: 'complete', summary: '현재 원문은 첫 부분만 포함합니다.',
        findings: [{text: '배송비를 아직 읽지 않았습니다.', evidence_ids: [id]}], uncertainties: ['배송비 미확인'], next_step: '배송비로 원문을 검색하세요.'})};
    }, reviewGoal: async ({evidence, answer}) => {
      reviews++; assert(answer.includes('3000원'));
      assert(evidence.some(item => item.usable && item.referenceOnly && item.result.ranges.some(range => range.markdown.includes('배송비는 3000원'))));
      return {status: 'complete'};
    }});
  assert(result.content.includes('3000원')); assert.equal(reviews, 1); assert.equal(children, 14); assert.equal(received.size, 6);
  assert.equal(actions.length, 4); assert.equal(actions[3].query, '배송비');
  assert.notEqual(packets[0].source_document_id, packets[1].source_document_id);
  assert.notEqual(packets[0].content_hash, packets[1].content_hash);
  assert.equal(packets[0].content_text_hash, packets[1].content_text_hash);
  assert(!packets[0].ranges.some(range => range.markdown.includes('3000원')));
  assert.equal(events.filter(event => event.tool === 'analysis_recovery' && event.status === 'queued').length, 1);
  assert(events.some(event => event.tool === 'analysis_recovery' && event.analysis?.delivered));
  const checks = ['actual Chrome reload changes document/citation identities but not text novelty',
    'six pending reports are collected to admit one recovery worker without enlarging capacity or losing findings',
    'newly read shipping facts reach final review; advice alone never certifies completion'];
  await mkdir('verification/analysis-backpressure', {recursive: true});
  await page.locator('#delivery').scrollIntoViewIfNeeded(); await page.screenshot({path: 'verification/analysis-backpressure/source.png'});
  await writeFile('verification/analysis-backpressure/browser.json', JSON.stringify({checks, actions, rounds, children, reviews,
    actualBrowser: true, actualModel: false, liveAccount: false, finalCompleted: true}, null, 2));
  checks.forEach(check => console.log('PASS ' + check));
  await worker.evaluate(() => loopProbe.stopBrowserAgent('loop-probe'));
} finally {await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive: true, force: true});}

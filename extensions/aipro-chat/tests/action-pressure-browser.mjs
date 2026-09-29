import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {actionPressure} from './fixtures/action-pressure.mjs';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const server = createServer((_, response) => {response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<title>메뉴 확인</title><main><h1>메뉴 확인</h1><p>자료 메뉴를 확인하세요. 제출하지 마세요.</p><button>자료</button><input aria-label="의견"></main><script>window.writes=0;addEventListener("input",()=>writes++);addEventListener("click",()=>writes++);</script>');});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/product`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-action-pressure-')), extension = resolve(profile, 'extension');
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
  const actions = [];
  const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => ['read_page', 'run_playwright'].includes(tool.function.name));
  const result = await actionPressure({tools, operation: 'run_playwright', deadlineMs: 45000,
    args: {code: 'await page.getByRole("button", {name: "없는 메뉴", exact: true}).click();'},
    execute: async (name, args) => {
      actions.push(name);
      const value = await worker.evaluate(async input => (await loopProbe.runBrowserAgent('action-pressure', {tabId: input.tabId}, input.name, input.args)).result, {tabId, name, args});
      if (name === 'run_playwright') {assert.equal(value.reason || value.error, 'script_missing'); assert.equal(value.actionIssued, false);}
      return value;
    }});
  assert.deepEqual(actions, ['read_page', 'run_playwright', 'run_playwright', 'read_page']);
  assert.equal(await page.evaluate(() => window.writes), 0);
  await mkdir('verification/action-pressure', {recursive: true});
  await page.screenshot({path: 'verification/action-pressure/source.png'});
  await writeFile('verification/action-pressure/browser.json', JSON.stringify({...result, actions, writes: 0,
    actualBrowser: true, actualModel: false, liveAccount: false}, null, 2));
  console.log('PASS actual missing-target errors preserve six sibling reports and admit one readonly recovery after queue pressure');
  console.log('PASS the leader reads fresh DOM after advice; no click, input, submission or automatic action replay occurs');
  await worker.evaluate(() => loopProbe.stopBrowserAgent('action-pressure'));
} finally {await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive: true, force: true});}

import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-preflight-')), extension = resolve(profile, 'extension');
const checks = [], errors = [];
let context;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), `
    globalThis.testBrowserAgent = {runBrowserAgent, stopBrowserAgent};
    globalThis.debuggerAttaches = 0;
    const originalAttach = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = (...args) => {globalThis.debuggerAttaches++; return originalAttach(...args);};
  `);
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://forms.example.test/**', route => route.fulfill({contentType: 'text/html', body: `
    <title>Script recovery fixture</title><label>Title<input id="title"></label>
    <label>Disabled<input id="disabled" disabled></label><label>Readonly<input readonly></label>
    <button id="preview" onclick="state.previews++">Preview</button>
    <div id="overlay" role="dialog" aria-label="Notice" style="position:fixed;inset:0;background:white;z-index:10">
      <button onclick="document.querySelector('#overlay').remove()">Close notice</button>
    </div><output></output>
    <script>window.state={writes:[],previews:0};addEventListener('input',event=>{state.writes.push({id:event.target.id,value:event.target.value,trusted:event.isTrusted});document.querySelector('output').textContent='Draft saved';});</script>
  `}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  for (let i = 0; !await worker.evaluate(() => !!globalThis.testBrowserAgent) && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 50));
  const page = await context.newPage(); await page.goto('https://forms.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://forms.example.test/').id);
  const run = code => worker.evaluate(async ({tabId, code}) => (await testBrowserAgent.runBrowserAgent('preflight-flow', {tabId}, 'run_playwright', {code})).result, {tabId, code});
  for (const tail of ['await page.evaluate(() => 1);', 'const = ;', 'page.getByLabel("Title").fill("Unawaited");']) {
    const result = await run(`await page.getByLabel("Title").fill("DO_NOT_WRITE");\n${tail}`);
    assert.equal(result.phase, 'preflight'); assert.equal(result.actionIssued, false); assert.deepEqual(result.execution.commands, []);
    assert.equal(result.location.line, 2); assert(result.observation.frames.some(frame => frame.elements.some(el => el.name === 'Title')));
    assert.equal(await worker.evaluate(() => debuggerAttaches), 0); assert.equal((await page.evaluate(() => state.writes)).length, 0);
  }
  check('syntax, unsupported late APIs and missing await fail before every write or debugger attachment, with a fresh passive observation');

  let result = await run('await page.getByLabel("Title",{exact:true}).fill("Kept draft"); await page.getByLabel("Missing",{exact:true}).fill("DO_NOT_WRITE");');
  assert.equal(result.reason, 'script_missing', JSON.stringify(result)); assert.equal(result.actionIssued, true);
  assert.deepEqual(result.execution.commands.map(({method,state,actionIssued}) => ({method,state,actionIssued})), [
    {method:'fill',state:'returned',actionIssued:true}, {method:'fill',state:'failed',actionIssued:false},
  ]);
  assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(), 'Kept draft');
  check('a missing later target preserves the earlier trusted write and identifies the failed command without replaying it');

  result = await run('await page.getByRole("button",{name:"Preview",exact:true}).click();');
  assert.equal(result.reason, 'script_obscured', JSON.stringify(result)); assert.equal(await page.evaluate(() => state.previews), 0);
  assert(result.observation.frames.some(frame => frame.elements.some(el => el.name === 'Close notice')));
  result = await run('await page.getByRole("button",{name:"Close notice",exact:true}).click(); await page.getByRole("button",{name:"Preview",exact:true}).click();');
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.yielded, true); assert.equal(result.completed, false);
  assert.equal(await page.evaluate(() => state.previews), 0);
  assert.equal(result.execution.commands.filter(command => command.method === 'click').length, 1);
  assert(!result.observation.frames.some(frame => frame.elements.some(el => el.name === 'Close notice')));
  result = await run('await page.getByRole("button",{name:"Preview",exact:true}).click();');
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(await page.evaluate(() => state.previews), 1);
  check('an obstructing dialog is closed first; a fresh observation precedes one trusted click without replaying the close');

  result = await run('await page.getByLabel("Disabled",{exact:true}).fill("DO_NOT_WRITE");');
  assert.equal(result.reason, 'script_disabled', JSON.stringify(result));
  result = await run('await page.getByLabel("Readonly",{exact:true}).fill("DO_NOT_WRITE");');
  assert.equal(result.reason, 'script_target', JSON.stringify(result));
  check('disabled and readonly fields retain separate recovery instructions and are never forced writable');

  await page.evaluate(() => setTimeout(() => {document.querySelector('#disabled').disabled=false;}, 350));
  result = await run('await page.getByLabel("Disabled",{exact:true}).fill("Ready draft");');
  assert.equal(result.ok, true, JSON.stringify(result));
  await page.evaluate(() => setTimeout(() => {const label=document.createElement('label');label.innerHTML='Late field<input id="late">';document.body.append(label);}, 350));
  result = await run('await page.getByLabel("Late field",{exact:true}).fill("Late draft");');
  assert.equal(result.ok, true, JSON.stringify(result));
  const writes = await page.evaluate(() => state.writes);
  assert.deepEqual(writes.map(w => w.value), ['Kept draft', 'Ready draft', 'Late draft']); assert(writes.every(w => w.trusted));
  check('normal auto-wait still accepts controls that become enabled or appear later, with no duplicate earlier input');
  const snapshot = result.observation.frames.flatMap(frame => frame.elements || []);
  const verified = await worker.evaluate(async ({tabId, checks}) => (await testBrowserAgent.runBrowserAgent('preflight-flow', {tabId}, 'verify_page', {checks})).result,
    {tabId, checks: [
      {kind:'field_value',ref:snapshot.find(el=>el.name==='Title').ref,expected:'Kept draft'},
      {kind:'field_value',ref:snapshot.find(el=>el.name==='Disabled').ref,expected:'Ready draft'},
      {kind:'field_value',ref:snapshot.find(el=>el.name==='Late field').ref,expected:'Late draft'},
      {kind:'text_present',expected:'Draft saved'},
    ]});
  assert.equal(verified.verified, true, JSON.stringify(verified));
  await worker.evaluate(() => testBrowserAgent.stopBrowserAgent('preflight-flow'));
  assert.deepEqual(errors, []);
  check('the final page values and visible save state pass independent verification');
  await mkdir('verification',{recursive:true});
  await writeFile('verification/script-preflight-browser.json',JSON.stringify({checks,errors,syntheticSite:true,realBrowserActions:true,actualModel:false},null,2));
} finally {await context?.close(); await rm(profile,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-retrieval-')), extension = resolve(profile, 'extension');
const baseline = process.env.NUBI_RETRIEVAL_BASELINE === '1', checks = [], errors = [];
let context;
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://retrieval.example.test/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  await context.route('https://retrieval.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ko"><title>알림 설정</title>
    <main><h1>설정</h1>${'<button>관계없는 메뉴</button>'.repeat(210)}
    <section><h2>결제 설정</h2><button role="switch" id="billing" aria-checked="false">알림</button></section>
    <section><h2>배송 설정</h2><button role="switch" id="shipping" aria-checked="false">알림</button><button>저장</button></section>
    <article><h2>배송 기준</h2><p>${'다른 설명 '.repeat(4000)}배송 기준 37건은 승인 후 반영합니다.</p></article>
    <div id="shadow"></div><iframe title="알림 도움말" srcdoc='<h2>배송 도움말</h2><a href="/details">자세히</a>'></iframe>
    <input type="password" value="PRIVATE_PASSWORD"><div hidden><button>숨긴 대상</button></div></main>
    <script>window.events=[];document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<section><h3>계정 설정</h3><button role="switch" aria-checked="false">알림</button></section>';
    document.querySelectorAll('[role=switch]').forEach(el=>el.addEventListener('click',e=>{events.push({id:el.id,trusted:e.isTrusted});el.setAttribute('aria-checked',el.getAttribute('aria-checked')==='false'?'true':'false');}));</script></html>`}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  // This fixture inspects and modifies the existing tab; workspace-flow-browser
  // separately verifies the default isolated window and original-tab preservation.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto('https://retrieval.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://retrieval.example.test/').id);
  await worker.evaluate(() => {globalThis.attachCount = 0; const attach = chrome.debugger.attach.bind(chrome.debugger); chrome.debugger.attach = (...args) => {attachCount++; return attach(...args);};});
  const run = async (name, args = {}) => (await worker.evaluate(({tabId, name, args}) => testBrowserAgent.runBrowserAgent('retrieval', {tabId}, name, args), {tabId, name, args})).result;
  const controls = result => (result.observation || result).frames.flatMap(frame => frame.elements || []);
  let result = await run('browser_snapshot', {query: '배송 설정의 알림 스위치'});
  assert(Array.isArray(result.frames), JSON.stringify(result));
  if (baseline) {
    assert(!controls(result).some(el => el.id === 'shipping')); checks.push('reproduced: full phrase query misses shipping switch');
    result = await run('browser_snapshot', {query: '배송 기준 37건'});
    assert(!result.frames.some(frame => frame.text?.includes('배송 기준 37건'))); checks.push('reproduced: long paragraph cuts off the matching evidence');
  } else {
    const shipping = controls(result).find(el => el.id === 'shipping'); assert(shipping);
    assert.equal(result.frames[0].elements[0].id, 'shipping'); assert.equal(shipping.match.coverage, 1);
    assert(shipping.context.some(c => c.name === '배송 설정')); assert(controls(result).some(el => el.id === 'billing'));
    assert.equal(result.frames[0].retrieval.method, 'lexical'); assert(result.frames[0].headings.some(h => h.name === '배송 설정'));
    assert(!JSON.stringify(result).includes('PRIVATE_PASSWORD')); assert(!controls(result).some(el => el.name === '숨긴 대상'));
    assert.equal(await worker.evaluate(() => attachCount), 0);
    checks.push('multi-term query ranks the actual section and control after 210 unrelated controls without attaching debugger');
    result = await run('browser_snapshot', {query: '계정 설정 알림'}); assert(controls(result).some(el => el.context?.some(c => c.name === '계정 설정')));
    result = await run('browser_snapshot', {query: '자세히'}); assert(result.frames.some(frame => frame.frame > 0 && frame.elements.some(el => el.name === '자세히')));
    checks.push('shadow controls and iframe controls keep their actual scopes and refs');
    result = await run('browser_snapshot', {query: '배송 기준 37건'});
    assert(result.frames[0].text.includes('배송 기준 37건')); assert(result.frames[0].truncated); assert(result.frames[0].text.length <= 16000);
    result = await run('browser_snapshot', {query: '존재하지않는항목'}); assert.equal(controls(result).length, 0); assert.equal(result.frames[0].retrieval.matchedControls, 0);
    checks.push('focused excerpts include late paragraph evidence and absent terms never fabricate refs');
    result = await run('browser_snapshot', {query: '배송 설정 알림'});
    const ref = controls(result).find(el => el.id === 'shipping').ref;
    result = await run('run_playwright', {code: `await browser.ref(${JSON.stringify(ref)}).setChecked(true); return await browser.snapshot('배송 설정 알림');`});
    assert.equal(result.ok, true, JSON.stringify(result)); assert(controls(result).some(el => el.id === 'shipping' && el.checked === true));
    assert.deepEqual(await page.evaluate(() => events), [{id: 'shipping', trusted: true}]);
    assert.equal(await page.locator('#billing').getAttribute('aria-checked'), 'false');
    assert.equal(result.observation.frames[0].retrieval.method, 'lexical');
    checks.push('ranked content-script ref performs one trusted action and the Playwright snapshot uses the same retrieval semantics');
  }
  assert.deepEqual(errors, []); await mkdir('verification', {recursive: true});
  await writeFile(`verification/retrieval-${baseline ? 'before' : 'after'}.json`, JSON.stringify({checks, errors, actualBrowser: true, syntheticSite: true, liveModel: false}, null, 2));
  for (const check of checks) console.log(`PASS ${check}`);
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

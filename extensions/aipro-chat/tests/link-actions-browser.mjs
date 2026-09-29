import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-links-')), extension = resolve(profile, 'extension');
const checks = [], errors = [];
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const fixture = `<title>업무 링크</title><style>body{font:16px sans-serif}a,span.link{display:block;margin:12px} .card{cursor:pointer;padding:16px;background:#eee;margin:12px}.contents{display:contents!important}.contents span{display:block;padding:16px}.cover{position:relative}.cover i{position:absolute;inset:0;z-index:2;background:#ddd}</style>
<a id="text" href="/opened/text">텍스트 링크</a>
<a id="contents" class="contents" href="/opened/contents"><span>카드 링크</span></a>
<span id="inline" class="link" onclick="location.href='/opened/inline'">업무 상세</span>
<div id="card" class="card"><strong>프로젝트 카드</strong><span>내용 보기</span></div>
<a id="blank" href="/opened/blank" target="_blank" rel="noopener"><span>새 탭 링크</span></a>
<a id="icon" href="/opened/icon" aria-label="아이콘 링크"><svg width="24" height="24"><rect width="24" height="24"/></svg></a>
<a id="history" href="/opened/history">신청 내역 보기</a><a id="compose" href="/opened/compose">등록 화면 열기</a>
<a id="send" href="/opened/send">발송하기</a>
<div class="cover"><a id="covered" href="/opened/covered">가려진 링크</a><i>잠시 기다려주세요</i></div>
<div id="disabled" role="link" aria-disabled="true" onclick="location.href='/opened/disabled'">사용 불가 링크</div>
<div id="shadow"></div><iframe title="별도 링크" src="https://links.example.test/frame"></iframe>
<script>card.addEventListener('click',()=>location.href='/opened/card');shadow.attachShadow({mode:'open'}).innerHTML='<a href="/opened/shadow">그림자 링크</a>';window.issued=[];document.addEventListener('click',e=>issued.push({id:e.target.closest('[id]')?.id,trusted:e.isTrusted}),true);</script>`;
let context, worker, page;
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  await context.route('https://links.example.test/**', r => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({contentType: 'text/html; charset=utf-8', body: path === '/frame' ? '<a href="/opened/frame">프레임 링크</a>' : path.startsWith('/opened/') ? `<title>열림</title><h1>${path}</h1>` : fixture});
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  page = await context.newPage(); await page.goto('https://links.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url === 'https://links.example.test/').id);
  const run = async (name, args = {}) => (await worker.evaluate(({tabId, name, args}) => testBrowserAgent.runBrowserAgent('links', {tabId}, name, args), {tabId, name, args})).result;
  const elements = result => (result.observation || result).frames.flatMap(f => f.elements || []);
  const find = (result, id) => elements(result).find(e => e.id === id || e.name === id);
  let snapshot = await run('browser_snapshot');
  if (process.env.NAV_BASELINE === '1') {
    const result = await run('click_element', {ref: find(snapshot, 'history').ref});
    assert.equal(result.error, 'approval_required');
    console.log({ordinaryHistoryLink: result.error});
    await writeFile('verification/link-navigation-before.json', JSON.stringify({ordinaryHistoryLink: result.error}, null, 2));
  } else if (process.env.BASELINE === '1') {
    const missing = ['contents', 'inline', 'card'].filter(id => !find(snapshot, id));
    const result = await run('run_playwright', {code: "await page.getByText('카드 링크',{exact:true}).locator('..').click();"});
    await writeFile('verification/link-actions-before.json', JSON.stringify({missing, failure: result.reason || result.error}, null, 2));
    console.log({missing, failure: result.reason || result.error});
  } else {
    assert(find(snapshot, 'contents')); assert(find(snapshot, 'inline')); assert(find(snapshot, 'card'));
    assert.equal(find(snapshot, 'inline').name, '업무 상세');
    assert.equal(find(snapshot, 'card').name, '프로젝트 카드내용 보기');
    assert(!elements(snapshot).some(e => e.tag === 'strong'), 'Inherited pointer cursor must not duplicate the actionable card');
    assert.equal(find(snapshot, 'text').destination, 'https://links.example.test/opened/text');
    assert.equal(find(snapshot, 'blank').linkTarget, '_blank');
    check('text, display-contents links, inline handlers and pointer cards expose exact refs, names and navigation hints');
    for (const [id, path, scripted] of [['text','text',false], ['contents','contents',false], ['inline','inline',true], ['card','card',true], ['icon','icon',false], ['그림자 링크','shadow',true], ['프레임 링크','frame',false], ['history','history',false], ['compose','compose',true], ['blank','blank',true]]) {
      if (id !== 'text') {await worker.evaluate(() => testBrowserAgent.stopBrowserAgent()); await page.goto('https://links.example.test/'); snapshot = await run('browser_snapshot');}
      const ref = find(snapshot, id)?.ref; assert(ref, id);
      const result = await run(scripted ? 'run_playwright' : 'click_element', scripted ? {code: `await browser.ref(${JSON.stringify(ref)}).click();`} : {ref});
      assert(!result.error, `${id}: ${JSON.stringify(result)}`);
      if (!scripted) assert.equal(result.navigationOnly, true, `${id}: observed link navigation must be classified as a read-only transition`);
      assert((result.observation || result).frames.some(f => f.text?.includes(`/opened/${path}`)), `${id}: wrong destination`);
      if (id === 'blank') assert.notEqual(result.observation.url, 'https://links.example.test/');
      check(`${id} opens the intended page through ${scripted ? 'Playwright ref' : 'semantic click'} and returns fresh destination evidence`);
    }
    await worker.evaluate(() => testBrowserAgent.stopBrowserAgent()); await page.goto('https://links.example.test/'); snapshot = await run('browser_snapshot');
    let result = await run('click_element', {ref: find(snapshot, 'covered').ref});
    assert.equal(result.reason, 'script_obscured', JSON.stringify(result));
    assert.equal(page.url(), 'https://links.example.test/'); assert.equal(await page.evaluate(() => issued.length), 0);
    result = await run('click_element', {ref: find(result, 'disabled').ref});
    assert.equal(result.error, 'script_disabled'); assert.equal(await page.evaluate(() => issued.length), 0);
    result = await run('click_element', {ref: find(result, 'send').ref});
    assert.equal(result.error, 'approval_required'); assert.equal(await page.evaluate(() => issued.length), 0);
    check('covered and disabled links explain the actual obstacle without force-click or navigation bypass');
    assert.deepEqual(errors, []);
    await writeFile('verification/link-actions-browser.json', JSON.stringify({checks, errors, actualBrowser: true, syntheticSites: true, actualModel: false}, null, 2));
  }
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

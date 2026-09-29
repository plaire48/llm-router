import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-specialist-')), extension = resolve(profile, 'extension');
const checks = [], errors = [];
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
let context, worker;
const fixture = `<title>브라우저 업무</title><style>body{font:16px sans-serif}dialog{position:relative;margin:0;width:600px}label{display:block;margin:12px}input,textarea{display:block}iframe{height:100px}</style>
<form aria-label="배경 검색"><label>제목<input id="background" value="BACKGROUND_PRIVATE"></label><button type="button" onclick="wrong++">미리보기</button></form>
<dialog open aria-labelledby="dialog-title"><h2 id="dialog-title">메일 초안</h2>
<span id="recipient-label">받는 사람</span><input id="recipient" aria-labelledby="recipient-label" required>
<label>분류<select id="category"><option value="">선택</option><option value="work">업무</option></select></label>
<label>제목<input id="subject" required></label><textarea id="body" aria-label="본문"></textarea>
<label>검색<input id="search" type="search"></label><label>수량<input id="quantity" type="number"></label>
<label>고정값<input readonly id="readonly" value="READONLY_PRIVATE"></label>
<fieldset disabled><label>잠긴 항목<input id="disabled"></label></fieldset>
<button type="button" id="preview" onclick="previews++;document.querySelector('output').textContent='미리보기 준비됨'">미리보기</button>
<button type="button" id="replace" onclick="subject.replaceWith(subject.cloneNode(true))">입력란 교체</button>
<button type="button" id="send" onclick="sent++">보내기</button>
<output>초안 작성 중</output><div role="alert">받는 사람을 입력하세요</div>
</dialog>
<span id="private-label">API token</span><input aria-labelledby="private-label" value="SECRET_VALUE">
<div id="shadow"></div><div id="hidden-shadow" aria-hidden="true"></div>
<iframe title="별도 편집기" src="https://editor.example.test/"></iframe>
<script>
window.wrong=0;window.previews=0;window.sent=0;window.writes=[];
document.addEventListener('input',e=>writes.push({id:e.target.id,trusted:e.isTrusted}));
document.querySelector('#category').addEventListener('change',()=>{if(!document.querySelector('#department'))document.querySelector('#body').insertAdjacentHTML('afterend','<label>부서<select id="department"><option value="dev">개발팀</option></select></label>')});
document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>보조 메모<input></label>';
document.querySelector('#hidden-shadow').attachShadow({mode:'open'}).innerHTML='<button>HIDDEN_CONTROL</button>';
</script>`;
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  await context.route('https://specialist.example.test/**', r => r.fulfill({contentType: 'text/html; charset=utf-8', body: fixture}));
  await context.route('https://editor.example.test/**', r => r.fulfill({contentType: 'text/html; charset=utf-8', body: '<label>편집기<textarea></textarea></label>'}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  const page = await context.newPage(); await page.goto('https://specialist.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url === 'https://specialist.example.test/').id);
  await worker.evaluate(() => {globalThis.attachCount=0; const attach=chrome.debugger.attach.bind(chrome.debugger);chrome.debugger.attach=(...args)=>{attachCount++;return attach(...args);};});
  const run = async (name, args = {}) => (await worker.evaluate(({tabId,name,args}) => testBrowserAgent.runBrowserAgent('specialist', {tabId}, name, args), {tabId,name,args})).result;
  let snapshot = await run('browser_snapshot');
  const elements = s => (s.observation || s).frames.flatMap(f => f.elements || []);
  const byId = (s,id) => elements(s).find(e=>e.id===id);
  const named = (s,name) => elements(s).find(e=>e.name===name);
  for (const [id,role,name] of [['recipient','textbox','받는 사람'],['category','combobox','분류'],['search','searchbox','검색'],['quantity','spinbutton','수량']]) {
    assert.equal(byId(snapshot,id).name,name);assert.equal(byId(snapshot,id).role,role);
    assert.equal(await page.getByRole(role,{name,exact:true}).getAttribute('id'),id);
  }
  assert(byId(snapshot,'recipient').required && byId(snapshot,'recipient').invalid);
  assert(byId(snapshot,'readonly').readonly);assert(byId(snapshot,'disabled').disabled);
  assert(snapshot.frames[0].alerts.some(a=>a.text==='받는 사람을 입력하세요'));
  assert(snapshot.frames[0].regions.some(r=>r.role==='dialog'&&r.name==='메일 초안'));
  assert(byId(snapshot,'subject').context.some(c=>c.name==='메일 초안'));
  assert.equal(await worker.evaluate(()=>attachCount),0);
  assert(!JSON.stringify(snapshot).match(/SECRET_VALUE|READONLY_PRIVATE|BACKGROUND_PRIVATE|HIDDEN_CONTROL/));
  assert(!elements(snapshot).some(e=>e.accessibleName==='API token'));
  check('passive observation matches real role locators, distinguishes dialog context and form constraints, and omits input values and hidden shadow controls without debugger');

  // Refs cross the passive isolated observer -> exact Playwright handle bridge.
  let result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(byId(snapshot,'recipient').ref)}).fill('team@example.invalid'); await browser.ref(${JSON.stringify(byId(snapshot,'subject').ref)}).fill('교육 안내');`});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.locator('#background').inputValue(),'BACKGROUND_PRIVATE');
  assert.equal(await page.locator('#recipient').inputValue(),'team@example.invalid');assert.equal(await page.locator('#subject').inputValue(),'교육 안내');
  assert(result.execution.commands.every(c=>c.state==='returned'&&c.actionIssued));
  check('observed refs fill the correct duplicate-name form and aria-labelledby input with trusted browser events');

  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(byId(result,'category').ref)}).selectOption('work');`});
  assert.equal(result.ok,true,JSON.stringify(result));assert(byId(result,'department'));
  assert.equal(byId(result,'category').name,'분류');
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(byId(result,'department').ref)}).selectOption('dev'); await browser.ref(${JSON.stringify(named(result,'보조 메모').ref)}).fill('보조 내용'); await browser.ref(${JSON.stringify(named(result,'편집기').ref)}).fill('iframe 내용');`});
  assert.equal(result.yielded,true,JSON.stringify(result));
  assert.equal(await page.getByLabel('보조 메모').inputValue(),'');
  assert.equal(await page.frameLocator('iframe').getByLabel('편집기').inputValue(),'');
  assert.deepEqual(result.execution.commands.map(command=>command.method),['selectOption']);
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(named(result,'보조 메모').ref)}).fill('보조 내용'); await browser.ref(${JSON.stringify(named(result,'편집기').ref)}).fill('iframe 내용');`});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.getByLabel('보조 메모').inputValue(),'보조 내용');
  assert.equal(await page.frameLocator('iframe').getByLabel('편집기').inputValue(),'iframe 내용');
  check('dependent choices expose new controls and exact refs work across open shadow roots and cross-origin frames');

  const bodyRef=byId(result,'body').ref;
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(bodyRef)}).fill('본문은 한 번만 입력'); await page.getByRole('button',{name:'미리보기',exact:true}).click();`});
  assert.equal(result.reason,'script_locator',JSON.stringify(result));
  assert.deepEqual(result.execution.commands.map(c=>[c.method,c.state,c.actionIssued]),[['fill','returned',true],['click','failed',false]]);
  assert(!JSON.stringify(result.execution).includes('본문은'));
  const previewRef=byId(result,'preview').ref;
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(previewRef)}).click();`});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>wrong),0);assert.equal(await page.evaluate(()=>previews),1);
  assert.equal(await page.evaluate(()=>writes.filter(w=>w.id==='body').length),1);
  check('partial script failure reports the completed write and unissued ambiguous click; recovery selects the correct dialog without rewriting content');

  let stale=byId(result,'subject').ref;
  await page.locator('#replace').click();
  const before=await page.evaluate(()=>writes.length);
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(stale)}).fill('DO_NOT_WRITE');`});
  assert.equal(result.reason,'browser_stale');assert.equal(result.actionIssued,false);assert.equal(await page.evaluate(()=>writes.length),before);
  const fresh=byId(result,'subject').ref;
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(fresh)}).fill('수정된 교육 안내');`});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.locator('#subject').inputValue(),'수정된 교육 안내');
  stale=byId(result,'body').ref;
  result=await run('browser_snapshot');
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(stale)}).fill('DO_NOT_WRITE');`});
  assert.equal(result.reason,'browser_stale');
  check('rerendered nodes and refs from earlier snapshots are rejected before writing, then fresh refs resume correctly');

  const verify=await run('verify_page',{checks:[{kind:'field_value',ref:byId(result,'subject').ref,expected:'수정된 교육 안내'},{kind:'field_value',ref:byId(result,'body').ref,expected:'본문은 한 번만 입력'},{kind:'text_present',expected:'미리보기 준비됨'}]});
  assert.equal(verify.verified,true,JSON.stringify(verify));
  // Playwright selectOption dispatches change/input events; text entry uses
  // actual keyboard input. Test trusted events for the text fields only.
  assert((await page.evaluate(()=>writes.filter(w=>['recipient','subject','body'].includes(w.id)))).every(w=>w.trusted));
  result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(byId(verify,'send').ref)}).click();`});
  assert.equal(result.error,'approval_required',JSON.stringify(result));assert.equal(await page.evaluate(()=>sent),0);
  check('actual requested fields pass fresh verification and ref-based final sending still stops for approval');

  // More controls than one observation holds (up to 400 within a size budget).
  await page.evaluate(()=>{for(let i=0;i<450;i++){const b=document.createElement('button');b.textContent='배경 '+i;document.body.prepend(b);}});
  result=await run('browser_snapshot');
  assert(result.frames[0].truncated);assert(result.frames[0].omittedControls>0);assert(byId(result,'subject'));
  result=await run('browser_snapshot',{query:'메일 초안'});
  assert(byId(result,'subject'));assert(!byId(result,'background'));assert.equal(result.frames[0].omittedControls,0);
  check('long pages report omitted controls, prioritize visible dialogs and support focused observation by region');
  await worker.evaluate(()=>testBrowserAgent.stopBrowserAgent('specialist'));
  assert.equal(await worker.evaluate(async tabId=>{try{await chrome.debugger.sendCommand({tabId},'Page.getFrameTree');return true;}catch{return false;}},tabId),false);
  assert.deepEqual(errors,[]);
  await mkdir('verification',{recursive:true});
  await writeFile('verification/browser-specialist.json',JSON.stringify({version:manifest.version,checks,errors,actualBrowser:true,actualModel:false,syntheticSite:true},null,2));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}

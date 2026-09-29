import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-hover-links-')), extension = resolve(profile, 'extension');
const fixture = `<!doctype html><meta charset="utf-8"><title>링크와 메뉴</title>
<style>body{font:16px sans-serif;margin:40px}section{margin:30px 0}a{color:#1366b3}.lines{position:relative;line-height:32px;width:300px}.lines a{font-size:20px}.lines .cover{position:absolute;top:0;left:0;width:300px;height:32px;background:#ddd;pointer-events:auto}.contents{display:contents}.contents span{display:inline-block;padding:14px;background:#eaf4ff}.menu{padding:12px;background:#eef8f5}a.menu-item{display:inline-block;padding:8px}.css-menu .menu{display:none}.css-menu:has(.contents:hover) .menu,.css-menu .menu:hover{display:block}</style>
<h1><a id="heading" href="/heading">제목의 텍스트 링크</a></h1>
<section class="lines"><a id="wrapped" href="/wrapped">첫 줄이 가려진 링크<br>클릭할 수 있는 둘째 줄</a><i class="cover">첫 줄 덮개</i></section>
<section class="css-menu"><a id="contents" class="contents" href="#menu" aria-haspopup="menu"><span>분야 메뉴</span></a><div class="menu" role="menu"><a class="menu-item" href="/area">분야 목록</a></div></section>
<section><a id="hover-only" onmouseenter="document.getElementById('hover-menu').hidden=false">추가 메뉴</a><div id="hover-menu" class="menu" hidden><a class="menu-item" href="/extra">추가 목록</a></div></section>
<section><a id="delayed" href="#delayed-menu" aria-haspopup="menu" aria-controls="delayed-menu" aria-expanded="false" onmouseenter="if(!window.menuTimer)window.menuTimer=setTimeout(()=>{document.getElementById('delayed-menu').hidden=false;this.setAttribute('aria-expanded','true')},650)">지연 메뉴</a><div id="delayed-menu" class="menu" hidden><a class="menu-item" href="/delayed">늦게 나타난 목록</a></div></section>
<section><a id="portal-trigger" aria-haspopup="menu" onmouseenter="if(!window.portalTimer)window.portalTimer=setTimeout(()=>{const menu=document.createElement('div');menu.setAttribute('role','menu');menu.innerHTML='<a href=/portal>포털에서 열린 항목</a>';document.body.append(menu)},700)">동적 메뉴</a></section>
<section><button id="tooltip-trigger" aria-describedby="delayed-tooltip" onmouseenter="setTimeout(()=>document.getElementById('delayed-tooltip').hidden=false,450)">도움말 보기</button><div id="delayed-tooltip" role="tooltip" hidden>승인 전에 입력 내용을 확인하세요.</div></section>
<div role="menu" aria-label="기존 메뉴"><a href="/existing">기존 항목</a></div>
<section><a id="covered" href="/covered" style="display:block">완전히 가려진 링크</a><div id="cover-all" style="position:relative;height:32px;margin-top:-32px;background:#ddd">덮개</div></section>
<output></output><script>window.events=[];document.addEventListener('keydown',e=>events.push({type:e.type,key:e.key}),true);document.addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;e.preventDefault();events.push({type:'click',id:a.id,path:a.getAttribute('href'),trusted:e.isTrusted});document.querySelector('output').textContent=a.getAttribute('href')||'';},true);</script>`;
const server = createServer((request, response) => {response.writeHead(200, {'content-type':'text/html; charset=utf-8'});response.end(fixture);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`, baseline = process.env.HOVER_BASELINE === '1';
const checks = [], before = {};
let context, worker, page, requestId, tabId;
const elements = result => (result.observation || result).frames?.flatMap(frame => frame.elements || []) || [];
const find = (result, name) => elements(result).find(el => el.id === name || el.name === name);
const check = text => {checks.push(text);console.log('PASS '+text);};
const run = async (name, args = {}) => (await worker.evaluate(({tabId, requestId, name, args}) => hoverTest.runBrowserAgent(requestId, {tabId}, name, args), {tabId, requestId, name, args})).result;
async function reset() {
  await worker.evaluate(() => hoverTest.stopBrowserAgent());
  await page.goto(url);requestId = crypto.randomUUID();
  return run('browser_snapshot');
}
try {
  await cp('dist', extension, {recursive:true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.hoverTest={runBrowserAgent,stopBrowserAgent};\n');
  context = await chromium.launchPersistentContext(profile, {headless:process.env.HEADED !== '1', executablePath:process.env.CHROME_BINARY, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage();await page.goto(url);
  tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
  let snapshot = await reset();
  before.hoverOnlyObserved = !!find(snapshot, 'hover-only');
  for (const [id, path, scripted] of [['heading','/heading'], ['wrapped','/wrapped'], ['wrapped','/wrapped',true]]) {
    snapshot = await reset();
    const ref = find(snapshot,id).ref;
    const result = await run(scripted?'run_playwright':'click_element', scripted?{code:`await browser.ref(${JSON.stringify(ref)}).click();`}:{ref});
    const events = await page.evaluate(() => events);
    before[id] = {error:result.reason || result.error, output:await page.locator('output').innerText(), events};
    if (!baseline) {
      assert(!result.error, JSON.stringify(before[id]));
      assert.equal(before[id].output, path);
      assert.deepEqual(events, [{type:'click',id,path,trusted:true}]);
      check(`${id} ${scripted?'script':'semantic'} uses one trusted pointer click without Enter or a direct URL bypass`);
    }
  }
  for (const mode of ['semantic','ref','locator']) {
    snapshot = await reset();const ref=find(snapshot,'contents').ref;
    const result=await run(mode==='semantic'?'hover_element':'run_playwright',mode==='semantic'?{ref}:{code:mode==='ref'?`await browser.ref(${JSON.stringify(ref)}).hover();`:"await page.getByRole('link',{name:'분야 메뉴',exact:true}).hover();"});
    before['contents-'+mode]={error:result.reason||result.error,visible:!!find(result,'분야 목록')};
    if (!baseline) {
      assert(!result.error, JSON.stringify(before));assert(find(result,'분야 목록'));
      const clicked=await run('click_element',{ref:find(result,'분야 목록').ref});assert(!clicked.error,JSON.stringify(clicked));
      assert.equal(await page.locator('output').innerText(),'/area');
      assert.equal((await page.evaluate(()=>events)).filter(e=>e.type==='click').length,1);
      check(`${mode} hover reveals a display-contents menu before clicking its freshly observed link`);
    }
  }
  snapshot = await reset();
  if (find(snapshot,'hover-only')) {
    const result=await run('hover_element',{ref:find(snapshot,'hover-only').ref});
    if(!baseline){assert(find(result,'추가 목록'));check('an anchor with only a mouse-enter handler is discoverable and usable');}
  } else if(!baseline) assert.fail('hover-only anchor missing from observation');
  snapshot=await reset();
  const delayed=await run('hover_element',{ref:find(snapshot,'delayed').ref});
  before.delayed={error:delayed.reason||delayed.error,visible:!!find(delayed,'늦게 나타난 목록')};
  if(!baseline){assert(find(delayed,'늦게 나타난 목록'),JSON.stringify(before.delayed));check('hover waits for its related delayed menu and returns new visible evidence');}
  snapshot=await reset();
  const portal=await run('hover_element',{ref:find(snapshot,'portal-trigger').ref});
  before.portal={error:portal.reason||portal.error,visible:!!find(portal,'포털에서 열린 항목')};
  if(!baseline){assert(find(portal,'포털에서 열린 항목'),JSON.stringify(before.portal));assert.deepEqual(await page.evaluate(()=>events),[]);check('hover observes a delayed portal menu with no aria-controls relationship before the next action');}
  if(!baseline){
    snapshot=await reset();
    const tooltip=await run('hover_element',{ref:find(snapshot,'tooltip-trigger').ref});
    assert(tooltip.observation.frames.some(frame=>frame.text?.includes('승인 전에 입력 내용을 확인하세요.')),JSON.stringify(tooltip));
    assert.deepEqual(await page.evaluate(()=>events),[]);
    check('aria-describedby tooltip becomes visible before returning and an existing unrelated menu cannot end the wait');
  }
  if(!baseline){
    snapshot=await reset();
    const result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(find(snapshot,'delayed').ref)}).hover(); await page.getByRole('link',{name:'늦게 나타난 목록'}).click();`});
    assert.equal(result.yielded,true);assert.equal(result.completed,false);
    assert.deepEqual(result.execution.commands.map(({method,actionIssued})=>({method,actionIssued})),[{method:'hover',actionIssued:true}]);
    assert(find(result,'늦게 나타난 목록'));assert.deepEqual(await page.evaluate(()=>events),[]);
    check('a hover script yields fresh delayed-menu evidence before any dependent click and records the pointer action');
  }
  if(!baseline){
    snapshot=await reset();const result=await run('click_element',{ref:find(snapshot,'covered').ref});
    assert.equal(result.reason,'script_obscured',JSON.stringify(result));assert.deepEqual(await page.evaluate(()=>events),[]);
    check('a fully covered link stays blocked without keyboard or force-click fallback');
  }
  await writeFile(`verification/hover-links-${baseline?'before':'browser'}.json`,JSON.stringify(baseline?before:{checks,actualBrowser:true,actualModel:false},null,2));
  if(baseline)console.log(JSON.stringify(before));
} finally {await context?.close();server.close();await rm(profile,{recursive:true,force:true});}

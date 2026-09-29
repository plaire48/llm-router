import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

// Real extension executor, synthetic application. The application owns the
// retained state and counters; an executor's `ok` is never the success oracle.
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-workflows-'));
const extension = resolve(profile, 'extension'), checks = [], errors = [];
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
let context, worker, saveAttempts = 0, savedDraft = null;
const fixture = `<!doctype html><title>업무 초안</title>
<style>body{font:16px sans-serif;padding:20px}label{display:block;margin:12px 0}button{margin:5px;padding:10px}#cover{position:fixed;inset:0;background:#eee;z-index:100}#rows{height:90px;overflow:auto}output{display:block}</style>
<form aria-label="초안 작성" onsubmit="return false">
<button type="button" id="category" role="combobox" aria-label="업무 분류" aria-required="true" aria-invalid="true" aria-expanded="false" aria-controls="choices">분류 선택</button>
<div id="choices" role="listbox" aria-label="업무 분류 선택" hidden></div>
<label>제목<input id="subject"></label><label>본문<textarea id="body"></textarea></label>
<button type="button" id="preview">미리보기</button>
<button type="button" id="save">초안 저장</button><output role="status" id="status">작성 중</output>
</form>
<section aria-label="업무 목록"><table><tbody id="rows"></tbody></table><button id="next">다음 목록</button></section>
<button id="enable">준비 시작</button><button id="delayed" disabled>결과 확인</button>
<script>
const $=id=>document.getElementById(id);
window.state={writes:[],previews:0,selectedRows:[],readyClicks:0};
document.addEventListener('input',e=>{state.writes.push(e.target.id);if(e.target.id==='subject')$('body').replaceWith($('body').cloneNode(true));});
$('category').onclick=()=>{const combo=$('category');combo.setAttribute('aria-expanded','true');setTimeout(()=>{
 $('choices').hidden=false;$('choices').innerHTML='<button type="button" role="option" aria-selected="false">교육</button>';
 $('choices').firstChild.onclick=()=>{combo.textContent='교육';combo.setAttribute('aria-expanded','false');combo.setAttribute('aria-invalid','false');$('choices').hidden=true;
 if(!$('department'))$('choices').insertAdjacentHTML('afterend','<label>담당 부서<select id="department" required><option value="">선택</option><option value="engineering">개발팀</option></select></label>');};
},450);};
$('preview').onclick=()=>{state.previews++;$('status').textContent='미리보기 준비됨';};
$('save').onclick=async()=>{const data={subject:$('subject').value,body:$('body').value,department:$('department').value};
 $('status').textContent='저장 중';const response=await fetch('/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 $('status').textContent=response.ok?'초안 저장됨':'저장 실패: 다시 시도';};
let pageNumber=0;function renderRows(){const names=pageNumber?['마케팅팀','교육팀']:['개발팀','디자인팀'];$('rows').innerHTML=names.map(name=>'<tr><th>'+name+'</th><td><button>열기</button></td></tr>').join('');
 for(const row of $('rows').children)row.querySelector('button').onclick=()=>state.selectedRows.push(row.querySelector('th').textContent);}
$('next').onclick=()=>{pageNumber++;renderRows();};renderRows();
$('enable').onclick=()=>setTimeout(()=>$('delayed').disabled=false,600);
$('delayed').onclick=()=>state.readyClicks++;
</script>`;

try {
  await cp(resolve('dist'), extension, {recursive:true});
  const manifest = JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('https://workflows.example.test/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('https://workflows.example.test/**',async route=>{
    if(route.request().method()==='POST') {
      saveAttempts++;
      if(saveAttempts===1)return route.fulfill({status:503,body:'Temporarily unavailable'});
      savedDraft=route.request().postDataJSON();
      return route.fulfill({contentType:'application/json',body:JSON.stringify({saved:true})});
    }
    return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
  });
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  const page=await context.newPage();await page.goto('https://workflows.example.test/');
  const tabId=await worker.evaluate(async()=>(await chrome.tabs.query({})).find(t=>t.url==='https://workflows.example.test/').id);
  const run=async(name,args={})=>(await worker.evaluate(({tabId,name,args})=>testBrowserAgent.runBrowserAgent('workflows',{tabId},name,args),{tabId,name,args})).result;
  const script=code=>run('run_playwright',{code});
  const elements=result=>(result.observation||result).frames.flatMap(f=>f.elements||[]);
  const byId=(result,id)=>elements(result).find(e=>e.id===id);
  const ref=(result,id)=>JSON.stringify(byId(result,id).ref);
  let result=await run('browser_snapshot');
  assert.equal(byId(result,'category').required,true,'ARIA combobox must expose its required constraint');
  assert.equal(byId(result,'category').invalid,true);
  result=await script(`await browser.ref(${ref(result,'category')}).click(); await page.getByRole('option',{name:'교육',exact:true}).waitFor({state:'visible'});`);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(byId(result,'category').expanded,true);
  result=await script(`await page.getByRole('option',{name:'교육',exact:true}).click();`);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(byId(result,'category').invalid,false);
  assert.equal(byId(result,'category').expanded,false);assert.equal(byId(result,'department').required,true);
  result=await script(`await browser.ref(${ref(result,'department')}).selectOption('engineering');`);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.locator('#department').inputValue(),'engineering');
  check('custom ARIA combobox exposes constraints, waits for delayed options and discovers a dependent required field');

  const oldBody=ref(result,'body');
  result=await script(`await browser.ref(${ref(result,'subject')}).fill('교육 일정'); await browser.ref(${oldBody}).fill('SHOULD_NOT_WRITE');`);
  assert.equal(result.reason,'browser_stale',JSON.stringify(result));
  assert.deepEqual(result.execution.commands.map(c=>[c.state,c.actionIssued]),[['returned',true],['failed',false]]);
  assert.equal(await page.locator('#body').inputValue(),'');
  result=await script(`await browser.ref(${ref(result,'body')}).fill('다음 주 교육을 준비합니다.');`);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(await page.evaluate(()=>state.writes),['department','subject','body']);
  check('input-triggered rerender stops a stale second write and fresh observation completes only the missing field');

  await page.evaluate(()=>{const cover=document.createElement('div');cover.id='cover';cover.setAttribute('role','dialog');cover.setAttribute('aria-label','도움말');cover.tabIndex=0;cover.textContent='Escape로 닫기';cover.onkeydown=e=>{if(e.key==='Escape')cover.remove();};document.body.append(cover);});
  result=await script(`await page.getByRole('button',{name:'미리보기',exact:true}).click();`);
  assert.equal(result.reason,'script_obscured',JSON.stringify(result));assert.equal(await page.evaluate(()=>state.previews),0);
  // The overlay fails Playwright's hover actionability before any click is
  // sent, so the host receipt is exact: nothing was issued (browser-agent.js).
  assert.equal(result.execution.commands[0].state,'failed');assert.equal(result.execution.commands[0].actionIssued,false);
  assert(result.observation.frames[0].regions.some(r=>r.name==='도움말'));
  result=await script(`await page.getByRole('dialog',{name:'도움말',exact:true}).press('Escape');`);
  assert.equal(result.ok,true,JSON.stringify(result));
  result=await script(`await browser.ref(${ref(result,'preview')}).click();`);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>state.previews),1);
  assert.deepEqual(await page.evaluate(()=>state.writes),['department','subject','body']);
  check('an overlay prevents the click; recovery dismisses it and performs one preview without replaying earlier inputs');

  const previousRow=elements(result).find(e=>e.name==='열기'&&e.context.some(c=>c.name==='개발팀'));
  assert(previousRow);
  result=await script(`await browser.ref(${ref(result,'next')}).click();`);
  assert.equal(result.ok,true,JSON.stringify(result));
  result=await script(`await browser.ref(${JSON.stringify(previousRow.ref)}).click();`);
  assert.equal(result.reason,'browser_stale');assert.deepEqual(await page.evaluate(()=>state.selectedRows),[]);
  const target=elements(result).find(e=>e.name==='열기'&&e.context.some(c=>c.name==='교육팀'));
  assert(target);
  result=await script(`await browser.ref(${JSON.stringify(target.ref)}).click();`);
  assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(await page.evaluate(()=>state.selectedRows),['교육팀']);
  check('paginated duplicate-name row buttons are selected by fresh row context and obsolete row refs never execute');

  assert.equal(byId(result,'delayed').disabled,true);
  result=await script(`await browser.ref(${ref(result,'enable')}).click(); await page.getByRole('button',{name:'결과 확인',exact:true}).click();`);
  assert.equal(result.yielded,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>state.readyClicks),0);
  result=await script(`await page.getByRole('button',{name:'결과 확인',exact:true}).click();`);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>state.readyClicks),1);
  check('a temporarily disabled control is awaited and clicked exactly once when the application enables it');

  result=await script(`await browser.ref(${ref(result,'save')}).click(); await page.getByText('저장 실패: 다시 시도',{exact:true}).waitFor({state:'visible'});`);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(savedDraft,null);assert.equal(saveAttempts,1);
  const failed=await run('verify_page',{checks:[{kind:'text_present',expected:'초안 저장됨'}]});
  assert.equal(failed.verified,false,'a returned click does not prove that the application saved the draft');
  result=await script(`await browser.ref(${ref(failed,'save')}).click(); await page.getByText('초안 저장됨',{exact:true}).waitFor({state:'visible'});`);
  assert.equal(result.ok,true,JSON.stringify(result));
  const verified=await run('verify_page',{checks:[{kind:'text_present',expected:'초안 저장됨'},{kind:'field_value',ref:byId(result,'subject').ref,expected:'교육 일정'},{kind:'field_value',ref:byId(result,'body').ref,expected:'다음 주 교육을 준비합니다.'}]});
  assert.equal(verified.verified,true,JSON.stringify(verified));
  assert.deepEqual(savedDraft,{subject:'교육 일정',body:'다음 주 교육을 준비합니다.',department:'engineering'});
  assert.equal(saveAttempts,2);assert.deepEqual(await page.evaluate(()=>state.writes),['department','subject','body']);
  check('server rejection fails completion verification; one explicit retry saves the correct payload without rewriting the draft');

  const incompatible=await run('verify_page',{checks:[{kind:'field_value',ref:byId(verified,'save').ref,expected:'초안 저장'},
    {kind:'field_value',ref:byId(verified,'subject').ref,expected:'교육 일정'}]});
  assert.equal(incompatible.error,'verification_failed');assert.equal(incompatible.verified,false);
  assert.equal(incompatible.checks[0].reason,'check_target_incompatible');assert.equal(incompatible.checks[1].passed,true);
  assert(byId(incompatible,'subject').ref);assert.equal(saveAttempts,2);
  assert.deepEqual(await page.evaluate(()=>state.writes),['department','subject','body']);
  check('an incompatible verification returns per-check repair guidance and fresh refs without losing valid checks or replaying writes');

  await worker.evaluate(()=>testBrowserAgent.stopBrowserAgent('workflows'));
  assert.equal(await worker.evaluate(async tabId=>{try{await chrome.debugger.sendCommand({tabId},'Page.getFrameTree');return true;}catch{return false;}},tabId),false);
  assert.deepEqual(errors,[]);
  await mkdir('verification',{recursive:true});
  await writeFile('verification/browser-workflows.json',JSON.stringify({version:manifest.version,checks,errors,actualBrowser:true,actualModel:false,syntheticSite:true},null,2));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}

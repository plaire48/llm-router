import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {parseElementLine} from '../context-evidence.js';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-keyboard-')), extension = resolve(profile, 'extension');
const checks = [], errors = [];
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
let context;
const fixture = `<title>입력 방식 확인</title><style>body{font:16px sans-serif}input,button,[role=listbox]{display:block;margin:16px;padding:10px}label{display:block}[hidden]{display:none!important}</style>
<label>직원 검색<input id="search" role="combobox" aria-autocomplete="list" aria-controls="people" aria-expanded="false"></label>
<div id="people" role="listbox" aria-label="직원 검색 결과" hidden><div id="alice" role="option" aria-selected="false">Alice Kim</div></div>
<input id="redirect" aria-label="초점이 바뀌는 입력란"><input id="other" aria-label="다른 입력란">
<input id="partial" aria-label="입력 도중 초점 이동"><input id="secret" type="password" aria-label="비밀번호">
<input id="readonly" readonly aria-label="읽기 전용"><div id="notfocusable" role="button">키보드 초점 없음</div>
<div id="shadow"></div><iframe title="별도 입력란" src="https://keyboard.example.test/frame"></iframe><output id="result">선택 전</output><button id="send">보내기</button>
<script>
window.keys=[];window.submits=0;window.writes=[];
document.addEventListener('keydown',e=>keys.push({id:e.target.id,key:e.key,trusted:e.isTrusted}));
document.addEventListener('input',e=>writes.push({id:e.target.id,trusted:e.isTrusted}));
search.onkeyup=e=>{if(e.key.length===1&&search.value==='alice'){people.hidden=false;search.setAttribute('aria-expanded','true')}};
search.onkeydown=e=>{if(e.key==='ArrowDown'&&!people.hidden){e.preventDefault();search.setAttribute('aria-activedescendant','alice');alice.setAttribute('aria-selected','true')}if(e.key==='Enter'&&search.getAttribute('aria-activedescendant')==='alice'){e.preventDefault();search.value='Alice Kim';result.textContent='Alice Kim 선택됨';people.hidden=true;search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant')}};
redirect.onfocus=()=>other.focus();partial.oninput=()=>secret.focus();send.onclick=()=>submits++;
shadow.attachShadow({mode:'open'}).innerHTML='<label>그림자 입력<input id="shadow-input"></label>';
</script>`;
try {
  await cp(resolve(process.env.TEST_EXTENSION || 'dist'), extension, {recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  // The real Send flow requests its normal optional browser origins. Grant
  // them in this disposable test extension so Chrome's permission dialog is
  // not mistaken for an agent/keyboard failure in headless mode.
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.testBrowserAgent={runBrowserAgent,runApprovedAction,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  await appendFile(resolve(extension,'browser-agent.js'),'\nglobalThis.detachCurrentTestHandle=async()=>{await active.app.detach(active.tabId);return active.page.isClosed();};\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('https://keyboard.example.test/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:r.request().url().endsWith('/frame')?'<label>프레임 메모<input id="frame-input"></label>':fixture}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  const page=await context.newPage();await page.goto('https://keyboard.example.test/');
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://keyboard.example.test/').id);
  const run=async(name,args={})=>(await worker.evaluate(({tabId,name,args})=>testBrowserAgent.runBrowserAgent('keyboard',{tabId},name,args),{tabId,name,args})).result;
  const elements=r=>(r.observation||r).frames.flatMap(f=>f.elements||[]).map(e=>typeof e==='string'?parseElementLine(e):e).filter(Boolean), byId=(r,id)=>elements(r).find(e=>e.id===id);
  const script=(ref,operation)=>run('run_playwright',{code:`await browser.ref(${JSON.stringify(ref)}).${operation};`});
  let r=await run('browser_snapshot');
  const originalOrder=elements(r).map(e=>e.id);

  // A successful Playwright press used to type into the redirected focus.
  r=await script(byId(r,'redirect').ref,'press("A")');
  const misdirected=await page.locator('#other').inputValue();
  console.log(JSON.stringify({focusFailure:r.reason||null,otherField:misdirected,actionIssued:r.actionIssued}));
  assert.equal(misdirected,'','Keyboard input must not reach a different field');
  assert.equal(r.reason,'script_focus');assert.equal(r.actionIssued,false);
  assert.deepEqual(elements(r).map(e=>e.id),originalOrder,'Focus alone must not reorder all visible controls');
  check('focus redirection stops a script key before input and returns fresh observation');
  const oldRef=byId(r,'search').ref;
  assert.equal(await worker.evaluate(()=>detachCurrentTestHandle()),true);
  const inventory=await run('list_tabs');assert(inventory.tabs.some(tab=>tab.tab_id===String(tabId)&&tab.current));
  r=await run('browser_snapshot');assert.notEqual(byId(r,'search').ref,oldRef);
  assert.equal(await page.locator('#other').inputValue(),'');
  check('a detached page handle reconnects the same surviving Chrome tab and invalidates old refs without replaying input');

  r=await run('press_key',{ref:byId(r,'redirect').ref,key:'enter'});
  assert.equal(r.reason,'keyboard_key_invalid');assert.equal(r.actionIssued,false);assert(r.instruction.includes('case-sensitive'));
  r=await run('press_key',{ref:byId(r,'redirect').ref,key:'B'});
  assert.equal(r.reason,'script_focus');assert.equal(r.actionIssued,false);assert.equal(await page.locator('#other').inputValue(),'');
  r=await script(byId(r,'notfocusable').ref,'press("C")');assert.equal(r.reason,'script_focus');
  assert.equal(await page.locator('#other').inputValue(),'');
  check('semantic keyboard tools and non-focusable controls use the same focus guard');

  const input=byId(r,'search');
  assert.equal(input.autocomplete,'list');assert(input.controls.some(c=>c.id==='people'&&c.role==='listbox'&&c.visible===false));
  assert.equal(input.editable,true);assert.equal(byId(r,'readonly').editable,false);
  assert(!elements(r).some(e=>e.id==='secret'));
  r=await script(input.ref,'fill("alice")');
  assert.equal(await page.locator('#search').inputValue(),'alice');assert.equal(await page.locator('#people').isVisible(),false);
  check('autocomplete relationships are observed while ordinary fill alone does not fake key events');

  r=await script(byId(r,'search').ref,'fill("")');
  r=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(byId(r,'search').ref)}).pressSequentially("alice"); await browser.ref(${JSON.stringify(byId(r,'other').ref)}).fill("MUST_NOT_RUN");`});
  assert.equal(r.yielded,true,JSON.stringify(r));assert.equal(r.completed,false);
  assert.equal(await page.locator('#other').inputValue(),'');assert.equal(await page.locator('#people').isVisible(),true);
  assert.equal(byId(r,'search').focused,true);assert(byId(r,'search').controls.some(c=>c.visible));
  assert.equal(byId(r,'alice').role,'option');
  assert((await page.evaluate(()=>keys.filter(e=>e.id==='search'))).every(e=>e.trusted));
  check('real sequential keys open the observed suggestions and pause before a second action');

  r=await run('press_key',{ref:byId(r,'search').ref,key:'ArrowDown'});
  assert.equal(byId(r,'search').activeDescendant.id,'alice');assert.equal(byId(r,'search').activeDescendant.name,'Alice Kim');
  assert.equal(byId(r,'alice').selected,true);
  r=await script(byId(r,'search').ref,'press("Enter")');assert(!r.error,JSON.stringify(r));
  r=await run('verify_page',{checks:[{kind:'field_value',ref:byId(r,'search').ref,expected:'Alice Kim'},{kind:'text_present',expected:'Alice Kim 선택됨'}]});
  assert.equal(r.verified,true,JSON.stringify(r));
  check('ArrowDown exposes the actual active option and Enter selects it before outcome verification');

  r=await script(byId(r,'partial').ref,'pressSequentially("abcd")');
  assert.equal(r.reason,'script_focus');assert.equal(r.actionIssued,true);
  assert.equal(await page.locator('#partial').inputValue(),'a');assert.equal(await page.locator('#secret').inputValue(),'');
  assert.equal(r.execution.commands.at(-1).actionIssued,true);
  check('mid-typing focus changes stop remaining keys without leaking input or replaying the prefix');

  r=await script(byId(r,'shadow-input').ref,'pressSequentially("메모")');assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(await page.getByLabel('그림자 입력').inputValue(),'메모');assert.equal(byId(r,'shadow-input').focused,true);
  r=await script(byId(r,'frame-input').ref,'pressSequentially("frame")');assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(await page.frameLocator('iframe').getByLabel('프레임 메모').inputValue(),'frame');
  await page.frameLocator('iframe').getByLabel('프레임 메모').fill('');
  await page.frameLocator('iframe').getByLabel('프레임 메모').evaluate(el=>el.oninput=()=>parent.document.getElementById('secret').focus());
  r=await script(byId(r,'frame-input').ref,'pressSequentially("abcd")');
  assert.equal(r.reason,'script_focus');assert.equal(r.actionIssued,true);
  assert.equal(await page.frameLocator('iframe').getByLabel('프레임 메모').inputValue(),'a');assert.equal(await page.locator('#secret').inputValue(),'');
  r=await script(byId(r,'readonly').ref,'pressSequentially("x")');assert.equal(r.reason,'script_target');assert.equal(r.actionIssued,false);
  r=await script(byId(r,'other').ref,'pressSequentially("bad\\nsubmit")');assert.equal(r.reason,'script_invalid');assert.equal(r.actionIssued,false);
  check('shadow inputs and Unicode work while readonly fields and implicit submission text are rejected');

  r=await script(byId(r,'send').ref,'press("Enter")');assert.equal(r.error,'approval_required',JSON.stringify(r));assert.equal(await page.evaluate(()=>submits),0);
  check('keyboard activation of the final send button still requires approval');

  // Exercise the host's approved-key branch as well as initial tool guards.
  // The test grants only the synthetic Send node and never a real transaction.
  for(const redirects of [true,false]) {
    await page.locator('#send').evaluate((el,redirects)=>el.onfocus=redirects?()=>document.getElementById('other').focus():null,redirects);
    r=await run('browser_snapshot');
    await worker.evaluate(({tabId,ref})=>testBrowserAgent.runBrowserAgent('keyboard',{tabId},'run_playwright',{code:`await browser.ref(${JSON.stringify(ref)}).press("Enter");`},{onApproval:async record=>{globalThis.keyboardApproval=record;return {requiresUserInput:true};}}),{tabId,ref:byId(r,'send').ref});
    await worker.evaluate(()=>testBrowserAgent.stopBrowserAgent());
    const before=await page.evaluate(()=>keys.length);
    const applied=(await worker.evaluate(({tabId,redirects})=>testBrowserAgent.runApprovedAction('approved-key-'+redirects,{tabId},keyboardApproval),{tabId,redirects})).result;
    if(redirects){assert.equal(applied.error,'approval_changed');assert.equal(applied.actionIssued,false);assert.equal(await page.evaluate(()=>keys.length),before);}
    else {assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(await page.evaluate(()=>submits),1);}
  }
  check('approved Enter also validates focus before sending and executes a stable approved button once');

  await worker.evaluate(()=>testBrowserAgent.stopBrowserAgent());await page.reload();
  let stage=0, failure, recoverySeen=false, finalReviews=0;
  const reviewedSteps=[];
  const keyboardPlan=[
    {text:'검색 입력란 확인',expected_outcome:'현재 페이지에 직원 검색 입력란이 관찰됨',status:'in_progress'},
    {text:'선택 결과 확인',expected_outcome:'입력값 Alice Kim과 선택 확인 문구가 실제로 검증됨',status:'pending'},
  ];
  const finalAnswer='Alice Kim을 선택하고 확인했습니다.';
  const call=(name,args={})=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try {
    if(route.request().method()==='GET')return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}});
    const body=route.request().postDataJSON(), plan=planCompletion(body), review=goalReviewPayload(body.messages);
    if(plan) {
      if(!plan.scopeAudit)plan.choices[0].message.tool_calls[0].function.arguments=JSON.stringify({steps:keyboardPlan});
      return route.fulfill({json:plan});
    }
    if(review) {
      if(review.phase==='checkpoint')return route.fulfill({json:reviewCompletion(review)});
      const proof=review.evidence.findLast(item=>item.usable&&!item.superseded&&item.tool==='verify_page'&&item.result?.verified===true);
      assert(proof,'Outcome reviewer must receive the actual successful selection verification');
      assert.deepEqual(proof.arguments.checks.map(check=>[check.kind,check.expected]),
        [['field_value','Alice Kim'],['text_present','Alice Kim 선택됨']]);
      assert(proof.result.checks.every(check=>check.passed===true));
      if(review.phase==='plan_step') {
        assert.equal(review.stepOutcomes.length,1);
        assert.equal(review.stepOutcomes[0].text,keyboardPlan[reviewedSteps.length]?.text);
        assert.equal(review.stepOutcomes[0].expected_outcome,keyboardPlan[reviewedSteps.length]?.expected_outcome);
        if(!reviewedSteps.length){const input=byId(proof.result,'search');assert.equal(input.name,'직원 검색');assert.equal(input.role,'combobox');}
        reviewedSteps.push(review.stepOutcomes[0].text);
      }else{
        assert.equal(review.phase,'final');assert.equal(reviewedSteps.length,2);
        assert.equal(review.proposed_answer,finalAnswer);finalReviews++;
      }
      return route.fulfill({json:{choices:[{message:{content:JSON.stringify({status:'complete',
        checks:[{requirement:review.phase==='plan_step'?review.stepOutcomes[0].expected_outcome:'선택 결과 확인',status:'met',evidence_ids:[proof.id]}],next_step:''})},finish_reason:'stop'}]}});
    }
    assert.equal(body.messages.filter(m=>m.role==='system').length,1);
    const last=body.messages.findLast(m=>m.role==='tool'), result=last?JSON.parse(last.content):null;
    let calls, content='';
    if(stage===0)calls=[call('browser_snapshot')];
    if(stage===1)calls=[call('run_playwright',{code:`await browser.ref(${JSON.stringify(byId(result,'redirect').ref)}).press("A");`})];
    if(stage===2){
      assert.equal(result.reason,'script_focus');assert.equal(result.actionIssued,false);
      recoverySeen=body.messages[0].content.includes('retained prefix');assert(recoverySeen);
      const api=body.tools.find(t=>t.function.name==='run_playwright').function.description;
      assert(api.includes('pressSequentially'));assert(api.includes('activeDescendant'));
      calls=[call('run_playwright',{code:`await browser.ref(${JSON.stringify(byId(result,'search').ref)}).pressSequentially("alice");`})];
    }
    if(stage===3){assert(byId(result,'alice'));calls=[call('press_key',{ref:byId(result,'search').ref,key:'ArrowDown'})];}
    if(stage===4){assert.equal(byId(result,'search').activeDescendant.name,'Alice Kim');calls=[call('press_key',{ref:byId(result,'search').ref,key:'Enter'})];}
    if(stage===5)calls=[call('verify_page',{checks:[{kind:'field_value',ref:byId(result,'search').ref,expected:'Alice Kim'},{kind:'text_present',expected:'Alice Kim 선택됨'}]})];
    if(stage===6){assert.equal(result.verified,true);content=finalAnswer;}
    if(stage===7){
      // A text candidate verifies one stage. The sole extra executor decision
      // is admitted only after host persistence of that exact 1/2 transition.
      const followup=body.messages.findLast(message=>message.role==='user'&&typeof message.content==='string'&&
        message.content.startsWith('The current stage passed independent review and its completion was saved.'));
      assert(followup,'Later-stage candidate requires real saved-stage feedback');
      const saved=JSON.parse(followup.content.split('\n').at(-1)).plan;
      assert.deepEqual(saved,keyboardPlan.map((step,index)=>({...step,status:index===0?'completed':'pending'})));
      assert.equal(reviewedSteps.length,1);content=finalAnswer;
    }
    assert(stage++<=7,'Unexpected model loop');
    await route.fulfill({json:{choices:[{message:{content,...(calls?{tool_calls:calls}:{})},finish_reason:calls?'tool_calls':'stop'}]}});
  }catch(error){failure=error;await route.fulfill({status:400,body:'fixture failure'});}});
  await worker.evaluate(()=>Promise.all([chrome.storage.local.set({browserWorkMode:'current'}),chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:21}})]));
  const ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const state=async()=>(await ui.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STATE'}))).data;
  for(let i=0;i<100&&(await state()).catalog?.models?.length!==1;i++)await new Promise(r=>setTimeout(r,30));
  const uiTabId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId,uiTabId})=>chrome.storage.session.set({chatSourceTabs:{[uiTabId]:tabId}}),{tabId,uiTabId});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('직원 검색에서 Alice Kim을 선택하고 확인해줘. 보내지는 마.');
  await ui.getByRole('button',{name:'모델 변경',exact:true}).waitFor({state:'visible'});
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  let reply;
  for(let i=0;i<900;i++){if(failure)throw failure;reply=(await state()).chat.messages.at(-1);if(reply?.role==='assistant'&&['done','error'].includes(reply.state))break;await new Promise(r=>setTimeout(r,40));}
  assert.equal(reply?.state,'done',JSON.stringify({stage,reply,state:await state()}));assert.equal(stage,8);assert(recoverySeen);
  assert.deepEqual(reviewedSteps,keyboardPlan.map(step=>step.text));assert.equal(finalReviews,1);
  assert((await state()).chat.task.plan.every(step=>step.status==='completed'));
  assert.equal(await page.locator('#search').inputValue(),'Alice Kim');assert.equal(await page.locator('#other').inputValue(),'');assert.equal(await page.evaluate(()=>submits),0);
  assert.equal((await page.evaluate(()=>keys.filter(e=>e.id==='search'&&e.key.length===1))).length,5,'The query must be typed only once');
  check('Pi/Qwen-format conversation receives focus feedback, corrects the next action and verifies selection without duplicate input');
  assert.deepEqual(errors,[]);
  await mkdir('verification',{recursive:true});
  await writeFile('verification/keyboard-interaction-browser.json',JSON.stringify({checks,errors,actualBrowser:true,actualModel:false,syntheticModel:'QWEN3.8-27B-FP8-256K',syntheticSite:true,recoverySeen,
    executorDecisions:stage,reviewedSteps,finalReviews},null,2));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,mkdir,rm,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {planCompletion} from './fixtures/task-plan.mjs';
import {completionIntentResponse} from './fixtures/completion-intent.mjs';
import {goalReviewPayload,reviewCompletion} from './fixtures/goal-review.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-form-workflow-')),extension=resolve(profile,'extension');
let context,ui,page,worker,stage=0,failure,allocationQuestionId;
const checks=[],errors=[],url='https://form-workflow.example.test/effort';
const goal='개발은 로그인 오류 수정, 테스트는 회귀 테스트로 공수 총 480분을 입력해줘. 상시업무인지와 시간 배분은 먼저 물어보고 최종 등록은 내 승인을 받아.';
const html=`<!doctype html><html lang="ko"><title>공수 입력</title><style>body{font:16px sans-serif;padding:24px}label{display:block;margin:12px}input,textarea{font:inherit}fieldset{margin:12px}</style>
<form aria-label="업무 입력"><section id="first"><h1>업무 내용</h1>
<label>개발 업무 내용<textarea id="dev" required></textarea></label><label>테스트 업무 내용<textarea id="qa" required></textarea></label>
<label><input id="regular" type="checkbox">상시업무</label><button id="next" type="button">다음</button></section>
<section id="second" hidden><h1>공수 배분</h1><p>총 공수는 480분입니다.</p>
<fieldset><legend>개발</legend><label>개발 시간<input id="hours" type="number" required min="0.5" max="8" step="0.5" aria-describedby="hours-help"></label><p id="hours-help">단위: 시간</p></fieldset>
<fieldset><legend>테스트</legend><label>테스트 시간<input id="minutes" type="number" required min="30" max="480" step="30" aria-describedby="minutes-help"></label><p id="minutes-help">단위: 분</p></fieldset>
<button type="submit">등록</button></section><p role="status" id="status"></p></form>
<script>window.log=[];window.submits=0;document.querySelectorAll('input,textarea').forEach(el=>el.addEventListener('input',()=>log.push(el.id)));
next.onclick=()=>{first.hidden=true;second.hidden=false};document.querySelector('form').onsubmit=e=>{e.preventDefault();submits++;document.querySelector('#status').textContent='공수 등록 완료'};</script></html>`;
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
const last=async()=>(await state()).chat.messages.at(-1);
async function poll(fn,want){let value;for(let i=0;i<900;i++){if(failure)throw failure;value=await fn();if(value===want)return;await new Promise(r=>setTimeout(r,40));}assert.equal(value,want,JSON.stringify({stage,last:await last()}));}
const elements=result=>(result.observation||result).frames?.flatMap(f=>f.elements||[])||[];
const ref=(result,name)=>{const found=elements(result).find(e=>e.name===name);assert(found,`${name}: ${JSON.stringify(result)}`);return found.ref;};
const call=(name,args)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const note=text=>{checks.push(text);console.log(`PASS ${text}`);};
try{
  await mkdir('verification',{recursive:true});await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.formTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(10000);
  await context.route(url,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
    if(route.request().method()==='GET')return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}});
    const body=route.request().postDataJSON(),planning=planCompletion(body),intent=completionIntentResponse(body),review=goalReviewPayload(body.messages);
    if(planning||intent)return route.fulfill({json:planning||intent});
    if(review)return route.fulfill({json:reviewCompletion(review)});
    const result=JSON.parse(body.messages.findLast(m=>m.role==='tool')?.content||'{}');
    let calls=[],text='';const current=stage++;
    if(current===0)calls=[call('select_tools',{groups:['input','scripts']}),call('browser_snapshot',{})];
    if(current===1){assert(elements(result).some(e=>e.name==='개발 업무 내용'&&e.required&&e.validation?.issues.includes('valueMissing')),JSON.stringify(result));calls=[call('ask_user',{question:'이번 작업은 상시업무인가요?',choices:[{label:'상시업무'},{label:'일회성 업무'}]})];}
    if(current===2)calls=[call('select_tools',{groups:['input','scripts']}),call('browser_snapshot',{})];
    if(current===3)calls=[call('fill_form',{fields:[{field_id:ref(result,'개발 업무 내용'),value:'로그인 오류 수정'},{field_id:ref(result,'테스트 업무 내용'),value:'회귀 테스트'}]})];
    if(current===4)calls=[call('run_playwright',{code:`await browser.ref(${JSON.stringify(ref(result,'상시업무'))}).setChecked(true);`})];
    if(current===5)calls=[call('verify_page',{checks:[{kind:'field_value',ref:ref(result,'개발 업무 내용'),expected:'로그인 오류 수정'},{kind:'field_valid',ref:ref(result,'개발 업무 내용'),expected:'true'},{kind:'field_value',ref:ref(result,'테스트 업무 내용'),expected:'회귀 테스트'},{kind:'control_state',ref:ref(result,'상시업무'),expected:'true'}]})];
    if(current===6){assert(result.verified);calls=[call('click_element',{ref:ref(result,'다음')})];}
    if(current===7){const control=elements(result).find(e=>e.name==='개발 시간');assert.equal(control.description,'단위: 시간');assert.equal(control.constraints.step,'0.5');calls=[call('ask_user',{question:'480분을 어떻게 나눌까요?',choices:[{label:'균등 배분',description:'개발 240분, 테스트 240분'},{label:'개발에 더 배분',description:'개발 360분, 테스트 120분'}],input_placeholder:'개발 몇 분, 테스트 몇 분으로 적어주세요.'})];}
    if(current===8){
      const answers=body.messages.filter(m=>m.role==='user'&&m.content?.startsWith('개발 300분, 테스트 180분\n<answered_question>\n'));
      assert.equal(answers.length,1,'The explicit answer must reach the model exactly once');
      const envelope=/^개발 300분, 테스트 180분\n<answered_question>\n([^\n]+)\n<\/answered_question>$/.exec(answers[0].content);
      assert(envelope,'Keep the verbatim answer and its question binding');
      assert.deepEqual(JSON.parse(envelope[1]),{questionId:allocationQuestionId,question:'480분을 어떻게 나눌까요?',answer:'개발 300분, 테스트 180분'});
      assert(body.messages.some(m=>m.role==='user'&&m.content===goal),'Keep the original request and approval restriction');
      calls=[call('select_tools',{groups:['input']}),call('browser_snapshot',{})];
    }
    if(current===9)calls=[call('fill_form',{fields:[{field_id:ref(result,'개발 시간'),value:'5'},{field_id:ref(result,'테스트 시간'),value:'180'}]})];
    if(current===10)calls=[call('verify_page',{checks:[{kind:'field_value',ref:ref(result,'개발 시간'),expected:'5'},{kind:'field_valid',ref:ref(result,'개발 시간'),expected:'true'},{kind:'field_value',ref:ref(result,'테스트 시간'),expected:'180'},{kind:'field_valid',ref:ref(result,'테스트 시간'),expected:'true'},{kind:'field_sum',terms:[{ref:ref(result,'개발 시간'),multiplier:'60'},{ref:ref(result,'테스트 시간')}],expected:'480'}]})];
    if(current===11){assert.equal(result.verified,true);calls=[call('request_approval',{ref:ref(result,'등록'),summary:'개발 300분과 테스트 180분, 총 480분의 상시업무를 등록합니다.'})];}
    if(current===12)calls=[call('verify_page',{checks:[{kind:'text_present',expected:'공수 등록 완료'}]})];
    // A text answer closes one plan stage per independent stage review
    // (agent-runtime.js); the two-stage fixture plan asks for the answer once
    // more after the first stage passes. No further tool call is allowed.
    if(current>=13){assert.equal(result.verified,true);text='개발 300분과 테스트 180분으로 등록하고 확인했습니다.';}
    assert(current<=14,JSON.stringify(result));
    return route.fulfill({json:{choices:[{message:calls.length?{content:'',tool_calls:calls}:{content:text},finish_reason:calls.length?'tool_calls':'stop'}]}});
  }catch(error){failure=error;return route.fulfill({status:500,body:'synthetic fixture failure'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.local.set({browserWorkMode:'current'}));
  const token=`header.${Buffer.from(JSON.stringify({exp:Date.now()/1000+3600})).toString('base64url')}.signature`;
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
  ui=await context.newPage();ui.on('pageerror',error=>errors.push(error.message));await ui.setViewportSize({width:360,height:850});await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async()=>(await state()).catalog?.models?.length,1);
  const uiTab=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  const tabId=await worker.evaluate(async({uiTab,url})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===url);await chrome.storage.session.set({chatSourceTabs:{[uiTab]:tab.id}});return tab.id;},{uiTab,url});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(goal);await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=>(await last())?.question?.text,'이번 작업은 상시업무인가요?');assert.deepEqual(await page.evaluate(()=>log),[]);
  await ui.locator('.question-card[data-answered=false]').getByRole('button',{name:/상시업무/}).click();
  await poll(async()=>(await last())?.question?.text,'480분을 어떻게 나눌까요?');await poll(async()=>(await last())?.state,'done');
  assert.equal(await page.locator('#hours').inputValue(),'');assert.equal(await page.locator('#minutes').inputValue(),'');assert.equal(await page.evaluate(()=>submits),0);
  assert.equal(await page.locator('#dev').inputValue(),'로그인 오류 수정');assert(await page.locator('#regular').isChecked());
  allocationQuestionId=(await last()).question.id;
  await ui.reload();await ui.getByRole('textbox',{name:'직접 답변',exact:true}).fill('개발 300분, 테스트 180분');await ui.getByRole('button',{name:'답변 보내기',exact:true}).click();
  await poll(async()=>(await last())?.question?.kind,'approval');await poll(async()=>(await last())?.state,'done');
  assert.equal(await page.locator('#hours').inputValue(),'5');assert.equal(await page.locator('#minutes').inputValue(),'180');assert.equal(await page.evaluate(()=>submits),0);
  assert.deepEqual(await page.evaluate(()=>log),['dev','qa','regular','hours','minutes']);
  await ui.getByRole('button',{name:'등록',exact:true}).waitFor();
  await ui.getByRole('button',{name:'등록',exact:true}).scrollIntoViewIfNeeded();
  await ui.screenshot({path:'verification/form-workflow-approval.png'});
  note('two-step form pauses for checkbox intent and allocation, retains supplied activities through reload, converts units and verifies actual values without replay');
  await ui.getByRole('button',{name:'등록',exact:true}).click();await poll(async()=>(await state()).chat.task?.status,'done');
  assert.equal(await page.evaluate(()=>submits),1);assert.equal((await state()).chat.task.goal,goal);
  note('final submission requires HITL and executes once, then verifies the visible confirmation');

  // Exercise the shipped verifier against wrong totals, invalid fields and stale refs.
  await ui.close(); // These executor probes have no chat lease; stop UI recovery polling.
  await worker.evaluate(async()=>{await formTest.ready;await formTest.stopBrowserAgent();});
  const run=(name,args={})=>worker.evaluate(async({tabId,name,args})=>(await formTest.runBrowserAgent('sum-check',{tabId},name,args)).result,{tabId,name,args});
  let observation=await run('browser_snapshot');
  const sumCheck=obs=>({kind:'field_sum',terms:[{ref:ref(obs,'개발 시간'),multiplier:'60'},{ref:ref(obs,'테스트 시간')}],expected:'480'});
  const staleCheck=sumCheck(observation);
  await page.locator('#minutes').fill('150');let result=await run('verify_page',{checks:[sumCheck(observation)]});assert.equal(result.verified,false,JSON.stringify(result));assert.equal(result.checks[0].reason,'sum_mismatch');
  await page.locator('#minutes').fill('180');result=await run('verify_page',{checks:[staleCheck]});assert.equal(result.error,'browser_stale');
  observation=await run('browser_snapshot');result=await run('verify_page',{checks:[sumCheck(observation)]});assert.equal(result.verified,true);
  await page.locator('#minutes').fill('175');observation=await run('browser_snapshot');assert(elements(observation).find(e=>e.name==='테스트 시간').validation.issues.includes('stepMismatch'));
  result=await run('verify_page',{checks:[sumCheck(observation)]});assert.equal(result.verified,false);assert.equal(result.checks[0].reason,'invalid_field');
  note('actual DOM totals reject mismatch, stale refs and native step errors without returning input values');
  assert.deepEqual(errors,[]);await writeFile('verification/form-workflow-browser.json',JSON.stringify({checks,errors,actualBrowser:true,syntheticModel:true,liveProvider:false},null,2));
}finally{if(!checks.length&&ui){await ui.screenshot({path:'verification/form-workflow-debug.png'}).catch(()=>{});console.log('UI',await ui.locator('body').innerText().catch(()=>''));}await context?.close();await rm(profile,{recursive:true,force:true});}

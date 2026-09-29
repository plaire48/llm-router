import {planCompletion} from './fixtures/task-plan.mjs';
import {CLARIFICATION_PROMPT} from '../user-question.js';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-script-recovery-')),extension=resolve(profile,'extension');
const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const checks=[],errors=[],reasons=[];let context,ui,worker,stage=0,mode='repair',routeFailure,releaseFailure;
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
const state=()=>ui.evaluate(async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function poll(fn,want) {let actual;for(let i=0;i<600;i++){if(routeFailure)throw routeFailure;actual=await fn();if(actual===want)return;await new Promise(r=>setTimeout(r,50));}assert.equal(actual,want);}
const elements=result=>(result.observation||result).frames.flatMap(frame=>frame.elements||[]);
const ref=(result,name)=>{const found=elements(result).find(el=>el.name===name);assert(found,name);return found.ref;};
function reply(name,args={}) {return {choices:[{message:name?{content:'',tool_calls:[{id:`step-${stage}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'초안을 작성하고 저장 상태를 확인했습니다.'},finish_reason:name?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};}
async function send(text){await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(text);await ui.getByRole('button',{name:'전송',exact:true}).click();}
try {
  await mkdir('verification',{recursive:true});await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('https://*/*','http://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  await context.route('https://draft.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<title>초안 작성</title><label>제목<input></label><label>본문<textarea></textarea></label><button>저장</button><output></output><script>window.writes=[];addEventListener('input',event=>{window.writes.push({trusted:event.isTrusted,value:event.target.value});document.querySelector('output').textContent='초안 저장됨';});</script>`}));
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try {
    if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'GLM-5.2-NVFP4',context_length:524288}]}});
    const body=route.request().postDataJSON(),review=goalReviewPayload(body.messages);
    if(body.messages.some(m=>m.role==='system'&&m.content.startsWith(CLARIFICATION_PROMPT)))return route.fulfill({json:reply('ask_user',{question:'어떤 내용을 다시 확인할까요?',input_mode:'long_text'})});
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    if(review)return route.fulfill({json:reviewCompletion(review)});
    const last=body.messages.findLast(m=>m.role==='tool'),result=last?JSON.parse(last.content):null;
    const current=stage++;let name,args={};
    if(result?.reason)reasons.push(result.reason);
    if(mode==='repeat') {
      name=current===0?'browser_snapshot':'run_playwright';args=current===0?{}:{code:'return await page.evaluate(() => 1);'};
    } else {
      if(current===0)name='browser_snapshot';
      if(current===1){name='run_playwright';args={code:'const = ;'};}
      if(current===2){assert.equal(result.reason,'script_syntax');assert.equal(result.actionIssued,false);assert(result.observation);assert(body.tools.some(t=>t.function.name==='fill_form'));await new Promise(resolve=>{releaseFailure=resolve;});name='run_playwright';args={code:'await page.getByLabel("제목").fill("DO_NOT_WRITE"); return await page.evaluate(() => document.title);'};}
      if(current===3){assert.equal(result.reason,'script_api');assert.equal(result.phase,'preflight');assert.equal(result.actionIssued,false);assert.deepEqual(result.execution.commands,[]);name='run_playwright';args={code:'await page.getByRole("textbox").fill("DO_NOT_WRITE");'};}
      if(current===4){assert.equal(result.reason,'script_locator');name='run_playwright';args={code:'await page.getByRole("button",{name:"저장",exact:true}).fill("DO_NOT_WRITE");'};}
      if(current===5){assert.equal(result.reason,'script_target');assert.equal(result.actionIssued,false);assert.equal(result.execution.commands.at(-1)?.actionIssued,false);assert(result.instruction);assert(result.recovery);name='fill_form';args={fields:[{field_id:ref(result,'제목'),value:'업무 안내'},{field_id:ref(result,'본문'),value:'작성한 본문을 페이지에 반영합니다.'}]};}
      if(current===6){assert.equal(result.verified,true);name='verify_page';args={checks:[{kind:'field_value',ref:ref(result,'제목'),expected:'업무 안내'},{kind:'field_value',ref:ref(result,'본문'),expected:'작성한 본문을 페이지에 반영합니다.'},{kind:'text_present',expected:'초안 저장됨'}]};}
      if(current===7)assert.equal(result.verified,true);
    }
    return route.fulfill({json:reply(name,args)});
  } catch(error){routeFailure=error;return route.fulfill({status:500,body:'Synthetic assertion failed'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  // This suite checks detailed execution UI; ordinary mode is covered by debug-plan-ui-browser.
  await worker.evaluate(() => chrome.storage.local.set({debugMode: true}));
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  const page=await context.newPage();await page.goto('https://draft.example.test/');
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);await ui.setViewportSize({width:360,height:800});
  await poll(async()=>!!(await state()).catalog?.models?.length,true);
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://draft.example.test/').id),uiId=await ui.evaluate(async()=> (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId,uiId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{tabId,uiId});
  await send('업무 안내 제목과 본문을 작성하고 페이지의 초안 저장 상태를 확인해줘');
  await poll(()=>!!releaseFailure,true);
  assert.notEqual(await ui.locator('.agent-trace').last().getAttribute('open'), null, 'Live progress opens automatically');
  await ui.getByText('코드 문법 오류',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('제목').inputValue(),'');
  await ui.waitForTimeout(700);await ui.screenshot({path:resolve('verification/script-failure-panel.png'),fullPage:true});
  check('a real sandbox syntax failure shows its short reason while keeping the unfinished task in an error state');
  releaseFailure();releaseFailure=null;
  await poll(async()=> (await state()).chat.messages.at(-1)?.state,'done');
  assert.deepEqual(reasons,['script_syntax','script_api','script_locator','script_target']);
  check('syntax, unavailable page.evaluate, ambiguous locator and non-editable target failures return distinct repair guidance with fresh observations');
  assert.equal(await page.getByLabel('제목').inputValue(),'업무 안내');assert.equal(await page.getByLabel('본문').inputValue(),'작성한 본문을 페이지에 반영합니다.');
  const writes=await page.evaluate(()=>window.writes);assert.equal(writes.length,2);assert(writes.every(w=>w.trusted&&!w.value.includes('DO_NOT_WRITE')));
  assert.equal((await state()).chat.task.goalReview.status,'complete');
  check('already-authorized semantic tools complete the requested draft after script failures with exactly two trusted writes and independent result review');
  if(!await ui.locator('.agent-trace').last().getAttribute('open').then(v=>v!==null))await ui.locator('.agent-trace > summary').last().click();
  await poll(()=>ui.getByText('복구됨',{exact:true}).count(),4);assert.equal(await ui.locator('.agent-trace').last().getAttribute('data-state'),'done');
  assert((await state()).chat.messages.at(-1).trace.filter(s=>s.status==='error').length===4);
  check('verified recovery clears the warning appearance while preserving the original failure receipts');
  await ui.waitForTimeout(700);await ui.screenshot({path:resolve('verification/script-recovery-panel.png'),fullPage:true});
  await ui.reload();await ui.setViewportSize({width:1100,height:850});await ui.locator('.agent-trace > summary').last().click();
  await poll(()=>ui.getByText('복구됨',{exact:true}).count(),4);
  assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await ui.waitForTimeout(700);await ui.screenshot({path:resolve('verification/script-recovery-desktop.png'),fullPage:true});
  check('recovered state persists after reload in both side-panel and desktop layouts');
  mode='repeat';stage=0;await send('이 페이지를 코드로 다시 확인해줘');
  await poll(async()=> (await state()).chat.task?.status,'awaiting_user');
  assert((await state()).chat.messages.at(-1).question);assert.equal(stage,4);
  // The persisted answer can precede its React render. Wait for this turn's
  // question before inspecting the last trace, otherwise it may be the prior
  // turn's four correctly recovered errors.
  await ui.getByText('어떤 내용을 다시 확인할까요?',{exact:true}).waitFor();
  if(await ui.locator('.agent-trace').last().getAttribute('open')===null)await ui.locator('.agent-trace > summary').last().click();
  assert.equal(await ui.locator('.agent-trace').last().getByText('복구됨',{exact:true}).count(),0);
  assert.equal(await ui.locator('.agent-trace').last().getByText('지원하지 않는 동작',{exact:true}).count(),3);
  assert.equal((await page.evaluate(()=>window.writes)).length,2);
  check('identical failing code pauses for clarification after an intermediate review and three no-progress attempts without replaying earlier writes');
  assert.deepEqual(errors,[]);
  await writeFile('verification/script-recovery-browser.json',JSON.stringify({checks,errors,syntheticModelResponses:true,realBrowserActions:true,actualCompanyPageVerified:false},null,2));
} catch(error){console.error({stage,mode,reason:routeFailure?.message,state:ui?await state().then(s=>s.chat.messages.at(-1)).catch(()=>null):null});throw error;}
finally {releaseFailure?.();await context?.close();await rm(profile,{recursive:true,force:true});}

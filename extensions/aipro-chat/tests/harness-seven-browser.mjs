import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {PLAN_PROMPT} from '../task-plan.js';
import {goalReviewPayload,reviewCompletion,scopeAuditCompletion} from './fixtures/goal-review.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-seven-')),extension=resolve(profile,'extension');
const checks=[],errors=[],phases=[];let context,ui,page,stage=0,routeError,stepReviews=0;
const check=text=>{checks.push(text);console.log('PASS '+text);};
const plan=[{text:'카드 이동',status:'in_progress',expected_outcome:'자료 카드가 보관함 안에 있고 삭제되지 않음'}, {text:'결과 확인',status:'pending',expected_outcome:'원래 요청한 위치와 카드 내용을 확인함'}];
const completion=(name,args={},content='')=>({choices:[{message:{content, ...(name?{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{})},finish_reason:name?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});
const ref=(result,name)=>(result.observation||result).frames.flatMap(frame=>frame.elements||[]).find(el=>el.name===name)?.ref;
try {
  await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://seven.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><title>자료 보드</title><style>body{font:16px system-ui;padding:36px;background:#f1f7fe}main{display:flex;gap:24px}section{width:230px;min-height:220px;border:1px solid #ddd;border-radius:16px;padding:16px;background:white}[draggable]{padding:24px;border-radius:12px;background:#e8f1fe;cursor:grab}</style><h1>자료 보드</h1><main><section aria-label="시작함"><div id="card" draggable="true" aria-label="자료 카드">검토 자료</div></section><section id="waiting" aria-label="대기함" ondragover="event.preventDefault()" ondrop="move(event,this)">대기함</section><section id="archive" aria-label="보관함" ondragover="event.preventDefault()" ondrop="move(event,this)">보관함</section><section id="delete" aria-label="삭제" ondragover="event.preventDefault()" ondrop="window.deleted++">삭제</section></main><script>window.drops=[];window.deleted=0;window.starts=0;document.querySelector('#card').addEventListener('dragstart',e=>{starts++;e.dataTransfer.setData('text/plain','card')});function move(e,target){e.preventDefault();target.append(document.querySelector('#card'));drops.push({target:target.id,trusted:e.isTrusted})}</script>`}));
  await context.route('https://aipro.sdsdev.co.kr/api/models',route=>route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144,max_input_tokens:221184}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions',async route=>{
    try {
      const body=route.request().postDataJSON();assert.equal(body.model,'QWEN3.8-27B-FP8-256K');
      assert.equal(body.messages.filter(message=>message.role==='system').length,1);
      const audit=scopeAuditCompletion(body); if(audit)return route.fulfill({json:audit});
      if(body.messages[0].content.startsWith(PLAN_PROMPT)) return route.fulfill({json:completion('update_plan',{steps:plan})});
      const review=goalReviewPayload(body.messages);
      if(review){
        phases.push(review.phase);assert(!body.tools?.length);
        if(review.phase==='checkpoint')return route.fulfill({json:reviewCompletion(review)});
        const inArchive=await page.locator('#archive #card').count()===1;
        const proof=review.evidence.findLast(item=>item.tool==='verify_page'&&item.usable);
        assert(proof);
        if(review.phase==='plan_step') {
          stepReviews++;
          assert.equal(review.stepOutcomes.length,1);
          assert.equal(review.stepOutcomes[0].expected_outcome,plan[stepReviews <= 2 ? 0 : 1].expected_outcome);
          assert(stepReviews <= 3);
          if(stepReviews===1){assert(!inArchive);assert.equal(proof.arguments.checks[0].kind,'text_present');}
          else {assert(inArchive);assert.equal(proof.arguments.checks[0].kind,'element_in');}
        } else {assert(inArchive);assert.equal(review.phase,'final');}
        return route.fulfill({json:completion(null,{},JSON.stringify({status:inArchive?'complete':'revise',checks:[{requirement:'자료 카드가 보관함에 있음',status:inArchive?'met':'unmet',evidence_ids:inArchive?[proof.id]:[]}],next_step:inArchive?'':'대기함으로 이동했습니다. 현재 카드만 보관함으로 옮기고 실제 부모 위치를 확인하세요.'}))});
      }
      const result=JSON.parse(body.messages.findLast(message=>message.role==='tool')?.content||'null');
      let name,args={},content='';
      switch(stage++) {
        case 0:name='browser_snapshot';break;
        case 1:name='drag_element';args={source_ref:ref(result,'자료 카드'),target_ref:ref(result,'대기함')};break;
        case 2:assert.equal(result.ok,true);name='verify_page';args={checks:[{kind:'text_present',expected:'자료 보드'}]};break;
        case 3:name='update_plan';args={steps:plan.map((step,index)=>({...step,status:index?'in_progress':'completed'}))};break;
        case 4:
          assert.equal(result.deferred,true);
          assert.equal((await ui.evaluate(async()=> (await chrome.storage.local.get('chat')).chat.task.plan))[0].status,'in_progress');
          name='browser_snapshot';args={query:'자료 보관함'};break;
        case 5:name='drag_element';args={source_ref:ref(result,'자료 카드'),target_ref:ref(result,'보관함')};break;
        case 6:name='verify_page';args={checks:[{kind:'element_in',ref:ref(result,'자료 카드'),expected:ref(result,'보관함')}]};break;
        case 7:assert.equal(result.verified,true);name='update_plan';args={steps:plan.map((step,index)=>({text:step.text,status:index?'in_progress':'completed'}))};break;
        case 8:content='자료 카드를 보관함으로 옮기고 위치를 확인했습니다.';break;
        default:throw Error('Unexpected model round');
      }
      await route.fulfill({json:completion(name,args,content)});
    } catch(error){routeError=error;await route.abort();}
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  page=await context.newPage();await page.goto('https://seven.example.test/board');
  ui=await context.newPage();ui.on('pageerror',error=>errors.push(error.message));await ui.setViewportSize({width:420,height:850});
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button',{name:'AI Pro',exact:true}).waitFor();
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:773}}));
  await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  const uiTab=await ui.evaluate(async()=> (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async uiTab=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith('https://seven.example.test/'));await chrome.storage.session.set({chatSourceTabs:{[uiTab]:tab.id}});},uiTab);
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('자료 카드를 보관함으로 옮겨줘. 삭제하지 마.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await ui.waitForFunction(()=>document.querySelector('.message-assistant[data-state="done"],.message-assistant[data-state="error"]'),null,{timeout:60000});
  if(routeError)throw routeError;
  let chat=await ui.evaluate(async()=> (await chrome.storage.local.get('chat')).chat);
  assert.equal(chat.messages.at(-1).state,'done',JSON.stringify(chat.messages.at(-1)));
  assert.equal(chat.task.goalReview.status,'complete');assert.equal(chat.task.verification.status,'passed');
  assert.equal(chat.task.plan[0].expected_outcome,plan[0].expected_outcome);
  assert.equal(stepReviews,3);assert.equal(phases.at(-1),'final');
  assert(chat.task.plan.every(step=>step.status==='completed'));
  assert.deepEqual(await page.evaluate(()=>drops),[{target:'waiting',trusted:true},{target:'archive',trusted:true}]);
  assert.equal(await page.evaluate(()=>starts),2);assert.equal(await page.evaluate(()=>deleted),0);
  check('observable step criteria remain pending after an unrelated passing check, then the model uses fresh DOM evidence to repair only the wrong destination');
  check('real native drag/drop uses trusted browser events, concrete containment verification and a separate final review under the Qwen wire contract');
  await ui.screenshot({path:'verification/harness-seven-panel.png'});
  await ui.reload();await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  chat=await ui.evaluate(async()=> (await chrome.storage.local.get('chat')).chat);
  assert.equal(chat.task.plan[0].expected_outcome,plan[0].expected_outcome);assert.equal(chat.messages.at(-1).state,'done');
  assert.equal(await page.evaluate(()=>starts),2);
  check('reload preserves the outcome-bearing plan and verified conversation without repeating the drag');
  assert.deepEqual(errors,[]);
  await writeFile('verification/harness-seven-browser.json',JSON.stringify({checks,phases,syntheticModel:true,actualBrowser:true,actualModel:false,liveAccount:false},null,2));
} catch(error){console.error({stage,routeError:routeError?.message,state:await ui?.evaluate(async()=>{const {chat}=await chrome.storage.local.get('chat');return {task:chat?.task,last:chat?.messages.at(-1)};}).catch(()=>null)});throw error;}
finally {await context?.close();await rm(profile,{recursive:true,force:true});}

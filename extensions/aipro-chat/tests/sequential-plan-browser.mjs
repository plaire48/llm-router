import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {PLAN_PROMPT} from '../task-plan.js';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-sequential-plan-')),extension=resolve(profile,'extension');
const steps=[
  {text:'선수 표 확인',expected_outcome:'표에서 선수 종목과 소속 확인',status:'in_progress'},
  {text:'출처 시점 구분',expected_outcome:'표에 표시한 기준 연도 확인',status:'pending'},
  {text:'결과 정리',expected_outcome:'종목, 소속과 기준 연도를 답변에 포함',status:'pending'},
];
const answer='시험 선수의 종목은 사브르, 소속은 시험팀입니다. 표의 기준 연도는 2026년입니다.';
const call=(name,args={})=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const reply=(calls,content='')=>({choices:[{message:{content,...(calls?{tool_calls:calls}:{})},finish_reason:calls?'tool_calls':'stop'}]});
let context,ui,worker,failure,held,finalHeld,round=0,stepReviews=0,finalReviews=0,reads=0;
const errors=[],counts=[];
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
const plan=()=>ui.locator('.message-assistant').last().getByRole('region',{name:'작업 계획'});
async function poll(read,expected){let actual;for(let i=0;i<500;i++){if(failure)throw failure;actual=await read();if(actual===expected)return;await new Promise(r=>setTimeout(r,40));}assert.equal(actual,expected);}
try{
  await mkdir('verification/sequential-plan',{recursive:true});
  await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('https://sequence.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<title>선수 표</title><h1>2026년 시험 선수 표</h1><table><tr><th>선수</th><th>종목</th><th>소속</th></tr><tr><td>시험 선수</td><td>사브르</td><td>시험팀</td></tr></table>'}));
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
    if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'GLM-5.2-NVFP4',context_length:524288}]}});
    const body=route.request().postDataJSON();
    if(body.messages[0].content.startsWith(PLAN_PROMPT))return route.fulfill({json:reply([call('update_plan',{steps})])});
    const review=goalReviewPayload(body.messages);
    if(review){
      assert(JSON.stringify(review.evidence).includes('사브르'),'review must contain actual DOM evidence');
      if(review.phase==='plan_step'){
        assert.equal(review.stepOutcomes.length,1,'text fallback must never batch three outcomes');
        assert.equal(review.stepOutcomes[0].text,steps[stepReviews].text);stepReviews++;
      }else{assert.equal(stepReviews,3);finalReviews++;await new Promise(r=>{finalHeld=r;});}
      return route.fulfill({json:reviewCompletion(review)});
    }
    round++;assert(round<=4,'one initial read and one candidate per pending stage');
    if(round===1){reads++;return route.fulfill({json:reply([call('read_page')])});}
    if(round>2)await new Promise(r=>{held=r;});
    return route.fulfill({json:reply(null,answer)});
  }catch(error){failure=error;await route.fulfill({status:500,body:'Fixture assertion failed'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{
    await chrome.storage.local.set({browserWorkMode:'current'});
    await chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:20}});
  });
  const target=await context.newPage();await target.goto('https://sequence.example.test/');
  ui=await context.newPage();await ui.setViewportSize({width:850,height:850});
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  await poll(async()=>(await state()).catalog?.models?.length,1);
  const uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async id=>{const target=(await chrome.tabs.query({})).find(t=>t.url==='https://sequence.example.test/');await chrome.storage.session.set({chatSourceTabs:{[id]:target.id}});},uiId);
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('이 표에서 시험 선수의 종목, 소속, 기준 연도를 확인하고 기록 양식에 입력할 값을 알려줘.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  for(const count of [1,2]){
    await poll(()=>!!held,true);
    await poll(()=>plan().locator('.task-plan-count').innerText(),`${count}/3`);
    const s=await state();assert.equal(s.chat.messages.at(-1).state,'pending');
    assert.equal(s.chat.task.plan.filter(p=>p.status==='completed').length,count);counts.push(count);
    await ui.screenshot({path:`verification/sequential-plan/${count}-of-3.png`});
    if(count===1){await ui.reload();await poll(()=>plan().locator('.task-plan-count').innerText(),'1/3');}
    const release=held;held=null;release();
  }
  await poll(()=>!!finalHeld,true);
  await poll(()=>plan().locator('.task-plan-count').innerText(),'3/3');
  assert.equal((await state()).chat.messages.at(-1).state,'pending');
  assert.equal(await plan().locator('.task-plan-pause').innerText(),'답변 확인 중');counts.push(3);
  const release=finalHeld;finalHeld=null;release();
  await poll(async()=>(await state()).chat.task.status,'done');
  await poll(async()=>(await state()).chat.messages.at(-1).state,'done');
  assert.equal((await state()).chat.messages.at(-1).content,answer);
  // Persisted task state can precede React's storage-event render. Wait for
  // the actual user-visible answer as a separate delivery requirement.
  await ui.getByText(answer,{exact:true}).waitFor({state:'visible'});
  assert(await ui.getByText(answer,{exact:true}).isVisible());
  await ui.screenshot({path:'verification/sequential-plan/final.png'});
  await ui.reload();await poll(()=>plan().locator('.task-plan-count').innerText(),'3/3');
  assert.equal(await plan().locator('[aria-current=step]').count(),0);
  assert.deepEqual(errors,[]);assert.equal(reads,1);assert.equal(finalReviews,1);
  await writeFile('verification/sequential-plan/browser.json',JSON.stringify({actualBrowser:true,actualModel:false,syntheticSite:true,counts,stepReviews,finalReviews,reads,reloadPreserved:true,finalAnswerVisible:true,errors},null,2));
  console.log('PASS sequential fallback persists 1/3, 2/3, 3/3 and withholds final answer until final review; reload preserves progress');
}finally{held?.();finalHeld?.();await context?.close();await rm(profile,{recursive:true,force:true});}

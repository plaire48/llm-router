import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-approval-labels-')),extension=resolve(profile,'extension');
const checks=[],errors=[];let context,worker,ui,page,stage=0,label,action,failure;
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function until(fn){for(let i=0;i<700;i++){if(failure)throw failure;if(await fn())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('UI condition timed out');}
const check=text=>{checks.push(text);console.log('PASS '+text);};
try{
  await cp('dist',extension,{recursive:true});
  // Pre-grant the normal browser-access prompt in this isolated profile. The
  // production manifest retains optional permissions and the user's choice.
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('https://*/*','http://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(12000);
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('https://approval.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<title>신청 관리</title><h1>신청 관리</h1><button>신청서 제출</button><button>신청하기</button><button>신청 내역 삭제</button><button>보내기</button><button>이번 분기 전체 신청 내역을 영구 삭제</button><script>window.clicks=0;document.addEventListener('click',()=>clicks++);</script>`}));
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
    if(route.request().method()==='GET')return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',display_name:'QWEN3.8-27B-256K',context_length:262144}]}});
    const body=route.request().postDataJSON(),planning=planCompletion(body),review=goalReviewPayload(body.messages);
    if(planning)return route.fulfill({json:planning});if(review)return route.fulfill({json:reviewCompletion(review)});
    const last=body.messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    let name,args={};
    if(stage===0)name='browser_snapshot';
    if(stage===1){name='verify_page';args={checks:[{kind:'text_present',expected:'신청 관리'}]};}
    if(stage===2){assert.equal(result.verified,true);name='request_approval';args={ref:result.observation.frames.flatMap(frame=>frame.elements||[]).find(element=>element.name===label).ref};}
    assert(stage<3,'The agent must wait for approval');stage++;
    return route.fulfill({json:{choices:[{message:{content:'',tool_calls:[{id:`step-${stage}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}});
  }catch(error){failure=error;return route.fulfill({status:500,body:'fixture failed'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  page=await context.newPage();await page.goto('https://approval.example.test/');
  const token=`header.${Buffer.from(JSON.stringify({exp:Date.now()/1000+3600})).toString('base64url')}.signature`;
  await worker.evaluate(async token=>{await chrome.storage.local.set({browserWorkMode:'current'});await chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}});},token);
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);await until(async()=>(await state()).catalog?.models?.length);
  const tabId=await worker.evaluate(async()=>(await chrome.tabs.query({})).find(tab=>tab.url==='https://approval.example.test/').id),uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId,uiId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{tabId,uiId});
  for([label,action] of [['신청서 제출','제출'],['신청하기','신청'],['신청 내역 삭제','삭제'],['보내기','발송'],['이번 분기 전체 신청 내역을 영구 삭제','삭제']]){
    stage=0;await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(`이 페이지에서 ${label} 작업을 준비해주세요`);await ui.getByRole('button',{name:'전송',exact:true}).click();await until(async()=>(await state()).chat.task?.status==='awaiting_user'&&stage===3);
    const question=(await state()).chat.messages.at(-1).question,card=ui.locator('.action-approval[data-answered=false]');
    assert.equal(question.action,action);assert.equal(question.buttonLabel,label);assert.equal(question.text,`${action}할까요?`);assert.equal(question.hasEditableDraft,false);
    await card.getByRole('button',{name:label,exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'초안 수정'}).count(),0);
    await card.locator('summary').click();assert.equal(await card.locator('summary').innerText(),'내용 확인');
    for(const width of [320,420,1100]){
      await ui.setViewportSize({width,height:850});await card.scrollIntoViewIfNeeded();await assertModalTypography(card);
      assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const button=await card.getByRole('button',{name:label,exact:true}).boundingBox(),bounds=await card.boundingBox();assert(button.x>=bounds.x&&button.x+button.width<=bounds.x+bounds.width);
      if(label==='신청서 제출')await ui.screenshot({path:`verification/approval-labels-${width}.png`});
    }
    assert.equal(await page.evaluate(()=>clicks),0);
    await card.getByRole('button',{name:'취소',exact:true}).click();await until(async()=>(await state()).chat.messages.at(-1).question.answer?.state==='rejected');
    check(`${label}: actual bound label, ${action} confirmation, no irrelevant draft editor, shared typography at 320/420/1100px, zero page clicks on cancel`);
  }
  assert.deepEqual(errors,[]);await writeFile('verification/approval-labels-browser.json',JSON.stringify({checks,errors,actualBrowser:true,syntheticModel:'QWEN3.8-27B-FP8-256K',actualModel:false},null,2));
}catch(error){console.error(JSON.stringify({stage,label,errors,chat:(await state().catch(()=>({}))).chat,body:await ui?.locator('body').innerText()},null,2));throw error;}finally{await context?.close();await rm(profile,{recursive:true,force:true});}

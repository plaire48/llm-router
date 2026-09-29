import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-debug-ui-'));
const extension=resolve(process.env.NUBI_UI_TEST_DIST || 'dist');
const checks=[],errors=[]; let context,ui,worker;
const rpc=(type,args={})=>ui.evaluate(({type,args})=>chrome.runtime.sendMessage({type,...args}),{type,args});
async function launch(){
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route('https://aipro.sdsdev.co.kr/**',route=>route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K'}]}}));
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',token:'synthetic',receivedAt:1}}));
  ui=await context.newPage();ui.on('pageerror',error=>errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
}
async function settings(){await ui.getByRole('button',{name:'설정',exact:true}).click();return ui.getByRole('dialog',{name:'설정',exact:true});}
async function toggle(enabled){const panel=await settings();assert.equal(await panel.getByRole('checkbox',{name:'디버그 모드',exact:true}).isChecked(),!enabled);await panel.getByRole('checkbox',{name:'디버그 모드',exact:true}).click();await ui.waitForFunction(enabled=>document.querySelector('.settings-debug input')?.checked===enabled,enabled);for(let n=0;n<100;n++){if((await rpc('GET_STATE')).data.debugMode===enabled)break;await ui.waitForTimeout(30);}assert.equal((await rpc('GET_STATE')).data.debugMode,enabled);await ui.keyboard.press('Escape');}
async function countReads(){return ui.evaluate(()=>window.__recordReads.length);}
async function probe(){await ui.evaluate(()=>{window.__recordReads=[];const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=(message,...args)=>{if(['GET_TRACE_JOURNAL','GET_AGENT_DIAGNOSTICS'].includes(message?.type))window.__recordReads.push(message.type);return send(message,...args);};});}
try{
  await mkdir('verification/debug-plan-ui',{recursive:true});await launch();
  assert.equal((await rpc('GET_STATE')).data.debugMode,false);
  assert.equal((await rpc('SET_DEBUG_MODE',{enabled:'true'})).ok,false);
  await ui.evaluate(async()=>{
    const {chat}=await chrome.storage.local.get('chat');
    const before=[{text:'검색어 확인',status:'completed'},{text:'전체 원문 탐색',status:'pending'}];
    const after=[{text:'검색어 확인',status:'completed'},{text:'필요한 근거 확인',status:'in_progress'}];
    const progress={status:'awaiting_user',plan:after,updates:[{revision:1,at:1,before:[],after:before,reason:'요청 확인'},{revision:2,at:2,before,after,reason:'요청에 필요한 근거부터 확인합니다.'}]};
    await chrome.storage.local.set({chat:{...chat,task:null,messages:[{id:'debug-ui-message',role:'assistant',state:'done',content:'확인할 정보가 있습니다.',progress,trace:[...Array.from({length:8},(_,index)=>({id:`completed-${index}`,tool:'read_page',status:'done',label:`지난 조회 ${index+1}`})),{id:'debug-ui-error',tool:'read_page',status:'error',label:'읽기 실패'}],traceJournal:{available:true},question:{id:'question-ui',kind:'choice',text:'다시 확인할까요?',options:[{id:'yes',label:'확인'}]}}]}});
  });
  await ui.reload();await ui.locator('.task-plan').waitFor();await probe();
  assert.equal(await ui.locator('.trace-journal').count(),0);assert.equal(await ui.locator('.task-plan-history').count(),0);
  await ui.locator('.agent-trace > summary').click();
  assert.match(await ui.locator('.agent-trace').innerText(),/읽기 실패/);
  assert.equal(await ui.locator('.agent-trace [data-status=done]').count(),0);
  assert.equal(await ui.getByRole('button',{name:'최근 단계 펼치기',exact:true}).count(),0);
  assert.match(await ui.locator('.agent-trace > summary').innerText(),/진행 상황/);
  assert.equal(await ui.getByText('다시 확인할까요?',{exact:true}).isVisible(),true);
  assert.match(await ui.locator('.task-plan').innerText(),/1\/2/);
  assert.equal(await ui.locator('.task-plan-update-caption').isVisible(),false);
  assert.match(await ui.locator('.task-plan-update > summary').getAttribute('aria-label'),/1개 추가, 1개 제외/);
  assert.equal(await ui.locator('.task-plan-update-heading .task-plan-change-count').count(),2);
  await ui.locator('.task-plan-update > summary').focus();await ui.keyboard.press('Enter');
  assert.equal(await ui.locator('.task-plan-update-caption').isVisible(),true);
  assert.equal(await countReads(),0);checks.push('Default off omits record components and makes no journal reads; failure, question and plan count remain visible');
  await toggle(true);assert.equal(await ui.locator('.agent-trace [data-status=done]').count(),8);assert.equal(await ui.locator('.trace-journal').count(),2);assert.equal(await ui.locator('.task-plan-history').count(),1);
  await ui.locator('.agent-diagnostics > summary').click();await ui.waitForTimeout(150);
  assert((await countReads())>0);checks.push('Explicit debug setting enables diagnostic reads and detailed history');
  await ui.reload();await ui.locator('.task-plan').waitFor();assert.equal((await rpc('GET_STATE')).data.debugMode,true);
  let panel=await settings();assert.equal(await panel.getByRole('checkbox',{name:'디버그 모드',exact:true}).isChecked(),true);await ui.keyboard.press('Escape');
  await context.close();context=null;await launch();assert.equal((await rpc('GET_STATE')).data.debugMode,true);checks.push('Debug setting persists through page reload, settings reopening and browser restart');
  await toggle(false);assert.equal(await ui.locator('.agent-trace [data-status=done]').count(),0);assert.equal(await ui.locator('.trace-journal').count(),0);assert.equal(await ui.locator('.task-plan-history').count(),0);await probe();
  await ui.reload();await ui.locator('.task-plan').waitFor();await probe();await ui.waitForTimeout(150);assert.equal(await countReads(),0);assert.equal(await ui.locator('.trace-journal').count(),0);checks.push('Turning off unmounts both record views and remains off after reload');
  for(const width of [360,1100]){await ui.setViewportSize({width,height:850});await ui.locator('.task-plan-update > summary').click();const metrics=await ui.locator('.task-plan').evaluate(el=>({overflow:document.documentElement.scrollWidth>innerWidth,font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize}));assert.equal(metrics.overflow,false);assert.match(metrics.font,/Noto Sans KR/);assert.equal(metrics.size,'14px');await ui.screenshot({path:resolve(`verification/debug-plan-ui/plan-${width}.png`)});panel=await settings();await ui.screenshot({path:resolve(`verification/debug-plan-ui/settings-${width}.png`)});await ui.keyboard.press('Escape');}
  await ui.evaluate(async()=>{const {chat}=await chrome.storage.local.get('chat');const message=chat.messages[0];await chrome.storage.local.set({chat:{...chat,messages:[{...message,question:undefined,trace:message.trace.filter(step=>step.status==='done'),content:'요청 결과를 확인했습니다.',progress:{...message.progress,status:'done',plan:message.progress.plan.map(step=>({...step,status:'completed'}))}}]}});});
  await ui.reload();await ui.getByText('요청 결과를 확인했습니다.',{exact:true}).waitFor();
  assert.equal(await ui.locator('.agent-trace').count(),0);assert.equal(await ui.locator('.task-plan-count').innerText(),'2/2');checks.push('Completed tool histories are absent with debug off; final answer and completed plan remain');
  assert.deepEqual(errors,[]);checks.push('Narrow and wide real Chrome layouts retain Noto identity without page overflow');
  await writeFile('verification/debug-plan-ui/report.json',JSON.stringify({synthetic:true,checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){console.error('UI fixture failure', errors, await ui?.locator('body').innerText());throw error;}finally{await context?.close();await rm(profile,{recursive:true,force:true});}

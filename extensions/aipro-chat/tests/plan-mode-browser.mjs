import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload} from './fixtures/goal-review.mjs';
import {PLAN_MODE_GUIDANCE} from '../plan-mode.js';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-plan-mode-')),extension=resolve(profile,'extension');
const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html lang="ko"><title>업무 계획</title><h1>업무 계획</h1><label>내용<input id="draft"></label><button onclick="window.submits++">등록</button><script>window.writes=0;window.submits=0;addEventListener("input",()=>window.writes++)</script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/work`;
let context,ui,worker,failure,asked=false,read=false,verified=false,execution=false,executionRound=0,holdResolve,started=false;
const hold=new Promise(r=>holdResolve=r),errors=[],checks=[];
const reply=(name,args={},content='')=>({choices:[{message:{content,...(name?{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{})},finish_reason:name?'tool_calls':'stop'}]});
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function until(fn){for(let i=0;i<600;i++){if(failure)throw failure;if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('plan flow timed out');}
try {
 await mkdir('verification',{recursive:true});await cp(resolve('dist'),extension,{recursive:true});
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await appendFile(resolve(extension,'background.js'),'\nglobalThis.testPlanCall = message => serial(() => handle(message, RUNNER, RUNNER));\n');
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
  if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144,max_input_tokens:221184}]}});
  const body=route.request().postDataJSON(),plan=planCompletion(body);if(plan)return route.fulfill({json:plan});
  const review=goalReviewPayload(body.messages);if(review){const evidence=review.evidence.findLast(item=>item.tool==='verify_page'&&item.result.verified);assert(evidence);return route.fulfill({json:reply(null,{},JSON.stringify({status:'complete',checks:[{requirement:execution?'초안 입력':'현재 화면에 근거한 계획',status:'met',evidence_ids:[evidence.id]}],next_step:''}))});}
  const tools=body.tools.map(t=>t.function.name);
  const last=body.messages.findLast(m=>m.role==='tool'),result=last&&JSON.parse(last.content);
  if(!execution){
   assert(body.messages[0].content.includes(PLAN_MODE_GUIDANCE));
   for(const name of ['click_element','run_playwright','fill_form','navigate_page','request_approval','call_mcp_tool'])assert(!tools.includes(name),name);
   if(!started){started=true;await hold;}
   if(!read){read=true;return route.fulfill({json:reply('read_page')});}
   if(!asked){asked=true;assert(result.frames || result.observation);return route.fulfill({json:reply('ask_user',{question:'초안의 범위를 골라주세요.',choices:[{label:'제목과 요약',description:'핵심 내용을 먼저 정리합니다.'},{label:'상세 본문',description:'세부 내용을 포함합니다.'}]})});}
   if(!verified){verified=true;return route.fulfill({json:reply('verify_page',{checks:[{kind:'text_present',expected:'업무 계획'}]})});}
   return route.fulfill({json:reply(null,{},'**계획을 정리했습니다.**\n1. 제목과 요약을 준비합니다.\n2. 내용란에 초안을 입력하고 확인합니다.\n\n페이지에는 아직 입력하지 않았습니다.')});
  }
  assert(!body.messages[0].content.includes(PLAN_MODE_GUIDANCE));
  if(++executionRound===1){assert(body.messages.some(m=>m.content?.includes?.('계획을 정리했습니다.')));assert(body.messages[1].content.includes('fill_form'));return route.fulfill({json:reply('read_page')});}
  if(executionRound===2){const input=(result.observation||result).frames.flatMap(f=>f.elements||[]).find(e=>e.name==='내용');assert(input?.ref);return route.fulfill({json:reply('fill_form',{fields:[{field_id:input.ref,value:'검토한 초안'}]})});}
  if(executionRound===3){assert.equal(result.applied,1);const input=result.observation.frames.flatMap(f=>f.elements||[]).find(e=>e.name==='내용');return route.fulfill({json:reply('verify_page',{checks:[{kind:'field_value',ref:input.ref,expected:'검토한 초안'}]})});}
  return route.fulfill({json:reply(null,{},'초안을 입력하고 확인했습니다. 등록하지 않았습니다.')});
 }catch(error){failure=error;await route.fulfill({status:500,body:'fixture failed'}).catch(()=>{});}});
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',token:'synthetic-plan',receivedAt:1}}));
 const source=await context.newPage();await source.goto(url);ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 const tab=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
 await worker.evaluate(async({tab,url})=>{const page=(await chrome.tabs.query({})).find(t=>t.url===url);await chrome.storage.session.set({chatSourceTabs:{[tab]:page.id}});await chrome.storage.local.set({browserWorkMode:'current'});},{tab,url});
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('/pl');await ui.getByText('계획만 검토',{exact:true}).waitFor();
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('/plan 업무 기록 작성 절차를 확인해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(()=>started);
 // Exercise the worker boundary even if a future tool catalog mistakenly exposes a write.
 for(const name of ['click_element','run_playwright','call_mcp_tool','apply_approved_action','apply_approved_mcp','export_voc']){
   const result=await worker.evaluate(async name=>{const {chatLease}=await chrome.storage.session.get('chatLease');try{await globalThis.testPlanCall({type:'RUN_TOOL',requestId:chatLease.id,name,args:{}});return 'executed';}catch(error){return error.message;}},name);
   assert.equal(result,'plan_read_only',name);
 }
 const fill=await worker.evaluate(async()=>{const {chatLease}=await chrome.storage.session.get('chatLease');try{await globalThis.testPlanCall({type:'APPLY_FILL',requestId:chatLease.id,planId:'injected'});return 'executed';}catch(error){return error.message;}});assert.equal(fill,'plan_read_only');
 holdResolve();await until(async()=>!(await state()).busy && !!(await state()).chat.messages.at(-1)?.question);
 assert.equal((await state()).chat.task.planningOnly,true);await ui.reload();await ui.getByRole('button',{name:'제목과 요약',exact:false}).click();
 await until(async()=>!(await state()).busy && (await state()).chat.messages.at(-1)?.content.includes('계획을 정리했습니다.'));
 assert.equal((await state()).chat.task.planningOnly,true);assert(!(await state()).chat.messages.at(-1).wikiOffer);
 assert.equal(await source.locator('#draft').inputValue(),'');assert.equal(await source.evaluate(()=>window.writes+window.submits),0);checks.push('read-only planning, guarded execution paths and question resume across reload');
 await ui.getByText('계획을 정리했습니다.',{exact:true}).waitFor();
 await ui.setViewportSize({width:390,height:850});await ui.screenshot({path:'verification/plan-mode-390.png'});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 execution=true;
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('이제 계획대로 내용란에 초안을 입력해줘. 등록하지 마.');await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(async()=>!(await state()).busy && (await state()).chat.messages.at(-1)?.content.includes('초안을 입력하고'));
 assert.equal(await source.locator('#draft').inputValue(),'검토한 초안');assert.equal(await source.evaluate(()=>window.submits),0);assert.equal((await state()).chat.task.planningOnly,false);
 checks.push('separate normal request reuses plan and performs verified draft entry without submission');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',checks,evidence:{actualChrome:true,syntheticPortal:true,mockedModel:true}},null,2));
} catch(error) {console.error('UI ERRORS',errors);console.error(await ui?.locator('body').innerText().catch(()=>''));console.error(await Promise.race([state().catch(()=>null),new Promise(r=>setTimeout(()=>r('state unavailable'),1500))]));throw error;} finally {holdResolve();await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}

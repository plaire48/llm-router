import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,appendFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-input-')),extension=resolve(profile,'extension');
let context,ui,failure,held,scenario='steer',round=0,abortedRequests=0;const requests=[],errors=[];
const response=(text,tool,args={})=>({choices:[{message:{content:text,...(tool?{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{})},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}});
const server=createServer(async(req,res)=>{
 if(req.url!='/chat'){res.end('<html><button onclick="window.clicks=(window.clicks||0)+1">Test</button></html>');return;}
 try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),plan=planCompletion(body);res.on('close',()=>{if(!res.writableEnded)abortedRequests++;});
  const clock=JSON.parse(/<nubi_computer_time>\n([^\n]+)/.exec(body.messages[0].content)[1]);assert.equal(clock.source,'user_computer_clock');assert(Math.abs(Date.now()-Date.parse(clock.utc))<10000);assert.equal(body.messages.filter(m=>m.role==='system').length,1);
  const reply=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  if(plan)return reply(plan);
  if(body.messages[0]?.content.startsWith(COMPLETION_REVIEW_PROMPT))return reply(response(JSON.stringify({decision:'reply',scope:'conversation',next_step:''})));
  requests.push(body);round++;
  if(round===1){held=()=>{if(scenario==='error'){res.statusCode=400;res.end(JSON.stringify({error:{message:'Invalid model',code:'invalid_request'}}));return;}reply(scenario==='question'?response('','ask_user',{question:'어떤 형식으로 작성할까요?',input_mode:'text'}):scenario==='steer'?response('','browser_snapshot'):response('원래 답변'));};return;}
  reply(response(body.messages.some(m=>m.role==='user'&&m.content==='두 번째 작업')?'두 번째 결과':'수정 반영 결과'));
 }catch(e){failure=e;res.statusCode=500;res.end('fixture failed');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const rpc=(type,value={})=>ui.evaluate(async({type,value})=>chrome.runtime.sendMessage({type,...value}),{type,value});
const state=async()=>(await rpc('GET_STATE')).data;
async function until(check){for(let i=0;i<600;i++){if(failure)throw failure;if(await check())return;await new Promise(r=>setTimeout(r,40));}throw Error('Input fixture timed out');}
const input=()=>ui.getByRole('textbox',{name:'메시지',exact:true});
const send=async text=>{await input().fill(text);await ui.getByRole('button',{name:'전송',exact:true}).click();await until(()=>!!held);};
async function dragQueue(from,to) {
 const handles=ui.getByRole('button',{name:'대기 메시지 순서 변경',exact:true});
 const start=await handles.nth(from).boundingBox(),end=await handles.nth(to).boundingBox();
 await ui.mouse.move(start.x+start.width/2,start.y+start.height/2);await ui.mouse.down();
 await ui.mouse.move(start.x+start.width/2,start.y+start.height/2+8,{steps:3});
 await ui.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:10});await ui.mouse.up();
}
const checks=[];const pass=s=>{checks.push(s);console.log('PASS '+s);};
try{
 await cp(resolve(process.env.TEST_EXTENSION||'dist'),extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await appendFile(resolve(extension,'background.js'),`\nconst inputFetch=globalThis.fetch;globalThis.fetch=(url,options)=>inputFetch(String(url).includes('/chat/completions')?${JSON.stringify(origin+'/chat')}:url,options);\n`);
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});context.setDefaultTimeout(10000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('https://aipro.sdsdev.co.kr/api/models',r=>r.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}}));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(async()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:31}}));
 const target=await context.newPage();await target.goto(origin);ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 await until(async()=>(await state()).catalog?.models?.length===1);
 await send('안녕하세요');let data=await state();const firstId=data.chat.messages.at(-1).id;
 const invalid=await rpc('AGENT_INPUT',{id:'wrong-conversation',mode:'steer',text:'잘못된 세션',requestId:firstId,conversationId:'other'});assert.equal(invalid.ok,false);
 await input().fill('더 짧게 설명해줘');await input().press('Enter');await until(async()=>(await state()).chat.inbox?.length===1);
 await input().fill('두 번째 작업');await input().press('Enter');await until(async()=>(await state()).chat.inbox?.length===2);
 assert.equal(requests.length,1,'queued work cannot overlap current inference');
 const originalOrder=(await state()).chat.inbox.map(item=>item.id);
 await dragQueue(1,0);await until(async()=>(await state()).chat.inbox[0].id===originalOrder[1]);
 await ui.reload();await until(async()=>await ui.getByRole('button',{name:'대기 메시지 순서 변경',exact:true}).count()===2);
 assert.deepEqual((await state()).chat.inbox.map(item=>item.id),[originalOrder[1],originalOrder[0]]);
 assert.equal((await rpc('REORDER_AGENT_INPUT',{id:originalOrder[0],overId:originalOrder[1],order:originalOrder,conversationId:(await state()).chat.sessionId})).ok,false);
 const firstHandle=ui.getByRole('button',{name:'대기 메시지 순서 변경',exact:true}).first();await until(async()=>await firstHandle.isEnabled() && await ui.locator('[data-dragging]').count()===0);await firstHandle.focus();await ui.keyboard.press('Space');await until(async()=>await ui.locator('[data-dragging]').count()===1);await ui.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await ui.keyboard.press('ArrowDown');await until(async()=>await ui.locator('[data-dragging]').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m42>10));await ui.keyboard.press('Space');
 await until(async()=>(await state()).chat.inbox[0].id===originalOrder[0]);
 await until(async()=>await firstHandle.isEnabled() && await ui.locator('[data-dragging]').count()===0);await firstHandle.focus();await ui.keyboard.press('Space');await until(async()=>await ui.locator('[data-dragging]').count()===1);await ui.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await ui.keyboard.press('ArrowDown');await ui.keyboard.press('Escape');
 assert.deepEqual((await state()).chat.inbox.map(item=>item.id),originalOrder);
 pass('pointer reorder persists on reload; keyboard reorder and Escape work; stale drops cannot move a different message');

 // Freeze a durable, admitted steering item before promotion to cover the
 // visible queue projection. Actual arrow promotion is exercised below.
 await worker.evaluate(async()=>{const {chat}=await chrome.storage.local.get('chat');chat.inbox.splice(1,0,{...chat.inbox[0],id:'held-steering',mode:'steer',text:'아직 반영되지 않은 추가 지시'});await chrome.storage.local.set({chat});});
 await until(async()=>await ui.locator('article[data-input-id="held-steering"]').count()===1);
 assert.equal(await ui.getByRole('button',{name:'대기 메시지 순서 변경',exact:true}).count(),2);
 await dragQueue(1,0);await until(async()=>(await state()).chat.inbox[0].id===originalOrder[1]);
 assert.deepEqual((await state()).chat.inbox.map(item=>item.id),[originalOrder[1],'held-steering',originalOrder[0]]);
 await ui.reload();await until(async()=>await ui.getByRole('button',{name:'대기 메시지 순서 변경',exact:true}).count()===2);
 const mixedHandle=ui.getByRole('button',{name:'대기 메시지 순서 변경',exact:true}).first();
 await mixedHandle.focus();await ui.keyboard.press('Space');await until(async()=>await ui.locator('[data-dragging]').count()===1);
 await ui.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await ui.keyboard.press('ArrowDown');await until(async()=>await ui.locator('[data-dragging]').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m42>10));
 await ui.getByText('2번째 위치',{exact:true}).waitFor({state:'attached'});
 await ui.keyboard.press('Space');await until(async()=>(await state()).chat.inbox[0].id===originalOrder[0]);
 assert.deepEqual((await state()).chat.inbox.map(item=>item.id),[originalOrder[0],'held-steering',originalOrder[1]]);
 assert.equal(requests.length,1,'Reordering does not promote steering or invoke another model');
 await mkdir('verification/agent-input',{recursive:true});
 await ui.setViewportSize({width:360,height:850});await ui.screenshot({path:'verification/agent-input/mixed-queue-360.png'});
 assert((await rpc('REMOVE_AGENT_INPUT',{id:'held-steering',conversationId:(await state()).chat.sessionId})).ok);
 pass('visible queue reorders by pointer and keyboard across an admitted steering item; its slot and run remain unchanged, reload preserves order, and announcements use visible positions');

 await ui.reload();await until(async()=>await ui.getByRole('list',{name:'대기 메시지'}).count()>0);
 assert.equal((await state()).chat.inbox.length,2);pass('steer and follow-up persist on reload; another conversation cannot inject messages');
 const typography=await ui.locator('.agent-input-queue').evaluate(el=>{const s=getComputedStyle(el);return{font:s.fontFamily,size:s.fontSize,line:s.lineHeight};});assert(typography.font.includes('Noto Sans KR'));assert.equal(typography.size,'14px');assert.equal(typography.line,'22px');
 await input().fill('작성 중인 추가 지시');await mkdir('verification/agent-input',{recursive:true});
 for(const width of [360,1100]){await ui.setViewportSize({width,height:850});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ui.screenshot({path:`verification/agent-input/queue-${width}.png`});}
 await input().fill('');await ui.getByRole('button',{name:'지금 반영',exact:true}).first().click();
 await until(async()=>{const d=await state();return !d.busy&&d.chat.messages.filter(m=>m.role==='assistant').length===2;});
 data=await state();assert(data.chat.messages.filter(m=>m.role==='assistant').every(m=>m.state==='done'),JSON.stringify(data.chat.messages));assert.equal(data.chat.inbox.length,0);
 assert.equal(data.chat.messages.filter(m=>m.role==='user'&&m.content==='더 짧게 설명해줘').length,1);
 assert(requests[1].messages.some(m=>m.role==='user'&&m.content==='더 짧게 설명해줘'));
 assert(abortedRequests>0,'steering cancels only the held model request');assert(round>=3,'replacement and queued task complete before the old response is released');held();held=null;
 assert(data.chat.messages.find(m=>m.id===firstId).inputGoal.includes('안녕하세요'));assert(data.chat.messages.find(m=>m.id===firstId).inputGoal.includes('더 짧게 설명해줘'));
 assert.equal(data.chat.messages.filter(m=>m.role==='assistant')[0].id,firstId);
 assert(requests.at(-1).messages.some(m=>m.role==='user'&&m.content==='두 번째 작업'));
 pass('queue promotion interrupts model generation immediately; Pi receives steering; next task runs once after completion');
 // Stop never means run queued work. Editing takes a message back into the composer.
 await rpc('NEW_CHAT');await ui.reload();scenario='cancel';round=0;held=null;await send('중지 시험');
 await input().fill('보류할 작업');await input().press('Enter');await until(async()=>(await state()).chat.inbox?.length===1);
 await ui.getByRole('button',{name:'중지',exact:true}).click();await until(async()=>!(await state()).busy);held();held=null;
 await ui.reload();assert.equal((await state()).chat.inbox.length,1);assert.equal(round,1);
 // An unrelated manually-started task must not unpause the old queue.
 round=0;held=null;await send('새로운 별도 질문');await input().fill('새 작업의 후속 질문');await input().press('Enter');await until(async()=>(await state()).chat.inbox.length===2);held();held=null;await until(async()=>!(await state()).busy);assert.equal(round,2);assert.equal((await state()).chat.inbox.length,1);assert.equal((await state()).chat.inbox[0].text,'보류할 작업');
 await until(async()=>await ui.getByRole('button',{name:'대기 메시지 수정',exact:true}).count()===1);await ui.getByRole('button',{name:'대기 메시지 수정',exact:true}).click();await until(async()=>await input().inputValue()==='보류할 작업');assert.equal((await state()).chat.inbox.length,0);
 pass('stop and re-entry preserve queued work without execution; editing restores the draft');
 await rpc('NEW_CHAT');await ui.reload();scenario='question';round=0;held=null;await send('질문 시험');
 await input().fill('승인 대신 실행하면 안 됨');await input().press('Enter');await until(async()=>(await state()).chat.inbox?.length===1);held();held=null;
 await until(async()=>!(await state()).busy);data=await state();assert(data.chat.messages.at(-1).question,JSON.stringify(data.chat.messages.at(-1)));assert.equal(data.chat.inbox.length,1);assert.equal(round,1);
 assert.equal((await rpc('START_AGENT',{queuedInputId:data.chat.inbox[0].id,conversationId:data.chat.sessionId})).ok,false);
 await input().fill('표로 작성해주세요');await ui.getByRole('button',{name:'전송',exact:true}).click();await until(async()=>!(await state()).busy&&(await state()).chat.inbox.length===0);assert.equal(round,3);
 pass('question boundary cannot be bypassed; an explicit answer resumes the same queue after task completion');
 await rpc('NEW_CHAT');await ui.reload();scenario='error';round=0;held=null;await send('오류 시험');
 await input().fill('오류 뒤 보류');await input().press('Enter');await until(async()=>(await state()).chat.inbox?.length===1);held();held=null;
 await until(async()=>!(await state()).busy);data=await state();assert.equal(data.chat.messages.at(-1).state,'error');assert.equal(data.chat.inbox.length,1);assert.equal(round,1);
 await ui.getByRole('button',{name:'대기 메시지 삭제',exact:true}).click();await until(async()=>(await state()).chat.inbox.length===0);
 pass('provider rejection preserves queued work without automatically starting it; pending messages can be deleted');
 await rpc('NEW_CHAT');await ui.reload();scenario='fifo';round=0;held=null;await send('순서 시험');
 // Model a slow UI acknowledgement after the queue is already persisted.
 await ui.evaluate(()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async(...args)=>{const result=await send(...args);if(args[0]?.type==='DRAFT')await new Promise(resolve=>setTimeout(resolve,350));return result;};});
 let delayedQueueReadiness=0;
 for(const text of ['나중에 할 작업','먼저 할 작업','세 번째 작업','네 번째 작업','다섯 번째 작업']){
  await input().fill(text);
  const add=ui.getByRole('button',{name:'대기열에 추가',exact:true});
  await until(async()=>await add.count()===1);
  if(!await add.isEnabled())delayedQueueReadiness++;
  // Persisted inbox state can arrive before submitRunningInput finishes its
  // DRAFT/readback. Keyboard press does not auto-wait for button readiness.
  await until(async()=>await add.isEnabled());
  await input().press('Enter');await until(async()=>(await state()).chat.inbox?.some(item=>item.text===text));
 }
 assert(delayedQueueReadiness>0,'Exercise delayed UI acknowledgement, not only backend persistence');
 await until(async()=>await ui.getByRole('button',{name:'대기 메시지 순서 변경',exact:true}).first().isEnabled());
 await dragQueue(1,0);await until(async()=>(await state()).chat.inbox[0].text==='먼저 할 작업');
 await ui.setViewportSize({width:360,height:850});
 const queue=ui.getByRole('list',{name:'대기 메시지'});
 const beforeScroll=await queue.evaluate(el=>{const s=getComputedStyle(el),rows=[...el.children];return {height:el.clientHeight,content:el.scrollHeight,three:rows.slice(0,3).reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)+2*parseFloat(s.rowGap)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom),page:document.documentElement.scrollHeight};});
 assert(Math.abs(beforeScroll.height-beforeScroll.three)<=1);assert(beforeScroll.content>beforeScroll.height);
 await queue.hover();await ui.mouse.wheel(0,500);await until(async()=>await queue.evaluate(el=>el.scrollTop>0));
 assert.equal(await queue.evaluate(el=>el.clientHeight),beforeScroll.height);assert.equal(await ui.evaluate(()=>document.documentElement.scrollHeight),beforeScroll.page);
 await ui.screenshot({path:'verification/agent-input/queue-scroll-360.png'});
 held();held=null;
 await until(async()=>!(await state()).busy&&(await state()).chat.inbox.length===0);
 assert.deepEqual((await state()).chat.messages.filter(m=>m.role==='user').map(m=>m.content),['순서 시험','먼저 할 작업','나중에 할 작업','세 번째 작업','네 번째 작업','다섯 번째 작업']);assert.equal(round,6);
 pass('queue height is limited to three rows with independent scrolling; natural completion drains all reordered items exactly once');
 assert.deepEqual(errors,[]);await writeFile('verification/agent-input/browser.json',JSON.stringify({checks,actualChrome:true,actualModel:false},null,2));
}catch(error){console.error(error);if(ui){await ui.screenshot({path:'verification/agent-input/failure.png'}).catch(()=>{});console.error(await ui.locator('.agent-input-queue').innerText().catch(()=>''));console.error(errors);}throw error;}finally{held?.();await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}

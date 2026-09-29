import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,appendFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload,reviewCompletion} from './fixtures/goal-review.mjs';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-steering-view-')),extension=resolve(profile,'extension');
let context,ui,releaseNavigation,releaseModel,failure,round=0,navigations=0;const requests=[],errors=[],checks=[];
const text='제목만 간단히 알려줘';
const response=(content,tool,args={})=>({choices:[{message:{content,...(tool?{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{})},finish_reason:tool?'tool_calls':'stop'}]});
const server=createServer(async(req,res)=>{
 if(req.url==='/slow'){navigations++;releaseNavigation=()=>res.end('<title>검증 페이지</title><h1>검증 페이지</h1>');return;}
 if(req.url!='/chat'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<title>원본 페이지</title><h1>원본 페이지</h1>');return;}
 try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  const reply=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  const plan=planCompletion(body);if(plan)return reply(plan);
  const review=goalReviewPayload(body.messages);if(review)return reply(reviewCompletion(review));
  if(body.messages[0]?.content.startsWith(COMPLETION_REVIEW_PROMPT))return reply(response(JSON.stringify({decision:'reply',scope:'conversation',next_step:''})));
  requests.push(body);round++;
  if(round===1)return reply(response('현재 페이지를 확인하겠습니다.','browser_snapshot'));
  if(round===2){releaseNavigation=()=>reply(response('원래 응답'));return;}
  if(round===3){releaseModel=()=>reply(response('검증 페이지입니다.'));return;}
  reply(response('검증 페이지입니다.'));
 }catch(error){failure=error;res.statusCode=500;res.end('fixture failed');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
const rpc=(type,value={})=>ui.evaluate(async({type,value})=>chrome.runtime.sendMessage({type,...value}),{type,value});
const state=async()=>(await rpc('GET_STATE')).data;
async function until(fn){for(let i=0;i<750;i++){if(failure)throw failure;if(await fn())return;await new Promise(done=>setTimeout(done,40));}throw Error('Steering transcript fixture timed out');}
const pass=label=>{checks.push(label);console.log('PASS '+label);};
try{
 await mkdir('verification/steering-transcript',{recursive:true});
 await cp(resolve('dist'),extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json')));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await appendFile(resolve(extension,'background.js'),`\nconst transcriptFetch=globalThis.fetch;globalThis.fetch=(url,options)=>transcriptFetch(String(url).includes('/chat/completions')?${JSON.stringify(origin+'/chat')}:url,options);\n`);
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});context.setDefaultTimeout(10000);
 context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
 await context.route('https://aipro.sdsdev.co.kr/api/models',r=>r.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}}));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:37}}));
 const target=await context.newPage();await target.goto(origin);ui=await context.newPage();await ui.setViewportSize({width:1100,height:850});await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 await until(async()=>(await state()).catalog?.models?.length===1);
 const uiTab=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);await worker.evaluate(async({uiTab,origin})=>{const target=(await chrome.tabs.query({})).find(t=>t.url===origin+'/');await chrome.storage.session.set({chatSourceTabs:{[uiTab]:target.id}});},{uiTab,origin});
 const input=()=>ui.getByRole('textbox',{name:'메시지',exact:true});
 await input().fill('지정한 검증 페이지를 열어 제목을 확인해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();await until(()=>!!releaseNavigation);
 const run=(await state()).chat.messages.at(-1).id;
 // Seed the durable admission boundary independently of the worker wake.
 // Actual arrow delivery is exercised below against a held provider request.
 async function seedAdmission(value){await worker.evaluate(async ({run,value})=>{const {chat}=await chrome.storage.local.get('chat');chat.inbox=[{id:crypto.randomUUID(),text:value,mode:'steer',conversationId:chat.sessionId,provider:chat.provider,credentialReceivedAt:37,runId:run,createdAt:Date.now()}];await chrome.storage.local.set({chat});},{run,value});await until(async()=>await ui.locator('article.message-user[data-state="admitted"] .user-text').textContent()===value);}
 
 await seedAdmission('수정할 추가 지시');
 assert.equal(await ui.getByRole('list',{name:'대기 메시지',exact:true}).count(),0);
 assert.equal((await state()).chat.messages.filter(m=>m.content==='수정할 추가 지시').length,0,'Admission is not model-history promotion');
 await ui.getByRole('button',{name:'대기 메시지 수정',exact:true}).click();await until(async()=>await input().inputValue()==='수정할 추가 지시');
 await until(async()=>await ui.locator('article.message-user[data-state="admitted"]').count()===0);
 await input().fill('');await seedAdmission('삭제할 추가 지시');await ui.getByRole('button',{name:'대기 메시지 삭제',exact:true}).click();await until(async()=>!(await state()).chat.inbox.length);
 await seedAdmission(text);let data=await state();const inputId=data.chat.inbox[0].id;
 assert.equal(data.chat.messages.filter(m=>m.inputId===inputId).length,0);assert.equal(navigations,0);assert.equal(round,2);
 await ui.reload();await until(async()=>await ui.locator(`[data-input-id="${inputId}"]`).count()===1);
 const region=ui.getByRole('region',{name:'작업 진행 상황',exact:true});await region.waitFor();
 assert.equal(await region.locator('article.message-user').count(),0);
 assert.equal(await ui.locator('article.message-assistant .task-plan, article.message-assistant .agent-trace').count(),0);
 assert.equal(await ui.locator(`[data-input-id="${inputId}"]`).getByText('반영 대기',{exact:true}).count(),1);
 pass('a durable pending admission renders once in chat, outside the composer and progress region; edit, delete and reload retain the boundary');
 for(const width of [360,1100]){await ui.setViewportSize({width,height:850});await ui.emulateMedia({reducedMotion:'reduce'});await ui.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ui.screenshot({path:`verification/steering-transcript/pending-${width}.png`,animations:'disabled'});}
 // Retrigger the actual existing arrow endpoint for this admitted ID.
 const steering=await rpc('STEER_AGENT_INPUT',{id:inputId,requestId:run,conversationId:data.chat.sessionId});assert(steering.ok);await until(()=>!!releaseModel);
 await until(async()=>{const d=await state();return d.chat.messages.some(m=>m.inputId===inputId)&&!d.chat.inbox.length;});
 assert.equal(await ui.locator(`[data-input-id="${inputId}"]`).count(),1);
 await until(async()=>await ui.locator(`[data-input-id="${inputId}"]`).getByText('반영 대기',{exact:true}).count()===0);
 assert(requests[2].messages.some(m=>m.role==='user'&&m.content===text));
 assert(!requests[2].messages.some(m=>m.content==='수정할 추가 지시'||m.content==='삭제할 추가 지시'));
 assert.equal((await state()).chat.messages.at(-1).id,run);assert.equal(navigations,0);
 pass('the real steering endpoint consumes the same input once; deleted inputs never reach the model and the original run is preserved');
 releaseModel();releaseModel=null;await until(async()=>!(await state()).busy);
 data=await state();assert.equal(data.chat.messages.at(-1).state,'done',JSON.stringify(data.chat.messages.at(-1)));
 assert.equal(data.chat.messages.filter(m=>m.inputId===inputId).length,1);
 await ui.reload();await until(async()=>await ui.getByText('검증 페이지입니다.',{exact:true}).count()===1);
 assert.equal(await ui.locator(`[data-input-id="${inputId}"]`).count(),1);assert.equal(await region.count(),1);
 assert.equal(await ui.locator('article.message-assistant .task-plan, article.message-assistant .agent-trace').count(),0);
 await ui.screenshot({path:'verification/steering-transcript/completed-1100.png',animations:'disabled'});
 assert.equal(await target.title(),'원본 페이지');assert.equal(navigations,0);assert.deepEqual(errors,[]);
 pass('final reply and progress remain separate after reload with one user bubble, one original run, and untouched source tab');
 await writeFile('verification/steering-transcript/browser.json',JSON.stringify({checks,actualChrome:true,actualModel:false,syntheticSite:true,errors},null,2));
}catch(error){if(ui){await ui.screenshot({path:'verification/steering-transcript/failure.png'}).catch(()=>{});console.error(JSON.stringify(await state()));}throw error;}
finally{releaseNavigation?.();releaseModel?.();await context?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});}

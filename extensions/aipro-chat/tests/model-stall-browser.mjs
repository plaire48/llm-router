import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-model-stall-')), extension=resolve(profile,'extension');
let context,ui,target,failure,stage=0,attempts=0,mode='recover',imageHash;
const checks=[], streams=new Set(),modeRequests={recover:0,exhaust:0,cancel:0};
const call=(name,args={})=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const reply=(calls,content='')=>({choices:[{message:{content,...(calls?{tool_calls:calls}:{})},finish_reason:calls?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}});
const control=result=>result.frames.flatMap(f=>f.elements||[]).find(e=>e.name==='내용 펼치기');
const server=createServer(async(req,res)=>{
  if(req.url!='/chat'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<html lang="ko"><meta charset="utf-8"><style>body{height:1900px}</style><h1>복구 검사</h1><button type="button" onclick="window.clicks++;document.querySelector(\'p\').textContent=\'내용 펼쳐짐\'">내용 펼치기</button><p>접힘</p><script>window.clicks=0</script></html>');return;}
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const keepalive=()=>{const timer=setInterval(()=>res.write(': keepalive\n\n'),50);streams.add(timer);res.on('close',()=>{clearInterval(timer);streams.delete(timer);});};
  try{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw),plan=planCompletion(body),review=goalReviewPayload(body.messages);
    if(plan)return json(plan);if(review)return json(reviewCompletion(review));
    modeRequests[mode]++;
    if(mode!=='recover'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();keepalive();return;}
    const last=body.messages.findLast(m=>m.role==='tool'),value=last&&JSON.parse(last.content);
    if(stage===0){stage++;return json(reply([call('browser_snapshot')]));}
    if(stage===1){stage++;return json(reply([call('click_element',{ref:control(value).ref})]));}
    if(stage===2){stage++;return json(reply([call('capture_page')]));}
    if(stage===3){
      assert.equal(await target.evaluate(()=>clicks),1);
      assert.equal(value.capture_mode,'page');
      const images=body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='image_url'):[]);
      assert.equal(images.length,1);const digest=createHash('sha256').update(images[0].image_url.url).digest('hex');
      if(imageHash)assert.equal(digest,imageHash,'retry uses the captured evidence without recapturing');else imageHash=digest;
      attempts++;
      res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();
      if(attempts===1){keepalive();return;}
      assert.equal(attempts,2);stage++;
      const next=call('verify_page',{checks:[{kind:'text_present',expected:'내용 펼쳐짐'}]});
      res.write('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,...next}]},finish_reason:'tool_calls'}]})+'\n\n');
      res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}})+'\n\n');
      keepalive();return; // Intentional missing DONE/EOF after a valid terminal result.
    }
    assert.equal(stage++,4);assert.equal(value.verified,true);json(reply(null,'내용을 펼치고 확인했습니다.'));
  }catch(error){failure=error;res.statusCode=500;res.end('fixture assertion failed');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function until(predicate,timeout=35000){const end=Date.now()+timeout;while(Date.now()<end){if(failure)throw failure;if(await predicate())return;await new Promise(done=>setTimeout(done,40));}assert.fail('Stall fixture timed out');}
const check=text=>{checks.push(text);console.log('PASS '+text);};
const send=async text=>{await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(text);await ui.getByRole('button',{name:'전송',exact:true}).click();};
try{
  await cp(resolve(process.env.TEST_EXTENSION||'dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  // Shorten only the three documented deadlines in this isolated test copy.
  // Production defaults remain 120s idle / 300s attempt / 15s visible waiting.
  const runtimePath=resolve(extension,'background-runner.js'),runtime=await readFile(runtimePath,'utf8');
  const policy=/idleMs:12e4,attemptMs:3e5,slowMs:15e3/g;assert.equal([...runtime.matchAll(policy)].length,1);
  await writeFile(runtimePath,runtime.replace(policy,'idleMs:1500,attemptMs:5000,slowMs:200'));
  await appendFile(resolve(extension,'background.js'),`\nconst stallFetch=globalThis.fetch;globalThis.fetch=(url,options)=>stallFetch(String(url).includes('/chat/completions')?${JSON.stringify(origin+'/chat')}:url,options);\n`);
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(8000);
  await context.route('https://aipro.sdsdev.co.kr/api/models',route=>route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await chrome.storage.local.set({browserWorkMode:'current'});await chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:31}});});
  target=await context.newPage();await target.goto(origin);ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await until(async()=>(await state()).catalog?.models?.length===1);
  const uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async({uiId,origin})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===origin+'/');await chrome.storage.session.set({chatSourceTabs:{[uiId]:tab.id}});},{uiId,origin});
  await send('내용을 펼치고 전체 화면을 캡처한 후 결과를 확인해줘.');
  await until(async()=>{const d=await state(); if(d.chat?.messages?.at(-1)?.error)throw Error(d.chat.messages.at(-1).error); return await ui.locator('[data-tool="wait_model"][data-status="running"]').count()>0;});
  assert.equal(await ui.locator('.agent-next-step').count(),0);
  await mkdir('verification/model-stall',{recursive:true});
  for(const width of [360,1100]){await ui.setViewportSize({width,height:850});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ui.screenshot({path:`verification/model-stall/waiting-${width}.png`});}
  check('after capture, keepalives produce a real model-wait state instead of an unchanged next-step spinner');
  await until(async()=>['done','error'].includes((await state()).chat.messages.at(-1)?.state));
  let data=await state(),answer=data.chat.messages.at(-1);assert.equal(answer.state,'done',JSON.stringify(answer));
  assert.equal(attempts,2);assert.equal(await target.evaluate(()=>clicks),1);
  assert.equal(answer.captures.length,1);assert(answer.trace.some(t=>t.tool==='recover_model'&&t.status==='done'));
  assert(answer.trace.some(t=>t.tool==='wait_model'&&t.status==='done'));assert.equal(await ui.locator('.agent-next-step').count(),0);
  await ui.reload();assert.equal((await state()).chat.messages.at(-1).state,'done');
  check('idle inference retries with the same full-page image; completed click/capture run once; missing DONE drains and proceeds; result survives reload');
  mode='exhaust';await send('현재 화면의 상태만 확인해줘.');
  await until(async()=>(await state()).chat.messages.at(-1)?.state==='error');
  answer=(await state()).chat.messages.at(-1);assert.equal(answer.error,'model_timeout');assert.equal(modeRequests.exhaust,4);assert(!answer.trace.some(t=>t.status==='running'));
  assert.equal(await target.evaluate(()=>clicks),1);assert.equal(await ui.locator('.agent-next-step').count(),0);
  check('four stalled attempts terminate as a visible recoverable error, preserving prior work instead of spinning forever');
  mode='cancel';await send('페이지 상태를 읽어줘.');await until(()=>modeRequests.cancel===1);
  await ui.getByRole('button',{name:'중지',exact:true}).click();await until(async()=>(await state()).chat.messages.at(-1)?.error==='cancelled');
  await new Promise(done=>setTimeout(done,1800));assert.equal(modeRequests.cancel,1);assert.equal(await target.evaluate(()=>clicks),1);
  check('user stop aborts a stalled stream without a retry or browser action');
  await writeFile('verification/model-stall/browser.json',JSON.stringify({checks,actualBrowser:true,syntheticModel:true,shortenedDeadlines:true,modeRequests},null,2));
}catch(error){await mkdir('verification/model-stall',{recursive:true});await ui?.screenshot({path:'verification/model-stall/fixture-failure.png'}).catch(()=>{});const data=await state().catch(()=>null);console.error(JSON.stringify({busy:data?.busy,stage,modeRequests,attempts,state:data?.chat?.messages?.at(-1)?.state,error:data?.chat?.messages?.at(-1)?.error,trace:data?.chat?.messages?.at(-1)?.trace}));throw error;}finally{for(const timer of streams)clearInterval(timer);await context?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});}

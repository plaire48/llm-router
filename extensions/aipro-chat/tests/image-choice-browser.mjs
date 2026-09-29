import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, rm, writeFile, readFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-image-choice-')), extension = resolve(profile, 'extension');
let context, worker, ui, failure, mode = 'choices', round = 0, requests = 0, candidates;
const checks = [], errors = [], check = text => {checks.push(text); console.log(`PASS ${text}`);};
const token = `header.${Buffer.from(JSON.stringify({exp: Date.now()/1000+3600})).toString('base64url')}.signature`;
const bag = '<path d="M5 8h14l2 14H3Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2"/>';
const server = createServer((req,res) => {
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy': "img-src 'self'; script-src 'none'; style-src 'unsafe-inline'"});
  res.end(`<!doctype html><html lang="ko"><meta charset="UTF-8"><title>아이콘 스튜디오</title><style>body{font:16px system-ui;padding:40px;background:#f1f7fe}nav{display:flex;gap:30px}button{padding:20px;background:white;border:0;border-radius:16px;color:#189bb0}svg{width:48px;height:48px;fill:currentColor}.second{color:#7b61e6}</style><h1>아이콘 스튜디오</h1><nav>
    <button aria-label="쇼핑"><svg id="first" aria-hidden="true" viewBox="0 0 24 24" onload="window.svgRan=true">${bag}<script>window.evil=1</script><foreignObject><div>untrusted</div></foreignObject></svg></button>
    <button aria-label="보관함" class="second"><svg id="second" aria-hidden="true" viewBox="0 0 24 24">${bag}</svg></button>
    <button aria-label="알림"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 18h16l-2-4V8a6 6 0 0 0-12 0v6Z"/><circle cx="12" cy="21" r="2"/></svg></button>
    <svg width="0" height="0" style="position:absolute;width:0;height:0"><defs><symbol id="bag-symbol" viewBox="0 0 24 24">${bag}</symbol></defs></svg>
    <button aria-label="스프라이트"><svg id="sprite" viewBox="0 0 24 24"><use href="#bag-symbol"/></svg></button>
    </nav></html>`);
});
await new Promise(r => server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
const rpc=(type,args={})=>ui.evaluate(async({type,args})=>chrome.runtime.sendMessage({type,...args}),{type,args});
const state=async()=> (await rpc('GET_STATE')).data;
const poll=async(fn,expected)=>{for(let i=0;i<400;i++){if(failure)throw failure;if(await fn()===expected)return;await new Promise(r=>setTimeout(r,50));}const snapshot=await state();console.log(JSON.stringify({mode,round,error:snapshot.chat.messages.at(-1)?.error,trace:snapshot.chat.messages.at(-1)?.trace}));assert.equal(await fn(),expected);};
const response=(name,args,text='선택한 이미지에서 다운로드 아이콘을 누르세요.')=>`data: ${JSON.stringify({choices:[{delta:name?{tool_calls:[{index:0,id:`q-${requests}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:text},finish_reason:name?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`;
try {
  await mkdir('verification',{recursive:true}); await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:true,acceptDownloads:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
    if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}});
    const body=route.request().postDataJSON(),review=goalReviewPayload(body.messages);
    if(body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT)){assert(['answer','written'].includes(mode));return route.fulfill({json:{choices:[{message:{content:JSON.stringify({decision:'reply',scope:'conversation',next_step:''})},finish_reason:'stop'}]}});}
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    // Question transport is the subject of this fixture. Keep the independent
    // review protocol intact; review-quality failures have their own suite.
    if(review)return route.fulfill({json:reviewCompletion(review)});
    requests++;const last=body.messages.findLast(m=>m.role==='tool'),result=last?JSON.parse(last.content):null,current=round++;
    let output;
    if(mode==='choices') {
      if(current===0)output=response('select_tools',{groups:['images']});
      else if(current===1)output=response('find_images',{query:'가방 모양 아이콘'});
      else if(current===2){assert(result.images.length>=4);assert(result.images.every(i=>!i.text_match));candidates=['쇼핑','보관함','알림'].map(label=>result.images.find(i=>i.label===label));assert(candidates.every(i=>i.kind==='svg'));output=response('inspect_images',{refs:candidates.map(i=>i.ref)});}
      else if(current===3){assert(body.messages.at(-1).content.some(p=>p.type==='image_url'));assert(result.candidates.every(c=>!c.error),JSON.stringify(result));output=response('ask_user',{question:'어느 가방 아이콘인가요?',image_refs:candidates.slice(0,2).map(i=>i.ref)});}
      else throw new Error('Model must stop while waiting for an answer');
    } else if(mode==='answer') {
      assert(body.messages.some(m=>typeof m.content==='string'&&m.content.includes('2번 이미지 (보관함)')));
      assert(body.messages.some(m=>typeof m.content==='string'&&m.content.includes('어느 가방 아이콘인가요?'))); output=response();
    } else if(mode==='text') {
      if(current===0)output=response('ask_user',{question:'아이콘이 페이지 어디에 있나요?'});else throw new Error('Free-text question must pause');
    } else if(mode==='written') {assert(body.messages.some(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('오른쪽 위')));output=response(null,null,'오른쪽 위를 기준으로 확인하겠습니다.');}
    else throw new Error('Unknown fixture');
    return route.fulfill({contentType:'text/event-stream',body:output});
  }catch(error){failure=error;return route.fulfill({status:500,body:'fixture failed'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:12}}),token);
  const tab=await context.newPage();await tab.goto(origin);
  ui=await context.newPage();ui.on('pageerror',error=>errors.push(error.message));await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async()=>!!(await state()).catalog?.models?.length,true);
  const chatTab=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id),sourceTab=await worker.evaluate(async url=>(await chrome.tabs.query({url:url+'/*'}))[0].id,origin);
  await worker.evaluate(({sourceTab,chatTab})=>chrome.storage.session.set({chatSourceTabs:{[chatTab]:sourceTab}}),{sourceTab,chatTab});
  await ui.setViewportSize({width:360,height:800});await ui.bringToFront();
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('가방 모양 아이콘을 다운로드하고 싶어');await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  let chat=(await state()).chat,reply=chat.messages.at(-1);assert(reply.question);assert.equal(reply.content,'');assert.equal(reply.captures.length,2);assert.equal(chat.task.status,'awaiting_user');assert.equal(requests,4);
  check('natural-language request discovers aria-hidden inline icons, compares actual numbered thumbnails despite restrictive website CSP, and pauses on two real choices');
  for(const [width,height] of [[360,800],[1100,850]]) {
    await ui.setViewportSize({width,height});await ui.locator('.image-question').scrollIntoViewIfNeeded();
    for(const img of await ui.locator('.capture-preview img').all())await img.evaluate(img=>img.decode());
    assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await ui.getByRole('button',{name:/이미지 다운로드/}).count(),2);
    await ui.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
    await ui.screenshot({path:`verification/image-choices-${width}x${height}.png`});
  }
  const pending=ui.waitForEvent('download');await ui.getByRole('button',{name:'이미지 다운로드',exact:true}).first().click();const download=await pending,svg=await readFile(await download.path(),'utf8');
  assert.match(download.suggestedFilename(),/\.svg$/);assert.match(svg,/M5 8h14/);assert.match(svg,/rgb\(24, 155, 176\)/);assert(!/onload|<script|foreignObject/.test(svg));
  check('choices render responsively and download a passive SVG retaining the actual icon geometry and CSS color');
  await ui.reload();await poll(()=>ui.getByRole('button',{name:'2. 보관함 선택',exact:true}).count(),1);assert.equal(requests,4);
  await ui.getByRole('textbox',{name:'직접 답변',exact:true}).click();assert(await ui.getByRole('textbox',{name:'직접 답변',exact:true}).evaluate(el=>el===document.activeElement));
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('보관할 초안');await poll(async()=>(await state()).chat.draft,'보관할 초안');
  mode='answer';round=0;await ui.getByRole('button',{name:'2. 보관함 선택',exact:true}).focus();await ui.keyboard.press('Enter');
  await poll(async()=>(await state()).chat.messages.at(-1)?.id !== reply.id,true);
  await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  chat=(await state()).chat;assert.equal(chat.messages.find(m=>m.question)?.question.answer.optionId,reply.question.options[1].id);assert.equal(chat.draft,'보관할 초안');
  assert.equal((await rpc('START_CHAT',{choice:{questionId:reply.question.id,optionId:reply.question.options[0].id},conversationId:chat.sessionId})).error,'question_changed');
  check('question survives reload; keyboard choice resumes with exact selection, preserves draft and rejects stale answers');
  mode='text';round=0;const priorId=chat.messages.at(-1).id;await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('다른 아이콘이야');await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=>(await state()).chat.messages.at(-1)?.id !== priorId,true);await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');reply=(await state()).chat.messages.at(-1);assert.deepEqual(reply.question.options,[]);
  mode='written';round=0;await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('오른쪽 위');await ui.getByRole('button',{name:'전송',exact:true}).click();await poll(async()=>(await state()).chat.messages.at(-1)?.id !== reply.id,true);await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  assert.equal((await state()).chat.messages.find(m=>m.id===reply.id).question.answer.text,'오른쪽 위');
  check('missing evidence produces a concise free-text question with no invented multiple-choice answers');
  const probe=async(name,args={})=>ui.evaluate(async({sourceTab,name,args})=>(await(await import(chrome.runtime.getURL('browser-agent.js'))).runBrowserAgent('choice-probe',{tabId:sourceTab},name,args,{vision:true,onImage:async(image,payload)=>({id:image.id,availableInChat:true,data:payload.data})})).result,{sourceTab,name,args});
  const found=await probe('find_images');const sprite=found.images.find(i=>i.label==='스프라이트');assert(sprite);
  const attached=await probe('attach_images',{refs:[sprite.ref]});assert(attached.attachments[0].availableInChat);const exported=Buffer.from(attached.attachments[0].data,'base64').toString('utf8');assert(!exported.includes('<use'));assert(exported.includes('M5 8h14'));assert.match(exported,/rgb\(24, 155, 176\)/);
  const stale=found.images.find(i=>i.label==='쇼핑');await tab.locator('#first path').first().evaluate(el=>el.setAttribute('d','M0 0h5v5Z'));assert.equal((await probe('attach_images',{refs:[stale.ref]})).error,'browser_stale');
  check('local SVG sprites resolve to geometry and changed icon geometry invalidates old candidate refs');
  await ui.evaluate(async()=>(await import(chrome.runtime.getURL('browser-agent.js'))).stopBrowserAgent('choice-probe'));
  assert.deepEqual(errors,[]);await writeFile('verification/image-choice-browser.json',JSON.stringify({checks,errors,realBrowserAssets:true,syntheticModelResponses:true,liveVisionRecognitionVerified:false},null,2));
} finally {await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}

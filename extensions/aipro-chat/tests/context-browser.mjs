import {planCompletion} from './fixtures/task-plan.mjs';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, readFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const profile = await mkdtemp(resolve(tmpdir(), 'aipro-context-')), extension = resolve(profile, 'extension');
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const summary = {goal: '교육 안내 메일 초안', constraints: ['보내지 말 것', '제목은 9월 교육'], decisions: ['본문만 작성'], completed: ['편집기 열기 확인'], pending: ['본문 입력 후 확인'], references: []};
const checks = [], errors = [], requests = [];
let context, ui, worker, portal, failure, mode = 'chat', stage = 0, releaseHeld;
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const rpc = (type, values = {}) => ui.evaluate(async ({type, values}) => chrome.runtime.sendMessage({type, ...values}), {type, values});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {let value; for (let i=0;i<600;i++) {if (failure) throw failure; value=await fn(); if(value===expected)return; await new Promise(r=>setTimeout(r,50));} assert.equal(value,expected);}
async function send(text) {await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(text);await ui.getByRole('button',{name:'전송',exact:true}).click();}
const reply = (content, tool, args = {}) => JSON.stringify({choices:[{message:{content, ...(tool ? {tool_calls:[{id:`c${requests.length}`,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]} : {})},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}});
try {
  await mkdir('verification',{recursive:true});await cp(resolve('dist'),extension,{recursive:true});
  const manifest = JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  // Pregrant test origins only in this isolated test copy. This does not verify
  // Chrome's production permission prompt or any real account/model behavior.
  manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(12000);
  await context.route('https://mail.example.test/**',route=>route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><title>메일 초안</title><label>제목<input aria-label="제목"></label><output>작성 중</output><script>window.writes=0;document.querySelector("input").addEventListener("input",()=>{window.writes++;document.querySelector("output").textContent="초안 저장됨";});</script>'}));
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
    // A small synthetic window forces compaction of the long history. The fixed
    // system prompt and lean tool set alone now estimate about 13.4k tokens,
    // so 16000/14000 (13600 input) cannot hold even the compacted request.
    if(route.request().url().endsWith('/api/models'))return route.fulfill({contentType:'application/json',body:JSON.stringify({modelList:[{name:'GLM-5.2-NVFP4',display_name:'GLM-5.2-512K',context_length:18000,max_input_tokens:15000}]})});
    const body=route.request().postDataJSON();
    if(body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT)) {requests.push(body);assert.equal(mode,'chat');return route.fulfill({contentType:'application/json',body:reply(JSON.stringify({decision:'reply',scope:'conversation',next_step:''}))});}
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});requests.push(body);
    const review=goalReviewPayload(body.messages);if(review)return route.fulfill({contentType:'application/json',body:JSON.stringify(reviewCompletion(review))});assert.equal(route.request().headers().authorization,`Bearer ${token}`);
    let response;
    if(body.messages[0].content.startsWith('Summarize conversation')) {assert.equal(body.tools,undefined);response=reply(JSON.stringify(summary));}
    else if(mode==='chat') {assert(body.messages.some(m=>m.content?.includes?.('context_summary')));assert(body.messages.some(m=>m.content==='초안 조건으로 기억해줘. 제목은 9월 교육이고 보내면 안 돼.'));response=reply('제목은 9월 교육으로 유지하겠습니다.');}
    else if(mode==='browser') {
      const result=body.messages.findLast(m=>m.role==='tool');
      if(stage===0) response=reply('','update_plan',{steps:[{text:'메일 초안 작성',status:'in_progress'},{text:'저장된 제목 확인',status:'pending'}]});
      if(stage===1) response=reply('','browser_snapshot');
      if(stage===2) {assert(result?.content.includes('제목')); response=reply('','run_playwright',{code:"await page.getByRole('textbox',{name:'제목',exact:true}).fill('9월 교육'); return await page.getByLabel('제목').inputValue();"});}
      if(stage===3) {assert.equal(JSON.parse(result.content).value,'9월 교육');stage++;await new Promise(r=>{releaseHeld=r;});return route.abort().catch(()=>{});}
      stage++;
    } else if(mode==='resume') {
      assert(body.messages.some(m=>m.content?.includes?.('task_checkpoint')));assert(body.messages.some(m=>m.content?.includes?.('Fresh browser observation')&&m.content.includes('초안 저장됨')));
      if(stage===0) response=reply('','run_playwright',{code:"return await page.getByLabel('제목').inputValue();"});
      else if(stage===1) {assert.equal(JSON.parse(body.messages.findLast(m=>m.role==='tool').content).value,'9월 교육');response=reply('','update_plan',{steps:[{text:'메일 초안 작성',status:'completed'},{text:'저장된 제목 확인',status:'completed'}]});}
      else if(stage===2) {assert.equal(JSON.parse(body.messages.findLast(m=>m.role==='tool').content).reason,'verification_required');response=reply('', 'verify_page', {checks:[{kind:'text_present',expected:'초안 저장됨'}]});}
      else if(stage===3) {assert.equal(JSON.parse(body.messages.findLast(m=>m.role==='tool').content).verified,true);response=reply('','update_plan',{steps:[{text:'메일 초안 작성',status:'completed'},{text:'저장된 제목 확인',status:'completed'}]});}
      else response=reply('저장된 제목을 확인했습니다. 메일은 보내지 않았습니다.');stage++;
    }
    await route.fulfill({contentType:'application/json',body:response});
  }catch(error){failure=error;await route.fulfill({status:500,body:'fixture assertion failed'}).catch(()=>{});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const original=Array.from({length:6},(_,i)=>({id:`m${i}`,role:i%2?'assistant':'user',content:i<4?(i%2?'old evidence '.repeat(1800):`old question ${i}`):(i%2?'최근 답':'최근 질문'),...(i%2?{state:'done'}:{})}));
  await worker.evaluate(async ({token,original})=>{await chrome.storage.local.set({chat:{messages:original,draft:''}});await chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}});},{token,original});
  ui=await context.newPage();ui.on('pageerror',e=>errors.push(e.message));await ui.setViewportSize({width:360,height:800});
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);await poll(async()=>(await state()).catalog?.models?.length,1);
  await send('초안 조건으로 기억해줘. 제목은 9월 교육이고 보내면 안 돼.');await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  let current=await state();assert.deepEqual(current.chat.messages.slice(0,6),original);assert.equal(current.chat.memory.throughId,'m3');assert(current.chat.contextStats.afterTokens<current.chat.contextStats.beforeTokens);
  assert.equal(current.usage.total.aipro.calls,requests.length);assert.equal(current.usage.total.aipro.total,requests.length*110);
  check('AI Pro auto compaction preserves the original history and latest correction, and counts every summary request once');
  const memory=structuredClone(current.chat.memory);await ui.reload();assert.deepEqual((await state()).chat.memory,memory);
  await ui.getByRole('button',{name:'컨텍스트 사용량',exact:true}).click();let dialog=ui.getByRole('dialog',{name:'컨텍스트',exact:true});await dialog.waitFor();
  await dialog.getByText('기억한 내용',{exact:true}).click();assert((await dialog.innerText()).includes('보내지 말 것'));assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await ui.screenshot({path:resolve('verification/context-memory-panel.png')});await ui.keyboard.press('Escape');
  check('saved memory survives reload and is readable inside the existing context dialog at 360px');
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('아직 보내지 않은 질문');
  await ui.getByRole('button',{name:'컨텍스트 사용량',exact:true}).click();await ui.getByRole('button',{name:'지금 대화 압축',exact:true}).click();
  await poll(async()=>(await state()).chat.contextStats.count,2);await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  assert.equal(await ui.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'아직 보내지 않은 질문');assert.equal((await state()).chat.draft,'아직 보내지 않은 질문');
  assert.equal((await state()).chat.memory.throughId,'m5');await ui.setViewportSize({width:1100,height:850});await ui.getByRole('button',{name:'컨텍스트 사용량',exact:true}).click();await ui.getByText('기억한 내용',{exact:true}).click();await ui.screenshot({path:resolve('verification/context-memory-desktop.png')});await ui.keyboard.press('Escape');
  check('manual compression advances memory while preserving the unsent draft and desktop layout');
  await rpc('CLEAR_CHAT');
  // This mutation is sent outside the UI action handler. Wait for the visible
  // conversation reset before entering a draft bound to the new conversation.
  await ui.locator('article.message').first().waitFor({state:'hidden'});
  // This legacy resume scenario asserts edits on the original current tab.
  // Select that supported mode explicitly; the product now defaults to a
  // separate window, covered by review-context-browser/workspace-flow-browser.
  await worker.evaluate(async()=>{const {catalog}=await chrome.storage.session.get('catalog');catalog.models[0].contextLength=524288;catalog.models[0].maxInputTokens=460800;await chrome.storage.session.set({catalog});await chrome.storage.local.set({browserWorkMode:'current'});});
  await poll(async()=>(await state()).browserWorkMode,'current');
  portal=await context.newPage();await portal.goto('https://mail.example.test/draft');const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://mail.example.test/draft').id);
  const uiId=await ui.evaluate(async()=> (await chrome.tabs.getCurrent()).id);await worker.evaluate(async({uiId,tabId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{uiId,tabId});
  await rpc('SELECT_SKILL',{id:'browser-agent'});mode='browser';stage=0;await ui.bringToFront();await send('메일 제목을 9월 교육으로 입력해줘. 보내지는 마.');
  await poll(()=>Promise.resolve(stage),4);assert.equal(await portal.evaluate(()=>window.writes),1);
  current=await state();assert.equal(current.chat.task.steps.find(s=>s.tool==='run_playwright').status,'done');assert.equal(current.chat.task.plan[0].status,'in_progress');
  const previousStepCount=current.chat.task.steps.length;
  const persisted=await worker.evaluate(async()=>JSON.stringify((await chrome.storage.local.get('chat')).chat.task));assert(!persisted.includes('getByRole'));assert(!persisted.includes('frames'));
  check('real Playwright input is checkpointed with its plan before the next model response, without persisting scripts or DOM');
  await ui.getByRole('button',{name:'중지',exact:true}).click();
  await poll(async()=>(await state()).busy,false);
  mode='resume';stage=0;await ui.reload();releaseHeld();await poll(async()=>(await state()).chat.task?.status,'paused');
  await send('/compact');await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');assert.equal((await state()).chat.task.status,'paused');
  const before=requests.length;await new Promise(r=>setTimeout(r,500));assert.equal(requests.length,before);assert.equal(await portal.evaluate(()=>window.writes),1);
  await ui.getByRole('button',{name:'작업 이어가기',exact:true}).click();await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  current=await state();assert.equal(current.chat.task.steps[previousStepCount].tool,'browser_snapshot');assert(current.chat.task.plan.every(s=>s.status==='completed'));assert.equal(await portal.evaluate(()=>window.writes),1);assert.equal(await portal.getByLabel('제목').inputValue(),'9월 교육');
  await ui.screenshot({path:resolve('verification/context-resume-desktop.png')});
  check('explicit stop and reload perform no automatic action; explicit resume re-observes the live page and keeps the completed input from repeating');
  assert.deepEqual(errors,[]);if(failure)throw failure;
  await writeFile('verification/context-checks.json',JSON.stringify({browser:context.browser().version(),checks,errors,scope:'Installed extension with API fixtures and test-only origin grants; no real accounts or model-quality claim'},null,2));
} catch (error) {
  const snapshot = ui && !ui.isClosed() ? await state().catch(() => null) : null;
  console.error(JSON.stringify({mode,stage,lastMessage:{state:snapshot?.chat?.messages?.at(-1)?.state,error:snapshot?.chat?.messages?.at(-1)?.error},requests:requests.map(r=>({summary:r.messages[0]?.content?.startsWith('Summarize conversation'),tools:r.tools?.length,inputChars:JSON.stringify(r.messages).length})),events:snapshot?.events},null,2));
  throw error;
} finally {releaseHeld?.();await context?.close();await rm(profile,{recursive:true,force:true});}

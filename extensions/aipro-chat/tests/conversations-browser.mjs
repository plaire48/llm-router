import {completionIntentResponse} from './fixtures/completion-intent.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, readFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-conversations-')), extension = resolve(profile, 'extension');
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const checks = [], errors = [], requests = [];
let context, ui, worker, extensionId;
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const rpc = (type, values = {}) => ui.evaluate(async ({type, values}) => chrome.runtime.sendMessage({type, ...values}), {type, values});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {let value; for(let i=0;i<200;i++){value=await fn();if(value===expected)return;await new Promise(r=>setTimeout(r,50));}assert.equal(value,expected);}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless:true, executablePath:process.env.CHROME_BINARY, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {
    if(route.request().url().endsWith('/api/models')) return route.fulfill({contentType:'application/json',body:JSON.stringify({modelList:[{name:'GLM-5.2-NVFP4',display_name:'GLM-5.2-512K',context_length:524288,max_input_tokens:460800}]})});
    const intent = completionIntentResponse(route.request().postDataJSON()); if (intent) return route.fulfill({json:intent});
    requests.push(route.request().postDataJSON());
    await route.fulfill({contentType:'application/json', body:JSON.stringify({choices:[{message:{role:'assistant',content:'회의 자료를 간단히 정리했습니다.'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})});
  });
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'); extensionId=new URL(worker.url()).hostname;
  ui=await context.newPage();ui.on('pageerror',e=>errors.push(e.message));await ui.setViewportSize({width:360,height:800});
  await ui.goto(`chrome-extension://${extensionId}/index.html`);await ui.getByRole('button',{name:'대화 이력',exact:true}).waitFor();
}
const openHistory = async () => {await ui.getByRole('button',{name:'대화 이력',exact:true}).click();return ui.getByRole('dialog',{name:'대화 이력',exact:true});};
try {
  await mkdir('verification',{recursive:true});await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await launch();
  assert.equal(await ui.getByRole('button',{name:'새 대화',exact:true}).count(),0,'new conversation belongs inside history, not the header');
  let panel=await openHistory();await panel.getByText('대화를 시작하면 여기에 남습니다.').waitFor();await ui.keyboard.press('Escape');
  assert.equal(await ui.getByRole('button',{name:'대화 이력',exact:true}).evaluate(e=>e===document.activeElement),true);
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);
  await poll(async()=>(await state()).catalog?.models?.length,1);
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('이번 주 회의 자료 정리');await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  const first=(await state()).chat.sessionId;
  // Starting from history must preserve the current draft and focus the composer.
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('다음 회의에서 확인할 내용');
  panel=await openHistory();
  const create=panel.getByRole('button',{name:'새 대화',exact:true});
  assert.equal(await create.getAttribute('data-action'),'add');
  assert.equal(await create.getAttribute('data-icon-only'),'true');
  await create.click();
  await poll(async()=>(await state()).chat.messages.length,0);
  await poll(()=>ui.getByRole('textbox',{name:'메시지',exact:true}).evaluate(e=>e===document.activeElement),true);
  assert.equal(await ui.getByRole('dialog').count(),0);
  assert.equal(await ui.getByRole('alertdialog').count(),0);
  assert.equal((await state()).conversations.length,1);
  assert.equal((await rpc('DRAFT',{value:'stale overwrite',conversationId:first})).error,'conversation_changed');
  // Storage commits before the asynchronous UI state refresh. Exercise that
  // boundary deliberately instead of assuming a direct GET_STATE renders React.
  await ui.evaluate(()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);window.delayStateRefresh=true;chrome.runtime.sendMessage=async message=>{const response=await send(message);if(window.delayStateRefresh&&message.type==='GET_STATE'&&message.clientId)await new Promise(resolve=>setTimeout(resolve,300));return response;};});
  panel=await openHistory();await panel.getByRole('button',{name:'이번 주 회의 자료 정리 열기',exact:true}).click();
  await poll(async()=>(await state()).chat.sessionId,first);
  assert.equal((await state()).chat.draft,'다음 회의에서 확인할 내용');
  await poll(()=>ui.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'다음 회의에서 확인할 내용');
  await ui.evaluate(()=>{window.delayStateRefresh=false;});
  await poll(()=>ui.getByRole('textbox',{name:'메시지',exact:true}).evaluate(e=>e===document.activeElement),true);
  // The existing logo shortcut also flushes a draft before the debounce runs.
  await ui.getByRole('button',{name:'누비 새 채팅',exact:true}).click();
  await poll(async()=>(await state()).chat.messages.length,0);
  panel=await openHistory();await panel.getByRole('button',{name:'이번 주 회의 자료 정리 열기',exact:true}).click();
  await poll(async()=>(await state()).chat.sessionId,first);
  await ui.reload();await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  assert.equal((await state()).chat.draft,'다음 회의에서 확인할 내용');
  await poll(()=>ui.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'다음 회의에서 확인할 내용');
  check('history plus and logo start new chats, preserve the old transcript/draft, and focus the composer; selection and reload restore both');
  panel=await openHistory();await panel.getByRole('button',{name:'이번 주 회의 자료 정리 이름 변경',exact:true}).click();
  await panel.getByRole('textbox',{name:'대화 이름',exact:true}).fill('회의 준비');
  await ui.screenshot({path:resolve('verification/conversation-rename-icons.png')});
  await panel.getByRole('button',{name:'저장',exact:true}).click();
  await panel.getByRole('button',{name:'회의 준비 열기',exact:true}).waitFor();
  await panel.getByRole('searchbox',{name:'대화 검색'}).fill('없는 대화');await panel.getByText('검색 결과가 없습니다.').waitFor();
  await panel.getByRole('searchbox',{name:'대화 검색'}).fill('회의');
  for(const [width,height] of [[320,800],[360,800],[1100,850]]) {
    await ui.setViewportSize({width,height});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const clipped=await panel.locator('.history-select').evaluate(e=>e.scrollWidth>e.clientWidth);assert.equal(clipped,false);
    const searchBox=await panel.getByRole('searchbox',{name:'대화 검색'}).boundingBox(),plusBox=await panel.getByRole('button',{name:'새 대화',exact:true}).boundingBox();
    assert(Math.abs(searchBox.height-plusBox.height)<1,'search and create share the control height');
    assert(searchBox.x+searchBox.width<=plusBox.x,'search and create never overlap');
    await ui.screenshot({path:resolve(`verification/conversations-${width}.png`)});
  }
  await ui.keyboard.press('Escape');
  check('history search, rename, current state and focus return work at panel and desktop widths');
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('내용을 이어서 보완해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  assert(requests.at(-1).messages.some(m=>m.content==='이번 주 회의 자료 정리'));
  assert(requests.at(-1).messages.some(m=>m.content==='내용을 이어서 보완해줘'));
  check('continuing a selected conversation sends its original context to the same provider');
  const count=requests.length;
  await context.close();await launch();
  assert.equal((await state()).auth.present,false);assert.equal((await state()).chat.sessionId,first);
  await ui.getByText('AI Pro 연결 필요',{exact:true}).waitFor();
  assert.equal(await ui.getByRole('textbox',{name:'메시지',exact:true}).count(),0);
  assert.equal(await ui.locator('.message-user').count(),2);assert.equal(requests.length,count);
  check('browser restart keeps history readable, removes the token, and makes no automatic model or browser action');
  await worker.evaluate(()=>chrome.storage.local.set({providerChats:{chatgpt:{sessionId:'other-provider',provider:'chatgpt',modelId:'gpt-5.6-sol',messages:[{id:'g1',role:'user',content:'개인 여행 계획'}],draft:'다른 제공자의 초안',createdAt:1,updatedAt:Date.now()}}}));
  panel=await openHistory();await panel.getByRole('button',{name:'개인 여행 계획 열기',exact:true}).click();
  await poll(async()=>(await state()).activeProvider,'chatgpt');await ui.getByText('ChatGPT 연결 필요',{exact:true}).waitFor();
  assert.equal((await state()).chat.messages.length,1);assert.equal(requests.length,count);
  panel=await openHistory();await panel.getByRole('button',{name:'회의 준비 열기',exact:true}).click();
  await poll(async()=>(await state()).chat.sessionId,first);
  check('other-provider sessions are isolated and require the matching connection before continuing');
  panel=await openHistory();await panel.getByRole('button',{name:'회의 준비 삭제',exact:true}).click();
  await ui.getByRole('alertdialog').getByRole('button',{name:'취소',exact:true}).click();assert.equal((await state()).chat.sessionId,first);
  await panel.getByRole('button',{name:'회의 준비 삭제',exact:true}).click();await ui.getByRole('alertdialog').getByRole('button',{name:'삭제',exact:true}).click();
  await poll(async()=>(await state()).conversations.some(c=>c.id===first),false);
  assert((await state()).conversations.some(c=>c.id==='other-provider'));
  await ui.reload();panel=await openHistory();assert.equal(await panel.getByRole('button',{name:'회의 준비 열기',exact:true}).count(),0);
  await panel.getByRole('button',{name:'개인 여행 계획 열기',exact:true}).waitFor();
  assert.equal((await state()).usage.total.aipro.total,240);
  check('confirmed deletion removes only that conversation, persists after reload, and retains usage totals');
  await worker.evaluate(async()=>{
    const {chatHistory=[]}=await chrome.storage.local.get('chatHistory');
    await chrome.storage.local.set({chatHistory:[...chatHistory,...Array.from({length:24},(_,i)=>({sessionId:`long-${i}`,provider:'aipro',createdAt:1,updatedAt:Date.now()-i*1000,draft:'',messages:[{id:`l${i}`,role:'user',content:`${i+1}번째 대화 아주 긴 제목도 목록에서 깔끔하게 표현되어야 합니다`.repeat(3)}]}))]});
  });
  await ui.setViewportSize({width:360,height:480});await poll(()=>panel.locator('.history-row').count(),25);
  await panel.locator('.history-row').last().scrollIntoViewIfNeeded();
  const panelBox=await panel.boundingBox();assert(panelBox.y>=0&&panelBox.y+panelBox.height<=480);
  assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await ui.screenshot({path:resolve('verification/conversations-long-list.png')});
  check('long titles and 25 saved conversations scroll inside the dialog at 360x480 without viewport overflow');
  assert.deepEqual(errors,[]);
  await writeFile('verification/conversations-browser.json',JSON.stringify({version:manifest.version,checks,syntheticModelResponses:true,liveProvidersVerified:false},null,2));
} finally {await context?.close().catch(()=>{});await rm(profile,{recursive:true,force:true});}

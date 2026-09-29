import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-toggles-')), extension = resolve(profile, 'extension');
const checks = [], errors = []; let context, worker, page, ui, failure, stage = 0, rejected = false, imageSeen = false;
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const fixture = `<title>알림 설정</title><style>body{font:16px sans-serif}label,[role=switch],button,.toggle{display:block;padding:14px;margin:10px;background:#eee;width:240px}label span{display:inline-block;width:35px;height:18px;background:#777}input:checked+span{background:teal}[aria-checked=true],[aria-pressed=true]{background:#aee}</style>
<input id="styled" type="checkbox" style="display:none"><label for="styled"><span></span>주간 요약</label>
<div id="switch" role="switch" aria-label="알림" aria-checked="false" tabindex="0">알림</div>
<button id="pressed" aria-pressed="false">즐겨찾기</button>
<button id="expanded" aria-expanded="false">상세 설정</button>
<div id="disabled" role="switch" aria-label="잠긴 알림" aria-disabled="true" aria-checked="false">잠긴 알림</div>
<div id="mixed" role="checkbox" aria-label="전체 선택" aria-checked="mixed">전체 선택</div>
<div id="broken" role="switch" aria-label="응답 없는 토글" aria-checked="false">응답 없는 토글</div>
<script>window.actions={}; for(const id of ['switch','mixed','pressed','expanded'])document.getElementById(id).onclick=e=>{actions[id]=(actions[id]||0)+1;const key=id==='pressed'?'aria-pressed':id==='expanded'?'aria-expanded':'aria-checked';e.currentTarget.setAttribute(key,e.currentTarget.getAttribute(key)==='true'?'false':'true')}; styled.onchange=()=>actions.styled=(actions.styled||0)+1;broken.onclick=()=>actions.broken=(actions.broken||0)+1;</script>`;
const elements = result => (result.observation || result).frames.flatMap(f => f.elements || []);
const find = (result, id) => elements(result).find(e => e.id === id);
const rpc = (type, args = {}) => ui.evaluate(message => chrome.runtime.sendMessage(message), {type, ...args});
const state = async () => (await rpc('GET_STATE')).data;
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  await context.route('https://toggles.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: fixture}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  page = await context.newPage(); await page.goto('https://toggles.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url === 'https://toggles.example.test/').id);
  const run = async (name, args = {}) => (await worker.evaluate(({tabId, name, args}) => testBrowserAgent.runBrowserAgent('toggles', {tabId}, name, args, {vision: true}), {tabId, name, args})).result;
  let result = await run('browser_snapshot');
  assert.equal(find(result,'styled').name,'주간 요약'); assert.equal(find(result,'switch').state,false); assert.equal(find(result,'pressed').stateKind,'pressed'); assert.equal(find(result,'mixed').state,'mixed');
  check('hidden native checkbox labels, ARIA switches, pressed buttons and mixed state are observed');
  for (const id of ['styled','switch','pressed','mixed']) {
    result = await run('run_playwright', {code:`await browser.ref(${JSON.stringify(find(result,id).ref)}).setChecked(true);`});
    assert(!result.error, `${id}: ${JSON.stringify(result)}`); assert.equal(find(result,id).state,true);
    result = await run('run_playwright', {code:`await browser.ref(${JSON.stringify(find(result,id).ref)}).setChecked(true);`});
    assert(!result.error, JSON.stringify(result)); assert.equal((await page.evaluate(()=>actions))[id],1, `${id} toggled again`);
    result = await run('verify_page', {checks:[{kind:'control_state',ref:find(result,id).ref,expected:'true'}]});
    assert.equal(result.verified,true,JSON.stringify(result));
  }
  check('state-setting and continuation do not flip an already-correct toggle; actual state is verified');
  result = await run('fill_form',{fields:[{field_id:find(result,'switch').ref,value:'false'}]}); assert.equal(result.verified,true); assert.equal(find(result,'switch').state,false);
  result = await run('click_element',{ref:find(result,'expanded').ref});
  result = await run('verify_page',{checks:[{kind:'control_expanded',ref:find(result,'expanded').ref,expected:'true'}]}); assert.equal(result.verified,true);
  result = await run('run_playwright',{code:`await browser.ref(${JSON.stringify(find(result,'broken').ref)}).check();`}); assert.equal(result.reason,'script_control_state'); assert.equal((await page.evaluate(()=>actions)).broken,1);
  result = await run('run_playwright',{code:`await browser.ref(${JSON.stringify(find(result,'disabled').ref)}).check();`}); assert.equal(result.reason,'script_disabled');
  const shot = await run('capture_page',{full_page:false}); assert(shot.image.data); assert(shot.visualTargets.some(t=>t.name==='알림'&&t.bounds.width>0));
  check('unchanged and disabled toggles return a recoverable reason; screenshots include matching control bounds');
  await worker.evaluate(()=>testBrowserAgent.stopBrowserAgent()); await page.reload();
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().method()==='GET') return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}});
    const body=route.request().postDataJSON(), plan=planCompletion(body), review=goalReviewPayload(body.messages);
    if(plan)return route.fulfill({json:plan}); if(review)return route.fulfill({json:reviewCompletion(review)});
    let calls,content=''; const last=body.messages.findLast(m=>m.role==='tool');
    if(stage===2&&!rejected){rejected=true;return route.fulfill({status:503,body:'temporary outage'});}
    if(stage===0)calls=[call('browser_snapshot')];
    if(stage===1)calls=[call('run_playwright',{code:'await page.getByRole("button",{name:"알림",exact:true}).click();'})];
    if(stage===2){
      const failed=JSON.parse(last.content); assert.equal(failed.reason,'script_missing'); assert(failed.visualRecovery.screenshot_id); assert.equal(failed.visualRecovery.capture_mode,'viewport');
      imageSeen=body.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url')); assert(imageSeen);
      const target=failed.visualRecovery.visualTargets.find(t=>t.name==='알림'); assert(target); assert.equal(target.state,false);
      calls=[call('run_playwright',{code:`await browser.ref(${JSON.stringify(target.ref)}).setChecked(true);`})];
    }
    if(stage===3)calls=[call('verify_page',{checks:[{kind:'control_state',ref:find(JSON.parse(last.content),'switch').ref,expected:'true'}]})];
    if(stage===4)content='알림을 켜고 상태를 확인했습니다.';
    assert(stage++<=4,'Unexpected model loop');
    await route.fulfill({json:{choices:[{message:{content,...(calls?{tool_calls:calls}:{})},finish_reason:calls?'tool_calls':'stop'}]}});
  }catch(error){failure=error;await route.fulfill({status:400,body:'fixture failure'});}});
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:11}}));
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  for(let i=0;i<100&&(await state()).catalog?.models?.length!==1;i++)await new Promise(r=>setTimeout(r,30));
  const uiTabId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId,uiTabId})=>chrome.storage.session.set({chatSourceTabs:{[uiTabId]:tabId}}),{tabId,uiTabId});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('알림을 켜고 확인해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
  let reply;
  for(let i=0;i<900;i++){if(failure)throw failure;reply=(await state()).chat.messages.at(-1);if(reply?.role==='assistant'&&['done','error'].includes(reply.state))break;await new Promise(r=>setTimeout(r,40));}
  assert(reply, JSON.stringify(await state()));
  assert.equal(reply.state,'done',JSON.stringify(reply));assert.equal(reply.question,undefined);assert(rejected&&imageSeen);
  assert.equal((await page.evaluate(()=>actions)).switch,1);assert.equal(await page.locator('#switch').getAttribute('aria-checked'),'true');
  assert(reply.trace.some(t=>t.tool==='recover_model'&&t.status==='done'),JSON.stringify(reply.trace));
  check('Qwen wire receives a fresh image after target failure and resumes after HTTP 503 without a user message or repeated click');
  assert.deepEqual(errors,[]);
  await writeFile('verification/toggle-recovery-browser.json',JSON.stringify({checks,errors,actualBrowser:true,actualModel:false,syntheticModel:'QWEN3.8-27B-FP8-256K',imageSeen,transientFailureRecovered:rejected},null,2));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}

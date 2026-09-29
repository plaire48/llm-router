import {planCompletion, fixturePlan} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir, appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-approval-')),extension=resolve(profile,'extension');
const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
let context,ui,worker,page,stage=0,routeFailure,mode='approve';const checks=[],errors=[];
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
const state=()=>ui.evaluate(async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function poll(fn,want){let actual;for(let i=0;i<900;i++){if(routeFailure)throw routeFailure;actual=await fn();if(actual===want)return;await new Promise(r=>setTimeout(r,40));}assert.equal(actual,want);}
const ref=(result,name)=>{const found=(result.observation||result).frames.flatMap(f=>f.elements||[]).find(e=>e.name===name);assert(found,name);return found.ref;};
const reply=(name,args={})=>({choices:[{message:name?{content:'',tool_calls:[{id:`step-${stage}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'등록 결과를 확인했습니다.'},finish_reason:name?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});
async function send(text){await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(text);await ui.getByRole('button',{name:'전송',exact:true}).click();}
try{
  await mkdir('verification',{recursive:true});await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('https://*/*','http://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.approvalTest={runBrowserAgent,stopBrowserAgent,runApprovedAction,handle,browserAgentRequestForTab};\n');
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(12000);context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('https://draft.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<title>업무 안내</title><style>body{font:16px sans-serif;padding:30px}label{display:block;margin:15px}textarea{width:500px;height:180px}</style><label>제목<input></label><label>본문<textarea></textarea></label><button id="publish">등록</button><output>초안</output><iframe src="https://frame.example.test/"></iframe><script>window.submits=[];document.querySelector('button').onclick=e=>{window.submits.push({trusted:e.isTrusted,title:document.querySelector('input').value,body:document.querySelector('textarea').value});document.querySelector('output').textContent='등록 완료';};</script>`}));
  await context.route('https://frame.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<label>수신자<input value="팀 게시판"></label>'}));
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
    if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'GLM-5.2-NVFP4',context_length:524288}]}});
    const body=route.request().postDataJSON(),review=goalReviewPayload(body.messages);
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});if(review)return route.fulfill({json:reviewCompletion(review)});
    const last=body.messages.findLast(m=>m.role==='tool'),result=last?JSON.parse(last.content):null,round=stage++,current=mode==='unverified' && round>=3 ? round-1 : round;let name,args={};
    if(current===0)name='browser_snapshot';
    if(current===1){name='run_playwright';args={code:'await page.getByLabel("제목",{exact:true}).fill("팀 업무 안내"); await page.getByLabel("본문",{exact:true}).fill("안녕하세요. 이번 주 업무 안내를 공유합니다.\\n진행 상황을 금요일까지 작성해주세요.");'};}
    if(mode==='unverified' && round===2){name='run_playwright';args={code:'await page.getByRole("button",{name:"등록",exact:true}).click();'};}
    else if(current===2){if(mode==='unverified')assert.equal(result.error,'approval_verification_required');name='verify_page';args={checks:[{kind:'field_value',ref:ref(result,'제목'),expected:'팀 업무 안내'},{kind:'field_contains',ref:ref(result,'본문'),expected:'금요일까지'}]};}
    if(current===3){assert.equal(result.verified,true);name='request_approval';args={ref:ref(result,'등록'),summary:'팀 게시판에 이번 주 업무 안내를 등록합니다.'};}
    if(current===4 && ['revise','edit'].includes(mode)){name='run_playwright';args={code:'await page.getByLabel("본문",{exact:true}).fill("진행 상황을 목요일까지 작성해주세요.");'};}
    else if(current===4){assert.equal(mode,'approve');assert(body.messages.some(m=>m.content?.includes?.('one-use approval')));name='verify_page';args={checks:[{kind:'text_present',expected:'등록 완료'}]};}
    if(current===5 && ['revise','edit'].includes(mode)){name='verify_page';args={checks:[{kind:'field_contains',ref:ref(result,'본문'),expected:'목요일까지'}]};}
    else if(current===5)assert.equal(result.verified,true);
    if(current===6 && ['revise','edit'].includes(mode)){assert.equal(result.verified,true);name='request_approval';args={ref:ref(result,'등록')};}
    if(mode==='approve' && current>=5){const completed=(await state()).chat.task.plan.filter(step=>step.status==='completed').length;assert.equal(completed,current-5,'A continuation requires a newly persisted stage');}
    assert(current<=(['revise','edit'].includes(mode)?6:mode==='approve'?4+fixturePlan.length:5),`Unexpected round ${current}`);return route.fulfill({json:reply(name,args)});
  }catch(error){routeFailure=error;return route.fulfill({status:500,body:'Synthetic assertion failure'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();await page.goto('https://draft.example.test/');
  // This suite edits the existing draft and binds its original iframe. The
  // default dedicated-window flow is covered by workspace-flow-browser.
  await worker.evaluate(()=>chrome.storage.local.set({browserWorkMode:'current'}));
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);await ui.setViewportSize({width:380,height:850});
  await poll(async()=>!!(await state()).catalog?.models?.length,true);
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://draft.example.test/').id),uiId=await ui.evaluate(async()=> (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId,uiId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{tabId,uiId});
  await send('이 페이지에 이번 주 팀 업무 안내를 작성해줘. 진행 상황은 금요일까지 받으면 돼.');
  await poll(async()=> (await state()).chat.task?.status,'awaiting_user');
  assert.equal(stage,4);assert.equal(await page.evaluate(()=>window.submits.length),0);assert.match(await page.getByLabel('본문',{exact:true}).inputValue(),/금요일/);
  const q=(await state()).chat.messages.at(-1).question;assert.equal(q.kind,'approval');assert(q.preview.some(f=>f.label==='제목'&&f.value==='팀 업무 안내'));
  assert.equal(await worker.evaluate(tabId=>approvalTest.browserAgentRequestForTab(tabId),tabId),null);
  check('compose, fill and verify a real browser draft without a repeated user request; final registration pauses and detaches debugger');
  // Native permission decision is injected; approval UI, worker permission
  // lookup and durable approval storage are the production code paths.
  await worker.evaluate(async()=>{
    const {chat}=await chrome.storage.local.get('chat');const {actionApprovals}=await chrome.storage.session.get('actionApprovals');
    globalThis.originalPermissionApproval=structuredClone(actionApprovals[chat.sessionId]);
    actionApprovals[chat.sessionId].operation.method='download';chat.messages.at(-1).question.requiredPermission='downloads';
    await chrome.storage.session.set({actionApprovals});await chrome.storage.local.set({chat});
  });
  await ui.reload();await ui.getByRole('button',{name:'등록',exact:true}).waitFor();
  await ui.evaluate(()=>{globalThis.permissionRequests=0;chrome.permissions.request=()=>{permissionRequests++;return Promise.resolve(false);};});
  await ui.getByRole('button',{name:'등록',exact:true}).click();
  await ui.getByText('설정에서 다운로드 추적 권한을 허용해 주세요.',{exact:true}).waitFor();
  assert.equal(await ui.evaluate(()=>permissionRequests),1);assert.equal(stage,4);
  let preserved=await state();assert(!preserved.chatLease);assert(!preserved.chat.messages.at(-1).question.answer);
  assert.equal(await worker.evaluate(async id=>(await chrome.storage.session.get('actionApprovals')).actionApprovals[id].questionId,preserved.chat.sessionId),q.id);
  // UI success cannot bypass the worker's real Chrome permission check.
  await ui.evaluate(()=>{chrome.permissions.request=()=>Promise.resolve(true);});
  await ui.getByRole('button',{name:'등록',exact:true}).click();
  await ui.getByText('설정에서 다운로드 추적 권한을 허용해 주세요.',{exact:true}).waitFor();
  preserved=await state();assert(!preserved.chatLease);assert(!preserved.chat.messages.at(-1).question.answer);assert.equal(stage,4);
  await worker.evaluate(async()=>{
    const {chat}=await chrome.storage.local.get('chat');const {actionApprovals}=await chrome.storage.session.get('actionApprovals');
    actionApprovals[chat.sessionId]=originalPermissionApproval;delete chat.messages.at(-1).question.requiredPermission;
    await chrome.storage.session.set({actionApprovals});await chrome.storage.local.set({chat});
  });
  await ui.reload();await ui.getByRole('button',{name:'등록',exact:true}).waitFor();
  check('download permission denial and worker preflight preserve the unanswered approval and execute no model/tool request');
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('다음 요청 초안');await ui.waitForTimeout(400);await ui.reload();
  await ui.getByRole('button',{name:'등록',exact:true}).waitFor();assert.equal(await ui.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'다음 요청 초안');
  await ui.locator('.approval-preview summary').click();await ui.screenshot({path:resolve('verification/approval-panel.png'),fullPage:true});
  assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await ui.setViewportSize({width:1100,height:850});await ui.screenshot({path:resolve('verification/approval-desktop.png'),fullPage:true});
  check('approval and actual draft preview survive chat reload, preserve composer text and fit narrow and wide layouts');
  const forbidden=await ui.evaluate(async q=>Promise.all([
    chrome.runtime.sendMessage({type:'START_CHAT',choice:{questionId:q.id,optionId:'approve'},conversationId:'another-conversation'}),
    chrome.runtime.sendMessage({type:'START_CHAT',choice:{questionId:'old-question',optionId:'approve'}}),
  ]),q);assert(forbidden.every(r=>r.ok===false));
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'new-account',receivedAt:2}}));
  const otherAccount=await ui.evaluate(async q=>chrome.runtime.sendMessage({type:'START_CHAT',choice:{questionId:q.id,optionId:'approve'}}),q);assert.equal(otherAccount.error,'approval_changed');
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);await ui.waitForTimeout(300);
  check('wrong conversation, wrong question and replacement credentials cannot reuse a pending approval');
  await ui.getByRole('button',{name:'등록',exact:true}).click();await poll(async()=> (await state()).chat.task?.status,'done');
  assert.equal(stage,5+fixturePlan.length);const submits=await page.evaluate(()=>window.submits);assert.equal(submits.length,1);assert(submits[0].trusted);assert.equal((await state()).chat.task.verification.status,'passed');
  assert.equal(await ui.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'다음 요청 초안');
  const duplicate=await ui.evaluate(async q=>chrome.runtime.sendMessage({type:'START_CHAT',choice:{questionId:q.id,optionId:'approve'}}),q);assert.equal(duplicate.ok,false);assert.equal(await page.evaluate(()=>window.submits.length),1);
  check('approval executes exactly one trusted click, verifies the visible result and rejects replay without clearing composer text');
  stage=0;mode='reject';await send('새 안내를 이 페이지에 작성해줘');await poll(async()=> (await state()).chat.task?.status,'awaiting_user');
  await ui.getByRole('button',{name:'취소',exact:true}).click();await poll(async()=> (await state()).chat.messages.at(-1)?.question?.answer?.state,'rejected');
  assert.equal(stage,4);assert.equal(await page.evaluate(()=>window.submits.length),1);assert.match(await page.getByLabel('본문',{exact:true}).inputValue(),/금요일/);
  assert.equal(Object.keys(await worker.evaluate(async()=> (await chrome.storage.session.get('actionApprovals')).actionApprovals)).length,0);
  check('cancel needs no model call, preserves the page draft and revokes the pending approval');
  stage=0;mode='unverified';await send('안내를 작성해줘');await poll(async()=> (await state()).chat.task?.status,'awaiting_user');
  assert.equal(stage,5);assert.equal(await page.evaluate(()=>window.submits.length),1);
  assert((await state()).chat.messages.at(-1).trace.some(s=>s.reason==='approval_verification_required'));
  await ui.getByRole('button',{name:'취소',exact:true}).click();await poll(async()=> (await state()).chat.messages.at(-1)?.question?.answer?.state,'rejected');
  check('unverified final script clicks are refused; the model verifies the draft before an approval can appear');
  stage=0;mode='revise';await send('팀 업무 안내를 새로 작성해줘');await poll(async()=> (await state()).chat.task?.status,'awaiting_user');
  const prior=(await state()).chat.messages.at(-1).question.id;
  await send('마감일을 목요일로 바꿔줘');await poll(async()=> (await state()).chat.task?.status,'awaiting_user');
  assert.equal(stage,7);assert.notEqual((await state()).chat.messages.at(-1).question.id,prior);
  assert.match((await state()).chat.task.goal,/팀 업무 안내/);assert.match((await state()).chat.task.goal,/목요일/);
  assert.equal(await page.getByLabel('본문',{exact:true}).inputValue(),'진행 상황을 목요일까지 작성해주세요.');assert.equal(await page.evaluate(()=>window.submits.length),1);
  const stale=await ui.evaluate(async questionId=>chrome.runtime.sendMessage({type:'START_CHAT',choice:{questionId,optionId:'approve'}}),prior);assert.equal(stale.ok,false);
  await ui.getByRole('button',{name:'취소',exact:true}).click();await poll(async()=> (await state()).chat.messages.at(-1)?.question?.answer?.state,'rejected');
  check('a written revision retains the original goal, updates the draft, revokes the old grant and requests fresh approval');
  stage=0;mode='edit';await send('작성한 안내를 페이지에 반영해줘');await poll(async()=> (await state()).chat.task?.status,'awaiting_user');
  await ui.setViewportSize({width:380,height:850});
  const card=ui.locator('.action-approval[data-answered=false]');
  await card.locator('.approval-preview summary').click();
  assert.equal(await card.getByRole('button',{name:'초안 수정',exact:true}).count(),0);
  await card.getByRole('button',{name:'본문 편집',exact:true}).click();
  const editor=card.getByRole('group',{name:'초안 편집'});await editor.waitFor();
  assert.equal(await ui.getByRole('dialog',{name:'초안 수정'}).count(),0);
  assert(await editor.getByLabel('본문',{exact:true}).evaluate(el=>el===document.activeElement));
  await assertModalTypography(editor);
  assert.equal(await editor.getByLabel('제목',{exact:true}).inputValue(),'팀 업무 안내');assert.match(await editor.getByLabel('본문',{exact:true}).inputValue(),/금요일/);
  await editor.getByLabel('본문',{exact:true}).fill('진행 상황을 목요일까지 작성해주세요.');
  await card.locator('.approval-preview summary').click();
  assert.equal(await card.getByRole('button',{name:'등록',exact:true}).count(),0);
  await card.locator('.approval-preview summary').click();
  assert.equal(await editor.getByLabel('본문',{exact:true}).inputValue(),'진행 상황을 목요일까지 작성해주세요.');
  for(const width of [320,360,1100]) {
    await ui.setViewportSize({width,height:850});await assertModalTypography(editor);
    assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const latest=ui.getByRole('button',{name:'최신 답변으로 이동'});
    if(await latest.isVisible()) {const arrow=await latest.boundingBox(), viewport=await ui.locator('.conversation').boundingBox();assert(arrow.y>=viewport.y+viewport.height,'latest control cannot cover inline approval fields or actions');}
    await ui.screenshot({path:resolve(`verification/approval-edit-${width}.png`),fullPage:true});
  }
  check('clicking preview text loads full verified fields inline and focuses the selected field; folding preserves edits and blocks stale publication');
  await card.getByRole('button',{name:'수정 반영',exact:true}).click();
  await poll(async()=> (await state()).chat.messages.at(-1)?.question?.preview?.some(f=>f.label==='본문'&&f.value==='진행 상황을 목요일까지 작성해주세요.'),true);
  assert.equal(stage,7);assert.equal(await page.getByLabel('본문',{exact:true}).inputValue(),'진행 상황을 목요일까지 작성해주세요.');assert.equal(await page.evaluate(()=>window.submits.length),1);
  assert.equal((await state()).chat.messages.at(-2).displayContent,'초안을 수정했습니다.');assert.equal(await editor.count(),0);
  await ui.getByRole('button',{name:'취소',exact:true}).click();await poll(async()=> (await state()).chat.messages.at(-1)?.question?.answer?.state,'rejected');
  check('inline editing uses full draft fields; edited values are applied and verified with fresh approval, without final submission');
  await ui.close(); // Direct executor probes below have no chat lease; close the UI recovery poller.
  // Exercise target binding against real DOM changes through the packaged executor.
  async function capture(){return worker.evaluate(async tabId=>{await approvalTest.stopBrowserAgent();const id=crypto.randomUUID(),page={tabId};const observed=(await approvalTest.runBrowserAgent(id,page,'browser_snapshot')).result;const ref=observed.frames.flatMap(f=>f.elements||[]).find(e=>e.name==='등록').ref;let record;const out=await approvalTest.runBrowserAgent(id,page,'request_approval',{ref},{onApproval:r=>{record=r;return Promise.resolve({requiresUserInput:true,questionId:'test'});}});await approvalTest.stopBrowserAgent();return {record,out};},tabId);}
  async function execute(record){return worker.evaluate(async record=>(await approvalTest.runApprovedAction(crypto.randomUUID(),{tabId:record.tabId},record)).result,record);}
  for(const change of ['body','iframe','replace','reload','expiry']){
    const {record,out}=await capture();assert.equal(out.result.requiresUserInput,true);
    if(change==='body')await page.getByLabel('본문',{exact:true}).fill('사용자 수정');
    if(change==='iframe')await page.frameLocator('iframe').getByLabel('수신자').fill('다른 팀');
    if(change==='replace')await page.evaluate(()=>{const el=document.querySelector('#publish');el.replaceWith(el.cloneNode(true));document.querySelector('#publish').onclick=()=>window.submits.push({unexpected:true});});
    if(change==='reload')await page.reload();
    if(change==='expiry')record.expiresAt=1;
    const count=await page.evaluate(()=>window.submits.length),result=await execute(record);assert.equal(result.error,'approval_changed');assert.equal(result.actionIssued,false);assert.equal(await page.evaluate(()=>window.submits.length),count);
    assert.equal(result.reason,change==='expiry'?'approval_expired':['replace','reload'].includes(change)?'approval_target_changed':'approval_snapshot_changed');
  }
  check('draft edits, iframe edits, replaced controls, same-URL reloads and expired grants all refuse stale approved actions');
  const guarded=await worker.evaluate(async tabId=>{await approvalTest.stopBrowserAgent();let record;const id=crypto.randomUUID();const out=await approvalTest.runBrowserAgent(id,{tabId},'run_playwright',{code:'try { await page.getByRole("button",{name:"등록",exact:true}).click(); } catch(e) {} await page.getByLabel("본문",{exact:true}).fill("BYPASS");'},{onApproval:r=>{record=r;return Promise.resolve({requiresUserInput:true,questionId:'guard'});}});await approvalTest.stopBrowserAgent();return {out,record};},tabId);
  assert.equal(guarded.out.result.requiresUserInput,true,JSON.stringify(guarded.out.result));assert.notEqual(await page.getByLabel('본문',{exact:true}).inputValue(),'BYPASS');assert.equal(await page.evaluate(()=>window.submits.length),0);
  check('script clicks are guarded and catching the pause cannot run subsequent writes');
  await page.evaluate(()=>{document.querySelector('#publish').textContent='완료';document.querySelector('#publish').style='position:fixed;left:40px;top:40px;z-index:10';});
  async function pointApproval(){const box=await page.locator('#publish').boundingBox();return worker.evaluate(async ({tabId,x,y})=>{
    await approvalTest.stopBrowserAgent();const id=crypto.randomUUID(),page={tabId};let record;
    const shot=(await approvalTest.runBrowserAgent(id,page,'capture_page',{full_page:false}, {vision:true})).result;
    const out=await approvalTest.runBrowserAgent(id,page,'request_approval',{screenshot_id:shot.screenshot_id,x,y,summary:'선택한 위치의 완료 버튼을 누릅니다.'},{vision:true,onApproval:r=>{record=r;return Promise.resolve({requiresUserInput:true,questionId:'point'});}});
    await approvalTest.stopBrowserAgent();return {out,record};
  },{tabId,x:box.x+box.width/2,y:box.y+box.height/2});}
  let point=await pointApproval();assert.equal(point.out.result.requiresUserInput,true);assert.equal(point.record.label,'완료');assert.equal(await page.evaluate(()=>window.submits.length),0);
  await page.evaluate(()=>{document.querySelector('#publish').style.left='90px';});
  assert.equal((await execute(point.record)).error,'approval_changed');assert.equal(await page.evaluate(()=>window.submits.length),0);
  point=await pointApproval();const pointResult=await execute(point.record);assert.equal(pointResult.ok,true,JSON.stringify(pointResult));assert.equal(await page.evaluate(()=>window.submits.length),1);
  check('visual-only final actions can request explicit screenshot-point approval; moved targets are rejected and unchanged targets execute once');
  assert.deepEqual(errors,[]);await writeFile('verification/approval-browser.json',JSON.stringify({checks,errors,syntheticModelResponses:true,realBrowserActions:true,actualCompanyPageVerified:false},null,2));
}catch(error){console.error({stage,mode,reason:routeFailure?.message,errors,last:await state().then(s=>s.chat.messages.at(-1)).catch(()=>null)});throw error;}
finally{await context?.close();await rm(profile,{recursive:true,force:true});}

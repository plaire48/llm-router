import {build,stop as stopBuildService} from 'esbuild';
import {assertDesktopDialog,desktopDialogScale} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/modal-review');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser,p;const checks=[],errors=[];
const origin='http://127.0.0.1:'+server.address().port;
// The conversation list lives in the sidebar; its search button opens the '대화 검색' dialog (2026-10-02).
async function openSidebar(){const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();}
async function history(){await openSidebar();await p.getByRole('button',{name:'대화 검색',exact:true}).click();}
// In the compact layout the sidebar is an overlay the user opened; closing a dialog returns to it, so the check closes it before using the composer.
async function closeSidebar(){const closer=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await closer.count()&&await p.locator('.nubi-sidebar[data-open="true"]').count())await closer.click();}
async function selectTask(){await history();await p.getByRole('dialog',{name:'대화 검색'}).locator('.nubi-history-item').filter({hasText:'문맥 사용량 화면 검증'}).click();}
async function inspect(name,file,large){
 const dialog=p.getByRole(name==='대화를 삭제할까요?'?'alertdialog':'dialog',{name,exact:true});
 await assertDesktopDialog(dialog,{large});
 const facts=await dialog.evaluate(root=>{const r=root.getBoundingClientRect();return {bounds:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,inset:[...root.querySelectorAll(':scope > .cx-panel-header,:scope > .cx-panel-body,:scope > .cx-panel-footer')].map(e=>getComputedStyle(e).paddingLeft),fields:[...root.querySelectorAll('input,select,textarea')].filter(e=>e.checkVisibility()&&e.type!=='checkbox').map(e=>({name:e.labels?.length||e.getAttribute('aria-label'),size:getComputedStyle(e).fontSize})),smallText:[...root.querySelectorAll('p,label')].filter(e=>e.checkVisibility()&&e.textContent.trim()).map(e=>getComputedStyle(e).fontSize)};});
 assert(facts.bounds,name+' stays inside the viewport');assert(new Set(facts.inset).size===1,name+' aligns title, body and footer');assert(facts.fields.every(e=>e.name&&e.size===desktopDialogScale(large).size),name+' uses labelled, readable inputs');assert(facts.smallText.every(size=>parseFloat(size)>=(large?16:14)),name+' keeps secondary copy at or above the caption scale');
 for(let i=0;i<18;i++){await p.keyboard.press(i<14?'Tab':'Shift+Tab');assert(await dialog.evaluate(root=>root.contains(document.activeElement)),name+' traps keyboard focus at '+i+' '+JSON.stringify(await p.evaluate(()=>({active:document.activeElement?.tagName,inert:[...document.querySelectorAll('[inert]')].map(e=>e.className),controls:[...document.querySelectorAll('.deck-dialog button,.deck-dialog input,.deck-dialog summary')].map(e=>({tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent.slice(0,25),disabled:e.disabled,visible:e.checkVisibility(),tab:e.tabIndex,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))}))));}
 await dialog.locator('.cx-panel-header h2').focus();await p.screenshot({path:path.join(dir,file+'.png'),animations:'disabled'});checks.push(`${name}: ${large?'large':'normal'} text, ${p.viewportSize().width}px, aligned spacing, named controls, focus and bounds`);
 return dialog;
}
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:950}});p.on('pageerror',e=>errors.push(e.message));
 // The integrated layout is the Electron Workspace: rail navigation with the settings button, the conversation sidebar with its search, the mail page and the composer's skill menu (the fixture passes workspaceView, which the navigation needs). The large-text toggle left the Workbench (2026-10-02).
 for(const variant of [{width:1280},{width:440}]){
  await p.setViewportSize({width:variant.width,height:950});await p.goto(origin+'/?context&modals&integrated');
  await selectTask();
  const suffix=`${variant.width}`;
  await p.getByRole('button',{name:'설정',exact:true}).click();await inspect('설정','settings-'+suffix);await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='설정');
  await p.getByRole('button',{name:'위키',exact:true}).click();await inspect('프로젝트 자료','library-'+suffix);
  // The mail page replaced the mail dialog (2026-10-02): its '메일 연결' opens the account dialog, and Escape returns focus to that control.
  await p.getByRole('button',{name:'사내 메일',exact:true}).click();await p.getByRole('button',{name:'메일 연결',exact:true}).click();await p.getByLabel('아이디',{exact:true}).waitFor();await inspect('메일 설정','mail-'+suffix);await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.classList.contains('nubi-mail-connect-link'));
  await selectTask();
  await p.getByRole('button',{name:'스킬 관리',exact:true}).click();await p.getByRole('dialog',{name:'스킬 목록',exact:true}).getByRole('button',{name:/^내 스킬/}).click();await p.getByText('보고서 작성',{exact:true}).waitFor();const skillDialog=await inspect('스킬 관리','skills-'+suffix);
  const skillControls=await skillDialog.locator('.nubi-skill-tabs button').evaluateAll(items=>items.filter(e=>e.checkVisibility()).map(e=>{const r=e.getBoundingClientRect();return {center:r.y+r.height/2,left:r.x,right:r.right};}));
  assert(skillControls.every(r=>Math.abs(r.center-skillControls[0].center)<2),'skill tabs and actions stay on one row');
  assert.equal(await skillDialog.getByText('휴지통 0',{exact:true}).count(),0);

  // The AI Workspace tab (2026-10-07): the company catalog with install, update, info and instruction controls inside the same dialog.
  {const dialog=p.getByRole('dialog',{name:'스킬 관리',exact:true});await dialog.getByRole('tab',{name:'Team',exact:true}).click();const card=name=>dialog.locator('.nubi-marketplace-card').filter({has:p.locator('strong',{hasText:name})});await card('보고서 검토').getByRole('button',{name:'보고서 검토 다운로드',exact:true}).waitFor();await card('간단 덧셈').getByRole('button',{name:'간단 덧셈 업데이트',exact:true}).waitFor();assert.equal(await card('간단 덧셈').getByRole('button',{name:'간단 덧셈 업데이트',exact:true}).getAttribute('title'),'v1.0.0 → v1.2.0');await card('간단 덧셈').locator('.nubi-actions-disclosure>summary').click();await card('간단 덧셈').getByRole('button',{name:'간단 덧셈 지침 열기',exact:true}).waitFor();await card('간단 덧셈').locator('.nubi-actions-disclosure>summary').click();await card('보고서 검토').locator('.nubi-actions-disclosure>summary').click();await card('보고서 검토').getByRole('button',{name:'보고서 검토 정보',exact:true}).click();await card('보고서 검토').locator('.nubi-skill-expanded').waitFor();assert.equal(await dialog.getByRole('button',{name:'마켓플레이스 새로고침',exact:true}).count(),1);await inspect('스킬 관리','marketplace-'+suffix);await card('보고서 검토').locator('.nubi-actions-disclosure>summary').click();await card('보고서 검토').getByRole('button',{name:'보고서 검토 정보',exact:true}).focus();const utilityHint=p.getByRole('tooltip');if(await utilityHint.count()){await p.keyboard.press('Escape');await utilityHint.waitFor({state:'hidden'});}await p.keyboard.press('Escape');assert.equal(await card('보고서 검토').locator('.nubi-actions-disclosure').getAttribute('open'),null,'Escape collapses the focused management group');}await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'스킬 관리',exact:true}).waitFor({state:'hidden'});
  // The company account dialog from the rail (2026-10-07): a guest sees the SSO button, login shows the device code, cancel returns to the guest view.
  {await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='스킬 관리');/* the skills dialog has handed focus back before the rail is used */await p.getByRole('button',{name:'로그인',exact:true}).click();const dialog=p.getByRole('dialog',{name:'로그인',exact:true});await dialog.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).waitFor();await inspect('로그인','account-'+suffix);await dialog.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).click();await dialog.getByText('NUBI-1234',{exact:true}).waitFor();await dialog.getByRole('button',{name:'로그인 코드 복사',exact:true}).waitFor();await dialog.getByRole('button',{name:'로그인 취소',exact:true}).click();await dialog.waitFor({state:'hidden'});/* cancelling a company login closes the dialog and returns to where the user was (cancelCompanyConnection) */await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='로그인');}
  await history();await inspect('대화 검색','history-'+suffix);await p.keyboard.press('Escape');await closeSidebar();
  await p.getByRole('button',{name:'컨텍스트 사용량',exact:true}).click();await inspect('컨텍스트 사용량','context-'+suffix);await p.keyboard.press('Escape');
  await p.getByRole('button',{name:'모델 변경',exact:true}).click();await inspect('모델 선택','models-'+suffix);
  await p.getByRole('tab',{name:'FabriX',exact:true}).click();await p.getByRole('button',{name:'연결',exact:true}).click();await inspect('FabriX 연결','fabrix-'+suffix);await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'모델 선택'}).waitFor();await p.keyboard.press('Escape');
  // Reload before checking the approval menu and destructive confirmation with the connected fixture provider.
  await p.goto(origin+'/?context&modals&integrated');await selectTask();
  await p.getByRole('button',{name:/매번 확인/}).click();const menu=p.getByRole('menu',{name:'승인 방식'});assert(await menu.locator('small').evaluateAll(es=>es.every(e=>parseFloat(getComputedStyle(e).fontSize)>=(document.querySelector('.nubi-workbench').dataset.largeText==='true'?16:14))));assert(await menu.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'approval menu stays fully inside the viewport');await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-checked')==='true');await p.keyboard.press('ArrowDown');assert.equal(await menu.getByRole('menuitemradio',{name:/파일 자동 반영/}).evaluate(e=>e===document.activeElement),true);await p.screenshot({path:path.join(dir,'approval-'+suffix+'.png')});await p.keyboard.press('Escape');assert(await p.getByRole('button',{name:/매번 확인/}).evaluate(e=>e===document.activeElement));
  await openSidebar();await p.locator('.nubi-session-row').filter({hasText:'문맥 사용량 화면 검증'}).locator('.nubi-actions-disclosure>summary').click();await p.getByRole('button',{name:'문맥 사용량 화면 검증 삭제',exact:true}).click();await inspect('대화를 삭제할까요?','delete-'+suffix);assert.match(await p.getByRole('alertdialog').innerText(),/프로젝트에 반영한 파일은 그대로/);await p.keyboard.press('Escape');assert.equal(await p.getByRole('button',{name:'문맥 사용량 화면 검증 삭제',exact:true}).count(),0);assert.equal(await p.locator('.nubi-session-row').filter({hasText:'문맥 사용량 화면 검증'}).count(),1);
  checks.push('nested navigation restores the invoking screen and control; FabriX returns to model selection; Escape cancels deletion');
 }
 // A changing fetchedAt previously triggered an endless refresh and locked the Workbench.
 await p.goto(origin+'/?context&modals&integrated&catalog');await closeSidebar();
 await p.getByRole('button',{name:'모델 변경',exact:true}).click();
 const catalogDialog=p.getByRole('dialog',{name:'모델 선택',exact:true});await catalogDialog.waitFor();
 await p.waitForTimeout(500);assert.equal(await p.evaluate(()=>window.catalogCalls),0,'opening a connected catalog reuses the loaded models');
 await p.evaluate(()=>{window.catalogDelay=1500;});
 await catalogDialog.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();
 assert(await catalogDialog.getByRole('button',{name:'Second fixture',exact:true}).isEnabled(),'cached choices remain interactive during refresh');
 await catalogDialog.getByRole('textbox',{name:'모델 검색'}).fill('Second');
 await catalogDialog.getByRole('button',{name:'Second fixture',exact:true}).click();await catalogDialog.waitFor({state:'hidden'});
 await p.waitForTimeout(1800);assert.equal(await p.evaluate(()=>window.catalogCalls),1,'catalog update does not retrigger itself');
 await p.getByRole('button',{name:'모델 변경',exact:true}).click();
 assert.equal(await catalogDialog.getByRole('button',{name:'Second fixture',exact:true}).getAttribute('aria-pressed'),'true','late refresh preserves the selected model');
 await p.evaluate(()=>{window.catalogDelay=50;window.catalogFailure=true;});
 await catalogDialog.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();
 await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>window.catalogCalls),2,'failed refresh stops until explicitly retried');
 assert(await catalogDialog.getByRole('button',{name:'Second fixture',exact:true}).isEnabled(),'failed refresh preserves cached choices');
 await p.evaluate(()=>{window.catalogFailure=false;});
 await catalogDialog.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();await p.waitForTimeout(300);
 assert.equal(await p.evaluate(()=>window.catalogCalls),3,'manual retry recovers');
 await p.screenshot({path:path.join(dir,'model-catalog-recovered.png'),animations:'disabled'});
 await p.keyboard.press('Escape');checks.push('catalog cache, nonblocking refresh, no repeated success/failure fetches, selected model preserved and explicit retry');
 for(const width of [1280,440]){
  await p.setViewportSize({width,height:800});await p.goto(origin+'/?context&modals&integrated&wiki-progress');
  const wiki=p.getByRole('dialog',{name:'위키 준비',exact:true});await wiki.waitFor();
  assert.equal(await wiki.getByRole('progressbar').getAttribute('aria-valuenow'),'30');
  assert.match(await wiki.innerText(),/현재 단계 약/);assert.match(await wiki.innerText(),/진행 (?:[1-9]\d*분(?: [1-9]\d*초)?|[1-9]\d*초)/);
  assert(await wiki.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'wiki progress fits the modal');
  await p.screenshot({path:path.join(dir,`wiki-progress-${width}.png`),animations:'disabled'});
  await wiki.getByRole('button',{name:'백그라운드로',exact:true}).click();await wiki.waitFor({state:'hidden'});
  await p.waitForTimeout(300);assert.equal(await wiki.count(),0,'background progress does not reopen its modal');
 }
 checks.push('wiki progress uses actual stage percentage, elapsed and stage-only ETA; modal can stay in background');
 await p.goto(origin+'/?context&modals&integrated&catalog');await closeSidebar();
 await p.getByRole('button',{name:'모델 변경',exact:true}).click();await p.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor();
 await p.evaluate(()=>window.setWikiFixture({id:'delayed-wiki',state:'running',stage:'scanning',startedAt:new Date().toISOString(),percent:null}));
 assert.equal(await p.getByRole('dialog',{name:'위키 준비',exact:true}).count(),0,'progress waits until the current modal closes');
 await p.keyboard.press('Escape');const immediateWiki=p.getByRole('dialog',{name:'위키 준비',exact:true});await immediateWiki.waitFor({timeout:2000});
 assert.match(await immediateWiki.innerText(),/파일 목록 확인/);assert(!await immediateWiki.innerText().then(text=>text.includes('남은 시간 계산 중')));
 await p.evaluate(()=>window.setWikiFixture({id:'delayed-wiki',state:'attention',stage:'snapshot_git',error:'wiki_snapshot_failed',startedAt:new Date(Date.now()-5000).toISOString(),finishedAt:new Date().toISOString()}));
 await immediateWiki.getByText(/분석용 Git 준비에 실패/).waitFor();await immediateWiki.getByText('오류 상세',{exact:true}).click();await immediateWiki.getByText('wiki_snapshot_failed',{exact:true}).waitFor();
 await p.screenshot({path:path.join(dir,'wiki-failure-detail.png'),animations:'disabled'});await p.keyboard.press('Escape');await p.waitForTimeout(250);assert.equal(await immediateWiki.count(),0);
 checks.push('Wiki opens after model picker closes, shows scanning immediately and retains staged failure details without reopening');

 await p.goto(origin+'/?context&modals&integrated&catalog');await closeSidebar();
 await selectTask();await closeSidebar();await p.evaluate(()=>{window.slowStart=true;});await p.getByRole('textbox',{name:'추가 요청',exact:true}).fill('느린 시작 검사');
 await p.getByRole('button',{name:'전송',exact:true}).click();await p.getByRole('button',{name:'요청 접수 중',exact:true}).waitFor();
 await p.getByRole('button',{name:'설정',exact:true}).click();await p.getByRole('dialog',{name:'설정',exact:true}).waitFor();
 await p.keyboard.press('Escape');await p.waitForTimeout(1800);checks.push('slow agent start leaves navigation usable and shows immediate pending feedback');
 await p.goto(origin+'/?context&modals&integrated&catalog');await selectTask();await closeSidebar();
 await p.evaluate(()=>{window.commandReviewRace=true;});
 const followup=p.getByRole('textbox',{name:'추가 요청',exact:true});await followup.fill('방금 실행한 결과를 설명해 주세요.');await followup.press('Enter');
 await p.getByRole('list',{name:'대기 메시지'}).getByText('방금 실행한 결과를 설명해 주세요.',{exact:true}).waitFor();
 assert.equal(await followup.inputValue(),'');assert.equal(await p.evaluate(()=>window.commandReviewAdmissions),1);
 assert.equal(await p.getByText('AI가 다른 작업을 확인하고 있어요. 입력한 내용은 보관했어요.',{exact:true}).count(),0);
 await p.screenshot({path:path.join(dir,'command-followup-queue.png'),animations:'disabled'});
 checks.push('Send racing automatic command review refreshes state and queues the exact message once without a busy error');
 // Company sign-in must be discoverable in the titlebar, including before a project/model is connected.
 for(const variant of [{width:1280,height:720},{width:800,height:600},{width:440,height:500},{width:440,height:500,noProject:true},{width:1280,height:720,connected:true},{width:440,height:600,connected:true}]){
  await p.setViewportSize({width:variant.width,height:variant.height});
  await p.goto(origin+'/?context&modals&integrated&toolbar'+(variant.noProject?'&noproject':'')+(variant.connected?'&company-connected':''));
  const account=p.locator('.nubi-toolbar-account button');await account.waitFor();
  assert.equal(await p.locator('.nubi-account-button').count(),1,'one account controller, without duplicate polling or dialogs');
  assert.equal(await account.locator(':scope > span:not(.nubi-account-avatar)').innerText(),variant.connected?'긴 이름의 회사 계정 화면 검토 사용자':'로그인');
  assert.equal(await account.locator('.nubi-account-avatar').isVisible(),true,'avatar remains visible at every toolbar width');
  assert(await account.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'company account is visible without scrolling');
  assert.deepEqual(await p.locator('.nubi-window-toolbar button').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.bottom>document.querySelector('.desktop-titlebar').getBoundingClientRect().bottom+1;}).map(e=>e.textContent.trim())),[],'toolbar actions stay inside the titlebar');
  await p.screenshot({path:path.join(dir,`company-menu-${variant.width}${variant.noProject?'-start':''}${variant.connected?'-connected':''}.png`),animations:'disabled'});
  await account.click();const dialog=p.locator('.nubi-ghes-modal');await dialog.waitFor();
  if(variant.connected){await dialog.locator('.nubi-account-heading strong').filter({hasText:'긴 이름의 회사 계정 화면 검토 사용자'}).waitFor();await dialog.getByText('기본 정보',{exact:true}).waitFor();assert.equal(await dialog.getByText('회사 저장소 열기',{exact:true}).count(),0);assert.equal(await dialog.locator('.nubi-account-avatar img').evaluate(img=>img.complete&&img.naturalWidth>0),true);}
  else{assert.doesNotMatch(await dialog.innerText(),/code\.sdsdev\.co\.kr/,'company connection keeps its host out of the visible copy');await dialog.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).waitFor();}
  await p.screenshot({path:path.join(dir,`company-login-${variant.width}${variant.noProject?'-start':''}${variant.connected?'-connected':''}.png`),animations:'disabled'});
  await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await account.evaluate(e=>e===document.activeElement),'Escape returns to the titlebar account button');
  checks.push(`company titlebar entry and login dialog: ${variant.width}x${variant.height}, ${variant.connected?'connected':variant.noProject?'no project':'guest'}`);
 }
 await p.setViewportSize({width:440,height:700});await p.goto(origin+'/?context&modals&integrated&toolbar&company-login-error');
 await p.locator('.nubi-toolbar-account button').click();
 const loginError=p.getByRole('dialog',{name:'로그인',exact:true});await loginError.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).click();
 await loginError.getByText('로그인 코드 발급 / HTTP 404',{exact:true}).waitFor();
 assert.match(await loginError.innerText(),/회사 로그인 경로를 찾지 못했어요/);assert.doesNotMatch(await loginError.innerText(),/저장소를 읽을 수 없어요|code\.sdsdev\.co\.kr/);
 assert(await loginError.locator('.nubi-account-diagnostic').evaluate(e=>e.scrollWidth<=e.clientWidth),'safe diagnostic stays on one line');
 await p.screenshot({path:path.join(dir,'company-login-error-440.png'),animations:'disabled'});checks.push('login endpoint failure is distinct from repository access and shows a safe, single-line stage/status');

 // The rail opens Nubi's catalog immediately without fetching or embedding the website.
 await p.setViewportSize({width:1280,height:850});await p.goto(origin+'/?context&modals&integrated&catalog&toolbar');await closeSidebar();
 const input=p.getByRole('textbox',{name:/^(작업 요청|추가 요청)$/});await input.waitFor();await input.fill('보존할 대화 초안');
 await p.getByRole('button',{name:'AI Workspace',exact:true}).click();await p.getByRole('heading',{name:'AI Workspace',exact:true}).waitFor();
 const skillSearch=p.getByRole('textbox',{name:'AI Workspace 스킬 검색'});await skillSearch.fill('보고서');await p.getByRole('button',{name:'보고서 검토 다운로드',exact:true}).waitFor();
 assert.equal(await p.locator('iframe').count(),0);assert.equal(await p.evaluate(()=>window.nativeViewCalls?.includes('team-workspace')||false),false);
 await p.evaluate(()=>{window.skillDownloadDelay=900;});await p.getByRole('button',{name:'보고서 검토 다운로드',exact:true}).click();await skillSearch.fill('간단');await p.getByRole('button',{name:'간단 덧셈 업데이트'}).waitFor();await p.waitForTimeout(1100);await skillSearch.fill('보고서');await p.locator('.nubi-marketplace-card').filter({hasText:'보고서 검토'}).getByRole('img',{name:'설치됨',exact:true}).waitFor();
 await skillSearch.fill('');await p.screenshot({path:path.join(dir,'nubi-workspace-skills.png'),animations:'disabled'});
 await p.getByRole('tab',{name:'Personal',exact:true}).click();await p.getByRole('textbox',{name:'내 스킬 검색'}).fill('보고서');await p.locator('.nubi-custom-skill-row').first().waitFor();await p.screenshot({path:path.join(dir,'nubi-my-skills.png'),animations:'disabled'});
 for(const width of [440,800,1280]){await p.setViewportSize({width,height:850});for(const tabName of ['Team','Personal']){await p.getByRole('tab',{name:tabName,exact:true}).click();const tabs=p.locator('.nubi-skill-tabs');assert(await tabs.evaluate(node=>node.scrollWidth<=node.clientWidth),'skill tabs fit at '+width);assert(await tabs.getByRole('tab').evaluateAll(items=>items.every(tab=>{const r=tab.getBoundingClientRect();return r.height>=40&&r.width>=44;})),'skill tab targets');}await p.screenshot({path:path.join(dir,'nubi-my-skills-'+width+'.png'),animations:'disabled'});}
 // Pagination searches the full catalog and resets on filtering.
 await p.evaluate(()=>{window.skillFixtureCount=22;});
 for(const entry of [{tab:'Personal',search:'내 스킬 검색',refresh:'목록 새로고침',prefix:'내 스킬',row:'.nubi-custom-skill-row',term:'검토 스킬 22',total:23},{tab:'Team',search:'AI Workspace 스킬 검색',refresh:'마켓플레이스 새로고침',prefix:'AI Workspace 스킬',row:'.nubi-marketplace-card',term:'공유 스킬 22',total:24}]){
   await p.getByRole('tab',{name:entry.tab,exact:true}).click();await p.getByRole('textbox',{name:entry.search}).fill('');await p.getByRole('button',{name:entry.refresh,exact:true}).click();
   const pager=p.getByRole('navigation',{name:entry.prefix+' 페이지 이동'});await pager.getByText('1–10 / '+entry.total,{exact:true}).waitFor();assert.equal(await p.locator(entry.row).count(),10);
   await pager.getByRole('button',{name:entry.prefix+' 다음 페이지',exact:true}).click();await pager.getByText('11–20 / '+entry.total,{exact:true}).waitFor();
   await pager.getByRole('button',{name:entry.prefix+' 다음 페이지',exact:true}).click();await pager.getByText('21–'+entry.total+' / '+entry.total,{exact:true}).waitFor();assert(await pager.getByRole('button',{name:entry.prefix+' 다음 페이지',exact:true}).isDisabled());
   await p.getByRole('textbox',{name:entry.search}).fill(entry.term);await p.locator(entry.row).filter({hasText:entry.term}).waitFor();assert.equal(await pager.count(),0,'one-page results need no pager');assert.equal(await p.locator(entry.row).count(),1);
   await p.getByRole('textbox',{name:entry.search}).fill('');await pager.getByText('1–10 / '+entry.total,{exact:true}).waitFor();
 }
 await p.getByRole('tab',{name:'Personal',exact:true}).click();
 for(const width of [440,1280]){
   await p.setViewportSize({width,height:850});assert.equal(await p.getByRole('button',{name:/휴지통/}).count(),0);
   const register=p.getByRole('button',{name:'등록',exact:true});assert(await register.evaluate(e=>e.getBoundingClientRect().width>=88&&e.querySelector('span').checkVisibility()));
   await p.screenshot({path:path.join(dir,'skills-pagination-'+width+'.png'),animations:'disabled'});
   await p.evaluate(()=>{window.nubi={...window.nubi,platform:'win32'};});await register.click();const registration=p.getByRole('dialog',{name:'스킬 등록',exact:true});await registration.waitFor();
   for(const name of ['파일 선택','폴더 선택']){const button=registration.getByRole('button',{name,exact:true});await button.waitFor();const style=await button.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {bg:s.backgroundColor,fg:s.color,border:s.borderWidth,width:r.width,height:r.height};});assert.notEqual(style.bg,'rgba(0, 0, 0, 0)');assert.notEqual(style.bg,style.fg);assert(style.width>=112&&style.height>=40);assert.notEqual(style.border,'0px');}
   await p.screenshot({path:path.join(dir,'skill-registration-'+width+'.png'),animations:'disabled'});await p.keyboard.press('Escape');await registration.waitFor({state:'hidden'});
 }
 checks.push('skill pagination across full local/company catalogs, filter reset, visible file/folder buttons, no trash toolbar, wide registration at 440/1280px');
 await p.getByRole('button',{name:'대화로 돌아가기'}).click();assert.equal(await input.inputValue(),'보존할 대화 초안');
 await p.mouse.move(1,1);await input.blur();const surface=p.locator('.nubi-composer-surface').first();const calm=await surface.evaluate(el=>getComputedStyle(el).borderColor);await surface.hover();assert.equal(await surface.evaluate(el=>getComputedStyle(el).borderColor),calm);
 await input.focus();const focus=await surface.evaluate(el=>({border:getComputedStyle(el).borderColor,shadow:getComputedStyle(el).boxShadow}));assert.notEqual(focus.border,calm);assert.notEqual(focus.shadow,'none');assert(!focus.border.includes('78, 89, 104'),'focus does not use the dark text token');await p.screenshot({path:path.join(dir,'composer-soft-focus.png'),animations:'disabled'});
 checks.push('Nubi-only skill catalog, search during direct download, installed state, no embedded website, draft preservation and quiet composer hover/focus');
 for(const phase of ['running','paused']){
  await p.setViewportSize({width:1280,height:900});await p.goto(origin+'/?command&command-analysis='+phase+'&modals&integrated');
  await openSidebar();await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색'}).locator('.nubi-history-item').first().click();
  const card=p.getByRole('region',{name:'실행 준비 승인'});await card.getByText(phase==='running'?'결과 확인 중':'결과 확인 중단',{exact:true}).waitFor();
  const output=card.getByRole('button',{name:'실행 결과 보기',exact:true});assert(await output.isEnabled());await output.click();await p.getByText('결과 확인용 출력',{exact:true}).waitFor();
  if(phase==='paused'){await p.getByText('응답 형식 확인 필요',{exact:false}).first().waitFor();assert.equal(await p.getByText('실행 실패',{exact:true}).count(),0);}
  await p.screenshot({path:path.join(dir,'command-analysis-'+phase+'.png'),animations:'disabled'});
  checks.push('command analysis '+phase+': actual state label, readable output during analysis, planning failure distinguished from shell failure');
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'actual Electron Workbench style and layout with synthetic data in Chrome; native pickers and real accounts are separate'},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){await p?.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});await writeFile(path.join(dir,'failure.txt'),error.stack+'\n--- page errors ---\n'+JSON.stringify(errors,null,1)+'\n--- body ---\n'+await p?.locator('body').innerText()+'\n--- aria ---\n'+await p?.locator('body').ariaSnapshot());throw error;}
finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));stopBuildService();}

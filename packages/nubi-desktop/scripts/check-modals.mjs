import {build} from 'esbuild';
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
  {const dialog=p.getByRole('dialog',{name:'스킬 관리',exact:true});await dialog.getByRole('tab',{name:'AI Workspace',exact:true}).click();const card=name=>dialog.locator('.nubi-marketplace-card').filter({has:p.locator('strong',{hasText:name})});await card('보고서 검토').getByRole('button',{name:'설치',exact:true}).waitFor();await card('간단 덧셈').getByRole('button',{name:'1.2.0로 업데이트',exact:true}).waitFor();await card('간단 덧셈').getByText('v1.0.0 → v1.2.0').waitFor();await card('간단 덧셈').locator('.nubi-actions-disclosure>summary').click();await card('간단 덧셈').getByRole('button',{name:'간단 덧셈 지침 열기',exact:true}).waitFor();await card('간단 덧셈').locator('.nubi-actions-disclosure>summary').click();await card('보고서 검토').locator('.nubi-actions-disclosure>summary').click();await card('보고서 검토').getByRole('button',{name:'보고서 검토 정보',exact:true}).click();await card('보고서 검토').locator('.nubi-skill-expanded').waitFor();assert.equal(await dialog.getByRole('button',{name:'마켓플레이스 새로고침',exact:true}).count(),1);await inspect('스킬 관리','marketplace-'+suffix);await card('보고서 검토').locator('.nubi-actions-disclosure>summary').click();await card('보고서 검토').getByRole('button',{name:'보고서 검토 정보',exact:true}).focus();const utilityHint=p.getByRole('tooltip');if(await utilityHint.count()){await p.keyboard.press('Escape');await utilityHint.waitFor({state:'hidden'});}await p.keyboard.press('Escape');assert.equal(await card('보고서 검토').locator('.nubi-actions-disclosure').getAttribute('open'),null,'Escape collapses the focused management group');}await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'스킬 관리',exact:true}).waitFor({state:'hidden'});
  // The company account dialog from the rail (2026-10-07): a guest sees the SSO button, login shows the device code, cancel returns to the guest view.
  {await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='스킬 관리');/* the skills dialog has handed focus back before the rail is used */await p.getByRole('button',{name:'회사 계정 메뉴',exact:true}).click();const dialog=p.getByRole('dialog',{name:'회사 계정',exact:true});await dialog.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).waitFor();await inspect('회사 계정','account-'+suffix);await dialog.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).click();await dialog.getByText('NUBI-1234',{exact:true}).waitFor();await dialog.getByRole('button',{name:'로그인 코드 복사',exact:true}).waitFor();await dialog.getByRole('button',{name:'로그인 취소',exact:true}).click();await dialog.waitFor({state:'hidden'});/* cancelling a company login closes the dialog and returns to where the user was (cancelCompanyConnection) */await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='회사 계정 메뉴');}
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
  assert.match(await wiki.innerText(),/현재 단계 약/);assert.match(await wiki.innerText(),/경과/);
  assert(await wiki.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'wiki progress fits the modal');
  await p.screenshot({path:path.join(dir,`wiki-progress-${width}.png`),animations:'disabled'});
  await wiki.getByRole('button',{name:'백그라운드로',exact:true}).click();await wiki.waitFor({state:'hidden'});
  await p.waitForTimeout(300);assert.equal(await wiki.count(),0,'background progress does not reopen its modal');
 }
 checks.push('wiki progress uses actual stage percentage, elapsed and stage-only ETA; modal can stay in background');
 await p.goto(origin+'/?context&modals&integrated&catalog');await closeSidebar();
 await selectTask();await closeSidebar();await p.evaluate(()=>{window.slowStart=true;});await p.getByRole('textbox',{name:'추가 요청',exact:true}).fill('느린 시작 검사');
 await p.getByRole('button',{name:'전송',exact:true}).click();await p.getByRole('button',{name:'요청 접수 중',exact:true}).waitFor();
 await p.getByRole('button',{name:'설정',exact:true}).click();await p.getByRole('dialog',{name:'설정',exact:true}).waitFor();
 await p.keyboard.press('Escape');await p.waitForTimeout(1800);checks.push('slow agent start leaves navigation usable and shows immediate pending feedback');
 // Company sign-in must be discoverable in the titlebar, including before a project/model is connected.
 for(const variant of [{width:1280,height:720},{width:800,height:600},{width:440,height:500},{width:440,height:500,noProject:true},{width:1280,height:720,connected:true}]){
  await p.setViewportSize({width:variant.width,height:variant.height});
  await p.goto(origin+'/?context&modals&integrated&toolbar'+(variant.noProject?'&noproject':'')+(variant.connected?'&company-connected':''));
  const account=p.locator('.nubi-toolbar-account button');await account.waitFor();
  assert.equal(await p.locator('.nubi-account-button').count(),1,'one account controller, without duplicate polling or dialogs');
  assert.equal(await account.locator('span:not(.nubi-account-avatar)').innerText(),'회사 계정','stable short label keeps long profiles from widening the toolbar');
  assert(await account.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'company account is visible without scrolling');
  assert.deepEqual(await p.locator('.nubi-window-toolbar button').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.bottom>document.querySelector('.desktop-titlebar').getBoundingClientRect().bottom+1;}).map(e=>e.textContent.trim())),[],'toolbar actions stay inside the titlebar');
  await p.screenshot({path:path.join(dir,`company-menu-${variant.width}${variant.noProject?'-start':''}${variant.connected?'-connected':''}.png`),animations:'disabled'});
  await account.click();const dialog=p.getByRole('dialog',{name:'회사 계정',exact:true});await dialog.waitFor();
  if(variant.connected){await dialog.getByRole('heading',{name:'긴 이름의 회사 계정 화면 검토 사용자',exact:true}).waitFor();}
  else{assert.doesNotMatch(await dialog.innerText(),/code\.sdsdev\.co\.kr/,'company connection keeps its host out of the visible copy');await dialog.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).waitFor();}
  await p.screenshot({path:path.join(dir,`company-login-${variant.width}${variant.noProject?'-start':''}${variant.connected?'-connected':''}.png`),animations:'disabled'});
  await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await account.evaluate(e=>e===document.activeElement),'Escape returns to the titlebar account button');
  checks.push(`company titlebar entry and login dialog: ${variant.width}x${variant.height}, ${variant.connected?'connected':variant.noProject?'no project':'guest'}`);
 }
 await p.setViewportSize({width:440,height:700});await p.goto(origin+'/?context&modals&integrated&toolbar&company-login-error');
 await p.locator('.nubi-toolbar-account button').click();
 const loginError=p.getByRole('dialog',{name:'회사 계정',exact:true});await loginError.getByRole('button',{name:'사내 SSO로 로그인',exact:true}).click();
 await loginError.getByText('로그인 코드 발급 / HTTP 404',{exact:true}).waitFor();
 assert.match(await loginError.innerText(),/회사 로그인 경로를 찾지 못했어요/);assert.doesNotMatch(await loginError.innerText(),/저장소를 읽을 수 없어요|code\.sdsdev\.co\.kr/);
 assert(await loginError.locator('.nubi-account-diagnostic').evaluate(e=>e.scrollWidth<=e.clientWidth),'safe diagnostic stays on one line');
 await p.screenshot({path:path.join(dir,'company-login-error-440.png'),animations:'disabled'});checks.push('login endpoint failure is distinct from repository access and shows a safe, single-line stage/status');
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'actual Electron Workbench style and layout with synthetic data in Chrome; native pickers and real accounts are separate'},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){await p?.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});await writeFile(path.join(dir,'failure.txt'),error.stack+'\n--- page errors ---\n'+JSON.stringify(errors,null,1)+'\n--- body ---\n'+await p?.locator('body').innerText()+'\n--- aria ---\n'+await p?.locator('body').ariaSnapshot());throw error;}
finally{await browser?.close();await new Promise(r=>server.close(r));}

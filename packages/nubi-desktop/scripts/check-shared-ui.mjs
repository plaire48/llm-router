import {build,stop as stopBuildService} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/shared-ui');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,p;const errors=[],checks=[];
// Every page opens in the Electron Workspace layout (integrated: rail navigation, sidebar with its toggle, mail page). The fixture passes the workspace view the rail needs.
const page=(query='')=>'http://127.0.0.1:'+server.address().port+'/?'+[query,'integrated'].filter(Boolean).join('&');
// The conversation list lives in the sidebar; its search button opens the '대화 검색' dialog and '새 대화' is a sidebar button (2026-10-02).
// Answer articles are labelled by the answering model ("Qwen fixture 답변"), so answer locators match the suffix.
async function openSidebar(){const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();}
// In the compact layout the open sidebar is an overlay over the content; the check closes it before using the content.
async function closeSidebar(){const closer=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await closer.count()&&await p.locator('.nubi-sidebar[data-open="true"]').count())await closer.click();}
async function openHistory(){await p.locator('.nubi-sidebar').waitFor({state:'attached'});await openSidebar();await p.getByRole('button',{name:'대화 검색',exact:true}).click();}
async function newConversation(){await openSidebar();await p.getByRole('button',{name:'새 대화',exact:true}).click();}
const record=checks.push.bind(checks);checks.push=(...items)=>{console.log(items.join('\n'));return record(...items);};
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:950}});p.on('pageerror',e=>errors.push(e.message));await p.goto(page());
 await p.locator('.aipro-login').getByRole('button',{name:'AI Pro',exact:true}).click();await p.getByRole('textbox',{name:'작업 요청'}).waitFor();assert.equal(await p.locator('.aipro-login').count(),0);checks.push('login state transitions to shared Welcome and composer');
 const requestBox=p.getByRole('textbox',{name:'작업 요청'}),smallHeight=await requestBox.evaluate(e=>e.clientHeight);
 const welcomeTitle=await p.locator('h1.welcome-title').innerText();
 assert(WELCOME_GREETINGS.flatMap(group=>group.lines).some(text=>welcomeTitle.includes(text)),'welcome uses the warm time-of-day greetings');
 assert.equal(await p.getByRole('complementary',{name:'프로젝트 대화'}).count(),1);
 assert.equal(await requestBox.getAttribute('title'),'');
 assert.equal(await p.getByText('완료 조건 추가',{exact:true}).count(),0);
 assert.equal(await requestBox.evaluate(e=>getComputedStyle(e).resize),'none');
 await requestBox.focus();assert.equal(await requestBox.evaluate(e=>getComputedStyle(e).outlineStyle),'none');
 assert.equal(await requestBox.evaluate(e=>getComputedStyle(e.closest('form')).outlineStyle),'none');
 assert.equal(await requestBox.evaluate(e=>getComputedStyle(e.closest('form')).borderTopWidth),'0px');
 await requestBox.fill('한글로 확인할 결과를 설명합니다.\n'.repeat(30));
 assert.equal(await requestBox.evaluate(e=>e.clientHeight>76&&e.clientHeight<=180&&e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY==='auto'),true);
 const longDraft=await requestBox.inputValue();
 const more=p.getByRole('button',{name:'더 보기',exact:true});await more.waitFor();
 assert.equal(await more.locator('xpath=ancestor::*[contains(@class,"composer-tools")]').count(),1);// the expand control sits with the tools, after the model control (2026-10-02)
 assert.equal(await p.locator('.composer .model-picker').count(),1);
 assert.equal(await p.locator('.composer .model-trigger-label').innerText(), 'Qwen fixture');// the composer shows the model only; the provider is in the model dialog (2026-10-02)
 assert.equal(await more.getAttribute('aria-controls'),'message-input');
 await more.click();assert.equal(await p.getByRole('button',{name:'접기',exact:true}).getAttribute('aria-expanded'),'true');
 assert.equal(await requestBox.evaluate(e=>e.clientHeight>180),true);
 assert.equal(await requestBox.inputValue(),longDraft);
 await p.screenshot({path:'verification/ui-composer-expanded.png'});
 await p.getByRole('button',{name:'접기',exact:true}).click();
 assert.equal(await requestBox.evaluate(e=>e.clientHeight<=180),true);
 await requestBox.fill('');assert.equal(await requestBox.evaluate(e=>e.clientHeight),smallHeight);
 assert.equal(await p.getByRole('button',{name:'더 보기',exact:true}).count(),0);
 checks.push('request composer grows, expands and collapses without a resize handle or losing its draft');await p.screenshot({path:'verification/ui-connected-fixture.png'});
 const modelControl=p.getByRole('button',{name:'모델 변경',exact:true});
 await modelControl.click();await p.screenshot({path:'verification/ui-model-selection.png',animations:'disabled'});await p.setViewportSize({width:440,height:900});await assertDesktopDialog(p.getByRole('dialog',{name:'모델 선택'}));assert.equal(await p.getByRole('dialog',{name:'모델 선택'}).getByRole('tab',{name:'AI Pro',exact:true}).locator('.provider-tab-name').isVisible(),true);await p.screenshot({path:'verification/ui-model-selection-narrow.png',animations:'disabled'});await p.setViewportSize({width:1280,height:950});await p.getByRole('textbox',{name:'모델 검색'}).fill('Second');await p.getByRole('button',{name:'Second fixture',exact:true}).click();
 await modelControl.click();assert.equal(await p.getByRole('dialog',{name:'모델 선택'}).getByRole('button',{name:'Second fixture',exact:true}).getAttribute('aria-pressed'),'true');await p.keyboard.press('Escape');
 checks.push('current provider and model stay visible in the composer and open the shared model dialog');
 // Automatic approval (user decision 2026-09-30): the mode sits beside the model, its menu names the three modes and
 // the commands always allowed, and says what always waits for the user.
 const modeButton=p.getByRole('button',{name:/매번 확인/});assert.equal(await modeButton.getAttribute('aria-expanded'),'false');
 await modeButton.click();const modeDialog=p.getByRole('dialog',{name:'승인 방식',exact:true}),modeMenu=modeDialog.getByRole('menu',{name:'승인 방식',exact:true});// the menu sits in a titled dialog with the note and the allowed commands (2026-10-02)
 assert.deepEqual(await modeMenu.getByRole('menuitemradio').evaluateAll(items=>items.map(item=>[item.querySelector('strong').textContent,item.getAttribute('aria-checked')])),[['매번 확인','true'],['파일 자동 반영','false'],['파일과 명령 자동','false']]);
 await modeDialog.getByText('관리자 명령과 앱 조작은 항상 확인해요.',{exact:true}).waitFor();assert.equal(await modeDialog.getByRole('group',{name:'항상 허용한 명령'}).getByText('npm test',{exact:true}).count(),1);
 await p.screenshot({path:'verification/ui-approval-mode.png'});
 await modeMenu.getByRole('menuitemradio',{name:/파일 자동 반영/}).click();await p.getByRole('button',{name:/파일 자동 반영/}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.approvalCalls),['edits']);assert.equal(await p.getByRole('menu',{name:'승인 방식'}).count(),0);
 await p.getByRole('button',{name:/파일 자동 반영/}).click();await p.keyboard.press('Escape');assert.equal(await p.getByRole('menu',{name:'승인 방식'}).count(),0);
 await p.getByRole('button',{name:/파일 자동 반영/}).click();await p.getByRole('menuitemradio',{name:/매번 확인/}).click();
 checks.push('the approval mode is chosen below the input; its menu shows the three modes, the always-allowed commands and what always waits');
 await p.getByRole('textbox',{name:'작업 요청'}).fill('문구를 간결하게 해 주세요.');await p.getByRole('button',{name:'전송',exact:true}).click();await p.getByRole('article',{name:/ 답변$/}).getByText(/합성 응답/).waitFor();await p.getByRole('textbox',{name:'추가 요청'}).fill('기존 조건도 유지해 주세요.');await p.getByRole('button',{name:'전송',exact:true}).click();await p.getByRole('article',{name:'내 메시지'}).getByText('기존 조건도 유지해 주세요.').waitFor();assert.equal(await p.getByRole('navigation',{name:'작업 보기'}).count(),0);assert.equal(await p.getByRole('textbox',{name:'로컬 실행',exact:true}).count(),0);await p.getByRole('region',{name:'작업 계획',exact:true}).waitFor();assert.equal(await p.getByRole('region',{name:'작업 계획',exact:true}).locator('li').count(),2);assert.equal(await p.locator('.nubi-work-plan > details').getAttribute('open'),null);/* Delivered results collapse automatically (user decision 2026-10-12); saved steps remain available. */await p.locator('.nubi-work-plan > details > summary').click();assert.equal(await p.locator('.nubi-work-plan > details').getAttribute('open'),'');assert.equal(await p.locator('.deck-blob').first().evaluate(e=>getComputedStyle(e).animationPlayState),'paused');checks.push('one task surface presents a concise plan and pauses background motion during work');
 assert.equal(await p.getByRole('button',{name:'새 작업',exact:true}).count(),0);assert.equal(await p.locator('.nubi-task-heading').getByText('REQ-fixture',{exact:true}).count(),0);
 await p.getByRole('textbox',{name:'추가 요청'}).fill('이 대화에서만 유지할 초안');
 await newConversation();
 assert.equal(await p.getByRole('textbox',{name:'작업 요청'}).inputValue(),'');await p.getByRole('textbox',{name:'작업 요청'}).fill('다른 요청의 초안');
 await openHistory();await p.getByRole('searchbox',{name:'대화 검색'}).fill('없는 요청');await p.getByText('검색 결과가 없어요',{exact:true}).waitFor();
 await p.getByRole('searchbox',{name:'대화 검색'}).fill('간결');await p.screenshot({path:'verification/ui-conversation-history.png',animations:'disabled'});await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/문구를 간결하게 해 주세요/}).click();
 await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='추가 요청');assert.equal(await p.getByRole('textbox',{name:'추가 요청'}).inputValue(),'이 대화에서만 유지할 초안');await p.getByRole('textbox',{name:'추가 요청'}).fill('');
 checks.push('new-task button and internal ID are absent from the conversation; history search and separate drafts preserve navigation context');
 const emphasis=p.getByRole('article',{name:/ 답변$/}).first().locator('.message-body strong');assert.deepEqual(await emphasis.evaluateAll(es=>es.map(e=>({color:getComputedStyle(e).color,weight:getComputedStyle(e).fontWeight}))),[{color:'rgb(25, 31, 40)',weight:'600'},{color:'rgb(25, 31, 40)',weight:'600'}]);checks.push('reading emphasis uses the common ink and semibold tokens');await p.screenshot({path:'verification/ui-workspace-fixture.png',animations:'disabled'});
 await newConversation();assert.equal(await p.getByRole('textbox',{name:'작업 요청'}).inputValue(),'다른 요청의 초안');await p.getByRole('textbox',{name:'작업 요청'}).fill('');await modelControl.click();await p.getByRole('button',{name:'AI Pro 로그아웃',exact:true}).click();await p.keyboard.press('Escape');await p.locator('.aipro-login').waitFor();checks.push('logout returns to Nubi login');
 await p.getByRole('button',{name:'FabriX',exact:true}).click();await p.getByRole('dialog',{name:'FabriX 연결'}).waitFor();await p.getByLabel('Endpoint').fill('https://fixture.example/openapi');await p.getByLabel('x-fabrix-client').fill('fixture');await p.getByLabel('x-openapi-token').fill('fixture');await p.getByRole('button',{name:'연결 테스트',exact:true}).click();await p.getByText('테스트 통과',{exact:true}).waitFor();await p.getByRole('button',{name:'연결',exact:true}).click();await p.getByRole('textbox',{name:'작업 요청'}).waitFor();checks.push('same FabriX test-then-connect dialog uses desktop permission adapter');assert.deepEqual(errors,[]);
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/문구를 간결하게 해 주세요/}).click();await p.getByRole('article',{name:/ 답변$/}).getByText('연결 후 대기 중인 오류 분석을 확인한 합성 결과입니다.',{exact:true}).waitFor();checks.push('provider reconnection refreshes queued recovery work and its finished result');assert.deepEqual(errors,[]);

 if(DESKTOP_FEATURES.computerUse){// the app connection dialog needs the computer-use feature (off since 2026-10-05)
 await p.getByRole('button',{name:'앱 연결',exact:true}).click();await p.getByText('동작 표시 예시',{exact:true}).click();const preview=p.getByRole('figure',{name:'커서 표시 예시'});await preview.waitFor();await preview.getByText('표시 예시입니다. 실제 앱을 조작하지 않습니다.',{exact:true}).waitFor();
 const example=p.getByRole('group',{name:'동작 예시 선택'});await example.getByRole('button',{name:'마우스 올리기',exact:true}).click();assert.equal(await preview.locator('.is-hover').count(),1);await example.getByRole('button',{name:'입력',exact:true}).click();assert.equal(await preview.locator('.is-set_value').count(),1);await example.getByRole('button',{name:'클릭',exact:true}).click();assert.equal(await preview.locator('.is-click').count(),1);checks.push('cursor preview distinguishes click, hover and input without issuing actions');
 const arrowStyle=await preview.locator('.nubi-action-pointer svg path').evaluate(e=>({fill:getComputedStyle(e).fill,stroke:getComputedStyle(e).stroke}));assert.equal(arrowStyle.fill,'rgb(23, 23, 23)');assert.equal(arrowStyle.stroke,'rgb(255, 255, 255)');await preview.screenshot({path:'verification/ui-visual-pointer-shape.png'});
 await assertDesktopDialog(p.getByRole('dialog',{name:'앱 연결',exact:true}));
 assert.doesNotMatch(await p.getByRole('dialog',{name:'앱 연결',exact:true}).innerText(),/REQ-fixture|직접 확인할 때 사용하는 도구입니다/);
 const replay=preview.getByRole('button',{name:'다시 보기',exact:true});assert.equal(await replay.getAttribute('data-icon-only'),'true');assert.equal(await replay.locator('.visually-hidden').evaluate(e=>e.getBoundingClientRect().width<=1&&e.getBoundingClientRect().height<=1),true);assert.equal(await replay.getAttribute('title'),'다시 보기');await replay.focus();await replay.press('Enter');
 checks.push('task tools and nested cursor preview use shared typography; replay is a named keyboard-operable icon');
 await preview.getByRole('button',{name:'커서 모션'}).click();assert.equal(await preview.locator('.nubi-action-pointer').evaluate(e=>getComputedStyle(e).animationName),'none');await preview.getByRole('button',{name:'커서 모션'}).click();await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await preview.locator('.nubi-action-halo').evaluate(e=>getComputedStyle(e).animationName),'none');assert.equal(await preview.locator('.nubi-action-pointer').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');checks.push('cursor motion respects explicit toggle and reduced-motion preference');await p.emulateMedia({reducedMotion:'no-preference'});
 await p.keyboard.press('Escape');const body=p.getByRole('article',{name:'내 메시지'}).first().locator('.message-body');assert.equal(await body.evaluate(e=>getComputedStyle(e).fontSize),'15px');await p.getByRole('button',{name:'큰 글자',exact:true}).click();assert.equal(await body.evaluate(e=>getComputedStyle(e).fontSize),'17px');assert.equal(await body.evaluate(e=>getComputedStyle(e).fontWeight),'400');assert.equal(await p.evaluate(()=>localStorage.getItem('nubi-workspace-large-text')),'true');checks.push('desktop body has stable 15px/17px reading scale and persists text preference');
 await p.setViewportSize({width:440,height:900});assert.equal(await p.locator('.nubi-workbench').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await p.screenshot({path:'verification/ui-cursor-typography-narrow.png'});await p.setViewportSize({width:1280,height:950});await p.screenshot({path:'verification/ui-cursor-typography.png'});checks.push('cursor preview and large Korean text fit narrow layout');
 await p.getByRole('button',{name:'앱 연결',exact:true}).click();await p.setViewportSize({width:440,height:950});
 await assertDesktopDialog(p.getByRole('dialog',{name:'앱 연결',exact:true}),{large:true});
 assert.equal(await p.getByRole('dialog').getByRole('textbox',{name:'로컬 실행',exact:true}).count(),0);
 assert.equal(await p.getByRole('dialog').getByRole('textbox',{name:'변경 전',exact:true}).count(),0);
 await p.screenshot({path:'verification/ui-identity-tools-large.png',animations:'disabled'});await p.keyboard.press('Escape');
 assert.equal(await p.getByRole('dialog').count(),0);await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='앱 연결');
 await p.setViewportSize({width:1280,height:950});checks.push('large text reaches modal labels and fields at narrow width; Escape restores the opener focus');
 }else checks.push('app connection dialog steps skipped: computerUse feature off');
 // the large-text toggle left the Workbench (2026-10-02); large text is verified through the host setting in check-modals.

 if(DESKTOP_FEATURES.computerUse){// app connection flows need the computer-use feature (off since 2026-10-05)
 await p.goto(page('connection=1'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/메신저 창의 안내문/}).click();
 const connection=p.getByRole('region',{name:'확인할 앱 연결',exact:true});await connection.waitFor();
 assert.deepEqual(await p.evaluate(()=>window.connectionCalls),[]);
 assert.equal(await p.getByRole('textbox',{name:'추가 요청'}).count(),0);
 assert.equal(await connection.getByRole('textbox',{name:'실행 파일 (.exe)'}).count(),0);
 await connection.getByRole('textbox',{name:'직접 답변',exact:true}).waitFor();
 assert.equal(await p.getByRole('button',{name:'작업 도구',exact:true}).count(),0);
 await p.setViewportSize({width:440,height:950});await p.screenshot({path:'verification/ui-simple-connection-question.png',animations:'disabled'});await p.setViewportSize({width:1280,height:950});
 await p.evaluate(()=>window.connectionFail=true);await connection.getByRole('button',{name:'열린 앱 선택',exact:true}).click();
 await connection.getByText('열린 창을 찾지 못했어요. 앱이 열려 있는지 확인하고 다시 찾아 주세요.',{exact:true}).waitFor();
 assert.equal(await connection.getByText('답변을 보내지 못했습니다. 다시 시도해주세요.',{exact:true}).count(),0);
 await p.evaluate(()=>{window.connectionFail=false;window.connectionCalls=[];});
 checks.push('app discovery failure explains the actual failed step and recovery rather than reporting a failed answer');
 await connection.getByRole('textbox',{name:'직접 답변',exact:true}).fill('안내문만 확인해 주세요');
 await connection.getByRole('button',{name:'열린 앱 선택',exact:true}).click();await connection.getByText('어느 창에 연결할까요?',{exact:true}).waitFor();
 await connection.getByRole('button',{name:'다른 방법으로 선택',exact:true}).click();await connection.getByRole('button',{name:/앱 파일 선택/}).waitFor();
 assert.equal(await connection.getByRole('textbox',{name:'직접 답변',exact:true}).inputValue(),'안내문만 확인해 주세요');
 assert.deepEqual(await p.evaluate(()=>window.connectionCalls.map(c=>c.method)),['save_connection_draft','windows']);
 await p.evaluate(()=>window.connectionCalls=[]);await connection.getByRole('textbox',{name:'직접 답변',exact:true}).fill('');await p.evaluate(()=>window.connectionCalls=[]);
 checks.push('app selection names the current step and returns to other methods without binding or discarding the draft');
 await connection.getByRole('button',{name:'열린 앱 선택',exact:true}).click();await connection.getByRole('button',{name:/업무 메신저 Messenger/}).click();await connection.getByRole('button',{name:/연결한 앱으로 이어가기/}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.connectionCalls.map(c=>c.method)),['windows','bind']);
 await connection.getByRole('button',{name:'다른 앱 선택',exact:true}).click();await connection.getByRole('button',{name:/업무 메신저 Messenger/}).click();await connection.getByRole('button',{name:/연결한 앱으로 이어가기/}).waitFor();
 await p.setViewportSize({width:440,height:950});assert.equal(await p.locator('.nubi-workbench').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await p.screenshot({path:'verification/ui-contextual-connection.png',animations:'disabled'});
 await connection.getByRole('button',{name:/연결한 앱으로 이어가기/}).click();await p.getByText('연결한 창에서 같은 작업을 이어가는 합성 응답입니다.',{exact:true}).waitFor();assert.equal(await connection.count(),0);
 assert.equal(await p.getByRole('textbox',{name:'추가 요청'}).isDisabled(),false);
 checks.push('agent connection request appears inline; binding is explicit and does not resume or approve native actions');

 await p.reload();await openSidebar();await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/메신저 창의 안내문/}).click();await connection.getByRole('button',{name:'연결 취소',exact:true}).click();
 assert.deepEqual(await p.evaluate(()=>window.connectionCalls.map(c=>c.method)),['cancel_connection']);assert.equal(await connection.count(),0);assert.equal(await p.getByRole('textbox',{name:'추가 요청'}).isDisabled(),false);
 checks.push('connection cancellation returns to the same conversation without selecting or starting an app');await p.setViewportSize({width:1280,height:950});
 await p.reload();await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/메신저 창의 안내문/}).click();
 await connection.getByRole('textbox',{name:'직접 답변',exact:true}).fill('앱 대신 문서를 먼저 확인해 주세요.');
 await connection.getByRole('button',{name:'답변 보내기',exact:true}).click();await p.getByRole('article',{name:'내 메시지'}).getByText('앱 대신 문서를 먼저 확인해 주세요.',{exact:true}).waitFor();
 assert.equal(await connection.count(),0);assert.equal(await p.evaluate(()=>window.connectionCalls.some(c=>['bind','windows','continue_connection'].includes(c.method))),false);
 checks.push('same compact choice form accepts free text below options; a typed answer never binds or operates an app');
 }else checks.push('app connection request flows skipped: computerUse feature off');


 if(DESKTOP_FEATURES.computerUse){// app launch, UIA controls and mouse scenarios need the computer-use feature (off since 2026-10-05)
 await p.goto(page('computer=1'));
 await p.getByText('컴퓨터로 확인',{exact:true}).click();await p.getByText('프로그램 실행',{exact:true}).click();
 await p.getByRole('button',{name:'앱 파일 선택',exact:true}).click();assert.equal(await p.getByRole('button',{name:'실행 준비',exact:true}).count(),0);
 await p.getByLabel('실행 파일 (.exe)',{exact:true}).fill('C:\\Program Files\\한국어 업무 시스템\\app.exe');await p.getByRole('button',{name:'앱 등록',exact:true}).click();assert.equal(await p.getByLabel('실행 횟수').textContent(),'0');
 await p.getByRole('button',{name:'실행 준비',exact:true}).click();await p.getByRole('region',{name:'프로그램 실행 승인'}).waitFor();assert.equal(await p.getByLabel('실행 횟수').textContent(),'0');
 await p.getByRole('button',{name:'실행',exact:true}).click();await p.getByRole('button',{name:'실행한 앱 연결',exact:true}).waitFor();assert.equal(await p.getByLabel('실행 횟수').textContent(),'1');
 await p.getByRole('button',{name:'열린 창 다시 확인',exact:true}).click();assert.equal(await p.getByLabel('실행 횟수').textContent(),'1');await p.getByRole('button',{name:'실행한 앱 연결',exact:true}).click();await p.getByText('컴퓨터 연결: 합성 앱',{exact:true}).waitFor();
 checks.push('app registration and picker cancellation are inert; approval, receipt lookup and explicit window connection remain distinct');
 await p.getByRole('button',{name:'이어가기',exact:true}).click();await p.getByText('분석 결과는 대화에서 확인하세요. 다음 동작은 별도로 승인합니다.',{exact:true}).waitFor();assert.equal(await p.getByLabel('실행 횟수').textContent(),'1');checks.push('result analysis continuation does not launch or approve another native operation');
 await p.getByLabel('실행 파일 (.exe)',{exact:true}).fill('C:\\Apps\\unknown.exe');await p.getByRole('button',{name:'앱 등록',exact:true}).click();await p.getByRole('button',{name:'실행 준비',exact:true}).last().click();await p.getByRole('button',{name:'실행',exact:true}).click();
 const uncertain=p.getByRole('region',{name:'프로그램 실행 승인'}).filter({hasText:'unknown.exe'});await uncertain.getByText('확인 필요',{exact:true}).waitFor();await uncertain.getByText(/실행 결과를 확인해야 합니다/).waitFor();await uncertain.getByRole('button',{name:'열린 창 다시 확인',exact:true}).click();assert.equal(await p.getByLabel('실행 횟수').textContent(),'2');await uncertain.getByRole('button',{name:'실제 결과를 확인했어요',exact:true}).click();await uncertain.getByText('사용자 확인됨',{exact:true}).waitFor();assert.equal(await p.getByLabel('실행 횟수').textContent(),'2');
 checks.push('uncertain app launch stays visible and read-only reconciliation or acknowledgement never repeats launch');

 await p.setViewportSize({width:440,height:950});assert.equal(await p.locator('.nubi-workbench').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await p.screenshot({path:'verification/ui-windows-launch-narrow.png'});
 await p.setViewportSize({width:1280,height:950});await p.screenshot({path:'verification/ui-windows-launch.png'});assert.deepEqual(errors,[]);
 await p.goto(page('controls=1'));
 await p.getByText('이미 요청한 상태여서 다시 조작하지 않았습니다.',{exact:true}).waitFor();
 await p.getByText('OpenWiki-SDS 근거가 바뀌어 실행하지 않았습니다. 최신 근거로 다시 제안해 주세요.',{exact:true}).waitFor();
 await p.getByText('OpenWiki-SDS 근거 1개',{exact:true}).first().click();await p.getByText('openwiki/notification.md:3 참조 버전 일치',{exact:true}).first().waitFor();
 assert.equal(await p.getByRole('button',{name:'실행',exact:true}).count(),0);
 await p.setViewportSize({width:440,height:950});assert.equal(await p.locator('.nubi-workbench').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await p.screenshot({path:'verification/ui-uia-state-evidence.png'});
 checks.push('UIA no-op and stale Wiki remain distinct with reviewable evidence and no execution button');assert.deepEqual(errors,[]);
 await p.setViewportSize({width:1280,height:950});
 const waitingBatch=p.getByRole('region',{name:'컴퓨터 동작 묶음 승인'}).filter({hasText:'요청한 입력 세 가지'});
 await waitingBatch.getByText('묶음 입력 3단계',{exact:true}).waitFor();
 assert.deepEqual(await waitingBatch.locator('.nubi-batch-steps > li > span').allTextContents(),['입력: 메모','체크 켜기: 긴급 처리','누르기: 임시 저장']);
 await waitingBatch.getByText('출장 택시비',{exact:true}).waitFor();
 assert.equal(await waitingBatch.getByRole('button',{name:'모두 실행',exact:true}).count(),1);
 const partialBatch=p.getByRole('region',{name:'컴퓨터 동작 묶음 승인'}).filter({hasText:'두 칸을 입력합니다.'});
 await partialBatch.getByText('2번째 단계에서 대상이 바뀌어 멈췄습니다. 그 단계부터는 실행하지 않았습니다.',{exact:true}).waitFor();
 assert.deepEqual(await partialBatch.locator('.nubi-batch-steps small').allTextContents(),['입력값 일치','실행하지 않음']);
 assert.equal(await partialBatch.getByRole('button',{name:'모두 실행',exact:true}).count(),0);
 await p.setViewportSize({width:440,height:950});assert.equal(await p.locator('.nubi-workbench').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await waitingBatch.screenshot({path:'verification/ui-computer-batch.png'});
 checks.push('a batch lists every step with its value, and a stopped batch tells which steps ran');assert.deepEqual(errors,[]);
 await p.goto(page('pointer=1'));
 // Both drag targets are shown before consent without a click to open them (2026-09-30: fewer steps).
 const pointerApproval=p.getByRole('button',{name:'마우스 제어 승인',exact:true});assert.equal(await p.getByLabel('마우스 실행 횟수').textContent(),'0');
 await p.getByRole('figure',{name:'컴퓨터 동작 미리보기',exact:true}).nth(1).waitFor();assert.equal(await pointerApproval.isEnabled(),true);
 assert.equal(await p.getByRole('button',{name:'대상 위치 보기',exact:true}).getAttribute('aria-pressed'),'true');
 await p.screenshot({path:'verification/ui-shared-pointer-approval.png'});await pointerApproval.click();await p.getByRole('button',{name:'작업 중지',exact:true}).click();await p.getByText('확인 필요',{exact:true}).waitFor();assert.equal(await p.getByLabel('마우스 실행 횟수').textContent(),'1');assert.equal(await p.getByRole('button',{name:'마우스 제어 승인',exact:true}).count(),0);
 checks.push('mouse control shows both drag targets before explicit consent and permits stop without replay');assert.deepEqual(errors,[]);
 }else checks.push('app launch, control and mouse scenarios skipped: computerUse feature off');
 await p.goto(page('command=1'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/무료 배송 기준을 고치고/}).click();
 const checkCard=p.getByRole('region',{name:'실행 준비 승인',exact:true});await checkCard.waitFor();
 assert.equal(await checkCard.getByRole('button',{name:'확인하고 실행',exact:true}).isDisabled(),true);assert.equal(await p.getByRole('dialog',{name:'이 명령을 실행할까요?',exact:true}).count(),0);
 await checkCard.getByText('수정안을 반영하면 실행할 수 있어요.',{exact:true}).waitFor();await checkCard.screenshot({path:'verification/ui-command-waits-for-fix.png'});
 await p.locator('.nubi-file-card').getByRole('button',{name:'반영',exact:true}).click();
 const commandDecision=p.getByRole('dialog',{name:'이 명령을 실행할까요?',exact:true});await commandDecision.waitFor();
 await commandDecision.getByRole('button',{name:/항상 허용/}).click();await checkCard.getByText('실행 요청됨',{exact:true}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.approvalPolicy.allowedCommands.map(item=>item.script)),['npm test']);
 checks.push('a check proposed with its fix waits for the fix; always allow approves it and remembers the command');assert.deepEqual(errors,[]);
 if(DESKTOP_FEATURES.computerUse){
 await p.goto(page('keyboard=1'));
 const keysCard=p.getByRole('region',{name:'컴퓨터 동작 승인',exact:true});
 assert.deepEqual(await keysCard.locator('.nubi-keys kbd').allTextContents(),['Ctrl + S']);
 const keyApproval=keysCard.getByRole('button',{name:'키보드 입력 승인',exact:true});await keysCard.getByRole('figure',{name:'컴퓨터 동작 미리보기',exact:true}).waitFor();
 await keysCard.screenshot({path:'verification/ui-keyboard-approval.png'});await keyApproval.click();await p.getByLabel('키 입력 횟수').getByText('1',{exact:true}).waitFor();
 assert.equal(await keysCard.getByRole('button',{name:'키보드 입력 승인',exact:true}).count(),0);
 checks.push('keys show as keycaps and are sent only with keyboard consent');assert.deepEqual(errors,[]);
 }else checks.push('keyboard consent scenario skipped: computerUse feature off');
 await p.goto(page('compaction=1'));
 await openSidebar();assert.equal(await p.getByRole('button',{name:'새 대화',exact:true}).isDisabled(),false);await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/대화 압축 화면 검증/}).click();
 await p.getByRole('region',{name:'계획과 진행 상황',exact:true}).getByText('이전 대화를 정리하고 있어요',{exact:true}).waitFor();// the compaction status is the activity's current step (2026-10-02)
 await p.getByRole('article',{name:'내 메시지'}).getByText('원문 보존 확인: 승인 없이 실행하지 마세요.',{exact:true}).waitFor();
 await p.screenshot({path:'verification/ui-context-compaction.png',animations:'disabled'});
 await p.getByRole('button',{name:'중지',exact:true}).click();await p.getByText('이전 대화를 정리하고 있어요',{exact:true}).waitFor({state:'hidden'});
 await p.getByRole('article',{name:'내 메시지'}).getByText('원문 보존 확인: 승인 없이 실행하지 마세요.',{exact:true}).waitFor();
 checks.push('synthetic compaction phase has a concise status and stop control while original messages remain visible');assert.deepEqual(errors,[]);
 await p.goto(page('elevation=1'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/관리자 승인 화면 검증/}).click();
 const adminDialog=p.getByRole('dialog',{name:'이 명령을 실행할까요?',exact:true});await adminDialog.waitFor();
 await adminDialog.getByText(/Windows UAC/).waitFor();
 await p.screenshot({path:'verification/ui-administrator-approval.png',animations:'disabled'});
 await adminDialog.getByRole('button',{name:'관리자 권한으로 실행',exact:true}).click();
 await p.getByRole('region',{name:'실행 준비 승인',exact:true}).filter({hasText:'관리자 실행 검증'}).getByText('실행 요청됨',{exact:true}).waitFor();
 await adminDialog.waitFor();await adminDialog.getByRole('button',{name:'실행 안 함',exact:true}).click();await adminDialog.waitFor({state:'hidden'});
 await p.getByText('실행하지 않음',{exact:true}).waitFor();
 await p.getByText('합성 관리자 승인 전달을 확인했습니다. 실제 UAC 실행은 하지 않았습니다.',{exact:true}).waitFor();
 checks.push('administrator card distinguishes dedicated consent, rejection and OS UAC from ordinary command approval');assert.deepEqual(errors,[]);
 await p.goto(page('apply=1'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/준비한 두 파일을 반영/}).click();
 assert.equal(await p.getByRole('button',{name:'이어서 진행',exact:true}).count(),0);
 await p.locator('.nubi-file-card').filter({hasText:'first.txt'}).getByRole('button',{name:'반영',exact:true}).click();assert.equal(await p.getByRole('article',{name:/ 답변$/}).count(),0);
 await p.locator('.nubi-file-card').filter({hasText:'second.txt'}).getByRole('button',{name:'반영',exact:true}).click();await p.getByRole('article',{name:/ 답변$/}).getByText(/합성 응답/).waitFor();
 assert.equal(await p.getByRole('button',{name:'반영',exact:true}).count(),0);assert.equal(await p.getByRole('article',{name:/ 답변$/}).count(),1);assert.equal(await p.getByRole('navigation',{name:'작업 보기'}).count(),0);
 checks.push('after all explicit file approvals the same task resumes review once, without a mode switch or extra continue button');assert.deepEqual(errors,[]);
 await p.getByRole('textbox',{name:'추가 요청'}).fill('새로고침 후에도 보존할 초안');await p.reload();
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/준비한 두 파일을 반영/}).click();
 assert.equal(await p.getByRole('textbox',{name:'추가 요청'}).inputValue(),'새로고침 후에도 보존할 초안');
 await newConversation();assert.equal(await p.getByRole('textbox',{name:'작업 요청'}).inputValue(),'');
 checks.push('same-window reload restores only the selected conversation draft without sending it or copying it to a new conversation');assert.deepEqual(errors,[]);
 await p.goto(page('context=1'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/문맥 사용량 화면 검증/}).click();
 const meter=p.getByRole('button',{name:'컨텍스트 사용량',exact:true});await meter.waitFor();
 assert.equal(await meter.getAttribute('title'),'마지막 응답 실측\n23,223 / 262,144 토큰');
 await meter.click();const meterDialog=p.getByRole('dialog',{name:'컨텍스트'});await meterDialog.getByText('1회 정리 (215K → 61K 추정)',{exact:true}).waitFor();
 await meterDialog.getByText('토큰 상세',{exact:true}).click();await meterDialog.locator('.context-compaction-policy').waitFor();assert.match(await meterDialog.locator('.context-compaction-policy').innerText(),/자동 요약[\s\S]*196/);// the policy row shows the 75% threshold of the 262,144 window (196,608), not the reported compactAt (2026-10-05)
 assert.equal(await meterDialog.getByText('23,175 토큰',{exact:true}).count(),1);
 await p.screenshot({path:'verification/ui-context-meter.png',animations:'disabled'});
 checks.push('the composer gauge shows the reported tokens against the model window and where the history is summarized');assert.deepEqual(errors,[]);
 await p.goto(page('document=running'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/긴 업무 문서의 요구사항/}).click();
 const documentProgress=p.getByRole('region',{name:'문서 분석 진행',exact:true});
 await documentProgress.getByText('분석 결과를 합치고 있어요',{exact:true}).waitFor();
 assert.equal(await documentProgress.locator('details').first().getAttribute('open'),'');
 await documentProgress.getByText('응답 2/3',{exact:true}).waitFor();await documentProgress.getByText('일부 확인',{exact:true}).waitFor();
 await documentProgress.getByText('문자 1–6,000',{exact:true}).waitFor();await documentProgress.getByText('결과 통합 3',{exact:true}).waitFor();
 assert.equal(await documentProgress.getByText('완료',{exact:true}).count(),0);
 await p.setViewportSize({width:440,height:950});await closeSidebar();await p.waitForFunction(()=>{const e=document.querySelector('.nubi-workbench');return !!e&&e.scrollWidth<=e.clientWidth;},null,{timeout:5000});/* layout settles after the resize */
 await closeSidebar();await p.locator('.nubi-sidebar-scrim').waitFor({state:'hidden'});await p.screenshot({path:'verification/ui-document-analysis-running.png',animations:'disabled'});
 await p.getByRole('button',{name:'중지',exact:true}).click();await documentProgress.getByText('분석 중지됨',{exact:true}).waitFor();
 if(!(await documentProgress.locator('details').first().getAttribute('open')))await documentProgress.locator('details > summary').first().click();
 await documentProgress.getByText('응답 미확인',{exact:true}).waitFor();
 checks.push('document analysis exposes real worker roles, ranges, partial response and synthesis phase; stop never marks pending work successful');
 await p.setViewportSize({width:1280,height:950});/* the shared layout has no sidebar opener at 440px; Electron's integrated layout does (check-modals) */await p.goto(page('document=partial'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/긴 업무 문서의 요구사항/}).click();
 await documentProgress.getByText('일부만 확인됨',{exact:true}).waitFor();await documentProgress.getByText('읽지 못한 구간 1개가 남아 있어요.',{exact:true}).waitFor();
 assert.equal(await documentProgress.locator('details').first().getAttribute('open'),null);
 await documentProgress.locator('details > summary').first().click();await documentProgress.getByText('남은 구간',{exact:true}).click();
 await documentProgress.getByText('문자 12,001–18,000',{exact:true}).waitFor();
 await p.screenshot({path:'verification/ui-document-analysis-partial.png',animations:'disabled'});
 checks.push('partial document analysis keeps missing ranges visible after reopening and distinguishes report responses from business success');assert.deepEqual(errors,[]);
 await p.goto(page('document=history'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/긴 업무 문서의 요구사항/}).click();
 const analyses=p.getByRole('region',{name:'분석 과정과 이력'});
 await analyses.getByText('이전 분석 1개',{exact:true}).click();
 const roles=p.getByRole('region',{name:'역할별 분석 진행'});
 await roles.getByText('저장 결과 화면을 확인합니다.',{exact:true}).waitFor();
 assert.equal(await roles.getByText('모델 호출 2회 / 근거 읽기 1회',{exact:true}).isVisible(),false);await roles.getByText('결과와 근거',{exact:true}).click();await roles.getByText('모델 호출 2회 / 근거 읽기 1회',{exact:true}).waitFor();await roles.getByText('근거 읽는 중',{exact:true}).waitFor();

 await roles.getByText('화면 캡처 열람',{exact:true}).waitFor();await roles.getByText('이전 기록',{exact:true}).waitFor();
 assert.equal(await p.locator('[data-tool="analysis_page"]').count(),1);
 await analyses.getByRole('button',{name:'이전 분석 더 보기',exact:true}).click();
 await analyses.getByText('이전 분석 2개',{exact:true}).waitFor();
 const old=analyses.getByRole('region',{name:'문서 분석 진행'}).last();
 await old.locator('details > summary').first().click();await old.getByText('이전 조사 기록 2',{exact:true}).waitFor();
 await p.waitForTimeout(1600);
 await p.screenshot({path:'verification/ui-analysis-history.png',animations:'disabled'});
 await old.getByText('이전 조사 기록 2',{exact:true}).waitFor();assert.equal(await analyses.getByRole('button',{name:'이전 분석 더 보기',exact:true}).count(),0);
 await p.getByRole('button',{name:'중지',exact:true}).click();await roles.getByText('분석 중단됨',{exact:true}).waitFor();if(await roles.locator('details').first().getAttribute('open')===null)await roles.locator('details > summary').first().click();await roles.getByText('응답 미확인',{exact:true}).waitFor();
 checks.push('all document and role analyses remain paged and expandable across live refresh; screenshots retain historical provenance and unfinished workers never become complete');
 await p.goto(page('document=history-resume'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/긴 업무 문서의 요구사항/}).click();
 await analyses.getByText('이전 분석 1개',{exact:true}).click();
 await roles.getByText('분석 중단됨',{exact:true}).waitFor();await roles.locator('details > summary').first().click();
 await roles.getByText('응답 미확인',{exact:true}).waitFor();
 assert.equal(await roles.getByText('역할을 나눠 확인하고 있어요',{exact:true}).count(),0);
 assert.equal(await roles.getByText('근거 읽는 중',{exact:true}).count(),0);
 await p.screenshot({path:'verification/ui-analysis-resumed.png',animations:'disabled'});
 checks.push('resumed task keeps prior interrupted worker stopped despite retained running trace; old worker is never presented as active');
 await p.goto(page('progress'));
 await openSidebar();await p.getByRole('button',{name:'선택 메일 확인',exact:true}).click();
 const recordedProgress=p.locator('.nubi-agent-activity .agent-trace');
 if(await recordedProgress.getAttribute('open')===null)await recordedProgress.locator(':scope > summary').click();
 assert.equal(await recordedProgress.locator('li[data-tool]').count(),6,'completed source reads remain visible beyond the former recent-three limit');
 await recordedProgress.getByText('메일과 개인 위키 검색',{exact:true}).waitFor();
 assert.equal(await recordedProgress.getByText('메일 원문과 개인 위키 조회',{exact:true}).count(),2);
 assert.equal(await p.getByText('응답 검토됨',{exact:true}).count(),0);
 assert.equal(await p.getByText('선택 메일 1의 원문과 개인 위키 비교',{exact:true}).isVisible(),true);
 assert.equal(await p.getByText('선택 메일 2의 원문과 개인 위키 비교',{exact:true}).isVisible(),true);
 assert.equal(await p.getByText('메인에 전달됨',{exact:true}).count(),2);
 await p.getByText('확인한 근거 1개',{exact:true}).click();await p.getByText('선택한 원문과 답변의 근거를 대조했습니다.',{exact:true}).waitFor();
 await p.screenshot({path:'verification/ui-personal-wiki-progress.png',animations:'disabled'});
 checks.push('all retained completed operations remain in order with explicit personal-Wiki lookup labels');
 await p.goto(page('document=history-error'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/긴 업무 문서의 요구사항/}).click();
 await analyses.getByText('분석 이력을 불러오지 못했어요. 표시된 기록은 유지합니다.',{exact:true}).waitFor();
 await analyses.getByRole('button',{name:'다시 불러오기',exact:true}).click();await analyses.getByText('이전 분석 1개',{exact:true}).waitFor();
 checks.push('history read failure is explicit and retry reads stored records without restarting analysis');
 await p.goto(page('document=history-handoff'));
 await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:/긴 업무 문서의 요구사항/}).click();
 await analyses.getByText('이전 분석 1개',{exact:true}).click();
 const reviewProgress=p.getByRole('region',{name:'분석 결과 검토',exact:true});
 await reviewProgress.getByText('보완할 결과가 있어요',{exact:true}).waitFor();
 assert.equal(await reviewProgress.locator('.nubi-review-open-items [data-check=unknown]').count(),1);
 await reviewProgress.locator('.nubi-review-open-items [data-check=unknown] p').waitFor();
 await reviewProgress.getByText('확인 항목',{exact:true}).click();
 await reviewProgress.getByText('문맥 한도로 제외한 하위 분석 1개',{exact:true}).waitFor();
 await reviewProgress.getByText('제외된 분석 중 미해결 분담 1개',{exact:true}).waitFor();
 await reviewProgress.getByText('파일 재열기 근거가 없습니다.',{exact:true}).waitFor();
 assert.equal(await reviewProgress.getByText('완료',{exact:true}).count(),0);
 checks.push('independent review shows missing evidence and omitted child reports without presenting a completed mission');
 await analyses.getByRole('button',{name:'이전 분석 더 보기',exact:true}).click();
 await roles.getByText('이전 분담의 저장 결과 확인',{exact:true}).waitFor();
 await p.evaluate(()=>window.finishHandoffFixture());
 await roles.getByText('일부 확인',{exact:true}).first().waitFor();
 if(await roles.locator('details').first().getAttribute('open')===null)await roles.locator('details > summary').first().click();
 await roles.getByText('메인에 전달됨',{exact:true}).waitFor();
 assert.equal(await roles.getByText('모델 호출 2회 / 근거 읽기 1회',{exact:true}).isVisible(),false);
 await roles.getByText('저장 후 다시 열기는 미확인입니다.',{exact:true}).waitFor();
 await roles.getByText('파일을 다시 열어 값을 확인합니다.',{exact:true}).waitFor();
 assert.equal(await analyses.getByRole('button',{name:'이전 분석 더 보기',exact:true}).count(),0);
 await p.screenshot({path:'verification/ui-analysis-handoff.png',animations:'disabled'});
 checks.push('paged worker outside recent trace refreshes to partial and keeps uncertainty and next action; collected is not reviewed');assert.deepEqual(errors,[]);
 if(DESKTOP_FEATURES.computerUse){// native app proposals need the computer-use feature (off since 2026-10-05)
 await p.goto(page('controls'));
 await p.getByText('문서 분석 근거 1개',{exact:true}).first().click();await p.getByText('docs/앱-규칙.md',{exact:true}).first().waitFor();
 await p.getByText('일부만 확인한 분석입니다. 미열람 구간과 결과를 확인해 주세요.',{exact:true}).first().waitFor();
 assert.equal(await p.getByRole('button',{name:'실행',exact:true}).count(),0);
 checks.push('native proposals show linked document scope and partial analysis without adding or implying approval');assert.deepEqual(errors,[]);
 }else checks.push('native proposal document evidence skipped: computerUse feature off');

 await p.setViewportSize({width:1280,height:950});await p.goto(page('sessions=1'));
 await openHistory();
 const sessionHistory=p.getByRole('dialog',{name:'대화 검색',exact:true});
 assert.equal(await sessionHistory.getByText('세션 검증 프로젝트',{exact:true}).count(),0);
 await sessionHistory.getByRole('region',{name:'오늘 대화'}).locator('.nubi-history-item').filter({hasText:'실행 중인 분석'}).click();
 const list=p.getByRole('navigation',{name:'대화 목록'}),row=text=>list.locator('.nubi-session-row').filter({hasText:text}),open=text=>row(text).locator('.nubi-session-select');
 await open('실행 중인 분석').waitFor();assert.equal(await row('실행 중인 분석').getAttribute('data-current'),'true');
 // One list by date (user decision 2026-09-30): the current conversation is its soft blue row, with no side bar.
 assert.equal(await list.locator('[data-current="true"]').count(),1);assert.equal(await row('실행 중인 분석').evaluate(e=>getComputedStyle(e).boxShadow),'none');
 await openHistory();
 await sessionHistory.getByRole('region',{name:'어제 대화'}).locator('.nubi-history-item').filter({hasText:'수정할 문서 확인'}).click();
 assert.equal(await row('수정할 문서 확인').getAttribute('data-current'),'true');assert.equal(await row('실행 중인 분석').getAttribute('data-current'),'false');
 const reviewDraft=p.getByRole('textbox',{name:'추가 요청'});assert.equal(await reviewDraft.isEnabled(),true);
 await reviewDraft.fill('다른 대화의 미전송 초안');
 assert.equal(await p.getByRole('button',{name:'전송',exact:true}).isEnabled(),true);
 assert.equal(await p.getByText('다른 대화가 진행 중입니다. 초안은 저장돼요.',{exact:true}).count(),0);
 await open('실행 중인 분석').click();await open('수정할 문서 확인').click();
 assert.equal(await reviewDraft.inputValue(),'다른 대화의 미전송 초안');
 await newConversation();// '새 대화' is a sidebar button (2026-10-02)
 await p.getByRole('textbox',{name:'작업 요청'}).fill('새 대화의 초안');
 assert.equal(await p.getByRole('button',{name:'전송',exact:true}).isEnabled(),true);
 await open('수정할 문서 확인').click();
 assert.equal(await reviewDraft.inputValue(),'다른 대화의 미전송 초안');
 await p.getByRole('complementary',{name:'프로젝트 대화'}).getByRole('button',{name:'새 대화',exact:true}).click();
 assert.equal(await p.getByRole('textbox',{name:'작업 요청'}).inputValue(),'새 대화의 초안');
 await p.setViewportSize({width:1280,height:820});
 await p.screenshot({path:'verification/ui-session-sidebar.png',animations:'disabled'});
 await p.reload();await row('실행 중인 분석').waitFor();
 assert.equal(await p.getByRole('textbox',{name:'작업 요청'}).inputValue(),'새 대화의 초안');
 assert.equal(await p.getByRole('complementary',{name:'프로젝트 대화'}).getByRole('button',{name:'새 대화',exact:true}).getAttribute('aria-current'),'page');
 // Deleting is the trash icon with a confirmation (user decision 2026-09-30); a running conversation has none.
 assert.equal(await row('실행 중인 분석').getByRole('button',{name:/삭제$/}).count(),0);
 const menuRow=row('수정할 문서 확인'),beforeMenu=await menuRow.boundingBox();
 await menuRow.locator('.nubi-actions-disclosure>summary').click();
 const afterMenu=await menuRow.boundingBox();assert.deepEqual(afterMenu,beforeMenu,'opening actions preserves the entire row geometry');
 const actionPanel=menuRow.locator('[popover]');assert.equal(await actionPanel.evaluate(e=>e.matches(':popover-open')),true);
 const panelBox=await actionPanel.boundingBox();assert.ok(panelBox.x>=0&&panelBox.y>=0&&panelBox.x+panelBox.width<=1280);
 const actionBoxes=await actionPanel.locator('button').evaluateAll(items=>items.map(e=>{const r=e.getBoundingClientRect();const copy=e.cloneNode(true);copy.querySelectorAll('.visually-hidden').forEach(n=>n.remove());return {y:r.y,height:r.height,width:r.width,text:copy.textContent.trim(),title:e.title};}));
 assert.equal(new Set(actionBoxes.map(r=>Math.round(r.y))).size,1,'conversation actions stay on one horizontal row');
 assert(actionBoxes.every(r=>r.width>=44&&r.height>=44&&!r.text&&r.title),'icon actions retain usable targets and tooltips');
 await p.screenshot({path:'verification/ui-conversation-actions-inline.png',animations:'disabled'});
 await p.keyboard.press('ArrowRight');assert.match(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),/고정/);
 await p.keyboard.press('ArrowRight');assert.match(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),/삭제/);
 await p.keyboard.press('Escape');assert.equal(await actionPanel.isVisible(),false);assert.equal(await menuRow.locator('summary').evaluate(e=>e===document.activeElement),true);
 await menuRow.locator('summary').click();await menuRow.locator('summary').click();assert.equal(await actionPanel.isVisible(),false,'reclick closes without native light-dismiss reopening');await menuRow.locator('summary').click();await p.getByRole('textbox',{name:'작업 요청'}).click();assert.equal(await actionPanel.isVisible(),false);
 checks.push('conversation actions float without row movement, fit viewport, support arrow/Escape focus and outside dismissal');
 if(await row('수정할 문서 확인').locator('.nubi-actions-disclosure').getAttribute('open')===null)await row('수정할 문서 확인').locator('.nubi-actions-disclosure>summary').click();
 await row('수정할 문서 확인').getByRole('button',{name:'수정할 문서 확인 삭제',exact:true}).click();
 const confirmDelete=p.getByRole('alertdialog',{name:'대화를 삭제할까요?'});await confirmDelete.getByText(/프로젝트에 반영한 파일은 그대로 남아요/).waitFor();
 assert.equal(await confirmDelete.getByRole('button').count(),3,'the header X, 취소 and 확인 (user decision 2026-10-02)');await confirmDelete.getByRole('button',{name:'취소',exact:true}).click();await confirmDelete.waitFor({state:'detached'});
 assert.equal(await p.evaluate(()=>window.deletedTasks?.length||0),0,'cancelling deletes nothing');
 if(await row('수정할 문서 확인').locator('.nubi-actions-disclosure').getAttribute('open')===null)await row('수정할 문서 확인').locator('.nubi-actions-disclosure>summary').click();
 await row('수정할 문서 확인').getByRole('button',{name:'수정할 문서 확인 삭제',exact:true}).click();await confirmDelete.getByRole('button',{name:'삭제',exact:true}).click();
 await row('수정할 문서 확인').waitFor({state:'detached'});assert.deepEqual(await p.evaluate(()=>window.deletedTasks),['session-review']);
 await p.getByText('대화를 삭제했어요.',{exact:true}).waitFor();
 await openHistory();
 assert.equal(await sessionHistory.locator('.nubi-history-item').filter({hasText:'수정할 문서 확인'}).count(),0);
 await sessionHistory.getByRole('region',{name:/2025년 1월 2일 대화/}).locator('.nubi-history-item').filter({hasText:'지난달 코드 검토'}).waitFor();
 await p.keyboard.press('Escape');
 // The narrow sidebar is the Electron (integrated) layout's overlay with its own opener; the shared layout has none at 440px.
 await p.setViewportSize({width:440,height:900});await p.goto(page('sessions=1'));await p.locator('.nubi-sidebar').waitFor({state:'attached'});await openSidebar();
 await p.waitForFunction(()=>{const e=document.querySelector('.nubi-workbench');return !!e&&e.scrollWidth<=e.clientWidth;},null,{timeout:5000});
 await p.screenshot({path:'verification/ui-session-sidebar-narrow.png',animations:'disabled'});
 assert.equal(await p.getByRole('complementary',{name:'프로젝트 대화'}).isVisible(),true);
 assert.equal(await p.getByRole('complementary',{name:'프로젝트 대화'}).getByRole('button',{name:'사이드바 닫기',exact:true}).count(),0,'the header button is the one close control');await p.emulateMedia({reducedMotion:'reduce'});await p.keyboard.press('Escape');await p.locator('.nubi-sidebar[data-open="false"]').waitFor();/* the compact sidebar collapses to its header strip that keeps the toggle (2026-10-02) */await openSidebar();assert.equal(await p.getByRole('complementary',{name:'프로젝트 대화'}).evaluate(e=>getComputedStyle(e).animationDuration),'0s');
 checks.push('one dated conversation list marks the current row without a side bar, keeps drafts across switching and reload, and deletes a finished conversation with the trash icon after confirmation');assert.deepEqual(errors,[]);

 // Search-to-chat is a draft handoff, including when literal search has no hits.
 await p.setViewportSize({width:1280,height:950});await p.goto(page('modals&toolbar'));
 await p.locator('.aipro-login').getByRole('button',{name:'AI Pro',exact:true}).click();
 const mailDraft=p.getByRole('textbox',{name:'작업 요청'});await mailDraft.fill('기존 초안');
 await mailDraft.press('Shift+Enter');await mailDraft.press('a');assert.equal(await mailDraft.inputValue(),'기존 초안\na');
 await mailDraft.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true});
 assert.equal(await mailDraft.inputValue(),'기존 초안\na');assert.equal(await p.locator('.nubi-task').count(),0);
 await p.getByRole('button',{name:'메일',exact:true}).click();
 await p.getByRole('searchbox',{name:'메일 검색',exact:true}).fill('김누비 예산 승인');
 await p.locator('.nubi-mail-filters>summary').click();await p.getByLabel('메일 기간',{exact:true}).selectOption('7');
 await p.locator('.nubi-mail-extra-filters>summary').click();
 for(const width of [440,1280]){
   await p.setViewportSize({width,height:850});
   const fields=p.locator('.nubi-mail-filters>.nubi-mail-filter-fields');
   assert(await fields.evaluate(e=>e.scrollHeight<=e.clientHeight+1&&e.scrollWidth<=e.clientWidth+1),'mail filters have no nested scroll or clipping');
   await p.getByLabel('메일 검색 위치',{exact:true}).selectOption('body');await p.getByLabel('메일 검색 위치',{exact:true}).selectOption('');
   await p.screenshot({path:`verification/mail-filters-no-scroll-${width}.png`,animations:'disabled'});
 }
 await p.locator('.nubi-mail-extra-filters>summary').click();
 checks.push('mail search filters fit without an inner scrollbar and all fields stay reachable at 440/1280px');
 await p.getByLabel('메일 보낸 사람',{exact:true}).fill('김누비');
 await p.getByRole('button',{name:'AI로 찾기',exact:true}).click();
 await mailDraft.waitFor();const searchDraft=await mailDraft.inputValue();assert(searchDraft.startsWith('기존 초안\na\n\n'));
 for(const text of ['김누비 예산 승인','최근 7일','보낸 사람: 김누비'])assert(searchDraft.includes(text));
 await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='작업 요청');
 assert.equal(await p.locator('.nubi-task').count(),0,'AI search must not auto-submit');
 assert.equal(await p.locator('.composer .model-trigger-label').innerText(),'Qwen fixture');
 await p.screenshot({path:'verification/ui-mail-ai-draft.png',animations:'disabled'});
 await mailDraft.press('Enter');await p.locator('.nubi-task').waitFor();
 checks.push('mail search hands query and filters to the selected-model draft, preserves existing text and waits for Send; Shift+Enter and Korean IME do not send');assert.deepEqual(errors,[]);

 // Project start (user decision 2026-09-30): folder and remote repository cards in the composer's place. Without a
 // project the host has no state; that is the start screen, not an error.
 await p.setViewportSize({width:1100,height:760});await p.goto(page('noproject'));
 await p.locator('.aipro-login').getByRole('button',{name:'AI Pro',exact:true}).click();await p.locator('.aipro-login').waitFor({state:'detached'});
 await p.getByRole('region',{name:'프로젝트 열기',exact:true}).waitFor();/* the greeting varies by time of day; the start screen is its own region (2026-10-02) */
 assert.equal(await p.getByRole('button',{name:/^폴더 열기/}).count(),1);assert.equal(await p.locator('.nubi-start-card').count(),2);
 assert.equal(await p.getByRole('button',{name:'프로젝트 열기',exact:true}).count(),0,'the cards replace the header button');
 assert.equal(await p.locator('.nubi-project-label').isVisible(),false,'no project name, no empty label');/* the brand carries the product name '누비 Workspace' (user decision 2026-09-30) */assert.doesNotMatch(await p.locator('.nubi-workbench').innerText(),/\/\*|\*\//,'no source comment leaks into the screen');
 await p.getByRole('button',{name:/^Git URL/}).click();const address=p.getByRole('textbox',{name:'저장소 주소',exact:true});await address.fill('github.com/owner/repo');await p.getByRole('button',{name:'저장할 폴더 선택',exact:true}).click();
 await p.getByRole('alert').filter({hasText:'git@ 주소를 넣어 주세요'}).waitFor();assert.equal(await p.evaluate(()=>window.cloneCalls?.length||0),0,'a malformed address stays in the card');
 await address.fill('https://github.com/owner/repo.git');await p.getByRole('button',{name:'저장할 폴더 선택',exact:true}).click();
 await p.waitForFunction(()=>window.cloneCalls?.length===1);assert.deepEqual(await p.evaluate(()=>window.cloneCalls),['https://github.com/owner/repo.git']);
 assert.equal(await p.locator('.nubi-error').count(),0);await p.screenshot({path:'verification/ui-project-start.png',animations:'disabled'});
 checks.push('project start offers folder and remote repository cards; a malformed address is explained in the card and never reaches the host');assert.deepEqual(errors,[]);

 for(const width of [1280,440]){
 await p.setViewportSize({width,height:850});await p.goto(page('conversation-search'));await openHistory();
 const search=p.getByRole('dialog',{name:'대화 검색',exact:true});await search.locator('.nubi-history-search-status').filter({hasText:'현재 공간의 모든 대화'}).waitFor();
 assert.equal(await search.getByRole('button',{name:/복사/}).count(),0);
 await search.getByRole('searchbox',{name:'대화 검색',exact:true}).fill('빵');await search.locator('.nubi-history-search-status').filter({hasText:'1개 대화'}).waitFor();
 const hit=search.locator('.nubi-history-item');assert.equal(await hit.count(),1);assert.match(await hit.innerText(),/아침 식사 추천/);assert.match(await hit.locator('.nubi-history-excerpt').innerText(),/따뜻한 빵과 우유/);assert.equal(await hit.locator('mark').first().innerText(),'빵');
 assert(await hit.locator('.nubi-history-excerpt').evaluate(node=>node.getBoundingClientRect().height<30));await p.screenshot({path:`verification/ui-conversation-search-${width}.png`,animations:'disabled'});
 await hit.click();await search.waitFor({state:'detached'});await p.getByRole('article',{name:/ 답변$/}).getByText('따뜻한 빵과 우유를 추천합니다. 식빵도 좋아요.',{exact:true}).waitFor();
 }
 checks.push('conversation search finds assistant body, highlights literal Korean keywords, removes copy, and opens the matching conversation at wide and narrow widths');
 for(const width of [1280,620,440]){
   await p.setViewportSize({width,height:900});await p.goto(page('queue-layout'));await openHistory();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').filter({hasText:'진행 내용을 간결하게 정리해 주세요.'}).click();await closeSidebar();
   const queue=p.getByRole('list',{name:'대기 메시지',exact:true});assert.equal(await queue.locator('.agent-input-order').count(),0);assert.equal(await queue.locator('.agent-input-actions').innerText(),'');assert(await queue.locator('.agent-input-actions button').evaluateAll(buttons=>buttons.every(button=>button.getAttribute('aria-label')&&button.title)));
   await p.screenshot({path:`verification/ui-queue-icons-${width}.png`,animations:'disabled'});
   await p.getByRole('button',{name:'지금 반영',exact:true}).click();
   await p.getByRole('article',{name:'반영 대기 메시지'}).waitFor();
   const pendingLayout=await p.locator('.agent-input-pending').evaluate(node=>{const bubble=node.querySelector('.nubi-user-bubble').getBoundingClientRect(),footer=node.querySelector('.nubi-pending-footer').getBoundingClientRect();return {gap:footer.top-bubble.bottom,inside:footer.bottom<=node.getBoundingClientRect().bottom+1};});
   assert(pendingLayout.gap>=3&&pendingLayout.gap<=5&&pendingLayout.inside);
   await p.getByText('추가 요청까지 반영했습니다. 이 화면은 배치 확인용 예시입니다.',{exact:true}).waitFor();
   const layouts=await p.locator('.message-user').evaluateAll(nodes=>nodes.map(node=>{const bubble=node.querySelector('.nubi-user-bubble').getBoundingClientRect(),footer=node.querySelector('.message-actions').getBoundingClientRect(),box=node.getBoundingClientRect();return {gap:footer.top-bubble.bottom,inside:footer.bottom<=box.bottom+1,position:getComputedStyle(node.querySelector('.message-actions')).position};}));
   assert(layouts.length===2&&layouts.every(item=>item.gap>=3&&item.gap<=5&&item.inside&&item.position==='static'),'queue admission retains metadata in normal flow next to its own bubble');
   await p.screenshot({path:`verification/ui-queue-layout-${width}.png`,animations:'disabled'});
 }
 checks.push('queued input, pending admission and consumed message keep metadata in normal flow at 1280, 620 and 440px');
 await writeFile('verification/shared-ui-result.json',JSON.stringify({scope:'synthetic UI provider states; not live authentication or model inference',checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){await p?.screenshot({path:'verification/shared-ui-failure.png'});await writeFile('verification/shared-ui-failure.html',await p.content());throw error;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));stopBuildService();}

import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,writeFile,readFile,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
import {assertDialogChrome} from './identity-browser.mjs';
const dir=path.resolve('verification/all-surfaces'),bundle=path.join(dir,'fixture');
await mkdir(bundle,{recursive:true});
await build({entryPoints:['tests/surface-audit-fixture.jsx'],outfile:path.join(bundle,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(bundle,'icons'),{recursive:true});
await writeFile(path.join(bundle,'index.html'),'<!doctype html><html lang="ko"><title>누비 전체 화면 검토</title><link rel="stylesheet" href="app.css"><body><div class="desktop-shell" data-toolbar="true" data-platform="darwin" data-layout="split"><div id="toolbar" class="desktop-titlebar"></div><div class="desktop-workspace-body"><div class="desktop-agent" id="root"></div></div></div><script type="module" src="app.js"></script></body></html>');
const storage=await mkdtemp('/tmp/nubi-all-surfaces-'),require=createRequire(import.meta.url);
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
const records=[],errors=[];let p;
async function load(query){await p.goto('file://'+path.join(bundle,'index.html')+'?'+query);await p.locator('.nubi-workbench,.deck-dialog,.nubi-bar,.nubi-mail-history').first().waitFor();await p.emulateMedia({reducedMotion:'reduce'});await p.evaluate(()=>document.fonts.ready);}
async function audit(name,selector='body'){
 for(const dialog of await p.locator('.deck-dialog:visible').all())await assertDialogChrome(dialog);
 const metrics=await p.locator(selector).first().evaluate(root=>{
  const floor=parseFloat(getComputedStyle(document.documentElement).fontSize)*.875;
  const nodes=[...root.querySelectorAll('*')].filter(e=>e.checkVisibility()&&!e.closest('svg,.monaco-editor,.xterm,[aria-hidden="true"],.visually-hidden')&&[...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()));
  const small=nodes.filter(e=>parseFloat(getComputedStyle(e).fontSize)+.1<floor).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.trim().slice(0,45),size:getComputedStyle(e).fontSize}));
  const clippedActions=[...document.querySelectorAll('.nubi-window-toolbar button,.composer-bottom button,.nubi-composer-footer button')].filter(e=>e.checkVisibility()).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(e=>e.getAttribute('aria-label')||e.textContent.trim());
  const hiddenNames=[...document.querySelectorAll('.composer-bottom .model-trigger-label,.composer-bottom .nubi-approval-mode-button>span')].filter(e=>!e.checkVisibility()).map(e=>e.textContent.trim());
  const wrappedControls=[];
  for(const control of root.querySelectorAll('button,[role=tab],summary,h2')) {
   if(!control.checkVisibility()||control.closest('.message-body'))continue;
   const walker=document.createTreeWalker(control,NodeFilter.SHOW_TEXT);let node;
   while(node=walker.nextNode()){
    if(!node.textContent.trim()||!node.parentElement.checkVisibility()||node.parentElement.closest('svg,.visually-hidden,[aria-hidden=true]'))continue;
    const range=document.createRange();range.selectNodeContents(node);const boxes=[...range.getClientRects()].filter(r=>r.width>1&&r.height>1);
    if(new Set(boxes.map(r=>Math.round(r.top))).size>1)wrappedControls.push(node.textContent.trim().slice(0,60));
   }
  }
  const dialog=document.querySelector('[role=dialog],[role=alertdialog]'),r=dialog?.getBoundingClientRect();
  return {small,clippedActions,hiddenNames,wrappedControls,overflow:document.documentElement.scrollWidth>innerWidth+1,dialog:r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null,width:innerWidth,height:innerHeight};
 });
 const composers=await p.locator('.nubi-composer-surface').evaluateAll(surfaces=>surfaces.map(surface=>{
  const bounds=surface.getBoundingClientRect(),buttons=[...surface.querySelectorAll('.composer-bottom button')].filter(e=>e.checkVisibility()&&!e.closest('[role=dialog],[role=menu]'));
  const boxes=buttons.map(e=>e.getBoundingClientRect()),model=surface.querySelector('.model-trigger'),field=surface.querySelector('textarea');
  return {positions:buttons.map((e,i)=>({name:e.getAttribute('aria-label'),x:boxes[i].x,y:boxes[i].y,w:boxes[i].width,h:boxes[i].height})),singleRow:boxes.every(r=>Math.abs((r.top+r.bottom)/2-(boxes[0].top+boxes[0].bottom)/2)<2),height:bounds.height,inputHeight:field?.getBoundingClientRect().height,inputEmpty:!field?.value,approval:!!surface.querySelector('.nubi-approval-mode-button'),context:!!surface.querySelector('.context-trigger'),inside:boxes.every(r=>r.left>=bounds.left&&r.right<=bounds.right+1&&r.top>=bounds.top&&r.bottom<=bounds.bottom+1),overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)),modelColor:model?getComputedStyle(model).backgroundColor:null,modelGradient:model?getComputedStyle(model).backgroundImage:null,ringWidth:surface.querySelector('.context-ring')?.getBoundingClientRect().width,ringFont:parseFloat(getComputedStyle(surface.querySelector('.context-ring text')).fontSize)};
 }));
 for(const composer of composers){assert(composer.approval&&composer.context,name+': approval and context inside input');assert(composer.inside&&!composer.overlap,name+': composer controls fit without overlap');assert(composer.singleRow,name+': composer controls stay on one row '+JSON.stringify(composer.positions));assert(composer.modelColor!=='rgba(0, 0, 0, 0)'||composer.modelGradient!=='none',name+': model retains provider surface');assert(composer.ringWidth>=40&&composer.ringFont>=14,name+': context number readable at native size');}
 if(name==='chat-preview-1280'){assert(composers[0].inputEmpty);assert(composers[0].inputHeight<=40,'empty input starts at one line');assert(composers[0].height<=110,'comfortable composer avoids excess vertical padding');}
 const tones=await p.evaluate(()=>{
  const root=document.querySelector('.desktop-shell'),probe=document.createElement('span');root.append(probe);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const lum=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const channels=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
  const pairs=[['primary','base'],['secondary','base'],['meta','base'],['action','selected'],['success','success'],['warning','warning'],['danger','danger']];
  const result=pairs.map(([ink,surface])=>{probe.style.color='var(--nubi-text-'+ink+')';probe.style.backgroundColor='var(--nubi-surface-'+surface+')';const style=getComputedStyle(probe),a=lum(style.color),b=lum(style.backgroundColor);return {ink,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});probe.remove();return result;
 });
 assert(tones.every(tone=>tone.contrast>=4.5),name+': semantic text contrast '+JSON.stringify(tones));
 const file=name+'.png';await p.screenshot({path:path.join(dir,file),animations:'disabled',scale:'css'});
 assert(!metrics.overflow,name+': outer horizontal overflow');assert.deepEqual(metrics.wrappedControls,[],name+': control labels must stay single line');
 assert.deepEqual(metrics.clippedActions,[],name+': named actions clipped');assert.equal(await p.locator('.composer-bottom button:visible').evaluateAll(buttons=>buttons.every(button=>(button.getAttribute('aria-label')||button.textContent).trim()&&button.title)),true,name+': compact controls keep names and hints');
 if(!process.argv.includes('--diagnostic'))assert.deepEqual(metrics.small,[],name+': text below caption token');
 if(metrics.dialog){const r=metrics.dialog;assert(r.left>=-1&&r.top>=-1&&r.right<=metrics.width+1&&r.bottom<=metrics.height+1,name+': dialog clipped');}
 records.push({name,file,...metrics,composers});console.log('checked',name);
 await writeFile(path.join(dir,'diagnostic.json'),JSON.stringify(records,null,2));
}
async function close(){await p.keyboard.press('Escape');}
async function chooseTask(){const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색'}).locator('.nubi-history-item').first().click();}
try{
 await app.firstWindow();await app.evaluate(async({BrowserWindow},file)=>{const window=new BrowserWindow({width:1280,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadFile(file);},path.join(bundle,'index.html'));
 p=app.windows().at(-1);p.setDefaultTimeout(10000);p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.stack);});
 if(!process.env.NUBI_BIRD_MOTION_ONLY&&!process.env.NUBI_WELCOME_ONLY&&!process.env.NUBI_PICKER_ONLY&&!process.env.NUBI_COMPOSER_ONLY&&!process.env.NUBI_NAV_ONLY){
 for(const width of (process.env.NUBI_MAIL_FLOW_ONLY?[]:[1280,440])){
  await p.setViewportSize({width,height:950});
  await load('screen=workbench&integrated&context&modals');await chooseTask();
  await audit('conversation-'+width);
  const rail=await p.locator('.nubi-workspace-rail').evaluate(e=>{const team=e.querySelector('.nubi-rail-team'),r=e.getBoundingClientRect(),b=team.getBoundingClientRect();return {last:e.lastElementChild===team,text:team.textContent.trim(),bottomGap:r.bottom-b.bottom,label:team.getAttribute('aria-label')};});assert(rail.last&&rail.text===''&&rail.label==='AI Workspace'&&rail.bottomGap<32,'AI Workspace is an icon at the bottom of the rail');
  await load('screen=workbench&integrated&context&modals&chat-preview');await chooseTask();await audit('chat-preview-'+width);
  await load('screen=workbench&integrated&context&modals');await chooseTask();
  for(const [button,title,key] of [['설정','설정','settings'],['위키','프로젝트 자료','library'],['토큰 사용량','사용량','usage'],['컨텍스트 사용량','컨텍스트 사용량','context'],['모델 변경','모델 선택','models'],['추론 정도','추론 정도 조절','reasoning'],['스킬 관리','스킬 목록','skill-menu']]){
   await p.getByRole('button',{name:button,exact:true}).click();await p.getByRole('dialog',{name:title,exact:true}).waitFor();await audit(key+'-'+width);await close();
  }
  await p.getByRole('button',{name:/매번 확인/}).click();await p.getByRole('dialog',{name:'승인 방식',exact:true}).waitFor();await audit('approval-'+width);await close();
  await p.getByRole('button',{name:'모델 변경',exact:true}).click();await p.getByRole('tab',{name:'FabriX',exact:true}).click();await p.getByRole('button',{name:'연결',exact:true}).click();await p.getByRole('dialog',{name:'FabriX 연결'}).waitFor();await audit('fabrix-'+width);await close();await close();
  await p.getByRole('button',{name:'메일',exact:true}).click();await p.getByRole('heading',{name:'메일',exact:true}).waitFor();await audit('mail-empty-'+width);
  await p.getByRole('button',{name:'메일 연결',exact:true}).click();await p.getByRole('textbox',{name:'아이디',exact:true}).waitFor();await audit('mail-connect-'+width);await close();
  await load('screen=workbench&integrated&noproject');await p.getByRole('button',{name:'AI Pro',exact:true}).waitFor();await audit('login-'+width);await p.getByRole('button',{name:'AI Pro',exact:true}).click();await p.getByRole('region',{name:'프로젝트 열기'}).waitFor();await audit('project-start-'+width);
  for(const [screen,wait] of [['claude-install','Claude Code 연결'],['claude-login','Claude Code 연결'],['claude-update','Claude Code 연결'],['startup','메일을 연결해 주세요'],['usage','사용량'],['models-long','모델 선택'],['mail-settings','메일 설정'],['registration','스킬 등록'],['skills','스킬 관리'],['marketplace','스킬 관리'],['account','검토 계정 @review']]){
   await load('screen='+screen);await (screen==='account'?p.locator('.nubi-ghes-modal'):p.getByRole('dialog',{name:wait,exact:true})).waitFor();
   if(screen==='account')await p.locator('.nubi-account-heading strong').filter({hasText:'검토 계정'}).waitFor();
   if(screen==='mail-settings')await p.getByRole('switch',{name:'메일 자동 정리'}).waitFor();
   if(screen==='skills')await p.getByText('보고서 작성',{exact:true}).waitFor();
   if(screen==='marketplace')await p.getByRole('button',{name:'보고서 작성 업데이트'}).waitFor();
   await audit(screen+'-'+width);
   if(screen==='models-long'){assert.equal(await p.getByRole('tab',{name:'Claude',exact:true}).count(),1,'Desktop provider tabs include Claude');}
   if(screen==='skills'){
    assert.equal(await p.getByRole('navigation',{name:'내 스킬 페이지 이동'}).count(),0,'single page has no redundant pager');
    await p.getByRole('button',{name:'보고서 작성 삭제',exact:true}).click();await p.getByRole('alertdialog').waitFor();await audit('custom-skill-delete-'+width);await close();
    assert.equal(await p.getByRole('button',{name:/휴지통 보기/}).count(),0,'removed trash entry stays out of skill management');
   }
   if(screen==='marketplace'){
    await p.locator('.nubi-marketplace-card').filter({has:p.locator('strong',{hasText:'보고서 작성'})}).locator('.nubi-actions-disclosure>summary').click();
    await p.getByRole('button',{name:'보고서 작성 삭제',exact:true}).click();await p.getByRole('alertdialog').waitFor();await audit('marketplace-delete-'+width);await close();
   }
   if(screen==='mail-settings'){await p.getByRole('switch',{name:'메일 자동 정리'}).click();await p.getByRole('switch').filter({hasText:''}).first().waitFor();await audit('mail-off-'+width);}
   if(screen==='account'){await p.locator('.nubi-account-settings>summary').click();await p.getByText('설치를 요청했어요. 다시 시작한 뒤 버전을 확인합니다.',{exact:true}).waitFor();await audit('account-update-'+width);}
  }
  await load('screen=mail');await p.getByRole('heading',{name:'메일',exact:true}).waitFor();await p.locator('.nubi-mail-result').first().waitFor();await audit('mail-results-'+width);await p.getByRole('searchbox',{name:'메일 검색',exact:true}).fill('승인');await p.getByRole('button',{name:'AI로 찾기',exact:true}).waitFor();await p.locator('.nubi-mail-results[aria-busy="false"]').waitFor();await audit('mail-ai-search-'+width);await p.getByRole('searchbox',{name:'메일 검색',exact:true}).fill('');await p.locator('.nubi-mail-result').first().click();await p.getByRole('heading',{name:'주간 보고서와 승인 일정 1',exact:true}).waitFor();await p.locator('.nubi-mail-history-detail').scrollIntoViewIfNeeded();await audit('mail-reader-'+width);
  await p.getByRole('button',{name:'메일 태그 관리',exact:true}).click();await p.getByRole('dialog',{name:'메일 태그',exact:true}).waitFor();await audit('mail-tags-'+width);await close();await p.getByRole('button',{name:'메일 목록으로',exact:true}).click();
  await p.locator('.nubi-mail-filters>summary').click();await audit('mail-inline-filters-'+width);
  await p.getByRole('button',{name:'저장한 검색',exact:true}).click();await p.getByRole('dialog',{name:'저장한 검색'}).waitFor();await audit('mail-saved-'+width);
  await load('screen=mail-filters');await p.getByRole('dialog',{name:'검색 조건'}).waitFor();await audit('mail-filter-dialog-'+width);
  const period=p.getByLabel('검색 기간',{exact:true});
  assert.equal(await period.locator('option').count(),5,'period options are real selectable values');
  await period.selectOption('custom');await p.getByLabel('검색 시작일').fill('2026-10-01');await p.getByLabel('검색 종료일').fill('2026-10-12');
  await p.getByLabel('보낸 사람 또는 도메인').fill('sender@example.com');await p.getByRole('button',{name:'보낸 사람 조건 추가'}).click();
  await p.getByLabel('첨부 유무',{exact:true}).selectOption('with');
  await p.getByText('상세 조건',{exact:true}).click();await p.getByRole('button',{name:'PDF',exact:true}).click();
  await p.getByLabel('첨부 파일명',{exact:true}).fill('report');await p.getByRole('button',{name:'적용',exact:true}).click();
  const applied=await p.evaluate(()=>window.appliedMailFilters);assert.equal(applied.period,'custom');assert.equal(applied.attachment,'with');assert.equal(applied.filename,'report');assert.deepEqual(applied.senders,['sender@example.com']);assert.deepEqual(applied.types,['pdf']);
  await audit('mail-filter-expanded-'+width);
  await p.getByRole('button',{name:'초기화',exact:true}).click();await p.getByRole('button',{name:'적용',exact:true}).click();assert.equal((await p.evaluate(()=>window.appliedMailFilters)).period,'all');

  for(const state of ['current','stale','ready','failed','running']){await load('screen=wiki&state='+state);await p.locator('.nubi-wiki-update').waitFor();await audit('wiki-'+state+'-'+width);}
  for(const screen of ['question','analysis','setup','progress']){await load('screen='+screen);await p.locator('.question-card,.nubi-document-progress,.nubi-setup-summary,.desktop-mail-progress').first().waitFor();await audit(screen+'-'+width);}
  await load('screen=applied');await p.getByRole('button',{name:'변경한 파일 보기'}).click();await p.getByRole('dialog',{name:'변경한 파일'}).waitFor();await audit('applied-'+width);
 }
 // Full mail workflow uses real production components in Electron with bounded synthetic sources.
 await p.setViewportSize({width:1600,height:950});await load('integrated&modals&toolbar&mail-flow');
 const gitControl=p.getByRole('button',{name:'Git 변경',exact:true});assert.equal((await gitControl.innerText()).trim(),'');assert(await gitControl.getAttribute('title'));
 const draft=p.getByRole('textbox',{name:'작업 요청',exact:true});await draft.fill('선택한 메일에서 승인할 항목과 일정을 비교해 주세요.');
 await p.getByRole('button',{name:'메일',exact:true}).click();
 const results=p.locator('.nubi-mail-results');await results.locator('.nubi-mail-result').first().waitFor();
 await p.locator('.nubi-mail-results[aria-busy="false"]').waitFor();await audit('mail-flow-list');
 assert.equal(await results.locator('.nubi-mail-result').count(),20);
 const pager=p.locator('.nubi-mail-page-options>summary');assert.match(await pager.innerText(),/1–20 \/ 47/);
 await results.locator('tbody input[type=checkbox]').nth(0).check();await results.locator('tbody input[type=checkbox]').nth(1).check();
 await p.getByRole('button',{name:'다음 메일 페이지',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.nubi-mail-page-options>summary')?.textContent.includes('21–40'));
 await results.locator('.nubi-mail-result').first().click();await p.getByRole('heading',{name:'프로젝트 일정 공유 21',exact:true}).waitFor();
 await p.getByRole('button',{name:'이전 메일',exact:true}).click();await p.getByRole('heading',{name:'견적서 검토 결과 20',exact:true}).waitFor();
 await p.getByRole('button',{name:'다음 메일',exact:true}).click();await p.getByRole('heading',{name:'프로젝트 일정 공유 21',exact:true}).waitFor();await audit('mail-flow-reader');
 await p.getByRole('button',{name:'메일 목록으로',exact:true}).click();
 await results.locator('tbody input[type=checkbox]').nth(0).check();await audit('mail-flow-selected');
 await p.evaluate(()=>window.mailEvidenceFailure='1'.padStart(64,'0'));
 await p.getByRole('button',{name:'AI에 질문',exact:true}).click();await p.getByRole('alert').filter({hasText:'선택한 원문이 바뀌었어요'}).waitFor();
 assert.equal(await p.evaluate(()=>window.mailSourceCalls?.length||0),0,'failed evidence does not attach a partial selection');
 await p.locator('.nubi-feedback-region').dispatchEvent('keydown',{key:'Escape'});await p.evaluate(()=>window.mailEvidenceFailure=null);await p.getByRole('button',{name:'AI에 질문',exact:true}).click();
 await draft.waitFor();assert.equal(await draft.inputValue(),'선택한 메일에서 승인할 항목과 일정을 비교해 주세요.');
 assert.equal(await p.evaluate(()=>window.mailSourceCalls.length),3);
 const originalLink=p.locator('.desktop-mail-source .nubi-mail-reader-text a').first();await originalLink.waitFor();assert.equal(await originalLink.innerText(),'example.test');assert.equal(await originalLink.getAttribute('href'),'https://example.test/notice?tracking=fixture');
 await p.locator('.desktop-mail-source .nubi-mail-original>summary').click();assert((await p.locator('.desktop-mail-source .nubi-mail-raw-text').innerText()).includes('tracking=fixture'));await p.locator('.desktop-mail-source .nubi-mail-original>summary').click();
 await p.getByRole('region',{name:'질문에 연결한 메일 원문'}).waitFor();await p.getByRole('heading',{name:'10월 예산 승인 요청 1',exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.mailFlowCalls.filter(call=>call.method==='createTask'||call.method==='startAgent').length),0);
 await p.locator('.nubi-mail-evidence-group>summary').click();assert.equal(await p.locator('.composer .nubi-mail-evidence-chip').count(),3);await p.locator('.nubi-mail-evidence-group>summary').click();
 await p.getByLabel('연결한 메일 선택',{exact:true}).selectOption('2');await p.getByRole('heading',{name:'프로젝트 일정 공유 21',exact:true}).waitFor();await audit('mail-flow-ai');
 await p.getByRole('button',{name:'원문 닫기',exact:true}).click();await p.getByRole('button',{name:'메일',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('.nubi-mail-page-options>summary')?.textContent.includes('21–40'));assert.equal(await p.locator('.nubi-mail-selection-count').innerText(),'3개 선택');
 await results.evaluate(node=>node.scrollTop=300);
 await results.locator('.nubi-mail-result').nth(8).click();const scroll=await results.evaluate(node=>node.scrollTop);await p.getByRole('button',{name:'메일 목록으로',exact:true}).click();assert.equal(await results.evaluate(node=>node.scrollTop),scroll);
 await pager.click();await p.getByLabel('메일 페이지',{exact:true}).fill('3');await p.getByLabel('메일 페이지',{exact:true}).press('Enter');await p.waitForFunction(()=>document.querySelector('.nubi-mail-page-options>summary')?.textContent.includes('41–47'));
 await p.getByLabel('메일 목록 간격',{exact:true}).selectOption('compact');await p.getByLabel('메일 페이지',{exact:true}).press('Escape');assert.equal(await results.locator('.nubi-mail-result').count(),7);
 await p.setViewportSize({width:440,height:900});await results.locator('.nubi-mail-result').first().click();await p.locator('.nubi-mail-history-detail').waitFor({state:'visible'});assert.equal(await p.locator('.nubi-mail-history-list').isVisible(),true);await audit('mail-flow-reader-narrow');
 await p.getByRole('button',{name:'메일 목록으로',exact:true}).click();await p.locator('.nubi-mail-history-list').waitFor({state:'visible'});await audit('mail-flow-list-narrow');
 assert.match(await pager.innerText(),/41–47/);await p.getByRole('searchbox',{name:'메일 검색',exact:true}).fill('예산 승인');await p.locator('.nubi-mail-results[aria-busy="false"]').waitFor();await p.waitForFunction(()=>document.querySelectorAll('.nubi-mail-result').length===16);assert.equal(await p.locator('.nubi-mail-selection-count').count(),0);
 await pager.click();await p.getByLabel('메일 목록 간격',{exact:true}).selectOption('comfortable');await pager.click();
 await p.getByRole('button',{name:'홈',exact:true}).click();await draft.waitFor();await draft.press('Enter');await p.locator('.nubi-task').waitFor();
 const sent=await p.evaluate(()=>window.mailFlowCalls.find(call=>call.method==='createTask'));assert.equal(sent.mailReferences.length,3);assert(sent.mailReferences.every(item=>item.sourceHash==='a'.repeat(64)));

 await p.setViewportSize({width:1280,height:950});await load('screen=skills&many');
 await p.getByRole('button',{name:'내 스킬 다음 페이지'}).click();await p.getByText('스킬 11',{exact:true}).waitFor();assert.equal(await p.locator('.nubi-custom-skill-row').count(),1);await p.getByRole('button',{name:'내 스킬 이전 페이지'}).click();await p.getByText('스킬 1',{exact:true}).waitFor();assert.equal(await p.locator('.nubi-custom-skill-row').count(),10);
 await p.setViewportSize({width:1280,height:950});await load('integrated&modals&toolbar&mail-flow&mail-disconnected');
 await p.getByRole('button',{name:'메일',exact:true}).click();await p.locator('.nubi-mail-results[aria-busy="false"]').waitFor();
 await p.locator('.nubi-mail-results tbody input[type=checkbox]').nth(0).check();await p.locator('.nubi-mail-results tbody input[type=checkbox]').nth(1).check();await p.getByRole('button',{name:'AI에 질문',exact:true}).click();
 await p.locator('.nubi-mail-login-context').waitFor();assert.match(await p.locator('.nubi-mail-login-context').innerText(),/선택한 메일 2개/);await audit('mail-flow-reconnect');
 await p.getByRole('button',{name:'AI Pro',exact:true}).click();await draft.waitFor();assert.match(await p.locator('.composer .nubi-mail-evidence-group').innerText(),/선택한 메일 2개/);assert.equal(await p.evaluate(()=>window.mailFlowCalls.filter(call=>call.method==='createTask'||call.method==='startAgent').length),0);
 await audit('mail-flow-reconnected');

 await p.setViewportSize({width:1280,height:950});
 for(const screen of (process.env.NUBI_MAIL_FLOW_ONLY?[]:['models-long','mail-settings','mail-filters','registration','skills','marketplace','usage','claude-install','claude-login','claude-update'])){await load('screen='+screen);await p.getByRole('dialog').waitFor();await p.evaluate(()=>document.documentElement.style.fontSize='200%');await audit(screen+'-200pct');}
 }
 if(process.env.NUBI_WELCOME_ONLY){
  await p.addInitScript(()=>{const hour=new URLSearchParams(location.search).get('greeting-hour');if(hour!==null){const NativeDate=Date,fixed=new NativeDate(2026,9,12,Number(hour)).getTime();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}}});
  for(const width of [1280,440])for(const hour of [2,9,12,15,19,23]){
   await p.setViewportSize({width,height:950});await load('integrated&modals&toolbar&context&greeting-hour='+hour);await p.locator('.welcome-title').waitFor();
   const title=p.locator('.welcome-title .visually-hidden'),greeting=await title.innerText();assert(WELCOME_GREETINGS.find(period=>hour<period.until).lines.includes(greeting));
   await p.getByRole('textbox',{name:'작업 요청',exact:true}).fill('인사를 바꾸지 않는 초안');assert.equal(await title.innerText(),greeting);
   const measurements=await p.locator('.welcome-title').evaluate((heading,lines)=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),style=getComputedStyle(heading);ctx.font=style.font;return {available:heading.parentElement.clientWidth,widest:Math.max(...lines.map(line=>ctx.measureText(line).width)),nowrap:getComputedStyle(heading.querySelector('.welcome-display')).whiteSpace};},WELCOME_GREETINGS.flatMap(period=>period.lines));
   assert(measurements.widest<=measurements.available,'all greeting variants fit the current width');assert.equal(measurements.nowrap,'nowrap');
   await p.getByRole('textbox',{name:'작업 요청',exact:true}).fill('');await p.getByRole('button',{name:'새 대화',exact:true}).first().click();assert.notEqual(await title.innerText(),greeting);
   await p.screenshot({path:path.join(dir,`welcome-${hour}-${width}.png`)});records.push({screen:'welcome',width,hour,greeting,oneLine:true,stableWhileTyping:true});
  }
 }
 if(process.env.NUBI_PICKER_ONLY){
  for(const width of [1280,440]){
   await p.setViewportSize({width,height:950});await load('integrated&modals&toolbar&context');
   for(const [button,title,key] of [['추론 정도','추론 정도 조절','reasoning'],['스킬 관리','스킬 목록','skill-menu'],[/매번 확인/,'승인 방식','approval']]){
    await p.getByRole('button',{name:button,exact:typeof button==='string'}).click();await p.getByRole('dialog',{name:title,exact:true}).waitFor();await audit(key+'-'+width);if(key==='reasoning'){assert(await p.locator('.nubi-reasoning-heading strong').evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+2,r.top+r.height/2));}),'reasoning heading is not clipped by the rail');}await close();
   }
  }
 }
 if(process.env.NUBI_COMPOSER_ONLY){
  for(const running of [false,true]){
   await p.setViewportSize({width:1280,height:950});await load('integrated&modals&toolbar&context&composer-stress'+(running?'&composer-running':''));await chooseTask();
   const field=p.getByRole('textbox',{name:'추가 요청',exact:true});await field.fill(('긴 초안에서도 버튼은 한 줄을 유지합니다.\n').repeat(20));
   for(const width of [1280,1000,900,760,620,520,440]){await p.setViewportSize({width,height:950});await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await audit('composer-'+(running?'running':'idle')+'-'+width);}
   await p.setViewportSize({width:760,height:950});await p.evaluate(()=>document.documentElement.style.fontSize='200%');await audit('composer-'+(running?'running':'idle')+'-200pct');
  }
 }
 if(process.env.NUBI_NAV_ONLY){
  await p.setViewportSize({width:1280,height:950});await load('integrated&modals&toolbar&context');
  const checkNavigation=async name=>{
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await audit(name);
   const state=await p.evaluate(()=>{
    const nav=document.querySelector('.nubi-toolbar-navigation'),sidebar=document.querySelector('.nubi-sidebar'),rail=document.querySelector('.nubi-workspace-rail'),team=rail.querySelector('.nubi-rail-team');
    return {aligned:nav.dataset.aligned==='true',difference:Math.abs(nav.getBoundingClientRect().right-sidebar.getBoundingClientRect().right),rail:rail.getBoundingClientRect().width,last:rail.lastElementChild===team,bottom:rail.getBoundingClientRect().bottom-team.getBoundingClientRect().bottom};
   });
   if(state.aligned)assert(state.difference<1,'brand separator tracks the sidebar boundary');
   assert.equal(state.rail,72);assert(state.last&&state.bottom<32,'AI Workspace stays at the bottom');
  };
  await checkNavigation('navigation-1280');
  const resize=p.getByRole('separator',{name:'사이드바 너비 조절',exact:true});await resize.focus();await p.keyboard.press('ArrowRight');await checkNavigation('navigation-resized');
  await p.getByRole('button',{name:'사이드바 접기',exact:true}).click();await checkNavigation('navigation-collapsed');
  await p.getByRole('button',{name:'사이드바 펼치기',exact:true}).click();
  for(const width of [960,760,440]){await p.setViewportSize({width,height:950});await checkNavigation('navigation-'+width);}
  await p.setViewportSize({width:760,height:950});await p.evaluate(()=>document.documentElement.style.fontSize='200%');await checkNavigation('navigation-200pct');
 }
 // Screenshots freeze motion, so also sample the live animation and its pause contracts.
 if(!process.env.NUBI_COMPOSER_ONLY&&!process.env.NUBI_NAV_ONLY){
 await p.setViewportSize({width:1280,height:950});await load('integrated&modals&toolbar&context');await p.emulateMedia({reducedMotion:'no-preference'});
 await p.locator('.welcome-emblem .agent-mark').waitFor();
 const bird=p.locator('.welcome-emblem .agent-mark'),emblem=p.locator('.welcome-emblem');
 await p.mouse.move(2,2);
 const birdMotion=await bird.evaluate(bird=>{
  const motion=bird.parentElement.getAnimations().find(a=>a.animationName==='nubi-bird-flight');
  if(!motion)return null;
  motion.pause();const positions=[0,1600,4000,6000,8000].map(time=>{motion.currentTime=time;const m=new DOMMatrix(getComputedStyle(bird.parentElement).transform);return {x:m.m41,y:m.m42};});motion.play();
  const wing=bird.querySelector('.bird-wing'),flap=wing.getAnimations()[0];
  flap.pause();flap.currentTime=1080;const wingVisible=Number(getComputedStyle(wing).opacity);flap.play();
  return {positions,wingVisible,small:[...document.querySelectorAll('.nubi-logo .agent-mark')].map(e=>getComputedStyle(e).animationName)};
 });
 assert(birdMotion,'welcome bird has a flight path');
 assert(birdMotion.positions.some(v=>Math.abs(v.x)>3)&&birdMotion.positions.some(v=>v.y<-7),'bird actually flies');
 assert(birdMotion.positions.every(v=>Math.abs(v.x)<=4.01&&v.y>=-8.01&&v.y<=.01),'flight stays gentle and within its art');
 assert(birdMotion.wingVisible>.9,'the wing frame is visible during the flap');
 assert(birdMotion.small.every(v=>v==='none'),'small logo birds stay in place');
 await p.getByRole('textbox',{name:'작업 요청',exact:true}).focus();assert.equal(await emblem.evaluate(e=>getComputedStyle(e).animationPlayState),'running','typing does not freeze the bird');
 await p.locator('.welcome-art').hover();await p.waitForFunction(()=>getComputedStyle(document.querySelector('.welcome-emblem .agent-mark')).animationName==='nubi-bird-dance');
 await p.waitForTimeout(2000); // The greeting timer must not end the smile while the pointer remains.
 assert.equal(await bird.evaluate(e=>getComputedStyle(e).animationName),'nubi-bird-dance');
 assert.equal(await bird.locator('.bird-smile').evaluate(e=>getComputedStyle(e).opacity),'1');
 assert.equal(await bird.locator('.bird-wing').evaluate(e=>getComputedStyle(e).animationName),'none','hover expression is not overwritten by wing cycling');
 await p.screenshot({path:path.join(dir,'bird-hover.png')});
 await p.evaluate(()=>document.documentElement.dataset.motionVisibility='hidden');
 assert.equal(await bird.evaluate(e=>getComputedStyle(e).animationPlayState),'paused','hover dance pauses in the background');
 await p.evaluate(()=>{document.documentElement.dataset.motionVisibility='visible';const modal=document.createElement('div');modal.className='cx-panel-backdrop';modal.id='bird-motion-pause-check';document.body.append(modal);});
 assert.equal(await emblem.evaluate(e=>getComputedStyle(e).animationPlayState),'paused','modal pauses flight');
 assert.equal(await bird.evaluate(e=>getComputedStyle(e).animationPlayState),'paused','modal pauses greeting');
 await p.evaluate(()=>document.getElementById('bird-motion-pause-check').remove());
 await p.mouse.move(2,2);assert.equal(await bird.evaluate(e=>getComputedStyle(e).animationName),'none','greeting stops on leave');
 for(const [mood,frame] of [['sleep','bird-blink'],['sad','bird-sad']]){
  await bird.evaluate((e,mood)=>e.dataset.mood=mood,mood);
  await p.waitForFunction(frame=>Number(getComputedStyle(document.querySelector('.welcome-emblem .'+frame)).opacity)>.99,frame);
  assert(Number(await bird.locator('.'+frame).evaluate(e=>getComputedStyle(e).opacity))>.99,mood+' expression');
  assert.equal(await emblem.evaluate(e=>getComputedStyle(e).animationName),'none',mood+' lands instead of flying');
 }
 await bird.evaluate(e=>e.dataset.mood='idle');
 await p.evaluate(()=>document.documentElement.dataset.motionVisibility='hidden');assert.equal(await emblem.evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
 await p.evaluate(()=>document.documentElement.dataset.motionVisibility='visible');
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await emblem.evaluate(e=>getComputedStyle(e).animationName),'none');assert.equal(await bird.evaluate(e=>getComputedStyle(e).animationName),'none');
 await p.locator('.welcome-art').hover();assert.equal(await bird.evaluate(e=>getComputedStyle(e).animationName),'none','reduced motion retains expression without dancing');
 records.push({screen:'central-bird-motion',flight:true,wing:true,hover:true,sleep:true,sad:true,reducedMotion:true});
 await writeFile(path.join(dir,'bird-motion.json'),JSON.stringify(birdMotion,null,2));
 }
 assert.deepEqual(errors,[]);
 const result={passed:records.length,records,errors,boundary:'Actual production components with the complete Electron styles in isolated Electron, synthetic data. Native host screens covered by test:ui/test:skills-ui/test:agent-ui. OS pickers and externally hosted pages retain their owner UI. computerUse/A2A are disabled.'};await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log('passed',records.length);
}catch(error){await p?.screenshot({path:path.join(dir,'failure.png')});await writeFile(path.join(dir,'failure.txt'),error.stack+'\n'+await p?.locator('body').innerText()+'\n'+JSON.stringify(errors)+'\n'+JSON.stringify(await p?.evaluate(()=>[...document.querySelectorAll('.nubi-workbench,.nubi-workbench-content,.nubi-main,.nubi-task,.composer-stack,.composer,.nubi-sidebar')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).fontSize,padding:getComputedStyle(e).padding,width:getComputedStyle(e).width,minWidth:getComputedStyle(e).minWidth,margin:getComputedStyle(e).margin}))),null,2));throw error;}
finally{await app.close();await rm(storage,{recursive:true,force:true});}

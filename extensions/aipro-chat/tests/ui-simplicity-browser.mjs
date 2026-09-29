import {clickComposerAction} from './helpers/composer-actions.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chatgptToken} from './fixtures/chatgpt.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-ui-review-')),checks=[],errors=[];
let context,ui,worker;
const surfaces=[];
const button=name=>ui.getByRole('button',{name,exact:true});
const modal=name=>ui.getByRole('dialog',{name,exact:true});
const rpc=(type,args={})=>ui.evaluate(({type,args})=>chrome.runtime.sendMessage({type,...args}),{type,args});
async function close(){await ui.keyboard.press('Escape');}
async function checkHeader(width) {
  assert.equal(await ui.locator('.cx-kit-topbar .account-action').count(), 0);
  const clipped = await ui.locator('.cx-kit-topbar button').evaluateAll(buttons => buttons.filter(button => {
    const r = button.getBoundingClientRect();
    return r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight;
  }).map(button => button.getAttribute('aria-label') || button.textContent));
  assert.deepEqual(clipped, [], `${width}px header controls must remain fully visible`);
}
async function snapshot(name,width,height){
  const dialog=ui.locator('[role=dialog], [role=alertdialog]').last();await dialog.waitFor();await ui.evaluate(()=>document.fonts.ready);
  await ui.mouse.move(0,0);
  const typography=await assertModalTypography(dialog);
  const metrics=await dialog.evaluate(el=>{
    for(const a of el.getAnimations()){a.pause();a.currentTime=100;}
    const style=getComputedStyle(el),opacity=style.opacity;const title=getComputedStyle(el.querySelector('h2'));const inputs=[...el.querySelectorAll('input:not([type=checkbox]),textarea')].filter(input=>input.getClientRects().length).map(input=>getComputedStyle(input).fontSize);for(const a of el.getAnimations())a.finish();
    // Read settled state colors, not an interpolated hover color left by the
    // preceding click. Infinite busy/mascot animations retain their lifecycle.
    for(const a of el.getAnimations({subtree:true}))if(a.effect?.getTiming().iterations!==Infinity)a.finish();
    const r=el.getBoundingClientRect();
    const fields=[...el.querySelectorAll('.cx-kit-input,.cx-input-shell')].filter(x=>x.getClientRects().length).map(x=>({shadow:getComputedStyle(x).boxShadow,font:getComputedStyle(x).fontFamily}));
    const controls=[...el.querySelectorAll('.cx-kit-button,.cx-action-button')].map(x=>({connectTile:x.classList.contains('provider-connect-button'),radius:getComputedStyle(x).borderRadius,motion:getComputedStyle(x).transitionTimingFunction}));
    const primaryButtons=[...el.querySelectorAll('.cx-button--primary:not(:disabled)')].map(x=>({color:getComputedStyle(x).color,background:getComputedStyle(x).backgroundColor}));
    return {fields,controls,primaryButtons,radius:style.borderRadius,font:style.fontFamily,titleSize:title.fontSize,titleLine:title.lineHeight,inputs,opacity,background:style.backgroundColor,within:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,
      unlabeled:[...el.querySelectorAll('button')].filter(b=>!((b.getAttribute('aria-label')||b.textContent||b.title).trim())).length};
  });
  assert.equal(metrics.titleSize,'16px',name);assert.equal(metrics.titleLine,'24px',name);assert(metrics.inputs.every(size=>size==='14px'),`${name} input sizes: ${metrics.inputs}`);assert.equal(metrics.opacity,'1',name);assert.equal(metrics.background,'rgb(255, 255, 255)',name);assert(metrics.within,name);assert(!metrics.overflow,name);assert.equal(metrics.unlabeled,0,name);
  assert(metrics.font.includes('Noto Sans KR'),name);
  assert(metrics.fields.every(field=>field.shadow==='none'),`${name}: fields must not cast card shadows`);
  assert(metrics.controls.every(control=>control.radius===(control.connectTile?'28%':'12px')),`${name}: control and connection-tile corners follow the HTML standard`);
  assert.equal(metrics.radius,'20px',`${name}: the same white-card shape across every dialog`);
  assert(metrics.primaryButtons.every(button=>button.color==='rgb(255, 255, 255)'&&button.background==='rgb(27, 100, 218)'),`${name}: primary controls must use the HTML deep blue, including nested portals: ${JSON.stringify(metrics.primaryButtons)}`);
  surfaces.push({name,width,height,...metrics,typography});
  await ui.screenshot({path:`verification/simple-${name}-${width}x${height}.png`,animations:'disabled'});
}
try{
  await mkdir('verification',{recursive:true});
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});context.setDefaultTimeout(10000);
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');ui=await context.newPage();ui.on('pageerror',e=>errors.push(e.message));
  const url=`chrome-extension://${new URL(worker.url()).hostname}/index.html`;
  await context.route('https://chatgpt.com/backend-api/wham/usage',r=>r.fulfill({json:{rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000},secondary_window:{used_percent:60,limit_window_seconds:604800}}}}));
  await ui.goto(url);
  assert.equal(await ui.title(),'nubi — 브라우저 AI Agent');
  assert.equal(await ui.evaluate(()=>chrome.runtime.getManifest().name),'nubi');
  for(const [width,height] of [[320,640],[360,800],[1100,850]]){
    await ui.setViewportSize({width,height});await checkHeader(width);await button('FabriX').click();
    await modal('FabriX 연결').getByLabel('Endpoint').waitFor();
    assert.equal(await modal('FabriX 연결').locator('input').count(),3);
    assert.equal(await modal('FabriX 연결').getByText('모델 설정', {exact:true}).count(),0);
    assert.equal(await modal('FabriX 연결').getByLabel('모델 ID').count(),0);
    await snapshot('fabrix',width,height);await close();
    await button('설정').click();await snapshot('settings',width,height);
    assert.equal(await modal('설정').locator('.settings-version').innerText(),'Beta 1.0.0');
    assert.equal(await modal('설정').locator('.settings-version').getAttribute('aria-label'),'버전 Beta 1.0.0');
    await modal('설정').getByText('연결 진단',{exact:true}).click();
    await modal('설정').getByText('데이터 보관',{exact:true}).click();
    await snapshot('settings-expanded',width,height);
    await modal('설정').getByText('OpenWiki 폴더',{exact:true}).click();
    const nested=modal('설정').locator('.wiki-server-settings > summary');
    await nested.focus();await nested.press('Enter');
    await snapshot('settings-project-expanded',width,height);
    assert.equal(await modal('설정').locator('.wiki-server-settings').getAttribute('open'),'');
    await nested.press('Enter');await modal('설정').getByText('OpenWiki 폴더',{exact:true}).click();
    const summaries=await modal('설정').locator('.settings-fields > details > summary').evaluateAll(rows=>rows.map(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight];}));
    // Compare peer section headings, not the nested optional server disclosure.
    for (const summary of summaries.slice(1)) assert.deepEqual(summary,summaries[0]);
    await modal('설정').getByRole('button',{name:/도움말/}).click();
    assert.equal(await modal('도움말').locator('details[open]').count(),0);await snapshot('help',width,height);
    const first=modal('도움말').locator('summary').first();await first.focus();await first.press('Enter');
    assert.equal(await modal('도움말').locator('details[open]').count(),1);
    for(const summary of await modal('도움말').locator('summary').all()) {
      if(await summary.locator('..').getAttribute('open')===null) await summary.click();
      await assertModalTypography(modal('도움말'));
    }
    const pageHelp=modal('도움말').locator('.help-topic').filter({has:ui.getByText('페이지 읽기와 자동화',{exact:true})});
    await pageHelp.locator('summary').click();
    await snapshot('help-page',width,height);
    const emphasis=await pageHelp.evaluate(el=>{
      const style=selector=>{const s=getComputedStyle(el.querySelector(selector));return {weight:s.fontWeight,color:s.color,size:s.fontSize,line:s.lineHeight};};
      return {lead:style('.help-lead strong'),key:style('.help-points strong'),detail:style('.help-points dd')};
    });
    assert.deepEqual(emphasis,{lead:{weight:'600',color:'rgb(25, 31, 40)',size:'14px',line:'22px'},key:{weight:'600',color:'rgb(27, 100, 218)',size:'14px',line:'22px'},detail:{weight:'400',color:'rgb(78, 89, 104)',size:'14px',line:'22px'}});
    await snapshot('help-expanded',width,height);await close();await modal('설정').waitFor();await close();
    await button('설정').click();assert.equal(await button('누비 작업 연결').count(),0);await close();
    checks.push(`${width}px login, FabriX fields, settings and collapsed help fit; keyboard disclosure and Escape return work`);
  }
  await worker.evaluate(token=>chrome.storage.session.set({providerSessions:{chatgpt:{credential:{provider:'chatgpt',token,receivedAt:88,expiresAt:Date.now()+3600000}}}}),chatgptToken());
  assert.equal((await rpc('SELECT_PROVIDER',{provider:'chatgpt'})).ok,true);
  await button('모델 변경').waitFor();
  assert.equal((await rpc('DRAFT',{value:'글꼴 확인용 대화'})).ok,true);
  assert.equal((await rpc('NEW_CHAT')).ok,true);
  for(const [width,height] of [[320,640],[360,800],[1100,850]]){
    await ui.setViewportSize({width,height});
    await checkHeader(width);
    await button('모델 변경').click();await snapshot('models-connected',width,height);await modal('모델 선택').getByRole('tab',{name:'AI Pro',exact:true}).click();
    const login=modal('모델 선택').getByRole('button',{name:'로그인',exact:true});assert.equal(await login.getAttribute('data-icon-only'),'true');assert.equal(await login.locator('span.visually-hidden').count(),1);assert.equal(await login.getAttribute('title'),'AI Pro 연결');
    await snapshot('models',width,height);await close();
    await clickComposerAction(ui, '스킬 선택');assert.equal(await modal('스킬').locator('small').count(),0);await snapshot('skills',width,height);
    await button('스킬 등록').click();await modal('스킬 등록').getByLabel('이름',{exact:true}).fill('반복 업무');await modal('스킬 등록').getByLabel('지침',{exact:true}).fill('페이지 내용을 확인하고 필요한 항목을 정리합니다.');await snapshot('skill-editor',width,height);
    await ui.evaluate(()=>{window.originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=message=>message.type==='SAVE_SKILL'?Promise.resolve({ok:false,error:'storage_failed'}):window.originalSend(message);});
    await button('저장').click();await modal('스킬 등록').getByRole('alert').waitFor();await snapshot('skill-error',width,height);
    assert.equal(await modal('스킬 등록').getByLabel('이름',{exact:true}).inputValue(),'반복 업무');
    await ui.evaluate(()=>{chrome.runtime.sendMessage=window.originalSend;});
    await button('취소').click();await modal('스킬').waitFor();await close();
    await button('컨텍스트 사용량').click();assert.equal(await modal('컨텍스트').locator('details[open]').count(),0);await snapshot('context',width,height);
    await modal('컨텍스트').getByText('토큰 상세',{exact:true}).click();await modal('컨텍스트').getByText('최대 입력',{exact:true}).waitFor();await snapshot('context-expanded',width,height);await close();
    await button('사용량').click();await modal('사용량').getByText('75% 남음',{exact:true}).waitFor();assert.equal(await modal('사용량').locator('.usage-provider[open]').count(),0);await snapshot('usage',width,height);
    const row=modal('사용량').getByText('ChatGPT',{exact:true});await row.click();await modal('사용량').locator('.usage-provider[open]').getByText('0회 호출',{exact:true}).waitFor();await snapshot('usage-expanded',width,height);await close();
    await button('대화 이력').click();await snapshot('history',width,height);
    const remove=modal('대화 이력').getByRole('button',{name:/ 삭제$/}).first();
    await remove.click();await snapshot('delete-confirmation',width,height);
    assert(await button('취소').evaluate(el=>el===document.activeElement), 'Destructive confirmations initially focus Cancel');
    if(width===360){
      await ui.evaluate(()=>{window.originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);window.deleteCalls=0;chrome.runtime.sendMessage=message=>message.type==='DELETE_CONVERSATION'?(window.deleteCalls++,new Promise(resolve=>{window.failDelete=()=>resolve({ok:false,error:'storage_failed'});})) : window.originalSend(message);});
      await button('삭제').click();await ui.getByRole('alertdialog').locator('[aria-busy=true]').first().waitFor();
      await button('삭제').evaluate(el=>el.click());await ui.keyboard.press('Escape');
      assert(await ui.getByRole('alertdialog').isVisible());assert.equal(await ui.evaluate(()=>window.deleteCalls),1);
      await ui.evaluate(()=>window.failDelete());await ui.getByRole('alertdialog').getByRole('alert').waitFor();
      await snapshot('delete-error',width,height);
      await ui.evaluate(()=>{chrome.runtime.sendMessage=window.originalSend;});
    }
    await button('취소').click();assert(await remove.evaluate(el=>el===document.activeElement));await close();
    checks.push(`${width}px model login is icon-only; skills, context, usage and history stay compact with accessible details`);
  }
  await ui.emulateMedia({reducedMotion:'reduce'});await button('사용량').click();assert.equal(await modal('사용량').evaluate(el=>getComputedStyle(el).animationName),'none');assert(parseFloat(await modal('사용량').locator('.usage-provider summary > svg').first().evaluate(el=>getComputedStyle(el).transitionDuration))<=.001);await close();
  await button('설정').click();await modal('설정').getByText('OpenWiki 폴더',{exact:true}).click();
  const reducedSummary=modal('설정').locator('.wiki-server-settings > summary');
  await reducedSummary.focus();await reducedSummary.press('Enter');await assertModalTypography(modal('설정'));
  assert.equal(await reducedSummary.evaluate(el=>getComputedStyle(el.nextElementSibling).animationName),'none');
  assert(await reducedSummary.evaluate(el=>document.activeElement===el));await close();
  checks.push('Nested details keep keyboard focus and disable motion under reduced-motion settings');
  assert.deepEqual(errors,[]);await writeFile('verification/ui-simplicity-browser.json',JSON.stringify({checks,surfaces,errors,syntheticAccount:true,liveAccountVerified:false},null,2));console.log(checks.join('\n'));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}

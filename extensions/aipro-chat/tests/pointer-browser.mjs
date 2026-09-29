import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {pointerPresentation} from '../dist/browser-pointer.js';
import {POINTER_THEME} from '../dist/generated/browser-pointer-theme.js';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-pointer-')), extension = resolve(profile, 'extension');
const checks = [], errors = []; let context, worker, page, requestId = 'pointer-main';
const check = text => {checks.push(text); console.log('PASS ' + text);};
const elements = value => (value.observation || value).frames?.flatMap(frame => frame.elements || []) || [];
const events = `window.inputs=[]; window.pointerMotion=[]; window.pointerInput=[]; window.clicks=0;
document.addEventListener('pointerdown', e => {const marker=document.querySelector('nubi-action-pointer'); pointerMotion.push(pointerRoots.get(marker)?.getAnimations().length); inputs.push({trusted:e.isTrusted,x:e.clientX,y:e.clientY,phase:marker?.dataset.phase,hit:document.elementFromPoint(e.clientX,e.clientY)?.tagName,hidden:marker?.getAttribute('aria-hidden'),events:marker&&getComputedStyle(marker).pointerEvents,closed:marker?.shadowRoot===null,popover:marker?.matches(':popover-open')});});
document.addEventListener('input',event=>{const marker=document.querySelector('nubi-action-pointer');pointerInput.push({trusted:event.isTrusted,phase:marker?.dataset.phase,text:pointerRoots.get(marker)?.textContent,focused:document.activeElement===event.target});});`;
const site = `<!doctype html><html><meta charset="utf-8"><title>포인터 검증</title><style>
body{margin:0;padding:56px;background:#f1f7fe;color:#191f28;font:16px system-ui}main{max-width:760px;padding:32px;background:white;border-radius:24px}h1{margin-top:0}button,input{font:inherit;border:1px solid #e5e8eb;border-radius:12px;padding:14px 24px;background:#e8f1fe;color:#1b64da;margin:8px}label{display:block;margin:12px 0}iframe{width:500px;height:120px;border:1px solid #e5e8eb;border-radius:12px}#hover:hover + output{display:block}output{display:none}dialog{padding:36px;border:0;border-radius:24px}dialog button{display:block}</style>
<main><h1>누비의 브라우저 작업</h1><p>클릭과 입력을 화면에서 따라갑니다.</p><button id="choose" onclick="clicks++">항목 선택</button><button id="hover">도움말</button><output>도움말 열림</output><label>제목<input aria-label="제목"></label><div id="shadow"></div><iframe src="https://pointer-frame.example.test/" title="상세 입력"></iframe><button id="modal" onclick="document.querySelector('dialog').showModal()">설정 열기</button><a target="_blank" href="https://pointer.example.test/popup">새 화면</a></main><dialog><button onclick="clicks++;this.textContent='항목 확인됨'">모달 항목</button></dialog><div style="height:1500px"></div>
<script>${events}document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button onclick="window.clicks++">그림자 항목</button>';</script></html>`;
async function poll(fn, expected) {let value; for (let i = 0; i < 350; i++) {value = await fn(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 40));} assert.equal(value, expected);}
try {
  await mkdir('verification/pointer-video', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.pointerTest = {runBrowserAgent, stopBrowserAgent};\n');
  if (process.env.POINTER_PROBE === '1') {
    const agentFile=resolve(extension,'browser-agent.js');
    await writeFile(agentFile,(await readFile(agentFile,'utf8')).replace(/const showAction = [\s\S]+?\nconst endedRequests/, 'const showAction = (_task, _handle, _kind, action) => action();\nconst endedRequests'));
  }
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    viewport: {width: 1000, height: 760}, deviceScaleFactor: 2,
    recordVideo: {dir: resolve('verification/pointer-video'), size: {width: 1000, height: 760}},
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.setDefaultTimeout(10000);
  // Test-only access to the closed presentation root; production exposes none.
  await context.addInitScript(() => {
    window.pointerRoots = new WeakMap();
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const root = attach.call(this, options);
      if (this.localName === 'nubi-action-pointer') window.pointerRoots.set(this, root);
      return root;
    };
  });
  await context.route('https://pointer.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: site}));
  await context.route('https://pointer-frame.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<button onclick="clicks++">프레임 항목</button><script>${events}</script>`}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await poll(() => worker.evaluate(() => !!globalThis.pointerTest), true);
  page = await context.newPage(); await page.goto('https://pointer.example.test/'); await page.frameLocator('iframe').getByRole('button').waitFor();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://pointer.example.test/').id);
  const run = (name, args = {}) => worker.evaluate(({requestId, tabId, name, args}) => pointerTest.runBrowserAgent(requestId, {tabId}, name, args, {vision:true}), {requestId, tabId, name, args});
  const stop = () => worker.evaluate(id => pointerTest.stopBrowserAgent(id), requestId);
  const ref = async name => {const snapshot = (await run('browser_snapshot')).result; const item=elements(snapshot).find(el => el.name === name); assert(item, name); return item.ref;};
  if (process.env.POINTER_PROBE === '1') {
    await run('hover_element',{ref:await ref('도움말')});
    await run('fill_form',{fields:[{field_id:await ref('제목'),value:'입력'}]});
    const result=await run('run_playwright',{code:"await page.getByRole('button',{name:'그림자 항목'}).click(); return await browser.snapshot();"});
    console.log(JSON.stringify({pointerDisabled:true,receipt:result.result.execution,frames:await Promise.all(page.frames().map(f=>f.evaluate(()=>({url:location.href,inputs:window.inputs,clicks:window.clicks}))))}));
    await stop();
    process.exitCode=await page.evaluate(()=>clicks)===1?0:1;
  } else {
  await run('read_page'); assert.equal(await page.locator('nubi-action-pointer').count(), 1);
  assert.equal(await page.evaluate(()=>document.querySelector('nubi-action-pointer').dataset.phase), 'idle');
  await page.screenshot({path:'verification/pointer-reading.png'});
  await page.reload(); await page.waitForSelector('nubi-action-pointer');
  assert.equal(await page.evaluate(()=>document.querySelector('nubi-action-pointer').dataset.phase), 'idle');
  check('passive reading displays a resting pointer and navigation restores it without another action');

  const chooseRef=await ref('항목 선택');
  const clicking=run('click_element', {ref:chooseRef});
  await page.waitForFunction(()=>inputs.at(-1)?.phase==='click');
  await page.screenshot({path:'verification/pointer-click.png'});
  let result = await clicking;
  assert.equal(result.result.ok, true, JSON.stringify(result.result));
  assert.equal(await page.evaluate(() => clicks), 1);
  const input = await page.evaluate(() => inputs.at(-1));
  assert.deepEqual({...input, x: 0, y: 0}, {trusted:true,x:0,y:0,phase:'click',hit:'BUTTON',hidden:'true',events:'none',closed:true,popover:true});
  const box = await page.getByRole('button', {name:'항목 선택', exact:true}).boundingBox();
  assert(Math.abs(input.x - (box.x + box.width / 2)) < 2); assert(Math.abs(input.y - (box.y + box.height / 2)) < 2);
  check('one trusted click shows the pointer at actual CSS-pixel coordinates on a 2x display without intercepting input');
  await page.evaluate(()=>{window.retainedPointer=document.querySelector('nubi-action-pointer');window.retainedPosition=pointerRoots.get(retainedPointer).querySelector('.cursor').style.transform;});
  await page.waitForTimeout(11000);
  assert.equal(await page.evaluate(()=>retainedPointer===document.querySelector('nubi-action-pointer')&&getComputedStyle(retainedPointer).visibility==='visible'),true);
  await page.getByRole('button', {name:'항목 선택', exact:true}).click();
  assert.equal(await page.evaluate(() => inputs.at(-1).phase), 'idle');
  assert.equal(await page.evaluate(()=>pointerRoots.get(retainedPointer).querySelector('.cursor').style.transform===retainedPosition),true);
  check('the same visible cursor survives idle waits and ordinary user clicks do not move or animate it');

  const hovering = run('hover_element', {ref:await ref('도움말')});
  await hovering;
  assert.equal(await page.evaluate(()=>document.querySelector('nubi-action-pointer').dataset.cursor),'pointer');
  await page.screenshot({path:'verification/pointer-hover.png'});
  result=await hovering;
  assert.equal(result.result.ok, true); assert(await page.getByText('도움말 열림',{exact:true}).isVisible());
  assert.equal(await page.evaluate(()=>retainedPointer===document.querySelector('nubi-action-pointer')),true);
  check('hover reuses the same cursor and opens the actual tooltip');
  result = await run('fill_form', {fields:[{field_id:await ref('제목'),value:'브라우저 작업 확인'}]});
  assert.equal(result.result.verified,true); assert.equal(await page.getByLabel('제목').inputValue(),'브라우저 작업 확인');
  // The observation returned by the tool can take longer than the visual TTL.
  // Assert presentation at the actual event, then assert the committed value.
  assert.deepEqual(await page.evaluate(()=>pointerInput.at(-1)),{trusted:true,phase:'input',text:'',focused:true});
  check('field feedback keeps focus and input intact without copying values into the indicator');

  result = await run('run_playwright',{code:"await page.getByRole('button', {name:'그림자 항목'}).click(); return await browser.snapshot();"});
  assert(!result.result.error,JSON.stringify(result.result)); assert.equal(await page.evaluate(()=>clicks),3,JSON.stringify(result.result.execution));
  result = await run('click_element',{ref:await ref('프레임 항목')}); assert.equal(result.result.ok,true);
  const frame = page.frames().find(frame=>frame.url().includes('pointer-frame'));
  assert.equal(await frame.evaluate(()=>inputs.at(-1).phase),'click'); assert.equal(await frame.evaluate(()=>clicks),1);
  check('script actions, shadow controls and cross-origin iframe clicks share the same presentation');

  await run('click_element',{ref:await ref('설정 열기')});
  const modalRef=await ref('모달 항목');
  const modalClick=run('click_element',{ref:modalRef});
  await page.waitForFunction(()=>document.querySelector('dialog button')?.textContent==='항목 확인됨');
  await page.screenshot({path:'verification/pointer-dialog.png'});
  result = await modalClick; assert.equal(result.result.ok,true);
  assert.equal(await page.evaluate(()=>inputs.at(-1).popover),true); assert(await page.getByText('항목 확인됨',{exact:true}).isVisible());
  await page.evaluate(()=>document.querySelector('dialog').close());
  check('an HTML dialog retains its real click target while the inert pointer is drawn above it');

  await page.emulateMedia({reducedMotion:'reduce'});
  await run('click_element',{ref:await ref('항목 선택')});
  assert.equal(await page.evaluate(()=>pointerMotion.at(-1)),0);
  result = await run('capture_page',{full_page:false}); assert(result.result.image?.data);
  assert.equal(await page.evaluate(()=>retainedPointer===document.querySelector('nubi-action-pointer')&&getComputedStyle(retainedPointer).visibility==='visible'),true);
  assert.equal(await frame.locator('nubi-action-pointer').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  const hiddenScreenshot=await page.screenshot({scale:'css',style:'nubi-action-pointer { visibility: hidden !important; }'});
  const shownScreenshot=await page.screenshot({scale:'css'});
  const pixelProof=await page.evaluate(async ({captured,hidden,shown})=>{
    const rect=pointerRoots.get(retainedPointer).querySelector('.cursor').getBoundingClientRect();
    const pixels=async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(Math.floor(rect.x),Math.floor(rect.y),24,28).data];};
    const [a,b,c]=await Promise.all([captured,hidden,shown].map(pixels));return {captureMatchesHidden:a.every((v,i)=>v===b[i]),visibleDiffers:c.some((v,i)=>v!==b[i])};
  },{captured:result.result.image.data,hidden:hiddenScreenshot.toString('base64'),shown:shownScreenshot.toString('base64')});
  assert.deepEqual(pixelProof,{captureMatchesHidden:true,visibleDiffers:true});
  assert(!JSON.stringify(result.result.observation).includes('nubi-action-pointer'));
  check('reduced motion is static; capture pixels exclude the cursor and retain its visible DOM afterward');

  result = await run('capture_page',{full_page:false});
  const choose = await page.getByRole('button',{name:'항목 선택',exact:true}).boundingBox();
  result = await run('click_at',{screenshot_id:result.result.screenshot_id,x:choose.x+choose.width/2,y:choose.y+choose.height/2});
  assert.equal(result.result.ok,true,JSON.stringify(result.result)); assert.equal(await page.evaluate(()=>inputs.at(-1).phase),'click');
  check('vision coordinate clicks render from delivered browser events using the existing screenshot validation');
  const stale=await run('capture_page',{full_page:false});
  await run('run_playwright',{code:"await page.getByRole('button',{name:'도움말'}).hover(); return await browser.snapshot();"});
  const countBeforeStale=await page.evaluate(()=>clicks);
  result=await run('click_at',{screenshot_id:stale.result.screenshot_id,x:choose.x+choose.width/2,y:choose.y+choose.height/2});
  assert.equal(result.result.error,'browser_stale');assert.equal(await page.evaluate(()=>clicks),countBeforeStale);
  check('a script hover invalidates earlier screenshot coordinates before any point click');
  await stop();
  assert.equal(await page.locator('nubi-action-pointer').count(),0);
  assert.equal(await frame.locator('nubi-action-pointer').count(),0);
  check('task stop removes the pointer from all affected frames');

  // Native HTML dragging cancels the pointer stream while drag events continue.
  await page.evaluate(() => {
    const zone=document.createElement('section');zone.id='drag-check';
    zone.style.cssText='position:fixed;left:80px;top:80px;display:flex;gap:80px;background:white;padding:24px;z-index:10';
    zone.innerHTML='<div draggable="true" aria-label="검토 카드" style="padding:24px;background:#e8f1fe">검토 카드</div><section aria-label="검토함" ondragover="event.preventDefault()" ondrop="event.preventDefault()" style="padding:24px;background:#e6f6f9">검토함</section>';
    document.body.append(zone);window.dragTrace=[];
    const [source,destination]=zone.children;
    source.addEventListener('dragstart',event=>event.dataTransfer.setData('text/plain','card'));
    for (const type of ['pointercancel','dragover','drop','dragend']) document.addEventListener(type,event=>{
      const marker=document.querySelector('nubi-action-pointer');
      dragTrace.push({type,trusted:event.isTrusted,phase:marker?.dataset.phase,pressed:marker?.hasAttribute('data-pressed')});
    });
    destination.addEventListener('dragover',event=>event.preventDefault());
    destination.addEventListener('drop',event=>{event.preventDefault();destination.append(source);});
  });
  requestId='pointer-native-drag';
  const dragTargets=elements((await run('browser_snapshot')).result);
  const sourceRef=dragTargets.find(item=>item.name==='검토 카드')?.ref, destinationRef=dragTargets.find(item=>item.name==='검토함')?.ref;
  assert(sourceRef);assert(destinationRef);
  result=await run('drag_element',{source_ref:sourceRef,target_ref:destinationRef});
  assert.equal(result.result.ok,true,JSON.stringify(result));
  assert.equal(await page.locator('[aria-label="검토함"] [aria-label="검토 카드"]').count(),1);
  const dragTrace=await page.evaluate(()=>dragTrace);
  assert(dragTrace.some(event=>event.type==='pointercancel'&&event.trusted&&event.phase==='drag'));
  assert(dragTrace.some(event=>event.type==='dragover'&&event.trusted&&event.phase==='drag'&&event.pressed));
  assert(dragTrace.some(event=>event.type==='drop'&&event.trusted&&event.phase==='drag'&&!event.pressed));
  await stop();await page.evaluate(()=>document.querySelector('#drag-check').remove());
  check('native HTML drag keeps the cursor through pointercancel and clears the held state on a real drop');

  // Exercise intermediate mouse states without delaying production actions.
  const arm = async kind => {
    const id=crypto.randomUUID();
    await page.evaluate(pointerPresentation,{operation:'arm',kind,id,owner:'visual-check',until:Date.now()+10000,theme:POINTER_THEME});
    return id;
  };
  const visual = () => page.evaluate(() => {
    const host=document.querySelector('nubi-action-pointer'), root=pointerRoots.get(host);
    const css=selector=>getComputedStyle(root.querySelector(selector));
    return {phase:host.dataset.phase,shape:host.dataset.cursor,pressed:host.hasAttribute('data-pressed'),cursor:css('.cursor').display,transition:css('.cursor').transitionDuration,
      halo:css('.halo').opacity,haloStyle:css('.halo').borderTopStyle,ring:css('.ring').display,wheel:css('.wheel').display,
      animations:root.getAnimations().length};
  });
  await page.emulateMedia({reducedMotion:'no-preference'});
  await arm('hover');
  await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointermove',{clientX:140,clientY:100,bubbles:true})));
  assert.equal((await visual()).cursor,'block'); assert.equal((await visual()).phase,'target');
  await page.mouse.move(140,100); await page.mouse.move(170,100);
  assert.equal((await visual()).halo,'0'); assert.equal((await visual()).transition,`${POINTER_THEME.travel/1000}s`);
  check('synthetic events cannot change the resting state; trusted movement gets short visual interpolation');
  const siteCursor=await page.evaluate(()=>{
    document.body.style.cursor='crosshair';
    return getComputedStyle(document.body).cursor;
  });
  await page.mouse.move(250,110);
  await page.waitForTimeout(POINTER_THEME.travel+30);
  const pointerIdentity=await page.evaluate(()=>{
    const root=pointerRoots.get(document.querySelector('nubi-action-pointer'));
    return {cursor:getComputedStyle(document.body).cursor,
      overlayHit:document.elementFromPoint(250,110)?.closest('nubi-action-pointer')!==null};
  });
  assert.equal(pointerIdentity.cursor,siteCursor); assert.equal(pointerIdentity.overlayHit,false);
  await page.screenshot({path:'verification/pointer-detail.png',clip:{x:170,y:60,width:280,height:160}});
  await page.mouse.move(997,757);
  await page.waitForTimeout(POINTER_THEME.travel+30);
  const tip=await page.evaluate(()=>{
    const rect=pointerRoots.get(document.querySelector('nubi-action-pointer')).querySelector('.cursor').getBoundingClientRect();
    return {x:rect.left+3,y:rect.top+2};
  });
  assert.deepEqual(tip,{x:997,y:757});
  await page.evaluate(()=>document.body.style.removeProperty('cursor'));
  check('virtual pointer preserves its exact hotspot near viewport edges without changing the site cursor or intercepting hits');

  await page.evaluate(()=>{
    const controls=document.createElement('div');controls.id='cursor-states';
    controls.style.cssText='position:fixed;left:100px;bottom:30px;display:flex;background:white;z-index:100';
    controls.innerHTML='<a href="#cursor-target" style="padding:20px">링크</a><input aria-label="포인터 입력" value="보존할 초안"><div draggable="true" style="cursor:grab;padding:20px">이동</div><button disabled>사용 불가</button>';
    document.body.append(controls);
  });
  const hoverState = async (selector, expected) => {
    await arm('hover'); const rect=await page.locator(selector).boundingBox();
    const x=rect.x+rect.width/2, y=rect.y+rect.height/2;
    await page.mouse.move(x,y); assert.equal((await visual()).shape,expected);
    await page.waitForTimeout(POINTER_THEME.travel + 30);
    const hotspot=await page.evaluate(()=>{
      const root=pointerRoots.get(document.querySelector('nubi-action-pointer'));
      const cursor=root.querySelector('.cursor'), rect=cursor.getBoundingClientRect(), style=getComputedStyle(cursor);
      return {x:rect.left+parseFloat(style.getPropertyValue('--hotspot-x')),y:rect.top+parseFloat(style.getPropertyValue('--hotspot-y'))};
    });
    assert(Math.abs(hotspot.x-x)<1&&Math.abs(hotspot.y-y)<1);
  };
  await hoverState('#cursor-states a','pointer');
  await page.screenshot({path:'verification/pointer-link.png',clip:{x:80,y:600,width:420,height:160}});
  await hoverState('#cursor-states input','text');
  assert.equal(await page.getByLabel('포인터 입력').inputValue(),'보존할 초안');
  await page.screenshot({path:'verification/pointer-text.png',clip:{x:80,y:600,width:420,height:160}});
  await hoverState('#cursor-states [draggable]','grab');
  await hoverState('#cursor-states button','blocked');
  await page.evaluate(()=>document.querySelector('#cursor-states').remove());
  check('link, editor, draggable and disabled states switch visual glyphs while retaining the actual hotspot and draft');
  await arm('drag'); await page.mouse.move(170,100); await page.mouse.down(); await page.mouse.move(250,100);
  assert.equal((await visual()).pressed,true); assert.equal((await visual()).haloStyle,'dashed'); assert.equal((await visual()).shape,'grabbing');
  await page.emulateMedia({reducedMotion:'reduce'});
  await poll(async()=>(await visual()).animations,0);
  assert.equal((await visual()).transition,'0s');
  await page.mouse.up(); assert.equal((await visual()).pressed,false); assert.equal((await visual()).transition,'0s');
  check('drag feedback follows press/release and an in-flight reduced-motion change stops all motion');
  await arm('scroll'); await page.mouse.wheel(0,120);
  await poll(async()=>(await visual()).phase,'scroll');
  assert.equal((await visual()).wheel,'block'); assert.equal((await visual()).ring,'none');
  check('wheel input shows a scroll glyph rather than a false click pulse');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await arm('click');
  await page.evaluate(() => document.addEventListener('pointerup', () => {
    globalThis.__nubiActionPointerV1.finish();
    const root = pointerRoots.get(document.querySelector('nubi-action-pointer'));
    window.finishedPulse = {visible: !root.querySelector('.ring').hidden, animations: root.getAnimations().length};
  }, {once:true}));
  await page.mouse.click(170,100);
  assert.equal(await page.evaluate(() => finishedPulse.visible), true);
  assert((await page.evaluate(() => finishedPulse.animations)) > 0);
  await page.waitForTimeout(POINTER_THEME.pulse + 30);
  assert.equal((await visual()).ring, 'none');
  check('a fast completed click keeps its pulse until the motion duration ends without replaying input');
  await page.evaluate(pointerPresentation,{operation:'clear',owner:'visual-check'});
  const stalePointer=await arm('hover'), currentPointer=await arm('hover');
  await page.mouse.move(175,110);
  await page.evaluate(pointerPresentation,{operation:'finish',id:stalePointer,failed:true});
  await page.evaluate(pointerPresentation,{operation:'clear',owner:'other-task'});
  assert.equal(await page.locator('nubi-action-pointer').count(),1);
  await page.evaluate(pointerPresentation,{operation:'finish',id:currentPointer,failed:false});
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await page.locator('nubi-action-pointer').count(),0);
  check('late cleanup cannot clear a newer action, and page exit removes finished feedback immediately');
  await page.evaluate(()=>scrollTo(0,0));
  await page.setViewportSize({width:390,height:760});
  await arm('hover'); await page.mouse.move(160,110);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('nubi-action-pointer')).pointerEvents),'none');
  await page.screenshot({path:'verification/pointer-narrow.png'});
  await page.evaluate(pointerPresentation,{operation:'clear',owner:'visual-check'});
  await page.setViewportSize({width:1000,height:760});
  await page.emulateMedia({reducedMotion:'no-preference'});
  check('the same cursor stays non-interactive in a narrow viewport');

  requestId='pointer-render-failure';
  await page.evaluate(()=>{window.pointerSheet=CSSStyleSheet;window.CSSStyleSheet=class{constructor(){throw Error('Synthetic presentation failure');}};});
  const before=await page.evaluate(()=>clicks);
  result=await run('click_element',{ref:await ref('항목 선택')}); assert.equal(result.result.ok,true); assert.equal(await page.evaluate(()=>clicks),before+1);
  await page.evaluate(()=>{window.CSSStyleSheet=window.pointerSheet;}); await stop();
  check('a broken visual layer neither blocks nor repeats the actual click');

  requestId='pointer-popup';
  result=await run('click_element',{ref:await ref('새 화면')}); assert.equal(result.result.ok,true); assert.notEqual(result.tabId,tabId);
  assert.equal(await page.locator('nubi-action-pointer').count(),0); await stop();
  check('following a new tab clears the old document pointer');
  await page.bringToFront(); await page.clock.install();
  const leaseId=await arm('hover');await page.mouse.move(180,110);
  await page.evaluate(pointerPresentation,{operation:'finish',id:leaseId});
  await page.clock.fastForward(29000);assert.equal(await page.locator('nubi-action-pointer').count(),1);
  await page.evaluate(pointerPresentation,{operation:'touch',owner:'visual-check'});
  await page.clock.fastForward(29000);assert.equal(await page.locator('nubi-action-pointer').count(),1);
  await page.clock.fastForward(1001);assert.equal(await page.locator('nubi-action-pointer').count(),0);
  check('a renewed lease keeps the marker alive and an orphan expires after the worker stops renewing it');
  assert.deepEqual(errors,[]);
  await writeFile('verification/pointer-browser.json',JSON.stringify({checks,actualBrowser:true,actualModel:false,liveAccount:false},null,2));
  const video=page.video(); await page.close();
  await video.saveAs('verification/pointer-demo.webm');
  await context.close(); context=null;
  }
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}

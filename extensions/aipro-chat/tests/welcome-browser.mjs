import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const profile = await mkdtemp(resolve(tmpdir(), 'aipro-composer-'));
const extension = resolve(profile, 'extension'), baseline = process.env.BASELINE === '1';
await cp(process.env.TEST_EXTENSION || resolve('dist'), extension, {recursive:true});
const manifest = JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
manifest.host_permissions.push('http://*/*','https://*/*');
await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const errors=[], checks=[];
try {
  await mkdir('verification',{recursive:true});
  await context.route('https://aipro.sdsdev.co.kr/api/models',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({modelList:[{name:'GLM-5.2-NVFP4',display_name:'GLM-5.2-512K'}]})}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions',r=>{
    if(r.request().postDataJSON().messages[0]?.content?.startsWith("You are Nubi's completion-intent reviewer."))return r.fulfill({json:{choices:[{message:{content:JSON.stringify({decision:'reply',scope:'conversation',next_step:''})},finish_reason:'stop'}]}});
    return r.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:'첫 대화를 확인했습니다.'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`});
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  
  const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:360,height:800});
  await page.addInitScript(() => {
    window.welcomeSamples=[];
    const observer=new MutationObserver(() => {
      const title=document.querySelector('.welcome-title'), typed=document.querySelector('.welcome-typed');
      if (typed) window.welcomeSamples.push({text:typed.textContent, width:title.getBoundingClientRect().width, fontsReady:document.fonts.status==='loaded'});
    });
    observer.observe(document, {subtree:true,childList:true,characterData:true});
  });
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await page.getByRole('button',{name:'AI Pro',exact:true}).waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({path:'verification/login-0.10.1-360x800.png'});
  await page.setViewportSize({width:1100,height:850});
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({path:'verification/login-0.10.1-1100x850.png'});
  await page.setViewportSize({width:360,height:480});
  const loginOverflow=await page.evaluate(()=>({x:document.documentElement.scrollWidth>innerWidth,y:document.documentElement.scrollHeight>innerHeight}));
  assert.deepEqual(loginOverflow,{x:false,y:false});
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({path:'verification/login-0.10.1-360x480.png'});
  for (const [width,height] of [[360,800],[1100,850],[320,640],[360,480]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    const boxes = await page.locator('.provider-button').evaluateAll(buttons => buttons.map(button => {
      const rect = el => {const {x,y,width,height}=el.getBoundingClientRect();return {x,y,width,height,cx:x+width/2,cy:y+height/2};};
      return {button:rect(button),label:rect(button.querySelector('.provider-label')),logo:rect(button.querySelector('img')),text:rect(button.querySelector('.provider-label > span'))};
    }));
    for(const box of boxes){assert(box.button.height>=48);assert(Math.abs(box.button.cy-box.logo.cy)<.6);assert(Math.abs(box.button.cy-box.text.cy)<.6);assert(Math.abs(box.button.cx-box.label.cx)<.6);}
    assert(Math.max(...boxes.map(b=>b.logo.x))-Math.min(...boxes.map(b=>b.logo.x))<.6);
    assert(Math.max(...boxes.map(b=>b.text.x))-Math.min(...boxes.map(b=>b.text.x))<.6);
    const panel=await page.locator('.provider-options').boundingBox();
    const first=boxes[0].button,last=boxes.at(-1).button;
    assert(Math.abs((first.y-panel.y)-(panel.y+panel.height-last.y-last.height))<.6);
    assert(first.y >= 0 && last.y + last.height <= height, 'All provider choices must be visible without scrolling');
    checks.push({label:`${width}x${height} provider vertical centers, 48px targets, shared icon/text starts and equal card padding`,boxes});
    await page.screenshot({path:`verification/login-aligned-${width}x${height}.png`});
  }
  const providerStyles=[];
  for(const provider of ['aipro','chatgpt','fabrix']) {
    const button=page.locator(`[data-provider="${provider}"]`);
    const style=()=>button.evaluate(el=>{const s=getComputedStyle(el);return {image:s.backgroundImage,color:s.backgroundColor,text:s.color,filter:getComputedStyle(el.querySelector('img')).filter};});
    await page.mouse.move(0,0);const normal=await style(); await button.hover();await page.waitForTimeout(220);const hover=await style();
    assert.notEqual(normal.text,'rgb(255, 255, 255)'); assert.equal(hover.text,normal.text);assert.equal(normal.image,hover.image);assert.equal(normal.color,hover.color);
    providerStyles.push({provider,...normal});
  }
  assert.notEqual(providerStyles[0].image,providerStyles[2].image);
  assert.equal(providerStyles[1].text,'rgb(25, 31, 40)');assert.equal(providerStyles[1].filter,'none');
  checks.push({label:'three provider pastel surfaces retain dark readable labels, transparent logo backgrounds and hover colors',providerStyles});
  await page.mouse.move(0,0);
  await page.setViewportSize({width:360,height:800});
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic-layout-token',receivedAt:93}}));
  const state=()=>page.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
  async function poll(fn,want){let last;for(let i=0;i<200;i++){last=await fn();if(last===want)return;await new Promise(r=>setTimeout(r,50));}assert.equal(last,want);}
  const input=()=>page.getByRole('textbox',{name:'메시지',exact:true});
  async function placement(label){
    const value=await page.evaluate(()=>{
      const box=document.querySelector('.composer').getBoundingClientRect();
      const main=document.querySelector('.cx-kit-main'), mainBox=main.getBoundingClientRect(), outer=getComputedStyle(main);
      const empty=Boolean(document.querySelector('.chat-page.is-empty'));
      const welcome=document.querySelector('.welcome')?.getBoundingClientRect();
      return {bottom:box.bottom,top:box.top,height:innerHeight,inset:parseFloat(outer.paddingBottom),empty,
        welcomeBottom:welcome?.bottom,groupCenter:welcome ? (welcome.top+box.bottom)/2 : null,mainCenter:(mainBox.top+mainBox.bottom)/2,
        horizontalOverflow:document.documentElement.scrollWidth>innerWidth,verticalOverflow:document.documentElement.scrollHeight>innerHeight};
    });
    if(!baseline){
      if(value.empty) assert(value.welcomeBottom <= value.top,JSON.stringify(value));
      assert(Math.abs(value.height-value.bottom-value.inset)<1,JSON.stringify(value));
      assert.equal(value.horizontalOverflow,false);assert.equal(value.verticalOverflow,false);
    }
    checks.push({label,...value}); return value;
  }
  await input().waitFor(); await poll(async()=>!!(await state()).catalog?.models?.length,true);
  await page.waitForFunction(()=>document.querySelector('.welcome-typed')?.textContent === '누비에게 무엇을 맡길까요?');
  const welcomeSamples=await page.evaluate(()=>window.welcomeSamples);
  assert(welcomeSamples.some(s=>s.text.length>0 && s.text.length<11),'Expected partial Korean greeting');
  const widths=welcomeSamples.filter(s=>s.fontsReady).map(s=>s.width);
  assert(widths.length > 1);
  assert(Math.max(...widths)-Math.min(...widths)<1,'Typing must reserve stable title width');
  const heading=page.getByRole('heading',{name:'누비에게 무엇을 맡길까요?',exact:true});
  assert.equal(await heading.count(),1);
  const image=page.locator('.welcome-emblem');
  const transformBefore=await image.evaluate(el=>getComputedStyle(el).transform);
  await page.waitForTimeout(220);
  const transformAfter=await image.evaluate(el=>getComputedStyle(el).transform);
  assert.notEqual(transformBefore,transformAfter,'Logo must move');
  const motion=await image.evaluate(el=>({duration:getComputedStyle(el).animationDuration,iterations:getComputedStyle(el).animationIterationCount}));
  assert.deepEqual(motion,{duration:'6s',iterations:'infinite'});
  await input().focus();
  assert.equal(await image.evaluate(el=>getComputedStyle(el).animationPlayState),'running');
  const focusedTransform=await image.evaluate(el=>getComputedStyle(el).transform);
  await page.waitForTimeout(220);
  assert.notEqual(await image.evaluate(el=>getComputedStyle(el).transform),focusedTransform,'Logo must keep floating while the composer has focus');
  assert.equal(await page.locator('.welcome-cursor.is-typing').count(),0);
  await page.locator('.welcome-title').click();
  assert.equal(await page.getByRole('button',{name:/배경 움직임/}).count(),0);
  await page.evaluate(()=>localStorage.setItem('aipro:motion-paused','true'));
  await page.reload(); await input().waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('aipro:motion-paused')),null);
  assert.equal(await image.evaluate(el=>getComputedStyle(el).animationPlayState),'running');
  checks.push({label:'removed motion control leaves no stale pause preference; OS reduced motion remains supported'});
  for(const [width,height] of baseline?[[360,800]]:[[360,800],[1100,850],[360,480]]){
    await page.setViewportSize({width,height});
    await page.getByRole('heading',{name:'누비에게 무엇을 맡길까요?',exact:true}).waitFor();
    await placement(`${width}x${height} empty`);
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({path:`verification/composer-${manifest.version}-${width}x${height}-empty.png`});
    if(baseline)continue;
    assert.equal(await page.locator('.welcome-emblem').evaluate(el=>getComputedStyle(el).animationIterationCount),'infinite');
    await input().fill('첫 번째 줄\n두 번째 줄\n세 번째 줄\n네 번째 줄');
    await placement(`${width}x${height} multiline`);
    await input().fill('안녕하세요');
    await page.getByRole('button',{name:'전송',exact:true}).click();
    await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
    await placement(`${width}x${height} first reply`);
    const replySurface=await page.locator('.message-assistant > .message-body').last().evaluate(el=>{
      const style=getComputedStyle(el);
      return {background:style.backgroundColor,border:style.borderWidth,padding:style.padding};
    });
    assert.deepEqual(replySurface,{background:'rgba(0, 0, 0, 0)',border:'0px',padding:'0px'},'Assistant replies stay unboxed');
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({path:`verification/composer-${manifest.version}-${width}x${height}-reply.png`});
    await page.getByRole('button',{name:'대화 이력',exact:true}).click();
    await page.getByRole('dialog',{name:'대화 이력',exact:true}).getByRole('button',{name:'새 대화',exact:true}).click();
    await page.getByRole('heading',{name:'누비에게 무엇을 맡길까요?',exact:true}).waitFor();
    await placement(`${width}x${height} new chat`);
    assert.equal(await page.locator('.welcome-cursor.is-typing').count(),0,'Do not replay greeting on new chat');
    await page.reload(); await input().waitFor();
    await placement(`${width}x${height} reload`);
  }
  await page.reload(); await input().waitFor();
  await input().focus();
  await page.waitForFunction(()=>document.querySelector('.welcome-typed')?.textContent === '누비에게 무엇을 맡길까요?');
  assert.equal(await page.locator('.welcome-cursor.is-typing').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload(); await input().waitFor();
  await page.getByRole('heading',{name:'누비에게 무엇을 맡길까요?',exact:true}).waitFor();
  assert.equal(await page.locator('.welcome-emblem').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.welcome-reserve').evaluate(el=>getComputedStyle(el).visibility),'visible');
  assert.equal(await page.locator('.motion-control').isVisible(),false);
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({path:'verification/welcome-0.10.1-reduced-motion.png'});
  assert.deepEqual(errors,[]);
  const result={version:manifest.version,baseline,checks,errors,syntheticAuthAndModel:true,fixtureSiteAccessPregranted:true,typingProgression:true,stableHeadingWidth:true,logoMotion:true,motionContinuesOnFocus:true,earlyTypingCompletion:true,reducedMotion:true,noGreetingReplay:true,loginOverflow:false};
  await writeFile(`verification/composer-${manifest.version}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}

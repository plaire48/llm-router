import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-capture-coverage-')), extension=resolve(profile,'extension');
const checks=[], pendingImages=new Set(); let context;
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>구간 캡처</title>
<style>body{margin:24px;font:16px sans-serif;height:3200px}.pane{height:240px;width:500px;overflow:auto;border:2px solid teal}.content{height:1100px;background:linear-gradient(white,#acf)}.horizontal{width:300px;height:90px;overflow:auto}.wide{width:1100px;height:50px}img{width:50px;height:50px}iframe{display:block;width:540px;height:270px}</style>
<h1>주문 내역</h1><div class="pane" id="history" aria-label="주문 이력"><div class="content"><p>첫 구간</p><div role="grid" aria-rowcount="1000"><div role="row" aria-rowindex="1"><span role="gridcell">행 1</span></div></div></div></div>
<div class="horizontal" id="horizontal" aria-label="가로 이력"><div class="wide">가로 구간</div></div>
<img alt="불러오는 도표" src="/slow.png"><img alt="없는 이미지" src="/broken.png"><iframe src="/frame"></iframe>
<script>window.scrollReceipts=0;historyBox=document.querySelector('#history');historyBox.addEventListener('scroll',()=>{scrollReceipts++;document.querySelector('[role=row]').setAttribute('aria-rowindex',String(1+Math.floor(historyBox.scrollTop/50)));});</script></html>`;
const server=createServer((req,res)=>{
  if(req.url==='/slow.png'){pendingImages.add(res);res.on('close',()=>pendingImages.delete(res));return;}
  if(req.url==='/broken.png'){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(req.url==='/frame'?'<style>body{margin:10px}.inner{height:160px;overflow:auto}</style><div class="inner" id="frame-scroll" aria-label="프레임 이력"><div style="height:800px">프레임 안쪽 구간</div></div>':html);
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const origin=`http://127.0.0.1:${server.address().port}`;
const check=name=>{checks.push(name);console.log(`PASS ${name}`);};
try{
  await cp(resolve(process.env.TEST_EXTENSION||'dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,manifest.background.service_worker),'\nimport * as coverageTestHost from "./browser-agent.js"; globalThis.coverageTestHost=coverageTestHost;globalThis.coverageTestReady=()=>serial(()=>{});\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(7000);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  // Initialize managed policy before intentionally holding an image request open.
  // Chrome can defer policy startup while that synthetic page is still loading.
  await worker.evaluate(()=>coverageTestReady());
  const page=await context.newPage();await page.setViewportSize({width:1000,height:800});await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.frameLocator('iframe').locator('#frame-scroll').waitFor();
  const tabId=await worker.evaluate(async origin=>(await chrome.tabs.query({})).find(tab=>tab.url===origin+'/').id,origin);
  const run=async(name,args={})=>(await worker.evaluate(({tabId,name,args})=>coverageTestHost.runBrowserAgent('coverage-test',{tabId},name,args,{vision:true}),{tabId,name,args})).result;
  const find=(observation,id)=>observation.frames.flatMap(frame=>frame.elements||[]).find(el=>el.id===id);
  let observation=await run('browser_snapshot');assert(!observation.error,JSON.stringify(observation));
  const area=find(observation,'history');assert(area?.ref);assert.equal(area.scroll.height,240);
  assert(find(observation,'frame-scroll')?.scroll);check('ordinary div and iframe scroll areas have current, executable semantic refs');
  const full=await run('capture_page');assert(!full.error,JSON.stringify(full));
  assert.equal(full.capture_mode,'page');assert.equal(full.coverage.allContentVerified,false);
  assert.equal(full.coverage.pendingImages,1);assert.equal(full.coverage.failedImages,1);assert(full.coverage.nestedScrollAreas.length>=3);
  assert(full.observation.frames[0].tables.some(table=>table.declaredRows===1000&&table.partial));
  check('full document capture reports loading/broken images, inner scroll omissions and virtual rows without claiming completion');
  for(const res of pendingImages){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));}
  await page.locator('img').first().evaluate(img=>img.decode());
  let scroll=await run('scroll_page',{direction:'down',ref:find(full.observation,'history').ref});
  assert.equal(scroll.scroll.status,'moved',JSON.stringify(scroll));assert.equal(scroll.scroll.requested,180);assert.equal(scroll.scroll.after.top,180);
  assert.equal(await page.evaluate(()=>scrollY),0);assert.equal(scroll.scroll.boundary,false);
  let shot=await run('capture_page',{full_page:false});assert.equal(shot.coverage.pendingImages,0);assert.equal(shot.coverage.failedImages,1);
  assert.equal(shot.coverage.nestedScrollAreas.find(item=>item.ref===find(shot.observation,'history').ref).top,180);
  check('native wheel moves 75 percent of the intended inner area and the next capture retains its measured range');
  // Bottom reached -> one actual scroll -> a lazy append grows the extent.
  await page.locator('#history').evaluate(el=>{el.scrollTop=el.scrollHeight-el.clientHeight-20;el.addEventListener('scroll',()=>{if(el.scrollTop>=el.scrollHeight-el.clientHeight-1&&!el.dataset.grown){el.dataset.grown='yes';el.firstElementChild.style.height='1500px';}},{passive:true});});
  observation=await run('browser_snapshot');scroll=await run('scroll_page',{direction:'down',ref:find(observation,'history').ref});
  assert.equal(scroll.scroll.extentChanged,true);assert.equal(scroll.scroll.boundary,false);assert.equal(scroll.scroll.requested,20);
  check('lazy append changes the measured extent and does not produce a false end-of-content receipt');
  await page.locator('#history').evaluate(el=>el.scrollTop=el.scrollHeight);
  observation=await run('browser_snapshot');const topBefore=await page.evaluate(()=>scrollY),eventsBefore=await page.evaluate(()=>scrollReceipts);
  scroll=await run('scroll_page',{direction:'down',ref:find(observation,'history').ref});
  assert.equal(scroll.scroll.status,'boundary');assert.equal(scroll.actionIssued,false);assert.equal(await page.evaluate(()=>scrollY),topBefore);
  assert.equal(await page.evaluate(()=>scrollReceipts),eventsBefore);
  check('known inner boundary issues no wheel and cannot chain into the surrounding document');
  // A website may cancel wheel input; this must not be reported as successful movement.
  await page.locator('#history').evaluate(el=>{el.scrollTop=0;el.addEventListener('wheel',event=>event.preventDefault(),{passive:false});});
  observation=await run('browser_snapshot');scroll=await run('scroll_page',{direction:'down',ref:find(observation,'history').ref});
  assert.equal(scroll.error,'scroll_not_moved');assert.equal(scroll.reason,'scroll_not_moved');assert.equal(scroll.scroll.status,'blocked');assert.equal(scroll.actionIssued,true);
  check('cancelled wheel events return blocked progress with recovery evidence instead of success');
  const horizontal=await run('scroll_page',{direction:'right',ref:find(scroll.observation,'horizontal').ref});
  assert.equal(horizontal.scroll.after.left,225);
  observation=horizontal.observation;
  const frameScroll=await run('scroll_page',{direction:'down',ref:find(observation,'frame-scroll').ref});
  assert.equal(frameScroll.scroll.after.top,120);check('horizontal and observed iframe regions use their own viewport dimensions');
  await page.locator('#horizontal').evaluate(el=>{el.style.direction='rtl';el.scrollLeft=0;});
  observation=await run('browser_snapshot');
  const rtl=await run('scroll_page',{direction:'left',ref:find(observation,'horizontal').ref});
  assert.equal(rtl.scroll.after.left,-225);assert.equal(rtl.scroll.boundary,false);assert.equal(rtl.scroll.after.minLeft,-800);
  check('right-to-left horizontal content uses negative scroll coordinates without a false boundary');
  const script=await run('run_playwright',{code:'return await browser.scroll("up");'});assert.equal(script.ok,true,JSON.stringify(script));
  const documentScroll=await run('scroll_page',{direction:'down'});assert.equal(documentScroll.scroll.status,'moved',JSON.stringify(documentScroll));
  const section=await run('capture_page',{full_page:false});assert(section.coverage.captured.y>0);assert.equal(section.coverage.scope,'viewport');
  check('document scrolling selects its own wheel area and viewport capture reports the actual document offset');
  await page.evaluate(()=>{
    const secret=document.createElement('input');secret.type='password';secret.value='not-for-raster';secret.style='position:fixed;left:110px;top:110px;width:50px;height:30px;z-index:80';document.body.append(secret);
    const marker=document.createElement('div');marker.style='position:fixed;left:200px;top:150px;width:40px;height:40px;background:rgb(12,176,75);z-index:80';document.body.append(marker);
  });
  const crop=await run('capture_page',{full_page:false,region:{x:100,y:100,width:250,height:150}});
  assert(!crop.error,JSON.stringify(crop));assert.equal(crop.capture_mode,'region');assert.equal(crop.width,250);assert.equal(crop.height,150);
  assert.equal(crop.coverage.scope,'viewport_region');assert.equal(crop.coverage.captured.y,crop.scrollY+100);assert.equal(crop.visualTargets.length,0);
  const pixels=await page.evaluate(async value=>{
    const bytes=Uint8Array.from(atob(value),char=>char.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    return {masked:[...ctx.getImageData(20,20,1,1).data].slice(0,3),marker:[...ctx.getImageData(120,70,1,1).data].slice(0,3)};
  },crop.image.data);
  assert.deepEqual(pixels.masked,[229,232,235]);assert.deepEqual(pixels.marker,[12,176,75]);
  const cropClick=await run('click_at',{screenshot_id:crop.screenshot_id,x:120,y:70});
  assert.equal(cropClick.error,'browser_stale');assert.equal(cropClick.actionIssued,false);
  check('scrolled viewport region uses exact CSS geometry, masks secrets and cannot authorize cropped-image clicks');
  await page.evaluate(()=>{const overlay=document.createElement('div');overlay.id='overlay';overlay.style='position:fixed;inset:0;overflow:auto;z-index:99;background:white';overlay.innerHTML='<div style="height:4000px">별도 목록</div>';document.body.append(overlay);});
  const obscured=await run('scroll_page',{direction:'down'});assert.equal(obscured.error,'scroll_target_required');assert.equal(obscured.actionIssued,false);
  await page.locator('#overlay').evaluate(el=>el.remove());
  check('a full-screen nested scroller is not silently wheeled by an unspecified document request');
  const stale=await run('scroll_page',{direction:'down',ref:area.ref});assert(stale.error);check('stale scroll refs cannot operate another area after observations change');
  await page.evaluate(()=>document.body.style.height='50000px');
  // A document too large for one image is captured whole, joined from sections
  // and reduced to fit; a viewport section remains available at full size.
  const huge=await run('capture_page');assert(!huge.error,JSON.stringify({error:huge.error}));assert.equal(huge.capture_mode,'page');
  assert(huge.image_scale>0&&huge.image_scale<1,String(huge.image_scale));assert(huge.observation);assert.equal(huge.coverage.scope,'rendered_document');
  const fallback=await run('capture_page',{full_page:false});assert(!fallback.error);assert.equal(fallback.coverage.scope,'viewport');
  check('oversized document is captured whole at a reduced size and a viewport section remains available');
  await worker.evaluate(()=>coverageTestHost.stopBrowserAgent('coverage-test'));
  const cancelled=await run('scroll_page',{direction:'down'});assert.equal(cancelled.error,'cancelled');
  check('stopped capture workflow cannot resume scrolling');
  await mkdir('verification/capture-coverage',{recursive:true});
  await writeFile('verification/capture-coverage/browser.json',JSON.stringify({checks,actualBrowser:true,syntheticSite:true,actualModel:false},null,2));
}finally{
  for(const res of pendingImages)res.end();
  await context?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});
}

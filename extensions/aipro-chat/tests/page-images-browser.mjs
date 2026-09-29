import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, rm, writeFile, readFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-page-images-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], assets = new Map(); let context, ui, worker, stage = 0, routeFailure, protectedRequests = 0;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const token = `header.${Buffer.from(JSON.stringify({exp: Date.now() / 1000 + 3600})).toString('base64url')}.signature`;
const rpc = (type, args = {}) => ui.evaluate(async ({type, args}) => chrome.runtime.sendMessage({type, ...args}), {type, args});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {for (let i = 0; i < 600; i++) {if (routeFailure) throw routeFailure; if (await fn() === expected) return; await new Promise(resolve => setTimeout(resolve, 50));} assert.equal(await fn(), expected);}
const sse = (name, args) => {
  const delta = name ? {tool_calls: [{index: 0, id: `image-${stage}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content: '요청하신 이미지를 찾았습니다. 카드에서 확대하거나 다운로드하세요.'};
  return `data: ${JSON.stringify({choices: [{delta, finish_reason: name ? 'tool_calls' : 'stop'}]})}\n\ndata: [DONE]\n\n`;
};
let origin, other;
const server = createServer((req, res) => {
  const path = new URL(req.url, origin || 'http://localhost').pathname;
  if (assets.has(path)) {
    if (path === '/protected.png' && ++protectedRequests > 1) {res.writeHead(403); res.end('denied'); return;}
    const asset = assets.get(path); res.writeHead(200, {'Content-Type': asset.type, 'Cache-Control': 'private,max-age=3600'}); res.end(asset.bytes); return;
  }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  if (path === '/frame') return res.end(`<img src="${other}/blue.webp" alt="프레임 제품" width="200">`);
  res.end(`<!doctype html><html lang="ko"><meta charset="UTF-8"><title>브랜드 자료실</title><style>body{font:16px system-ui;background:#f3f7fd;padding:28px;color:#191f28}h1{font-size:30px}section{display:flex;flex-wrap:wrap;gap:20px}figure{margin:0;padding:20px;background:white;border-radius:24px;width:240px}img{max-width:100%;height:auto}figcaption{padding-top:12px}.background{width:160px;height:120px;background-size:contain;background-repeat:no-repeat}</style>
  <h1>브랜드 자료실</h1><p>프로젝트에 사용할 이미지를 확인하세요.</p><section>
  <figure><picture><source srcset="/blue.webp?private=signature"><img id="hero" src="/fallback.jpg" alt="하늘색 가방" width="240"></picture><figcaption>봄 컬렉션 대표 이미지</figcaption></figure>
  <figure><img src="${other}/protected.png" alt="보라색 가방" width="240"><figcaption>보라 컬렉션</figcaption></figure>
  <figure><div aria-label="민트 로고" class="background" style="background-image:url('/brand.svg')"></div><figcaption>공식 브랜드 로고</figcaption></figure>
  <figure><img src="/motion.gif" alt="움직이는 아이콘" width="60"></figure>
  <div id="shadow"></div><img id="blob" alt="로컬 미리보기" width="120"><img id="data" alt="인라인 이미지" width="120"><img src="/fake.png" alt="잘못된 이미지" width="120" height="100">
  <iframe src="${other}/frame" title="제품 사진"></iframe></section>
  <script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<img src="/photo.jpg" alt="그림자 제품" width="180">';fetch('/blue.webp').then(r=>r.blob()).then(blob=>{document.querySelector('#blob').src=URL.createObjectURL(blob);const r=new FileReader();r.onload=()=>document.querySelector('#data').src=r.result;r.readAsDataURL(blob);});</script></html>`);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
origin = `http://localhost:${server.address().port}`; other = `http://127.0.0.1:${server.address().port}`;
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, acceptDownloads: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  const maker = await context.newPage();
  for (const [path, type, color] of [['/blue.webp', 'image/webp', '#3182f6'], ['/protected.png', 'image/png', '#7b61e6'], ['/photo.jpg', 'image/jpeg', '#189bb0']]) {
    const data = await maker.evaluate(({type, color}) => {const c=document.createElement('canvas'); c.width=900;c.height=600;const x=c.getContext('2d'); x.fillStyle='#f1f7fe';x.fillRect(0,0,900,600);x.fillStyle=color;x.beginPath();x.roundRect(235,190,430,310,64);x.fill();x.lineWidth=24;x.strokeStyle=color;x.beginPath();x.arc(450,205,110,Math.PI,0);x.stroke();x.fillStyle='white';x.font='bold 32px sans-serif';x.fillText('STUDIO',383,370);return c.toDataURL(type).split(',')[1];}, {type, color});
    assets.set(path, {type, bytes: Buffer.from(data, 'base64')});
  }
  assets.set('/brand.svg', {type: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" rx="40" fill="#e6f6f9"/><path d="M160 35 260 185H60Z" fill="#189bb0"/><circle cx="160" cy="130" r="25" fill="white"/></svg>')});
  assets.set('/motion.gif', {type:'image/gif', bytes: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')});
  assets.set('/fake.png', {type:'text/html', bytes:Buffer.from('<html>sign in</html>')}); await maker.close();
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name:'GLM-5.2-NVFP4', display_name:'GLM-5.2-512K', context_length:524288}]}});
    const body = route.request().postDataJSON(), last = body.messages.findLast(message => message.role === 'tool'), result = last ? JSON.parse(last.content) : null;
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    const review = goalReviewPayload(body.messages);
    if (review) return route.fulfill({json: reviewCompletion(review)});
    const current = stage++;
    if (current === 0) {assert(body.tools.some(tool => tool.function.name === 'select_tools')); return route.fulfill({contentType:'text/event-stream',body:sse('select_tools',{groups:['images']})});}
    if (current === 1) {assert(body.tools.some(tool => tool.function.name === 'find_images')); return route.fulfill({contentType:'text/event-stream',body:sse('find_images',{})});}
    if (current === 2) {
      assert(!JSON.stringify(result).includes('signature')); assert(result.images.some(image=>image.label==='프레임 제품'));  assert(result.images.some(image => image.label === '그림자 제품'));
      const refs = ['하늘색 가방','보라색 가방','민트 로고','그림자 제품'].map(label => result.images.find(image => image.label === label).ref);
      return route.fulfill({contentType:'text/event-stream',body:sse('attach_images',{refs})});
    }
    assert.equal(result.attachments.length,4); assert(result.attachments.every(image => image.availableInChat),JSON.stringify(result));
    return route.fulfill({contentType:'text/event-stream',body:sse()});
  } catch(error) {routeFailure=error; return route.fulfill({status:500,body:'Fixture failed'});}});
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(token => chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:12}}),token);
  const tab=await context.newPage(); await tab.goto(origin+'/catalog?private=secret'); await tab.locator('#data').evaluate(img => img.decode());
  await tab.frameLocator('iframe').locator('img').evaluate(img=>img.decode());
  ui=await context.newPage();ui.on('pageerror',error=>errors.push(error.message));await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async()=>!!(await state()).catalog?.models?.length,true);
  const chatTab=await ui.evaluate(async()=> (await chrome.tabs.getCurrent()).id),sourceTab=await worker.evaluate(async url => (await chrome.tabs.query({url:url+'/*'}))[0].id,origin);
  await worker.evaluate(({sourceTab,chatTab})=>chrome.storage.session.set({chatSourceTabs:{[chatTab]:sourceTab}}),{sourceTab,chatTab});
  await ui.setViewportSize({width:360,height:800});await ui.bringToFront();
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('이 페이지의 가방 사진과 브랜드 로고를 다운로드하고 싶어.'); await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=> (await state()).chat.messages.at(-1)?.state,'done');
  const captures=(await state()).chat.messages.at(-1).captures;
  assert.equal(captures.length,4); assert(captures.every(item=>item.source==='page-image'));
  assert.deepEqual(captures.map(item=>item.format),['WEBP','PNG','SVG','JPG']); assert.equal(captures[0].width,900);
  assert.equal(protectedRequests,1); check('text-only model selects picture/currentSrc, cross-origin cached image, CSS SVG and shadow-root image through the complete agent loop');
  await poll(()=>ui.locator('.capture-preview img').count(),4);
  for (const [index,path] of ['/blue.webp','/protected.png','/brand.svg','/photo.jpg'].entries()) {
    await ui.locator('.capture-preview img').nth(index).evaluate(img=>img.decode());
    const pending=ui.waitForEvent('download'); await ui.locator('.capture-card').nth(index).getByRole('button',{name:'이미지 다운로드',exact:true}).click();const download=await pending;
    assert.equal(download.suggestedFilename(),captures[index].filename);assert.deepEqual(await readFile(await download.path()),assets.get(path).bytes);
  }
  assert.equal(await ui.locator('.capture-caption').filter({hasText:'localhost:'}).count(),0);
  assert.equal(await ui.getByRole('button',{name:'이미지 다운로드',exact:true}).count(),4);
  assert.equal(await ui.locator('.capture-download svg').first().innerHTML(),await ui.locator('.capture-download svg').last().innerHTML());
  check('WebP, PNG, SVG and JPEG download byte-for-byte; download controls remain icons without host labels or success checks');
  for (const [width,height] of [[360,800],[1100,850]]) {await ui.setViewportSize({width,height});await ui.locator('.capture-gallery').scrollIntoViewIfNeeded();await ui.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ui.screenshot({path:`verification/page-images-${width}x${height}.png`});}
  if(await ui.getByRole('button',{name:'알림 닫기',exact:true}).count()) await ui.getByRole('button',{name:'알림 닫기',exact:true}).click();
  const opener=ui.getByRole('button',{name:'하늘색 가방 확대'});await opener.click();const dialog=ui.getByRole('dialog',{name:'페이지 이미지'});await dialog.locator('img').evaluate(img=>img.decode());await dialog.getByRole('button',{name:'다음 이미지'}).click();await dialog.getByRole('button',{name:'원본 크기로 보기'}).click();
  await ui.setViewportSize({width:320,height:480});assert(await dialog.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));assert(await dialog.locator('.capture-viewer-stage').evaluate(el=>el.scrollWidth>el.clientWidth));await dialog.getByRole('button',{name:'화면에 맞추기'}).click();await ui.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));assert(await dialog.locator('.capture-viewer-footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));await ui.screenshot({path:'verification/page-image-preview-320x480.png'});
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();assert(await opener.evaluate(el=>el===document.activeElement));check('responsive cards and image viewer support concise labels, navigation, zoom and focus return');
  await ui.reload();await poll(()=>ui.locator('.capture-preview img').count(),4);await ui.locator('.capture-preview img').first().evaluate(img=>img.decode());check('original image attachments survive extension page reload');
  const probe=async(name,args={})=>ui.evaluate(async({sourceTab,name,args})=>(await(await import(chrome.runtime.getURL('browser-agent.js'))).runBrowserAgent('image-probe',{tabId:sourceTab},name,args,{onImage:async(image,payload)=>({id:image.id,availableInChat:true,format:payload.mimeType,data:payload.data})})).result,{sourceTab,name,args});
  let found=await probe('find_images');
  for(const label of ['로컬 미리보기','인라인 이미지','움직이는 아이콘','프레임 제품']) {assert(found.images.find(image=>image.label===label),label);const result=await probe('attach_images',{refs:[found.images.find(image=>image.label===label).ref]});assert(result.attachments[0].availableInChat,JSON.stringify(result));}
  check('blob, data, GIF and cross-origin frame images are retrievable');
  const ref=found.images.find(image=>image.label==='하늘색 가방').ref;
  await tab.locator('picture source').evaluate(el=>el.srcset='/photo.jpg');await tab.locator('#hero').evaluate(img=>img.decode());
  assert.equal((await probe('attach_images',{refs:[ref]})).error,'browser_stale');assert.equal((await probe('attach_images',{refs:['https://attacker.invalid/image']})).error,'browser_stale');
  found=await probe('find_images');const invalid=await probe('attach_images',{refs:[found.images.find(image=>image.label==='잘못된 이미지').ref]});assert.equal(invalid.attachments[0].error,'image_unavailable');
  check('stale source, fabricated refs and HTML disguised as an image are rejected');
  await ui.evaluate(async()=> (await import(chrome.runtime.getURL('browser-agent.js'))).stopBrowserAgent('image-probe'));
  await rpc('CLEAR_CHAT');assert.equal(await ui.evaluate(async ids=>{const {readCapture}=await import(chrome.runtime.getURL('capture-store.js'));return (await Promise.all(ids.map(readCapture))).filter(Boolean).length;},captures.map(item=>item.id)),0);check('clearing the conversation removes original image blobs');
  assert.deepEqual(errors,[]);await writeFile('verification/page-images-browser.json',JSON.stringify({checks,errors,realBrowserImages:true,syntheticModelResponses:true,liveAiProVerified:false},null,2));
} finally {await context?.close();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}

import {planCompletion, fixturePlan} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, readFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {assertModalTypography} from './helpers/modal-typography.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-captures-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], routedModels = [], analystModels = [], frozenImages = new Map();
const reviewCaptures = !!process.env.NUBI_CAPTURE_MODEL;
let reviewIds = [];
const fullPage = process.env.NUBI_CAPTURE_FULL_PAGE === '1';
const output = fullPage ? 'verification/full-page-captures' : 'verification';
const captureLabel = fullPage ? '전체 페이지 캡처' : '브라우저 캡처';
const textModel = process.env.NUBI_CAPTURE_MODEL || 'QWEN3.8-27B-FP8-256K';
const workMode = process.env.NUBI_CAPTURE_WORK_MODE || 'current';
const token = `header.${Buffer.from(JSON.stringify({exp: Date.now() / 1000 + 3600})).toString('base64url')}.signature`;
let context, ui, worker, stage = 0, releaseAnswer, routeFailure;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const rpc = (type, args = {}) => ui.evaluate(async ({type, args}) => chrome.runtime.sendMessage({type, ...args}), {type, args});
const state = async () => (await rpc('GET_STATE')).data;
const settleAnimations = () => ui.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
async function expandCaptures() {
  const trace = ui.locator('.agent-trace').last();
  await trace.waitFor();
  if (!await trace.evaluate(el => el.open)) await trace.locator(':scope > summary').click();
  for (const disclosure of await trace.locator('.agent-step-capture:not(.trace-journal)').all()) {
    if (!await disclosure.evaluate(el => el.open)) await disclosure.locator(':scope > summary').click();
  }
}
async function poll(fn, expected) {
  for (let i = 0; i < 800; i++) {if (routeFailure) throw routeFailure; const value = await fn(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 50));}
  assert.equal(await fn(), expected);
}
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
function response(name, args) {
  const delta = name ? {tool_calls: [{index: 0, id: `capture-${stage}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content: '화면을 캡처했습니다. 이미지를 눌러 크게 보거나 다운로드할 수 있습니다.'};
  return frame({choices: [{delta, finish_reason: name ? 'tool_calls' : 'stop'}]}) + frame({choices: [], usage: {prompt_tokens: 200, completion_tokens: 30, total_tokens: 230}}) + 'data: [DONE]\n\n';
}
const site = `<!doctype html><html lang="ko"><meta charset="UTF-8"><title>프로젝트 워크스페이스</title><style>
body{margin:0;color:#191f28;background:#f5f8fd;font:14px system-ui,sans-serif}header{padding:24px 40px;background:white;border-bottom:1px solid #e5e8eb;display:flex;justify-content:space-between}header strong{color:#1b64da}main{padding:40px;max-width:880px;margin:auto}h1{font-size:32px;margin:12px 0}p{color:#4e5968;line-height:1.8}.tag{display:inline-block;background:#e8f1fe;color:#1b64da;border-radius:30px;padding:7px 12px;font-size:12px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:28px 0}.card{background:white;border:1px solid #e5e8eb;border-radius:24px;padding:24px;box-shadow:0 14px 44px #191f2809}.card b{display:block;font-size:28px;margin:16px 0 8px}.mint{background:#e6f6f9}.purple{background:#efecfd}button{border:0;border-radius:12px;background:#1b64da;color:white;padding:12px 20px}label{display:block;margin-top:20px}input{border:1px solid #d7dfe9;border-radius:8px;padding:10px;margin-left:12px}.long{height:1000px}</style>
<header><strong>WORKSPACE</strong><span>프로젝트 현황</span></header><main><span class="tag">진행 중</span><h1>작은 변화부터, 함께.</h1><p>팀의 작업을 한눈에 확인하고 다음 단계를 준비하세요.</p><div class="cards"><div class="card"><span>진행 중인 작업</span><b>12</b><span>이번 주</span></div><div class="card mint"><span>완료한 작업</span><b>28</b><span>계획대로 진행 중</span></div><div class="card purple"><span>검토 대기</span><b>3</b><span>확인이 필요해요</span></div></div><section class="card"><h2>다음 단계</h2><p>브라우저 Agent의 화면 확인과 다운로드를 테스트합니다.</p><button>프로젝트 열기</button><label>비밀번호<input type="password" value="capture-secret"></label></section><div class="long"></div><p style="background:rgb(12,180,75);height:80px">BELOW_VIEWPORT_MARKER</p></main></html>`;
try {
  await mkdir(output, {recursive: true}); await cp(resolve(process.env.TEST_EXTENSION || 'dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  assert(!manifest.permissions.some(permission => ['desktopCapture', 'tabCapture', 'downloads'].includes(permission)));
  // Site access pregranted only in this test copy, without changing production.
  manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  if(fullPage){const entry=resolve(extension,manifest.background.service_worker);await writeFile(entry,await readFile(entry,'utf8')+'\nimport {runBrowserAgent as captureTestRun,stopBrowserAgent as captureTestStop} from \"./browser-agent.js\"; globalThis.captureTestHost={runBrowserAgent:captureTestRun,stopBrowserAgent:captureTestStop,withTool:action=>serialTool("RUN_TOOL",action)};\n');}
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', acceptDownloads: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://workspace.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: site}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', display_name: 'QWEN3.8-27B-256K', context_length: 262144}, {name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2', context_length: 524288}]}});
    const body = route.request().postDataJSON();
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    const review = goalReviewPayload(body.messages); if (review) {
      if (review.phase === 'final') {const saved = (await state()).chat.task.plan; assert(saved.length === fixturePlan.length && saved.every(step => step.status === 'completed'));}
      return route.fulfill({contentType: 'application/json', body: JSON.stringify(reviewCompletion(review))});
    }
    if (reviewCaptures && body.messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes("Nubi's isolated review analyst"))) {
      analystModels.push(body.model);
      assert.deepEqual(body.tools.map(tool => tool.function.name), ['read_analysis_evidence']);
      if (analystModels.length === 1) {
        assert.equal(body.model, textModel);
        return route.fulfill({json:{choices:[{message:{content:'',tool_calls:reviewIds.map((id,index)=>({id:`read-frozen-${index}`,type:'function',function:{name:'read_analysis_evidence',arguments:JSON.stringify({evidence_id:id,mode:'image'})}}))},finish_reason:'tool_calls'}]}});
      }
      assert.equal(analystModels.length, 2);
      assert.equal(body.model, 'QWEN3.8-27B-FP8-256K');
      const visual = body.messages.filter(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));
      assert.equal(visual.length, 2, 'both actual captured PNGs must reach the isolated analyst');
      assert.deepEqual(visual.map(message => JSON.parse(message.content[0].text).evidence_id), reviewIds);
      for (const message of visual) {
        const reference = JSON.parse(message.content[0].text);
        assert.equal(reference.dataKind, 'analysis_image_reference');
        assert.match(reference.instruction, /Not the current viewport/);
        const images = message.content.filter(part => part.type === 'image_url');
        assert.equal(images.length, 1);
        assert.equal(images[0].image_url.url, frozenImages.get(reference.evidence_id), 'analyst receives the original captured bytes for this ID');
        const png = Buffer.from(images[0].image_url.url.split(',')[1], 'base64');
        assert.equal(png.readUInt32BE(16), 1120); assert.equal(png.readUInt32BE(20), 820);
      }
      return route.fulfill({json:{choices:[{message:{content:JSON.stringify({status:'complete',summary:'두 캡처의 표시 내용을 비교했습니다.',findings:[{text:'두 원본 캡처를 확인했습니다.',evidence_ids:reviewIds}],uncertainties:[],next_step:''})},finish_reason:'stop'}]}});
    }
    assert.equal(body.model, stage ? 'QWEN3.8-27B-FP8-256K' : textModel);
    routedModels.push(body.model);
    if (stage > 0) {
      const images = body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
      assert.equal(images.length, 1, JSON.stringify(body.messages.filter(message => message.role === 'tool').map(message => message.content)));
      assert(images[0].image_url.url.startsWith('data:image/png;base64,iVBOR'));
      const png = Buffer.from(images[0].image_url.url.split(',')[1], 'base64');
      assert.equal(png.readUInt32BE(16), 1120);
      assert(fullPage ? png.readUInt32BE(20) > 1600 : png.readUInt32BE(20) === 820, 'model receives the full PNG, not just a viewport preview');
    }
    const toolResults = body.messages.filter(message => message.role === 'tool').map(message => {try {return JSON.parse(message.content);} catch {return {};}});
    if (reviewCaptures && (stage === 1 || stage === 2)) {
      const source = toolResults.findLast(result => result.analysis_evidence_id);
      const image = body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : [])[0];
      assert(source?.analysis_evidence_id && image);
      frozenImages.set(source.analysis_evidence_id, image.image_url.url);
    }
    const current = stage++;
    if (current === 0) return route.fulfill({contentType: 'text/event-stream', body: response('capture_page', fullPage ? {} : {full_page:false})});
    if (current === 1) return route.fulfill({contentType: 'text/event-stream', body: response('run_playwright', {code: fullPage ? 'await browser.screenshot(); return await browser.screenshot({fullPage:true});' : 'await browser.screenshot({fullPage:false}); return await browser.screenshot({fullPage:false});'})});
    if (current === 2) {
      await new Promise(resolve => {releaseAnswer = resolve;});
      if (reviewCaptures) {
        reviewIds = [...frozenImages.keys()]; assert.equal(reviewIds.length, 2);
        return route.fulfill({contentType:'text/event-stream',body:response('delegate_analysis',{tasks:[{role:'review',task:'두 원본 캡처의 표시 내용을 비교하세요.',done_when:'두 이미지 근거를 직접 읽고 비교 결과를 반환함',evidence_ids:reviewIds}]})});
      }
    }
    if (reviewCaptures && current === 3) {
      const launched = toolResults.findLast(result => result.tasks?.length);
      assert(launched?.tasks[0]?.task_id);
      return route.fulfill({contentType:'text/event-stream',body:response('collect_analysis',{task_ids:[launched.tasks[0].task_id]})});
    }
    if (reviewCaptures && current === 4) {
      const result = toolResults.findLast(result => result.results?.length)?.results[0];
      assert.equal(result?.report?.status, 'complete');
      assert.deepEqual(result.evidence.map(source => [source.evidence_id, source.image_read]), reviewIds.map(id => [id, true]));
    }
    const closureRound = reviewCaptures ? 4 : 2;
    if (current === closureRound) return route.fulfill({contentType: 'text/event-stream', body: response('update_plan', {steps: fixturePlan.map(step => ({...step, status: 'completed'}))})});
    assert.equal(current, closureRound + 1, 'Only the final answer follows explicit plan closure');
    const savedReceipt = toolResults.at(-1); assert(savedReceipt.ok && savedReceipt.plan?.length === fixturePlan.length && savedReceipt.plan.every(step => step.status === 'completed'));
    assert.deepEqual((await state()).chat.task.plan, savedReceipt.plan);
    return route.fulfill({contentType: 'text/event-stream', body: response()});
  } catch (error) {routeFailure = error; return route.fulfill({status: 500, body: 'Fixture assertion failed'});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This test measures the original tab's viewport and password mask. Dedicated
  // work-window creation/focus is covered separately by workspace browser tests.
  await worker.evaluate(browserWorkMode => chrome.storage.local.set({browserWorkMode}), workMode);
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 12}}), token);
  const tab = await context.newPage(); await tab.setViewportSize({width: 1120, height: 820}); await tab.goto('https://workspace.example.test/project?private=value#private');
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async () => !!(await state()).catalog?.models?.length, true);
  await rpc('SELECT_MODEL', {name: textModel});
  const chatTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  if(fullPage)await tab.evaluate(()=>{window.capturePointerClicks=0;document.addEventListener('click',()=>window.capturePointerClicks++);window.scrollTo(0,120);});
  const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({url: 'https://workspace.example.test/*'}))[0].id);
  await worker.evaluate(({sourceTab, chatTab}) => chrome.storage.session.set({chatSourceTabs: {[chatTab]: sourceTab}}), {sourceTab, chatTab});
  await ui.setViewportSize({width: 360, height: 800}); await ui.bringToFront();
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('현재 브라우저 화면을 캡처해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await poll(async () => {const reply = (await state()).chat.messages.at(-1); if (reply?.error) throw new Error(`Reply failed: ${reply.error}`); return reply?.captures?.length;}, 3);
  await poll(() => ui.locator('.agent-step-capture:not(.trace-journal)').count(), 2);
  assert.equal(await ui.locator('.capture-preview img').count(), 0);
  const firstCapture = ui.locator('[data-tool="capture_page"] .agent-step-capture:not(.trace-journal) > summary');
  await firstCapture.focus(); await ui.keyboard.press('Enter');
  await poll(() => ui.locator('.capture-preview img').count(), 1);
  await ui.keyboard.press('Space');
  await poll(() => ui.locator('.capture-preview img').count(), 0);
  await expandCaptures();
  await poll(() => ui.locator('.capture-preview img').count(), 3);
  assert.equal(await ui.locator('[data-tool="capture_page"] .capture-card').count(), 1);
  assert.equal(await ui.locator('[data-tool="run_playwright"] .capture-card').count(), 2);
  assert.equal(await ui.locator('.message-assistant > .capture-gallery').count(), 0);
  check('captures start folded and Enter/Space reveal images beneath their exact tool step without a separate gallery');
  assert.equal((await state()).chat.messages.at(-1).state, 'pending');
  await poll(async () => !!releaseAnswer, true); releaseAnswer();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  check('direct capture and both captures inside a generated script appear during the pending reply');
  assert.equal((await state()).settings.modelId, textModel);
  if (textModel !== 'QWEN3.8-27B-FP8-256K') {
    assert((await state()).chat.messages.at(-1).trace.some(step => step.tool === 'image_model' && step.status === 'done'));
    assert.deepEqual(routedModels.slice(0, 3), [textModel, 'QWEN3.8-27B-FP8-256K', 'QWEN3.8-27B-FP8-256K']);
    assert.deepEqual(routedModels.slice(3), ['QWEN3.8-27B-FP8-256K', 'QWEN3.8-27B-FP8-256K', 'QWEN3.8-27B-FP8-256K']);
    assert.deepEqual(analystModels, [textModel, 'QWEN3.8-27B-FP8-256K']);
    const analysis = (await state()).chat.messages.at(-1).trace.find(step => step.tool === 'analysis_review');
    assert.equal(analysis?.status, 'done'); assert.equal(analysis.analysis.delivered, true);
    assert.deepEqual(analysis.analysis.sources.map(source => [source.id, source.imageRead]), reviewIds.map(id => [id, true]));
    check('isolated review receives two original Chrome PNGs through the actual model request and acknowledges both after delivery');
    assert.equal((await state()).chat.messages.at(-1).modelId, 'QWEN3.8-27B-FP8-256K');
    check('GLM starts the task and Qwen receives the captures in the same conversation without changing the saved model');
  }
  const captures = (await state()).chat.messages.at(-1).captures;
  const trace = (await state()).chat.messages.at(-1).trace;
  assert.equal(captures[0].traceId, trace.find(step => step.tool === 'capture_page').id);
  assert(captures.slice(1).every(capture => capture.traceId === trace.find(step => step.tool === 'run_playwright').id));
  assert.equal(await ui.locator('.agent-step-capture:not(.trace-journal)[open]').count(), 2);
  check('completion preserves the open capture and persisted step identity');
  assert.equal(new Set(captures.map(item => item.id)).size, 3);
  if(fullPage){assert.equal(await tab.evaluate(()=>window.capturePointerClicks),0);assert(Math.abs(await tab.evaluate(()=>window.scrollY)-120)<=1, 'scroll offset stays within browser pixel rounding');}
  assert(captures.every(item => item.source === 'browser-tab' && item.width === 1120 && (fullPage ? item.height > 1600 && item.mode === 'page' : item.height === 820) && item.host === 'workspace.example.test'));
  assert(!JSON.stringify(captures).includes('private')); assert(!JSON.stringify(captures).includes('iVBOR'));
  const storedPNG = await ui.evaluate(async id => {
    const {readCapture} = await import(chrome.runtime.getURL('capture-store.js'));
    return [...new Uint8Array(await (await readCapture(id)).arrayBuffer())];
  }, captures[0].id);
  const pixels = await ui.locator('.capture-preview img').first().evaluate(async img => {
    await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let masked = 0, bottom = 0; for (let i = 0; i < data.length; i += 4) if (data[i] === 229 && data[i + 1] === 232 && data[i + 2] === 235) masked++;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 12 && data[i + 1] === 180 && data[i + 2] === 75) bottom++;
    return {masked, bottom, width: canvas.width, height: canvas.height};
  });
  assert(pixels.masked > 500); if(fullPage){assert(pixels.height > 1600); assert(pixels.bottom > 10000);}else{assert.equal(pixels.height,820);assert.equal(pixels.bottom,0);}
  check(fullPage ? 'whole-page PNG includes the below-fold marker, masks password fields and preserves the scroll position' : 'viewport PNG excludes below-fold content and masks password fields');
  if(fullPage){
    // Match the real tool queue while the completed chat continues polling.
    // An unowned direct probe would otherwise be stopped by normal recovery.
    const rejected=await worker.evaluate(async tabId=>captureTestHost.withTool(async()=>{
      const {runBrowserAgent,stopBrowserAgent}=globalThis.captureTestHost;
      const id=crypto.randomUUID(),page={tabId};
      try{
        const viewport=await runBrowserAgent(id,page,'capture_page',{full_page:false}, {vision:true});
        const whole=await runBrowserAgent(id,page,'capture_page',{full_page:true},{vision:true});
        if(viewport.result.error||whole.result.error)throw new Error(JSON.stringify([viewport.result.error,whole.result.error]));
        const first=await runBrowserAgent(id,page,'click_at',{screenshot_id:whole.result.screenshot_id,x:10,y:10},{vision:true});
        const previous=await runBrowserAgent(id,page,'click_at',{screenshot_id:viewport.result.screenshot_id,x:10,y:10},{vision:true});
        return [first.result,previous.result].map(({error,actionIssued})=>({error,actionIssued}));
      }finally{await stopBrowserAgent(id);}
    }),sourceTab);
    assert.deepEqual(rejected,[{error:'browser_stale',actionIssued:false},{error:'browser_stale',actionIssued:false}]);
    assert.equal(await tab.evaluate(()=>window.capturePointerClicks),0);
    check('full-page and previous viewport screenshot IDs both reject coordinate input without clicking');
  }
  const downloadEvent = ui.waitForEvent('download');
  await ui.getByRole('button', {name: '이미지 다운로드', exact: true}).first().click();
  const download = await downloadEvent; assert.equal(download.suggestedFilename(), captures[0].filename);
  assert.deepEqual(await readFile(await download.path()), Buffer.from(storedPNG));
  assert.equal(await ui.locator('[data-download-state="started"]').count(), 1);
  check('card downloads the original PNG byte-for-byte with a unique filename and started feedback');
  if (await ui.getByRole('button', {name: '알림 닫기', exact: true}).count()) await ui.getByRole('button', {name: '알림 닫기', exact: true}).click();
  const opener = ui.locator('[data-tool="run_playwright"]').getByRole('button', {name: `${captureLabel} 확대`}).first();
  await opener.click();
  const dialog = ui.getByRole('dialog', {name: captureLabel});
  await dialog.locator('img').waitFor();
  await assertModalTypography(dialog);
  if(fullPage){await dialog.locator('img').evaluate(img=>img.decode());assert(await dialog.locator('.capture-viewer-stage').evaluate(el=>getComputedStyle(el.querySelector('img')).maxHeight==='none' && el.querySelector('img').getBoundingClientRect().width<=el.clientWidth+1));}
  await dialog.getByRole('button', {name: '원본 크기로 보기'}).click();
  assert(await dialog.locator('.capture-viewer-stage').evaluate(el => el.scrollWidth > el.clientWidth));
  await dialog.getByRole('button', {name: '화면에 맞추기'}).click();
  await dialog.getByRole('button', {name: '다음 캡처'}).click(); assert.equal(await dialog.locator('.capture-count').innerText(), '2 / 2');
  await dialog.getByRole('button', {name: '이전 캡처'}).click();
  for (const [width, height] of [[360, 800], [320, 480], [1100, 850]]) {
    await ui.setViewportSize({width, height});
    if(fullPage && width>=1100)assert(await dialog.locator('.capture-viewer-stage').evaluate(el=>el.scrollHeight>el.clientHeight));
    assert(await dialog.evaluate(el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth));
    assert(await dialog.locator('.capture-viewer-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
    assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await settleAnimations();
    await ui.screenshot({path: `${output}/capture-preview-${width}x${height}.png`});
  }
  await ui.keyboard.press('Tab'); assert(await ui.evaluate(() => !!document.activeElement.closest('[role="dialog"]')));
  if (await ui.getByRole('tooltip').count()) {await ui.keyboard.press('Escape'); await ui.getByRole('tooltip').waitFor({state: 'hidden'});}
  await ui.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'});
  assert(await opener.evaluate(el => document.activeElement === el));
  check('CX preview supports original-size scrolling, fit, gallery navigation, Escape and focus return at desktop and panel widths');
  await ui.setViewportSize({width: 360, height: 800});
  await ui.locator('.message-assistant').last().scrollIntoViewIfNeeded();
  await settleAnimations();
  await ui.screenshot({path: `${output}/captures-chat-panel.png`});
  await ui.setViewportSize({width: 1100, height: 850});
  await ui.screenshot({path: `${output}/captures-chat-desktop.png`});
  await ui.reload(); await ui.locator('.agent-trace').waitFor();
  assert.equal(await ui.locator('.capture-preview img').count(), 0);
  await expandCaptures(); await poll(() => ui.locator('.capture-preview img').count(), 3);
  assert.equal(await ui.locator('[data-tool="run_playwright"] .capture-card').count(), 2);
  await ui.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await ui.locator('.capture-card').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  check('capture attachments survive reload and respect reduced motion');
  await ui.evaluate(() => {window.originalAnchorClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = () => {throw new Error('Synthetic download failure');};});
  await ui.getByRole('button', {name: '이미지 다운로드', exact: true}).first().click();
  assert.equal(await ui.locator('.capture-error[role="alert"]').count(), 1);
  await ui.evaluate(() => {HTMLAnchorElement.prototype.click = window.originalAnchorClick;});
  const retried = ui.waitForEvent('download'); await ui.getByRole('button', {name: '이미지 다운로드', exact: true}).first().click(); await retried;
  assert.equal(await ui.locator('.capture-error[role="alert"]').count(), 0);
  check('failed download keeps an inline retry and succeeds on the next click');
  // Inspect the actual Chrome side-panel target, not only a narrow normal tab.
  await ui.evaluate(async () => {
    const {id} = await chrome.windows.getCurrent();
    const button = document.createElement('button'); button.textContent = 'Open capture test panel';
    button.onclick = () => chrome.sidePanel.open({windowId: id}); document.body.append(button);
  });
  await ui.getByRole('button', {name: 'Open capture test panel'}).click();
  const cdp = await context.browser().newBrowserCDPSession();
  let target;
  await poll(async () => {target = (await cdp.send('Target.getTargets')).targetInfos.find(info => info.url === ui.url() && !info.attached); return !!target;}, true);
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false});
  let sequence = 0;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const response = JSON.parse(event.message), resolve = pending.get(response.id);
    if (resolve) {pending.delete(response.id); resolve(response);}
  });
  async function command(method, params = {}) {
    const id = ++sequence, result = new Promise(resolve => pending.set(id, resolve));
    await cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})});
    const response = await result; if (response.error) throw Error(JSON.stringify(response.error)); return response.result;
  }
  async function panel(expression) {
    const result = await command('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
  }
  await poll(() => panel('!!document.querySelector(".agent-trace")'), true);
  assert.equal(await panel('document.querySelectorAll(".capture-preview img").length'), 0);
  await panel('document.querySelector(".agent-trace > summary").click(); document.querySelectorAll(".agent-step-capture:not(.trace-journal) > summary").forEach(el => el.click())');
  await poll(() => panel('document.querySelectorAll(".capture-preview img").length'), 3);
  await panel('document.querySelector(".capture-preview").click()');
  await poll(() => panel('!!document.querySelector(".capture-dialog img")?.complete'), true);
  assert(await panel('document.documentElement.scrollWidth <= innerWidth'));
  await panel('Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))');
  const shot = await command('Page.captureScreenshot', {format: 'png'});
  await writeFile(`${output}/capture-native-side-panel.png`, Buffer.from(shot.data, 'base64'));
  const downloadPath = resolve(profile, 'downloads'); await mkdir(downloadPath);
  await cdp.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath, eventsEnabled: true});
  let downloaded, complete = false;
  cdp.on('Browser.downloadWillBegin', value => {downloaded = value;});
  cdp.on('Browser.downloadProgress', value => {if (value.guid === downloaded?.guid && value.state === 'completed') complete = true;});
  await panel('document.querySelector(".capture-dialog [data-action=download]").click()');
  await poll(() => complete, true);
  assert.equal(downloaded.suggestedFilename, captures[0].filename);
  assert.deepEqual(await readFile(resolve(downloadPath, downloaded.suggestedFilename)), Buffer.from(storedPNG));
  await cdp.detach();
  check('the native Chrome side panel displays, expands and downloads the same PNG successfully');
  const isolation = await ui.evaluate(async ({capture, bytes}) => {
    const media = await import(chrome.runtime.getURL('capture-store.js'));
    const data = btoa(String.fromCharCode(...bytes));
    const input = {screenshot: {id: crypto.randomUUID(), at: Date.now(), url: 'https://workspace.example.test/'}, image: {data, mimeType: 'image/png'}, requestId: 'inactive-provider', provider: 'chatgpt'};
    const other = await media.saveCapture(input);
    const {providerChats = {}} = await chrome.storage.local.get('providerChats');
    await chrome.storage.local.set({providerChats: {...providerChats, chatgpt: {messages: [{id: 'inactive-provider', role: 'assistant', content: 'Other provider', state: 'done', captures: [other]}], draft: ''}}});
    await media.deleteCaptures([capture.id]);
    return {input: {...input, screenshot: {id: capture.id, at: capture.capturedAt, url: `https://${capture.host}/`}}, otherId: other.id};
  }, {capture: captures[0], bytes: storedPNG});
  await ui.reload(); await expandCaptures(); await ui.getByText('이미지를 불러오지 못했습니다.', {exact: true}).waitFor();
  await ui.evaluate(async input => (await import(chrome.runtime.getURL('capture-store.js'))).saveCapture(input), isolation.input);
  await ui.getByRole('button', {name: '이미지 다시 불러오기'}).click();
  await poll(() => ui.locator('.capture-preview img').count(), 3);
  check('a missing image has an explicit reload action and recovers without changing the reply');
  const quota = await ui.evaluate(async input => {
    const media = await import(chrome.runtime.getURL('capture-store.js'));
    const db = await new Promise(resolve => {const r = indexedDB.open('aipro-browser-captures', 1); r.onsuccess = () => resolve(r.result);});
    await new Promise(resolve => {const tx = db.transaction('captures', 'readwrite'); tx.objectStore('captures').put({id: 'quota-fixture', bytes: media.CAPTURE_LIMITS.bytes}); tx.oncomplete = resolve;}); db.close();
    let result; try {await media.saveCapture({...input, screenshot: {...input.screenshot, id: crypto.randomUUID()}});} catch (error) {result = error.message;}
    await media.deleteCaptures(['quota-fixture']);
    return {result, existing: !!await media.readCapture(input.screenshot.id)};
  }, isolation.input);
  assert.deepEqual(quota, {result: 'capture_storage_full', existing: true});
  check('storage limits reject new images without silently evicting existing attachments');
  // A browser restart clears credentials; authenticate the fixture again and
  // verify persistent images, including the inactive provider, after startup GC.
  const extensionURL = ui.url();
  const capturedSession = (await state()).chat.sessionId;
  await rpc('NEW_CHAT');
  await context.close();
  if(fullPage){const entry=resolve(extension,manifest.background.service_worker);await writeFile(entry,await readFile(entry,'utf8')+'\nimport {runBrowserAgent as captureTestRun,stopBrowserAgent as captureTestStop} from \"./browser-agent.js\"; globalThis.captureTestHost={runBrowserAgent:captureTestRun,stopBrowserAgent:captureTestStop,withTool:action=>serialTool("RUN_TOOL",action)};\n');}
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', acceptDownloads: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144}]}}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 13}}), token);
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message)); await ui.goto(extensionURL);
  await rpc('SELECT_CONVERSATION', {id: capturedSession});
  await expandCaptures();
  await poll(() => ui.locator('.capture-preview img').count(), 3);
  assert(await ui.evaluate(async id => !!await (await import(chrome.runtime.getURL('capture-store.js'))).readCapture(id), isolation.otherId));
  check('browser restart retains archived and inactive provider images after reauthentication');
  // The common one-capture reply, using the same real captured PNG.
  await ui.evaluate(async () => {const {chat} = await chrome.storage.local.get('chat'); window.captureVisualChat = chat; await chrome.storage.local.set({chat: {...chat, messages: chat.messages.map(message => message.captures ? {...message, captures: message.captures.slice(0, 1)} : message)}});});
  await poll(() => ui.locator('.capture-card').count(), 1);
  for (const [width, height] of [[360, 800], [1100, 850]]) {
    await ui.setViewportSize({width, height});
    await ui.getByRole('textbox', {name: '메시지', exact: true}).focus();
    await ui.locator('.conversation').evaluate(el => {el.scrollTop = el.scrollHeight;});
    await settleAnimations();
    await ui.screenshot({path: `${output}/capture-single-${width}x${height}.png`});
  }
  await ui.evaluate(() => chrome.storage.local.set({chat: window.captureVisualChat}));
  await poll(() => ui.locator('.capture-card').count(), 1);
  const savedChat = await ui.evaluate(async () => (await chrome.storage.local.get('chat')).chat);
  await ui.evaluate(async chat => {
    await chrome.storage.local.set({chat: {...chat, messages: chat.messages.map(message => message.captures ? {...message, trace: undefined, captures: message.captures.map(({traceId, ...capture}) => capture)} : message)}});
  }, savedChat);
  await poll(() => ui.locator('.agent-unlinked-captures').count(), 1);
  await expandCaptures(); await poll(() => ui.locator('.agent-unlinked-captures .capture-preview img').count(), 3);
  assert.equal(await ui.locator('.message-assistant > .capture-gallery').count(), 0);
  check('older captures without execution IDs remain available inside the record without guessed step associations');
  await ui.evaluate(chat => chrome.storage.local.set({chat}), savedChat);
  const storage = await ui.evaluate(() => chrome.storage.local.get(null));
  assert(!JSON.stringify(storage).includes('iVBOR')); assert(!JSON.stringify(storage).includes(token));
  await ui.getByRole('button', {name: '대화 이력', exact: true}).click();
  await ui.getByRole('dialog', {name: '대화 이력', exact: true}).getByRole('button', {name: '새 대화', exact: true}).click();
  await poll(() => ui.locator('.capture-card').count(), 0);
  assert.equal(await ui.evaluate(async ids => {
    const {readCapture} = await import(chrome.runtime.getURL('capture-store.js'));
    return (await Promise.all(ids.map(readCapture))).filter(Boolean).length;
  }, captures.map(item => item.id)), captures.length);
  await rpc('DELETE_CONVERSATION', {id: capturedSession});
  assert.equal(await ui.evaluate(async ids => {
    const {readCapture} = await import(chrome.runtime.getURL('capture-store.js'));
    return (await Promise.all(ids.map(readCapture))).filter(Boolean).length;
  }, captures.map(item => item.id)), 0);
  assert(await ui.evaluate(async id => !!await (await import(chrome.runtime.getURL('capture-store.js'))).readCapture(id), isolation.otherId));
  check('new conversation retains images; deleting its history removes only its PNGs without touching other providers');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/${process.env.NUBI_CAPTURE_MODEL ? 'vision-routing' : 'captures'}-browser.json`, JSON.stringify({version: manifest.version, checks, routedModels, selectedModel: textModel, workMode, realBrowserCaptures: true, syntheticQwenResponses: true, liveAiProVerified: false}, null, 2));
} catch (error) {
  console.dir({stage, errors, reply: await state().then(value => value.chat.messages.at(-1)).catch(() => null)}, {depth: 6});
  throw error;
} finally {releaseAnswer?.(); await context?.close(); await rm(profile, {recursive: true, force: true});}

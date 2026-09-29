import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {clickComposerAction} from './helpers/composer-actions.mjs';
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-add-'));
const checks = [], errors = [];
let context;
try {
  await mkdir('verification', {recursive: true});
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/**', r => r.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4'}]}}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite checks detailed execution UI; ordinary mode is covered by debug-plan-ui-browser.
  await worker.evaluate(() => chrome.storage.local.set({debugMode: true}));
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider:'aipro', mode:'browser', token:'synthetic', receivedAt:1}}));
  const ui = await context.newPage(); ui.on('pageerror', e => errors.push(e.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const plus = ui.getByRole('button', {name:'추가', exact:true}), panel = ui.getByRole('group', {name:'추가 기능'});
  await plus.waitFor();
  await worker.evaluate(async () => {
    const {chat} = await chrome.storage.local.get('chat');
    await chrome.storage.local.set({chat:{...chat,messages:[{id:'u',role:'user',content:'안내 내용을 확인해줘'}, {id:'a',role:'assistant',state:'done',content:'확인한 내용을 정리했습니다.',
      progress:{status:'paused',plan:[{text:'**신청 조건** 확인',status:'completed'},{text:'`제출 서류` 비교',status:'in_progress'}]},
      trace:[{tool:'read_page',status:'done',planStep:'**신청 조건** 확인',label:'**안내 페이지** 읽기'},
        {tool:'progress_note',status:'done',content:'### 확인한 내용\n\n**신청 조건**을 확인했습니다.\n제출 서류는 추가 확인이 필요합니다.\n\n1. 신분증\n2. 신청서\n\n| 항목 | 상태 |\n| --- | --- |\n| 안내 페이지 | 확인 |\n\n[공식 안내](https://example.test) [차단](javascript:alert(1))\n<script>window.unsafeProgress = true</script>'}]}]}});
  });
  await ui.locator('.task-plan-label strong').waitFor();
  await ui.locator('.agent-trace > summary').click();
  for (const width of [320,360,1100]) {
    await ui.setViewportSize({width,height:850});
    assert.equal(await ui.getByRole('button', {name:'파일 첨부',exact:true}).count(),0);
    assert.equal(await ui.getByRole('button', {name:'스킬 선택',exact:true}).count(),0);
    await plus.focus(); await plus.press('Enter'); await panel.waitFor();
    await ui.keyboard.press('Tab');
    assert.equal(await ui.getByRole('button',{name:'파일 첨부',exact:true}).evaluate(el=>el===document.activeElement),true);
    assert.equal(await panel.getByRole('button').count(),3);
    const type = await panel.getByRole('button').evaluateAll(buttons => buttons.map(el => {const s=getComputedStyle(el); return [s.fontSize,s.lineHeight,s.fontWeight];}));
    assert.deepEqual(type, Array.from({length:3},()=>['14px','22px','400']));
    const rect = await panel.boundingBox(); assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width);
    await ui.screenshot({path:`verification/composer-add-${width}.png`,animations:'disabled'});
    await ui.keyboard.press('Escape'); assert.equal(await panel.isVisible(),false);
    assert.equal(await plus.evaluate(el=>el===document.activeElement),true);
    await plus.click(); await ui.mouse.click(5, 180); assert.equal(await panel.isVisible(),false);
    await clickComposerAction(ui,'스킬 선택'); await ui.getByRole('dialog',{name:'스킬',exact:true}).waitFor();
    assert.equal(await panel.isVisible(),false);
    await ui.keyboard.press('Escape'); assert.equal(await plus.evaluate(el=>el===document.activeElement),true);
    assert.equal(await ui.locator('.task-plan-label strong').textContent(),'신청 조건');
    assert.equal(await ui.locator('.agent-trace-plan strong').textContent(),'신청 조건');
    const md = ui.locator('.progress-markdown');
    assert.equal(await md.locator('ol > li').count(),2); assert.equal(await md.locator('table tbody tr').count(),1);
    assert.equal(await md.locator('a').count(),1); assert.equal(await md.locator('script').count(),0);
    assert.equal(await md.locator('p').first().evaluate(el=>getComputedStyle(el).whiteSpace),'pre-line');
    assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&!window.unsafeProgress));
    await ui.locator('.message-assistant').screenshot({path:`verification/composer-progress-${width}.png`,animations:'disabled'});
    checks.push(`${width}px: one +, all actions, Tab/Escape/outside dismissal, dialog focus return, Markdown plan/list/table/line breaks and safe links`);
  }
  const chooser = ui.waitForEvent('filechooser'); await clickComposerAction(ui,'파일 첨부');
  await (await chooser).setFiles({name:'guide.txt',mimeType:'text/plain',buffer:Buffer.from('첨부 자료')});
  await ui.getByRole('button',{name:'guide.txt 미리보기'}).waitFor();
  assert.equal(await panel.isVisible(),false);
  await ui.reload(); await plus.waitFor();
  assert.equal(await panel.isVisible(),false);
  await ui.locator('.task-plan-label strong').waitFor();
  await ui.getByRole('button',{name:'guide.txt 미리보기'}).waitFor();
  checks.push('file chooser still attaches documents and persisted plans/attachments survive reload');
  assert.deepEqual(errors,[]);
  await writeFile('verification/composer-add-browser.json',JSON.stringify({checks,errors,actualBrowser:true,syntheticState:true,actualModel:false},null,2));
  console.log(checks.join('\n'));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}

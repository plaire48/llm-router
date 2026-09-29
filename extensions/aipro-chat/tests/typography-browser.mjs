import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-typography-'));
const checks = [], errors = [], measurements = [];
let tones, renderedFonts;
const markdown = '# 페이지 확인\n\n본문과 **강조**, [링크](https://example.test)가 같은 크기로 보입니다.\n\n## 작업 진행\n\n### 확인 결과\n\n#### 세부 항목\n\n##### 참고 사항\n\n###### 추가 설명\n\n- 읽기와 실행\n\n> 확인한 내용입니다.\n\n| 항목 | 결과 |\n|---|---|\n| 표시 | 정상 |\n\n`inline code`';
const progress = {status: 'running', plan: [
  {text: '현재 페이지 확인', status: 'completed'},
  {text: '선택한 표의 값과 수식 확인', status: 'in_progress'},
  {text: '변경 결과 검증', status: 'pending'},
]};
const trace = [
  {tool: 'read_page', status: 'done', planStep: '현재 페이지 확인', label: '**페이지** 읽기'},
  {tool: 'progress_note', status: 'done', content: '### 확인한 내용\n\n**선택한 표**를 기준으로 진행합니다.\n\n- [항목](https://example.test)과 `A1`의 값 확인'},
  {tool: 'analysis_page', status: 'running', planStep: '선택한 표의 값과 수식 확인', label: '**선택한 표** 분석'},
  {tool: 'run_playwright', status: 'error'},
  {tool: 'ask_user', status: 'waiting'},
];
let context;
try {
  await mkdir('verification', {recursive: true});
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`]});
  context.setDefaultTimeout(12000);
  await context.route('https://aipro.sdsdev.co.kr/**', r => r.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4'}]}}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite checks detailed execution UI; ordinary mode is covered by debug-plan-ui-browser.
  await worker.evaluate(() => chrome.storage.local.set({debugMode: true}));
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 1}}));
  const ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button', {name: '모델 변경', exact: true}).waitFor();
  tones = await ui.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const luminance = color => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => {v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;});
      return .2126 * r + .7152 * g + .0722 * b;
    };
    return [['body','--layout-text','--deck-card'], ['secondary','--layout-muted','--deck-tint'], ['active','--brand-ink','--deck-blue-soft'], ['success','--cx-success','--deck-green-soft'], ['warning','--cx-warning','--deck-orange-soft'], ['error','--cx-danger','--deck-red-soft']].map(([name, ink, surface]) => {
      const sample = document.createElement('span'); sample.style.color = `var(${ink})`; sample.style.backgroundColor = `var(${surface})`; document.body.append(sample);
      const style = getComputedStyle(sample), color = style.color, background = style.backgroundColor;
      const a = luminance(color), b = luminance(background); sample.remove();
      return {name, color, background, contrast: (Math.max(a,b) + .05) / (Math.min(a,b) + .05)};
    });
  });
  assert(tones.every(tone => tone.contrast >= 4.5), JSON.stringify(tones));
  checks.push('HTML body, secondary and state colors meet 4.5:1 text contrast on their pale surfaces');
  async function render(content, question, extras = {}) {
    await worker.evaluate(async ({content, question, extras}) => {
      const {chat} = await chrome.storage.local.get('chat');
      await chrome.storage.local.set({chat: {...chat, messages: [{id: 'user-font', role: 'user', content: '페이지를 확인해줘'},
        {id: 'font-answer', role: 'assistant', state: 'done', content, ...extras, ...(question ? {question} : {})}]}});
    }, {content, question, extras});
    await ui.locator('.message-body').last().waitFor({state: 'attached'}); await ui.evaluate(() => document.fonts.ready);
  }
  async function styles(locator, size, line) {
    const rows = await locator.evaluateAll(els => els.map(el => {const s = getComputedStyle(el); return {tag: el.tagName, text: el.textContent.slice(0, 35), font: s.fontFamily, size: s.fontSize, line: s.lineHeight, weight: s.fontWeight, color: s.color, background: s.backgroundColor};}));
    assert(rows.length); assert(rows.every(row => row.font.includes('Noto Sans KR') && row.size === size && (!line || row.line === line)), JSON.stringify(rows));
    measurements.push(...rows); return rows;
  }
  for (const width of [320, 360, 1100]) {
    await ui.setViewportSize({width, height: 960}); await render(markdown);
    await ui.locator('.message-body h6').waitFor();
    const headings = await styles(ui.locator('.message-body :is(h1,h2,h3,h4,h5,h6)'), '16px', '24px');
    assert(headings.every(row => row.weight === '600'));
    await styles(ui.locator('.message-body :is(p,li,th,td)'), '14px', '22px');
    const emphasis=await styles(ui.locator('.message-body strong'), '14px', '22px');
    assert(emphasis.every(row=>row.weight==='600'&&row.color==='rgb(27, 100, 218)'), 'Answer emphasis must use the shared readable weight and deep blue');
    await styles(ui.getByRole('textbox', {name: '메시지', exact: true}), '14px', '22px');
    await ui.reload(); await ui.locator('.message-body h6').waitFor();
    await styles(ui.locator('.message-body h6'), '16px', '24px');
    await ui.locator('.message-body h1').scrollIntoViewIfNeeded();
    assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await ui.screenshot({path: `verification/typography-chat-${width}.png`, animations: 'disabled'});
    await ui.getByRole('button', {name: '설정', exact: true}).click();
    const dialog = ui.getByRole('dialog', {name: '설정', exact: true});
    await styles(dialog.locator('.cx-panel-heading h2'), '16px', '24px');
    await styles(dialog.locator('summary'), '14px', '22px');
    await dialog.locator('.diagnostics > summary').click(); await dialog.locator('.storage-help > summary').click();
    await styles(dialog.locator('.storage-help p,.diagnostics pre'), '14px', '22px');
    await styles(dialog.locator('.settings-version'), '12px');
    await ui.screenshot({path: `verification/typography-settings-${width}.png`, animations: 'disabled'});
    await ui.keyboard.press('Escape');
    checks.push(`${width}px: markdown headings, body, composer and expanded settings keep the same role-based type scale after reload`);
    await render('진행 표기 확인', null, {progress, trace});
    await ui.locator('.task-plan-tool strong').waitFor();
    await ui.locator('.agent-trace > summary').click();
    await ui.locator('.subagent-group > summary').click();
    await styles(ui.locator('.task-plan summary,.task-plan-count,.task-plan-label,.task-plan-tool,.agent-trace > summary,.agent-tool-label,.agent-tool-state,.agent-trace-plan,.progress-inline,.progress-markdown :is(h3,p,li,strong,a)'), '14px', '22px');
    const stateTypes = await styles(ui.locator('.task-plan-label,.task-plan-tool,.agent-tool-state'), '14px', '22px');
    assert(stateTypes.every(row => row.weight === '400'), `Changing a step's status must not change its font weight: ${JSON.stringify(stateTypes)}`);
    assert.equal(await ui.locator('.task-plan-tool strong').textContent(), '선택한 표');
    if (!renderedFonts) {
      const cdp = await context.newCDPSession(ui); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const {root} = await cdp.send('DOM.getDocument');
      const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector: '.agent-tool-state'});
      renderedFonts = (await cdp.send('CSS.getPlatformFontsForNode', {nodeId})).fonts;
      assert(renderedFonts.length && renderedFonts.every(font => font.familyName.includes('Noto Sans KR') && font.isCustomFont), JSON.stringify(renderedFonts));
      await cdp.detach();
    }
    const colors = await ui.evaluate(() => {
      const color = selector => getComputedStyle(document.querySelector(selector)).color;
      return {body: color('.agent-tool-label'), secondary: color('.task-plan-tool'), active: color('.agent-trace li[data-status="running"] .agent-tool-state'), error: color('.agent-trace li[data-status="error"] .agent-tool-state'), surface: getComputedStyle(document.querySelector('.task-plan li[data-status="in_progress"]')).backgroundColor};
    });
    assert.deepEqual(colors, {body: 'rgb(25, 31, 40)', secondary: 'rgb(78, 89, 104)', active: 'rgb(25, 31, 40)', error: 'rgb(210, 32, 48)', surface: 'rgb(232, 241, 254)'});
    const code = await ui.locator('.progress-markdown code').evaluate(el => {const s = getComputedStyle(el); return {size: s.fontSize, line: s.lineHeight};});
    assert.deepEqual(code, {size: '14px', line: '22px'});
    assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.task-plan,.agent-trace')].every(el => el.scrollWidth <= el.clientWidth)));
    await ui.locator('.message-assistant').screenshot({path: `verification/typography-progress-${width}.png`, animations: 'disabled'});
    const doneProgress = {...progress, status: 'done', plan: progress.plan.map(step => ({...step, status: 'completed'}))};
    await render('진행 표기 확인', null, {progress: doneProgress, trace: trace.map(step => step.status === 'running' ? {...step, status: 'done'} : step)});
    const completedTypes = await styles(ui.locator('.task-plan-label,.agent-tool-state'), '14px', '22px');
    assert(completedTypes.every(row => row.weight === '400'), 'Completion must preserve the same type scale and weight');
    await render('진행 표기 확인', null, {progress: {...progress, status: 'paused'}, trace});
    await ui.locator('.task-plan-pause').waitFor();
    await styles(ui.locator('.task-plan-pause'), '14px', '22px');
    await ui.reload(); await ui.locator('.task-plan-pause').waitFor();
    await ui.locator('.agent-trace > summary').click();
    await ui.locator('.subagent-group > summary').click();
    await styles(ui.locator('.task-plan-label,.task-plan-pause,.agent-tool-state,.agent-trace-plan,.progress-markdown :is(h3,p,li)'), '14px', '22px');
    checks.push(`${width}px: plan, live tool labels, Markdown and paused/reloaded progress share 14/22px with HTML ink, subtext and state colors`);
  }
  await render('', {id: 'font-question', text: '어떤 내용을 담을까요?', options: [], kind: 'text', inputMode: 'long_text'});
  await ui.locator('.question-card textarea').waitFor();
  await styles(ui.locator('.question-card .interaction-heading p,.question-card textarea'), '14px', '22px');
  await render('', {id: 'font-approval', kind: 'approval', text: '작성한 내용을 등록할까요?', action: '등록', options: [], preview: [{label: '제목', value: '확인한 내용'}]});
  await ui.locator('.approval-preview summary').click();
  await styles(ui.locator('.action-approval .interaction-heading p,.approval-preview summary,.approval-preview dt,.approval-preview dd,.approval-actions button:not([data-icon-only])'), '14px', '22px');
  checks.push('narrative questions, approval previews and actions share the same body font and line height');
  assert.deepEqual(errors, []); console.log(checks.map(text => `PASS ${text}`).join('\n'));
  await writeFile('verification/typography-browser.json', JSON.stringify({checks, errors, measurements, tones, renderedFonts, actualBrowser: true, syntheticTranscript: true}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

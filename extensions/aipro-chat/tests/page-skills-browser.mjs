import {clickComposerAction} from './helpers/composer-actions.mjs';
import {importSkillArchive} from '../skill-archive.js';
import {planCompletion} from './fixtures/task-plan.mjs';
import {chromium} from 'playwright';
import {assertModalTypography} from './helpers/modal-typography.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, readFile, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-page-skills-')), output = resolve('verification'), extension = resolve(profile,'extension');
const assertions = [], errors = [], requests = [];
let recoveryAnalysts = 0;
let context, ui, target, worker;
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
const check = label => {assertions.push(label); console.log(`PASS ${label}`);};
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>신청서</title><style>body{font:16px sans-serif;padding:30px}label{display:block;margin:16px}textarea{display:block}.hidden{display:none}</style><h1>교육 신청</h1><main><p>이름과 메모를 입력하세요.</p><form onsubmit="event.preventDefault();window.submits++"><label>이름 <input name="name" value="private-existing-value"></label><label>메모 <textarea name="memo"></textarea></label><label>분류 <select name="category"><option value="dev">개발</option><option value="design">디자인</option></select></label><label>비밀번호 <input type="password" value="private-password"></label><input type="hidden" value="private-hidden"><label>API key<textarea name="api_key">private-api-key</textarea></label><label>카드번호<input autocomplete="cc-number" value="private-card"></label><p class="hidden">private-hidden-text</p><button>제출</button></form></main><script>window.submits=0;window.inputEvents=0;document.addEventListener('input',()=>window.inputEvents++);/* private-script */</script></html>`;
const rpc = (type, values = {}) => ui.evaluate(async ({type, values}) => chrome.runtime.sendMessage({type, ...values}), {type, values});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {for (let i = 0; i < (process.env.HEADED === '1' ? 2400 : 200); i++) {if (await fn() === expected) return; await new Promise(resolve => setTimeout(resolve, 50));} assert.equal(await fn(), expected);}
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
function tool(name, args) {return frame({choices: [{delta: {tool_calls: [{index: 0, id: `call-${requests.length}`, type: 'function', function: {name, arguments: JSON.stringify(args)}}]}, finish_reason: 'tool_calls'}]}) + 'data: [DONE]\n\n';}
async function connect() {
  await target.bringToFront();
  const result = await rpc('CONNECT_PAGE');
  assert.equal(result.ok, true, result.error);
  await poll(async () => !!(await state()).page, true);
}
async function send(text) {
  await ui.bringToFront();
  await ui.getByRole('dialog').waitFor({state: 'hidden'});
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(text);
  assert.equal(await ui.getByRole('textbox', {name: '메시지', exact: true}).inputValue(), text);
  await ui.getByRole('button', {name: '전송', exact: true}).click();
}
async function select(name) {
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('dialog', {name: '스킬', exact: true}).locator('.skill-option').filter({hasText: name}).click();
  await ui.getByRole('dialog', {name: '스킬', exact: true}).waitFor({state: 'hidden'});
}
try {
  await mkdir(output, {recursive: true});
  await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://*/*','https://*/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', channel: 'chromium', executablePath: process.env.CHROME_BINARY || undefined, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(process.env.HEADED === '1' ? 120000 : 10000);
  await context.route('https://first.example.test/**', route => route.fulfill({contentType: 'text/html', body: fixture}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/fixture')) return route.fulfill({contentType: 'text/html', body: fixture});
    if (path === '/api/models') return route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', target: 'chat', context_length: 524288, max_input_tokens: 460800}]})});
    if (path !== '/api/v1/chat/completions') return route.abort();
    assert.equal(route.request().headers().authorization, `Bearer ${token}`);
    const body = route.request().postDataJSON();
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    const review = goalReviewPayload(body.messages);
    if (review) return route.fulfill({json: reviewCompletion(review)});
    // A leader that repeats the same step without progress gets one read-only
    // recovery analyst (action-recovery-analysis.js). It never acts in the page.
    if (/isolated recovery analyst/.test(body.messages[0]?.content || '')) {
      recoveryAnalysts++;
      assert.deepEqual((body.tools || []).map(item => item.function.name).filter(name => name !== 'read_analysis_evidence'), []);
      const brief = JSON.parse(body.messages[1].content), id = brief.evidence[0].evidence_id;
      if (body.tools?.length && !body.messages.some(message => message.role === 'tool')) return route.fulfill({contentType: 'text/event-stream', body: tool('read_analysis_evidence', {evidence_id: id})});
      return route.fulfill({contentType: 'text/event-stream', body: frame({choices: [{delta: {content: JSON.stringify({status: 'complete', summary: '같은 도구 선택을 반복했습니다.',
        findings: [{text: '필요한 도구는 이미 선택되어 있습니다.', evidence_ids: [id]}], uncertainties: [], next_step: '선택된 도구로 다음 단계를 진행하세요.'})}, finish_reason: 'stop'}]}) + 'data: [DONE]\n\n'});
    }
    requests.push(body);
    const last = body.messages.at(-1);
    const storageTask = body.messages.findLast(message => message.role === 'user')?.content.includes('저장 정보');
    let response;
    if (last.role !== 'tool') response = body.tools.some(t => t.function.name === 'select_tools') ? tool('select_tools', {groups: ['scripts']}) : tool('inspect_dom', {});
    else {
      const result = JSON.parse(last.content);
      if (result.tools) response = tool('inspect_dom', {});
      else if (storageTask && result.fields) response = tool('list_page_storage', {});
      else if (storageTask && result.areas) response = tool('read_page_storage', {area:'local', keys:['application']});
      else if (storageTask && result.entries) {const data=result.entries[0].value; response=tool('fill_form', {fields:[{field_id:'f1',value:data.name},{field_id:'f2',value:data.memo}]});}
      else if (result.fields && body.tools.some(tool => tool.function.name === 'fill_form')) response = tool('fill_form', {fields: [{field_id: result.fields.find(field => field.label === '이름').field_id, value: '홍길동'}, {field_id: result.fields.find(field => field.label === '메모').field_id, value: '교육 신청합니다.'}]});
      else response = frame({choices: [{delta: {content: result.cancelled ? '입력을 취소했습니다.' : result.error ? '페이지가 변경되어 입력하지 못했습니다.' : result.applied ? '입력했습니다.' : '페이지 구조를 확인했습니다.'}, finish_reason: 'stop'}]}) + frame({choices: [], usage: {prompt_tokens: 1300, completion_tokens: 15, total_tokens: 1315}}) + 'data: [DONE]\n\n';
    }
    return route.fulfill({contentType: 'text/event-stream', body: response});
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite checks detailed execution UI; ordinary mode is covered by debug-plan-ui-browser.
  await worker.evaluate(() => chrome.storage.local.set({debugMode: true}));
  await worker.evaluate(async token => {
    // This suite asserts edits on the original fixture page. Dedicated windows
    // are covered by workspace-browser and real-HTTP OpenWiki integration tests.
    await chrome.storage.local.set({browserWorkMode: 'current'});
    await chrome.storage.session.set({credential: {mode: 'browser', token, receivedAt: 7}});
  }, token);
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.setViewportSize({width: 360, height: 800});
  await poll(async () => (await state()).catalog?.models?.length, 1);
  assert.equal((await state()).skills.length, 5);
  assert.equal(await ui.getByRole('button', {name: '현재 페이지 연결', exact: true, includeHidden: true}).innerText(), '현재 페이지 연결');
  assert.equal(await ui.getByRole('button', {name: '스킬 선택', exact: true, includeHidden: true}).innerText(), '스킬 선택');
  await clickComposerAction(ui, '스킬 선택');
  await ui.screenshot({path: resolve(output, 'skills-panel.png'), fullPage: true});
  await ui.getByRole('button', {name: '스킬 등록', exact: true}).click();
  await ui.getByRole('dialog', {name: '스킬 등록', exact: true}).locator('input[type="file"]:not([webkitdirectory])').setInputFiles({name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: 핵심 요약\n---\n핵심 세 문장으로 답변하세요.')});
  await poll(() => ui.getByRole('textbox', {name: '이름', exact: true}).inputValue(), '핵심 요약');
  await ui.keyboard.press('Escape');
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('button', {name: '스킬 등록', exact: true}).click();
  assert.equal(await ui.getByRole('textbox', {name: '이름', exact: true}).inputValue(), '핵심 요약');
  assert.equal(await ui.getByRole('textbox', {name: '지침', exact: true}).inputValue(), '핵심 세 문장으로 답변하세요.');
  check('closing an imported skill draft preserves its unsaved content in this conversation');
  await ui.getByRole('button', {name: '저장', exact: true}).click();
  await poll(async () => (await state()).skills.length, 6);
  const customId = (await state()).activeSkillId;
  await ui.reload();
  assert.equal((await state()).activeSkillId, customId);
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('button', {name: '핵심 요약 편집', exact: true}).click();
  // Opening without changing anything must not cache an old server revision.
  await ui.keyboard.press('Escape');
  const updatedSkill = {...(await state()).skills.find(skill => skill.id === customId), description: '최신 서버 설명', instructions: '새 저장본의 지침입니다.'};
  assert.equal((await rpc('SAVE_SKILL', {skill: updatedSkill})).ok, true);
  await clickComposerAction(ui, '스킬 선택');
  await ui.locator('.skill-option[title^="최신 서버 설명"]').waitFor();
  await ui.getByRole('button', {name: '핵심 요약 편집', exact: true}).click();
  assert.equal(await ui.getByRole('textbox', {name: '지침', exact: true}).inputValue(), '새 저장본의 지침입니다.');
  check('an untouched skill editor reopens the latest stored revision');
  await ui.getByRole('textbox', {name: '지침', exact: true}).fill('중요한 내용만 두 문장으로 답변하세요.');
  await ui.keyboard.press('Escape');
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('button', {name: '스킬 등록', exact: true}).click();
  assert.equal(await ui.getByRole('textbox', {name: '이름', exact: true}).inputValue(), '');
  assert.equal(await ui.getByRole('textbox', {name: '지침', exact: true}).inputValue(), '');
  await ui.getByRole('button', {name: '취소', exact: true}).click();
  await ui.getByRole('button', {name: '핵심 요약 편집', exact: true}).click();
  assert.equal(await ui.getByRole('textbox', {name: '지침', exact: true}).inputValue(), '중요한 내용만 두 문장으로 답변하세요.');
  await ui.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...rest) => message.type === 'SAVE_SKILL' ? new Promise(resolve => {
      window.releaseSkillSave = () => {chrome.runtime.sendMessage = original; resolve({ok: false, error: 'storage_failed'});};
    }) : original(message, ...rest);
  });
  await ui.getByRole('button', {name: '저장', exact: true}).click();
  await ui.waitForFunction(() => typeof window.releaseSkillSave === 'function');
  const skillDialog = ui.getByRole('dialog', {name: '스킬 편집', exact: true});
  assert(await skillDialog.locator('input, textarea').evaluateAll(fields => fields.length >= 5 && fields.every(field => field.disabled)));
  await ui.keyboard.press('Escape'); assert(await skillDialog.isVisible());
  await ui.evaluate(() => window.releaseSkillSave());
  await skillDialog.getByText('저장하지 못했습니다. 다시 시도해 주세요.', {exact: true}).waitFor();
  assert.equal(await ui.getByRole('textbox', {name: '지침', exact: true}).inputValue(), '중요한 내용만 두 문장으로 답변하세요.');
  assert(await ui.getByRole('textbox', {name: '지침', exact: true}).isEnabled());
  check('skill drafts stay isolated by target; pending save locks inputs and closing, then failed save preserves edits for retry');
  await ui.getByRole('button', {name: '저장', exact: true}).click();
  await poll(async () => (await state()).skills.find(skill => skill.id === customId)?.instructions, '중요한 내용만 두 문장으로 답변하세요.');
  check('five built-in skills and Markdown import/edit persist across reload with icon-only entry points');
  const skillDirectory = resolve(profile, 'checkout-skill');
  await mkdir(resolve(skillDirectory, 'references'), {recursive: true});
  await mkdir(resolve(skillDirectory, 'scripts'), {recursive: true});
  await writeFile(resolve(skillDirectory, 'SKILL.md'), '---\nname: checkout-skill\ndescription: Checkout 초안 작성과 확인\n---\n필요하면 references/check.md를 읽고 현재 입력 내용을 확인하세요.');
  await writeFile(resolve(skillDirectory, 'references/check.md'), '필수 항목을 확인하고 등록 전 승인을 받으세요.');
  await writeFile(resolve(skillDirectory, 'scripts/example.py'), 'print("reference only")');
  await clickComposerAction(ui, '스킬 선택');
  assert.equal(await ui.getByRole('button', {name: '스킬 폴더 불러오기', exact: true}).innerText(), '');
  await ui.locator('input[webkitdirectory]').setInputFiles(skillDirectory);
  await ui.getByRole('textbox', {name: '이름', exact: true}).waitFor();
  assert.equal(await ui.getByRole('textbox', {name: '사용할 때', exact: true}).inputValue(), 'Checkout 초안 작성과 확인');
  assert.equal(await ui.getByRole('dialog', {name: '스킬 등록', exact: true}).getByRole('checkbox').count(), 0);
  await ui.getByText('참고 자료 2개', {exact: true}).click();
  await ui.getByText('scripts/example.py', {exact: true}).waitFor();
  await assertModalTypography(ui.getByRole('dialog', {name: '스킬 등록', exact: true}));
  await ui.screenshot({path: resolve(output, 'workflow-skill-folder-mobile.png'), fullPage: true});
  await ui.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...rest) => message.type === 'SAVE_SKILL' ? new Promise((resolve, reject) => {
      window.releaseFolderSave = () => {chrome.runtime.sendMessage = original; original(message, ...rest).then(resolve, reject);};
    }) : original(message, ...rest);
  });
  await ui.getByRole('button', {name: '저장', exact: true}).click();
  await ui.waitForFunction(() => typeof window.releaseFolderSave === 'function');
  assert(await ui.getByRole('dialog', {name: '스킬 등록', exact: true}).locator('textarea').evaluateAll(fields => fields.length === 3 && fields.every(field => field.disabled)));
  await ui.evaluate(() => window.releaseFolderSave());
  await poll(async () => (await state()).skills.length, 7);
  await ui.reload();
  const folderSkill = (await state()).skills.find(skill => skill.name === 'checkout-skill');
  assert.equal(folderSkill.resources.length, 2); assert.equal(folderSkill.toolMode, 'automatic'); assert.equal(folderSkill.needsPage, false);
  assert.match(folderSkill.resources.find(item => item.path === 'scripts/example.py').content, /reference only/);
  await rpc('DELETE_SKILL', {id: folderSkill.id});
  check('folder import preserves purpose and reference scripts with automatic tool selection and no eager page access');

  target = await context.newPage(); await target.goto('https://first.example.test/fixture?private-query=omit');
  assert.equal((await state()).page, null);
  const pagesBeforeOpen = context.pages().length;
  await rpc('OPEN_TAB');
  assert.equal(context.pages().length, pagesBeforeOpen, 'full-screen open reuses the existing Nubi chat tab');
  await ui.waitForURL(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.evaluate(() => {window.reuseProbe = 'same document';});
  for (let i = 0; i < 2; i++) {
    await rpc('OPEN_TAB', {hash:'#settings'});
    await ui.getByRole('dialog').waitFor();
    await ui.keyboard.press('Escape');
    await ui.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await ui.evaluate(() => window.reuseProbe), 'same document');
    assert.equal(context.pages().length, pagesBeforeOpen);
  }

  await ui.setViewportSize({width: 360, height: 800});
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  await select('소스 확인');
  await ui.evaluate(() => {window.realPermissionRequest=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=async()=>false;});
  const beforeDenied = (await state()).chat.messages.length;
  await send('권한 거부 후에도 유지할 초안');
  await ui.getByText('웹페이지 접근을 허용한 뒤 다시 전송해 주세요.', {exact:true}).waitFor();
  assert.equal((await state()).chat.messages.length, beforeDenied);
  assert.equal(requests.length, 0);
  assert.equal(await ui.getByRole('textbox', {name:'메시지',exact:true}).inputValue(), '권한 거부 후에도 유지할 초안');
  await ui.evaluate(() => {chrome.permissions.request=window.realPermissionRequest;});
  check('declining optional access preserves the draft and sends no page or model request');
  for (const name of ['소스 확인', '구조 분석']) {
    await select(name);
    const previous = (await state()).chat.messages.length;
    await send(`${name} 스킬로 현재 페이지를 확인해줘`);
    await poll(async () => (await state()).chat.messages.length, previous + 2);
    await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
    assert.equal((await state()).page.url, 'https://first.example.test/fixture');
    assert(requests.at(-1).messages.some(message => message.role === 'tool' && message.content.includes('교육 신청')));
  }
  check('source and structure skills automatically connect the original website after opening full-screen chat without a link click');
  await select('입력란 채우기');
  await send('이름은 홍길동, 메모는 교육 신청합니다.로 입력해줘');
  await ui.getByRole('dialog', {name: '입력 내용 확인', exact: true}).waitFor();
  assert.equal(await target.locator('input[name="name"]').inputValue(), 'private-existing-value');
  await assertModalTypography(ui.getByRole('dialog', {name: '입력 내용 확인', exact: true}));
  await ui.screenshot({path: resolve(output, 'fill-review-panel.png'), fullPage: true});
  await ui.getByRole('button', {name: '취소', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(await target.locator('input[name="name"]').inputValue(), 'private-existing-value');
  assert.equal((await state()).chat.messages.at(-1).content, '입력을 취소했습니다.');
  check('model-driven inspect and fill proposal make no page changes before review or after cancellation');
  const serialized = JSON.stringify(requests);
  for (const secret of ['private-existing-value', 'private-password', 'private-hidden', 'private-api-key', 'private-card', 'private-query', 'private-script']) assert(!serialized.includes(secret), secret);
  check('tool results omit form values, hidden content, scripts, secret inputs and URL query values');
  await send('같은 내용으로 입력해줘');
  await ui.getByRole('dialog', {name: '입력 내용 확인', exact: true}).waitFor();
  await target.locator('input[name="name"]').fill('사용자가 수정한 값');
  await ui.getByRole('button', {name: '페이지에 입력', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(await target.locator('input[name="name"]').inputValue(), '사용자가 수정한 값');
  assert.equal(await target.locator('textarea[name="memo"]').inputValue(), '');
  check('edits made after proposal invalidate the whole plan before any field changes');
  await send('다시 입력해줘');
  await ui.getByRole('dialog', {name: '입력 내용 확인', exact: true}).waitFor();
  await ui.getByRole('button', {name: '페이지에 입력', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(await target.locator('input[name="name"]').inputValue(), '홍길동');
  assert.equal(await target.locator('textarea[name="memo"]').inputValue(), '교육 신청합니다.');
  assert.equal(await target.evaluate(() => window.submits), 0);
  assert.equal((await state()).chat.messages.at(-1).content, '입력했습니다.');
  assert.equal((await rpc('APPLY_FILL', {requestId: 'stale', planId: 'stale'})).ok, false);
  await ui.setViewportSize({width: 1100, height: 850});
  await ui.screenshot({path: resolve(output, 'skills-chat-desktop.png'), fullPage: true});
  check('approved fields dispatch input events and report actual changes without submitting; stale plans are rejected');
  await send('다시 한번 입력해줘');
  await ui.getByRole('dialog', {name: '입력 내용 확인', exact: true}).waitFor();
  await target.goto('https://first.example.test/fixture-next');
  await ui.getByRole('button', {name: '페이지에 입력', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(await target.locator('input[name="name"]').inputValue(), 'private-existing-value');
  check('navigation to another document cannot receive an old approved fill plan');
  await target.evaluate(() => {
    localStorage.setItem('application', JSON.stringify({name:'김신청',memo:'저장된 교육 신청',authToken:'hidden-nested-secret',nested:{password:'hidden-password',category:'교육'}}));
    localStorage.setItem('access_token', 'hidden-root-secret');
    localStorage.setItem('opaque', 'abCDef0123456789abcdefghijABCDEFGHIJKLMN');
    localStorage.setItem('nestedEncoded', JSON.stringify({data: JSON.stringify({token:'hidden-encoded-secret',note:'공개 메모'})}));
    localStorage.setItem('large', 'x'.repeat(20000));
    sessionStorage.setItem('selectedCourse', JSON.stringify({title:'브라우저 활용'}));
  });
  await rpc('SAVE_SKILL', {skill: {name: '저장 정보 입력', instructions: 'Read requested storage keys, propose field values and verify them after user review.', needsPage: true, allowStorage: true, allowFill: true, allowAutomation: false}});
  const beforeStorage = requests.length;
  await send('현재 페이지의 저장 정보로 신청서를 채워줘');
  await ui.getByRole('dialog', {name: '입력 내용 확인', exact: true}).waitFor();
  assert.equal(await target.locator('input[name="name"]').inputValue(), 'private-existing-value');
  assert(await ui.getByRole('dialog').innerText().then(text => text.includes('김신청')));
  await ui.getByRole('button', {name:'페이지에 입력',exact:true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert.equal(await target.locator('input[name="name"]').inputValue(), '김신청');
  assert.equal(await target.locator('textarea').first().inputValue(), '저장된 교육 신청');
  const agentMessages = requests.at(-1).messages;
  const fillResult = JSON.parse(agentMessages.at(-1).content);
  assert.equal(fillResult.verified, true);
  assert.equal(fillResult.verification.matched, 2);
  assert.equal(fillResult.submitted, false);
  const storageResults = agentMessages.filter(message => message.role==='tool').map(message=>JSON.parse(message.content));
  assert.equal(storageResults[1].origin, 'https://first.example.test');
  assert(!storageResults[1].areas.local.includes('access_token'));
  assert(storageResults[1].areas.session.includes('selectedCourse'));
  assert.equal(storageResults[2].entries[0].value.nested.category, '교육');
  assert(!JSON.stringify(requests.slice(beforeStorage)).includes('hidden-nested-secret'));
  assert(!JSON.stringify(requests.slice(beforeStorage)).includes('hidden-root-secret'));
  const trace = (await state()).chat.messages.at(-1).trace;
  assert.deepEqual(trace.map(step=>step.tool), ['inspect_dom','list_page_storage','read_page_storage','fill_form','verify_form']);
  assert(trace.every(step=>step.status==='done'));
  assert(!JSON.stringify(trace).includes('김신청'));
  await ui.locator('.agent-trace').last().locator(':scope > summary').click();
  await ui.setViewportSize({width:360,height:800});
  await ui.screenshot({path:resolve(output,'agent-chat-mobile.png'),fullPage:true});
  assert(await ui.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  await ui.reload();
  assert.deepEqual((await state()).chat.messages.at(-1).trace, trace);
  check('browser agent inspects DOM, reads selected site storage, proposes values and verifies the applied DOM; trace survives reload without tool payloads');

  // Exercise the isolated page implementation through the granted production extension.
  const pageOp = (operation,args={}) => ui.evaluate(async ({operation,args}) => {
    const module=await import(chrome.runtime.getURL('page-tools.js'));
    const {page}=await chrome.storage.session.get('page');
    return module.runPageOperation(page,operation,args);
  },{operation,args});
  await pageOp('list_page_storage');
  assert.equal((await pageOp('read_page_storage',{area:'local',keys:['access_token']})).error, 'storage_key_unavailable');
  const filtered = await pageOp('read_page_storage',{area:'local',keys:['opaque','nestedEncoded','large']});
  assert.equal(filtered.entries[0].value,'[redacted]');
  assert.equal(filtered.entries[1].value.data.note,'공개 메모');
  assert(!JSON.stringify(filtered).includes('hidden-encoded-secret'));
  assert.equal(filtered.entries[2].omitted,'value_too_large');
  assert.equal((await pageOp('read_page_storage',{area:'session',keys:['selectedCourse']})).entries[0].value.title,'브라우저 활용');
  check('storage tools enforce prior key listing, secret filtering, nested serialized JSON filtering and bounded results across local/session storage');

  await target.evaluate(()=>document.querySelector('input[name="name"]').addEventListener('input', event=>setTimeout(()=>{event.target.value='사이트가 되돌린 값';},80),{once:true}));
  await send('저장 정보로 다시 채워줘');
  await ui.getByRole('dialog', {name:'입력 내용 확인',exact:true}).waitFor();
  await ui.getByRole('button', {name:'페이지에 입력',exact:true}).click();
  await poll(async ()=>(await state()).chat.messages.at(-1)?.state,'done');
  const rejectedFill=JSON.parse(requests.at(-1).messages.at(-1).content);
  assert.equal(rejectedFill.verified,false);
  assert.equal(rejectedFill.error,'fill_not_retained');
  assert.equal((await state()).chat.messages.at(-1).trace.at(-1).status,'error');
  check('post-action verification catches a site reverting the field asynchronously and returns failure evidence to the model');

  await clickComposerAction(ui, '스킬 선택');
  const downloading = ui.waitForEvent('download');
  await ui.getByRole('button',{name:'브라우저 작업 내보내기',exact:true}).click();
  const downloaded = await downloading;
  const shared = await readFile(await downloaded.path());
  const imported = await importSkillArchive(new Uint8Array(shared));
  assert.equal(imported.name, '브라우저 작업');
  assert(!JSON.stringify(imported).includes('김신청'));
  assert(!JSON.stringify(imported).includes(token));
  await ui.getByRole('dialog', {name: '스킬', exact: true}).locator('input[type="file"]:not([webkitdirectory])').setInputFiles({name:'agent.skill.zip',mimeType:'application/zip',buffer:Buffer.from(shared)});
  assert.equal(await ui.getByRole('dialog', {name: '스킬 등록', exact: true}).getByRole('checkbox').count(), 0);
  await ui.getByRole('textbox',{name:'이름',exact:true}).fill('공유한 신청서 스킬');
  await ui.screenshot({path:resolve(output,'agent-skill-editor-mobile.png'),fullPage:true});
  await ui.setViewportSize({width:1100,height:850});
  await assertModalTypography(ui.getByRole('dialog', {name:'스킬 등록',exact:true}));
  await ui.screenshot({path:resolve(output,'agent-skill-editor-desktop.png'),fullPage:true});
  await ui.setViewportSize({width:360,height:800});
  assert(await ui.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
  await ui.getByRole('button',{name:'저장',exact:true}).click();
  assert.equal((await state()).skills.find(skill=>skill.name==='공유한 신청서 스킬').allowStorage,true);
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('button',{name:'공유한 신청서 스킬 삭제',exact:true}).click();
  await ui.keyboard.press('Escape');
  check('download/import round trip preserves workflow instructions with automatic tools and no capability checkboxes or private data');

  await select('Playwright 작업');
  await send('이 페이지 입력 테스트를 작성해줘');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  assert(requests.at(-1).messages[0].content.includes('run_playwright'));
  assert(requests.at(-1).tools.some(tool => tool.function.name === 'run_playwright'));
  assert.equal((await state()).page.url, 'https://first.example.test/fixture-next');
  check('Playwright skill reconnects after navigation and advertises its packaged executor');
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('button', {name: '핵심 요약 삭제', exact: true}).click();
  await ui.getByRole('button', {name: '저장 정보 입력 삭제', exact: true}).click();
  await poll(async () => (await state()).skills.length, 5);
  await ui.keyboard.press('Escape');
  await clickComposerAction(ui, '현재 페이지 연결');
  await poll(async () => (await state()).page, null);
  assert(await ui.evaluate(() => chrome.permissions.contains({origins:['http://*/*','https://*/*']})));
  // The main fixture has required grants, which Chrome cannot revoke. Check
  // genuine ungranted injection using the unchanged distribution in a fresh
  // profile instead of mocking Chrome's permission enforcement.
  const ungranted=await chromium.launchPersistentContext(resolve(profile,'ungranted'),{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
  try {
    await ungranted.route('https://first.example.test/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
    const ungrantedWorker=ungranted.serviceWorkers()[0]||await ungranted.waitForEvent('serviceworker');
    const opening=ungranted.waitForEvent('page');
    const ungrantedTab=await ungrantedWorker.evaluate(()=>chrome.tabs.create({url:'https://first.example.test/fixture'}));
    const ungrantedPage=await opening;
    await ungrantedPage.waitForURL('https://first.example.test/fixture');
    await ungrantedPage.getByRole('heading',{name:'교육 신청',exact:true}).waitFor();
    const ungrantedUI=await ungranted.newPage();
    await ungrantedUI.goto(`chrome-extension://${new URL(ungrantedWorker.url()).hostname}/index.html`);
    const error=await ungrantedUI.evaluate(async tabId=>{const module=await import(chrome.runtime.getURL('page-tools.js'));try {await module.runPageOperation({tabId},'connect');return null;}catch(error){return error.message;}},ungrantedTab.id);
    assert.equal(error,'page_permission');
  } finally {await ungranted.close();}
  check('the unchanged distribution without a site grant receives a real Chrome injection denial on the fixture origin');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'page-skills-browser-results.json'), JSON.stringify({synthetic: true, realAiProVerified: false, permissionScope: 'Pregranted fixture writes; simulated user decline; unchanged distribution in a second profile for actual missing-grant injection denial', actualOptionalHostPermission:false,fixtureSiteAccessPregranted:true,userDeclineSimulated:true,actualUngrantedAccessVerified:true, assertions, pageErrors: errors}, null, 2));
} catch (error) {
  console.error('Synthetic UI failure', {errors, requestCount: requests.length, state: await state().then(data => ({busy: data.busy, activeSkillId: data.activeSkillId, messages: data.chat.messages, draft: data.chat.draft})).catch(() => null), text: await ui?.locator('body').innerText().catch(() => '')});
  throw error;
} finally {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}

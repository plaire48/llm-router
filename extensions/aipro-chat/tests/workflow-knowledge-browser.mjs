import {clickComposerAction} from './helpers/composer-actions.mjs';
import {importSkillArchive} from '../skill-archive.js';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {planCompletion,fixturePlan} from './fixtures/task-plan.mjs';
import {SKILL_CREATOR_PROMPT} from '../skill-creator.js';
import {goalReviewPayload} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-workflow-knowledge-')), extension = resolve(profile, 'extension');
const server = createServer((_, res) => {res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(`<!doctype html><html lang="ko"><title>업무 기록</title><h1>업무 기록</h1>
<label>업무 날짜<input></label><label>투입 시간<input type="number" aria-describedby="unit"></label><p id="unit">단위: 시간</p>
<label>업무 내용<textarea></textarea></label><button onclick="submits++">등록</button><script>window.submits=0;window.writes=0;addEventListener('input',()=>writes++);</script></html>`);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/work-log`;
let context, ui, worker, source, failure, round = 0, skillId, observation, reviews = 0, creations = 0, reuseRound = 0, reuse = false, failedAfterAnswers = false, holdCreator = false, releaseCreator;
const errors = [], checks = [];
const reply = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}]});
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const ref = name => {const item = observation.frames.flatMap(f => f.elements || []).find(e => e.name === name); assert(item?.ref, name); return item.ref;};
async function expectDownloadToastAtTop() {
  await ui.locator('.cx-toast').waitFor();
  const position = await ui.locator('.cx-toast').evaluate(el => {
    const rect = el.getBoundingClientRect(), region = getComputedStyle(el.parentElement);
    return {count: document.querySelectorAll('.cx-toast').length, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, position: region.position, insetTop: region.top, insetBottom: el.parentElement.computedStyleMap().get('bottom').toString()};
  });
  assert.equal(position.count, 1, JSON.stringify(position));
  assert.equal(position.position, 'fixed', JSON.stringify(position));
  assert.equal(position.insetBottom, 'auto', JSON.stringify(position));
  assert(Math.abs(position.top - (position.width <= 600 ? 12 : 24)) < 1, JSON.stringify(position));
  assert(position.bottom < position.height / 2, JSON.stringify(position));
}
async function until(predicate) {for (let i = 0; i < 800; i++) {if (failure) throw failure; if (await predicate()) return; await new Promise(r => setTimeout(r, 40));} assert.fail('Workflow did not finish');}
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    const body = route.request().postDataJSON();
    if (body.messages[0]?.content.startsWith(SKILL_CREATOR_PROMPT)) {
      if (holdCreator) {await new Promise(resolve => {releaseCreator = resolve;}); return route.fulfill({json:reply(null,{},'{"name":"late"}')}).catch(()=>{});}
      creations++; assert(body.tools.every(t => ['ask_user','find_skills','read_skill'].includes(t.function.name))); const packet = JSON.parse(body.messages.find(m=>m.role==='user').content);
      assert.equal(packet.conversationContext.scope, 'current_conversation');
      assert(packet.conversationContext.conversationId);
      assert(packet.conversationContext.statements.some(item => item.text.includes('MH 480분') && item.text.includes('등록하지 마')));
      assert(packet.steps.some(s => s.tool === 'verify_page' && s.status === 'done')); assert.equal(packet.verification, 'passed');
      assert(!JSON.stringify(packet).includes('synthetic-workflow'));
      if (creations > 1 && !packet.answers?.length) {
        const read = body.messages.findLast(m=>m.role==='tool');
        if (!read) return route.fulfill({json:reply('read_skill',{skill_id:skillId,path:'references/terms.md'})});
        assert(JSON.parse(read.content).content.includes('MH'));
        return route.fulfill({json:reply('ask_user',{question:'초안 작성을 마치면 어떻게 안내할까요?',choices:[{label:'작성 완료만 안내',description:'등록하지 않고 초안 상태로 둡니다.'},{label:'검토 요청까지 안내',description:'담당자가 확인할 항목을 덧붙입니다.'}]})});
      }
      if (packet.answers?.length===1) {
        assert.equal(packet.answers[0].answer,'검토 요청까지 안내');
        return route.fulfill({json:reply('ask_user',{question:'사내 업무 유형의 정확한 이름은 무엇인가요?',input_placeholder:'업무 유형 이름'})});
      }
      if (packet.answers?.length===2) {
        assert.equal(packet.answers[1].answer,'공유용 업무 기록');
        if (!failedAfterAnswers) {failedAfterAnswers=true; return route.fulfill({json:reply(null,{},'invalid draft')});}
      }
      const draft = {name:'공유 업무 초안', description:'업무 기록 입력', instructions:'references/terms.md와 references/inputs.md를 읽고 references/procedure.md에 따라 입력합니다. references/checks.md로 검증합니다.', terms:'팀기록: 시험용 업무 기록. 시간 단위 입력란은 분을 60으로 나눈다. 실제 사내 규칙은 작성 필요.', inputs:'{{업무 날짜}}, {{투입 시간(분)}}, {{업무 내용}}을 사용자에게 받는다.', procedure:'현재 페이지를 읽고 업무 날짜, 투입 시간, 업무 내용을 찾아 입력한다. 단위가 시간이면 분을 시간으로 환산한다. 라벨이 다르면 다시 관찰하고 필요한 내용을 질문한다.', checks:'세 필드의 값과 단위를 확인한다. 등록은 누르지 않고 검토 요청까지 안내한다. 업무 유형은 공유용 업무 기록이다.'};
      return route.fulfill({json:reply(null, {}, creations === 1 ? '{"name":"잘린 초안"}' : JSON.stringify(draft))});
    }
    const planning = planCompletion(body);
    if (planning) return route.fulfill({json: planning});
    const review = goalReviewPayload(body.messages);
    if (review) {
      reviews++; const proof = review.evidence.findLast(e => e.tool === 'verify_page' && e.usable && e.result.verified); assert(proof);
      assert(!review.evidence.some(e => ['find_skills', 'read_skill'].includes(e.tool)));
      return route.fulfill({json: reply(null, {}, JSON.stringify({status: 'complete', checks: [{requirement: '업무 초안', status: 'met', evidence_ids: [proof.id]}], next_step: ''}))});
    }
    const last = body.messages.findLast(m => m.role === 'tool'), result = last && JSON.parse(last.content);
    let name, args = {};
    if (reuse) {
      switch (++reuseRound) {
        case 1: {
          // The slash command selected this skill. Its library holds that skill only, so there is no search.
          assert(!body.tools.some(tool => tool.function.name === 'find_skills'));
          const listed = JSON.parse(body.messages.map(message => String(message.content)).join('\n').match(/Registered workflow catalog: (\[.*?\])\nConnected page/s)[1]);
          assert.equal(listed[0].name,'공유 업무 초안'); skillId=listed[0].id; name='read_skill'; args={skill_id:skillId}; break;
        }
        case 2: name='read_skill'; args={skill_id:skillId,query:'단위',path:'references/terms.md'}; break;
        case 3: assert(result.results.some(r=>r.content.includes('60'))); name='read_skill'; args={skill_id:skillId,path:'references/procedure.md'}; break;
        case 4: name='read_skill'; args={skill_id:skillId,path:'references/checks.md'}; break;
        case 5: name='read_page'; break;
        case 6: observation=result.observation || result; name='fill_form'; args={fields:[{field_id:ref('업무 날짜'),value:'2026-09-25'},{field_id:ref('투입 시간'),value:'4'},{field_id:ref('업무 내용'),value:'검색 기능 점검'}]}; break;
        case 7: assert.equal(result.applied,3); observation=result.observation || observation; name='verify_page'; args={checks:[['업무 날짜','2026-09-25'],['투입 시간','4'],['업무 내용','검색 기능 점검']].map(([name,expected])=>({kind:'field_value',ref:ref(name),expected}))}; break;
        case 8: assert(result.verified); name='update_plan'; args={steps:fixturePlan.map(step=>({...step,status:'completed'}))}; break;
        default: assert.equal(reuseRound,9); assert(result.ok && result.plan.every(step=>step.status==='completed')); return route.fulfill({json:reply(null,{},'새 값으로 초안을 확인했습니다. 등록하지 않았습니다.')});
      }
      return route.fulfill({json:reply(name,args)});
    }
    if (++round === 1) {name = 'find_skills'; args = {query: 'MH'}; assert(!JSON.stringify(body.messages).includes('480분: 시간 단위'));}
    else if (round === 2) {skillId = result.skills[0].id; assert.equal(result.skills[0].name, '업무 기록 초안'); name = 'read_skill'; args = {skill_id: skillId};}
    else if (round === 3) {assert.equal(result.path, 'SKILL.md'); name = 'read_skill'; args = {skill_id: skillId, query: '480분', path: 'references/terms.md'};}
    else if (round === 4) {assert.equal(result.dataKind, 'skill_search'); assert(result.results.some(r => r.content.includes('8시간'))); name = 'read_skill'; args = {skill_id: skillId, path: 'references/procedure.md'};}
    else if (round === 5) {assert.equal(result.path, 'references/procedure.md'); name = 'read_skill'; args = {skill_id: skillId, path: 'references/writing.md'};}
    else if (round === 6) {name = 'read_page';}
    else if (round === 7) {observation = result.observation || result; name = 'fill_form'; args = {fields: [{field_id: ref('업무 날짜'), value: '2026-09-24'}, {field_id: ref('투입 시간'), value: '8'}, {field_id: ref('업무 내용'), value: '로그인 오류 분석을 진행했습니다.'}]};}
    else if (round === 8) {assert.equal(result.applied, 3); observation = result.observation || observation; name = 'verify_page'; args = {checks: [['업무 날짜', '2026-09-24'], ['투입 시간', '8'], ['업무 내용', '로그인 오류 분석을 진행했습니다.']].map(([name, expected]) => ({kind: 'field_value', ref: ref(name), expected}))};}
    else if(round===9) {assert(result.verified); name='update_plan'; args={steps:fixturePlan.map(step=>({...step,status:'completed'}))};}
    else {assert.equal(round, 10); assert(result.ok && result.plan.every(step=>step.status==='completed')); return route.fulfill({json: reply(null, {}, '480분을 8시간으로 환산해 초안을 작성하고 확인했습니다. 등록 전 상태입니다.')});}
    return route.fulfill({json: reply(name, args)});
  } catch (error) {failure = error; await route.fulfill({status: 500, body: 'Fixture assertion failed'}).catch(() => {});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', token: 'synthetic-workflow', receivedAt: 1}}));
  source = await context.newPage(); await source.goto(url);
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('dialog', {name: '스킬', exact: true}).locator('input[type="file"]:not([webkitdirectory])').setInputFiles(resolve('tests/fixtures/skills/work-log-draft.skill.json'));
  await ui.getByRole('textbox', {name: '이름', exact: true}).waitFor();
  await ui.getByRole('button', {name: '저장', exact: true}).click();
  await until(async () => (await state()).skills.some(s => s.name === '업무 기록 초안'));
  // Automatic discovery, without explicitly selecting the skill or linking a page.
  await ui.evaluate(() => chrome.runtime.sendMessage({type: 'SELECT_SKILL', id: ''}));
  await ui.reload(); await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
  assert.equal((await state()).activeSkillId, '');
  const tab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async ({tab, url}) => {const source = (await chrome.tabs.query({})).find(t => t.url === url); await chrome.storage.session.set({chatSourceTabs: {[tab]: source.id}});}, {tab, url});
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('2026-09-24 로그인 오류 분석 MH 480분 초안을 작성해줘. 등록하지 마.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => ['done', 'error'].includes((await state()).chat.messages.at(-1)?.state) && !(await state()).busy);
  assert.equal((await state()).chat.messages.at(-1).state, 'done'); assert.equal(reviews, 2);
  assert((await state()).chat.task.plan.every(step=>step.status==='completed'));
  const work = context.pages().find(p => p !== source && p.url() === url); assert(work);
  assert.equal(await work.getByRole('spinbutton', {name: '투입 시간'}).inputValue(), '8');
  assert.equal(await work.evaluate(() => writes), 3); assert.equal(await work.evaluate(() => submits), 0);
  assert.equal(await source.evaluate(() => writes), 0);
  await ui.reload(); assert((await state()).skills.some(s => s.id === skillId)); assert.equal(await work.evaluate(() => writes), 3);
  // The creator reuses the background transport but cannot execute browser tools.
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('보존할 다음 요청');
  await until(async () => (await state()).chat.draft === '보존할 다음 요청');
  const taskId=(await state()).chat.task.requestId;
  async function createDraft() {
    await clickComposerAction(ui, '스킬 선택');
    await ui.getByRole('button',{name:'작업으로 만들기',exact:true}).click();
    await until(async () => !(await state()).busy && (await state()).chat.messages.at(-1)?.creatingSkill);
  }
  await createDraft();
  assert.equal((await state()).chat.messages.at(-1).error,'skill_draft_invalid');
  assert.equal((await state()).skills.filter(s=>s.id.startsWith('custom-')).length,1);
  await createDraft();
  assert.equal((await state()).chat.messages.at(-1).question.kind,'choice');
  assert.equal(await work.evaluate(()=>writes),3);
  await ui.reload();
  await ui.getByRole('textbox',{name:'직접 답변',exact:true}).waitFor();
  await ui.getByRole('button',{name:'검토 요청까지 안내',exact:false}).click();
  await until(async () => !(await state()).busy && (await state()).chat.messages.at(-1)?.question?.kind==='text');
  await ui.getByRole('textbox',{name:'직접 답변',exact:true}).fill('공유용 업무 기록');
  await ui.getByRole('button',{name:'답변 보내기',exact:true}).click();
  await until(async () => !(await state()).busy && (await state()).chat.messages.at(-1)?.error==='skill_draft_invalid');
  await createDraft();
  await until(async () => !(await state()).busy && !!(await state()).chat.messages.at(-1)?.skillDraft);
  assert.equal((await state()).chat.messages.at(-1).skillDraft.status,'draft');
  assert.match((await state()).chat.messages.at(-1).skillDraft.skill.resources.find(r=>r.path.endsWith('checks.md')).content,/검토 요청/);
  assert.equal((await state()).chat.task.requestId,taskId);
  assert.equal((await state()).chat.draft,'보존할 다음 요청');
  assert.equal(await work.evaluate(()=>writes),3);
  assert.equal((await state()).skills.filter(s=>s.id.startsWith('custom-')).length,1);
  await ui.reload();
  await ui.getByRole('button',{name:'스킬 초안 검토',exact:true}).click();
  await ui.getByText('참고 자료 4개',{exact:true}).click();
  await ui.getByRole('textbox',{name:'용어',exact:true}).fill('팀기록: 시험용 업무 기록. 시간 단위 입력란은 분을 60으로 나눈다. 실제 업무 규칙은 담당자가 검토한다.');
  await ui.getByRole('textbox',{name:'완료 기준',exact:true}).fill('세 필드의 값과 단위를 확인한다. 등록은 누르지 않는다.');
  await ui.screenshot({path:'verification/workflow-skill-editor.png'});
  await ui.setViewportSize({width:390,height:844});
  assert(await ui.getByRole('textbox',{name:'완료 기준',exact:true}).isVisible());
  assert(await ui.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await ui.screenshot({path:'verification/workflow-skill-editor-narrow.png'});
  await ui.setViewportSize({width:1280,height:720});
  const quickDownload = ui.waitForEvent('download');
  await ui.getByRole('button',{name:'저장하고 ZIP 다운로드',exact:true}).click();
  const quickFile = await quickDownload;
  await expectDownloadToastAtTop();
  const quickSkill = await importSkillArchive(new Uint8Array(await readFile(await quickFile.path())));
  assert.equal(quickSkill.name,'공유 업무 초안');

  await until(async () => (await state()).skills.some(s=>s.name==='공유 업무 초안'));
  const created=(await state()).skills.find(s=>s.name==='공유 업무 초안');
  await ui.reload();
  await ui.getByRole('button',{name:'공유 업무 초안 ZIP 다운로드',exact:true}).waitFor();
  assert.equal((await state()).chat.messages.at(-1).skillDraft.saved,true);
  const cardDownload=ui.waitForEvent('download');
  await ui.getByRole('button',{name:'공유 업무 초안 ZIP 다운로드',exact:true}).click();
  const cardFile=await cardDownload;
  await expectDownloadToastAtTop();
  assert.equal((await importSkillArchive(new Uint8Array(await readFile(await cardFile.path())))).name,created.name);
  await ui.setViewportSize({width:390,height:844});
  await ui.getByRole('button',{name:'공유 업무 초안 ZIP 다운로드',exact:true}).scrollIntoViewIfNeeded();
  await expectDownloadToastAtTop();
  await ui.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ui.screenshot({path:'verification/workflow-skill-card.png'});
  await ui.setViewportSize({width:1280,height:720});
  await clickComposerAction(ui, '스킬 선택');
  const downloadPromise=ui.waitForEvent('download');
  await ui.getByRole('button',{name:'공유 업무 초안 내보내기',exact:true}).click();
  const exported=await downloadPromise, exportPath=resolve(profile,'shared.skill.zip'); await exported.saveAs(exportPath);
  const shared=await importSkillArchive(new Uint8Array(await readFile(exportPath)));
  assert(!JSON.stringify(shared).includes('로그인 오류 분석')); assert(!JSON.stringify(shared).includes('2026-09-24')); assert(!JSON.stringify(shared).includes('sourceId'));
  await ui.evaluate(id=>chrome.runtime.sendMessage({type:'DELETE_SKILL',id}),created.id);
  await ui.getByRole('dialog',{name:'스킬',exact:true}).locator('input[type="file"]:not([webkitdirectory])').setInputFiles(exportPath);
  await ui.getByRole('button',{name:'저장',exact:true}).click();
  await until(async () => (await state()).skills.some(s=>s.name==='공유 업무 초안' && s.id!==created.id));
  await ui.evaluate(()=>chrome.runtime.sendMessage({type:'SELECT_SKILL',id:''}));
  reuse=true;
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('/공유');
  await ui.getByRole('group',{name:'슬래시 명령',exact:true}).getByRole('button',{name:'공유 업무 초안 /공유-업무-초안',exact:true}).click();
  assert.equal(await ui.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'/공유-업무-초안 ');
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('/공유-업무-초안 팀기록 2026-09-25 검색 기능 점검 240분 초안만 작성해줘.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await until(async () => !(await state()).busy && reuseRound===9);
  assert.equal((await state()).chat.messages.at(-1).state,'done');
  assert.equal((await state()).activeSkillId,'');
  assert.equal((await state()).chat.messages.findLast(m=>m.role==='user').skillCommandId,skillId);
  assert.equal(await work.getByRole('spinbutton',{name:'투입 시간'}).inputValue(),'4');
  assert.equal(await work.evaluate(()=>submits),0); assert.equal(await source.evaluate(()=>writes),0);
  const storedCount=(await state()).skills.length;
  holdCreator=true;
  await clickComposerAction(ui, '스킬 선택');
  await ui.getByRole('button',{name:'작업으로 만들기',exact:true}).click();
  await until(()=>!!releaseCreator);
  await ui.getByRole('button',{name:'중지',exact:true}).click();
  await until(async()=>!(await state()).busy);
  assert.equal((await state()).chat.messages.at(-1).error,'cancelled');
  releaseCreator();
  await ui.reload(); await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  assert.equal((await state()).skills.length,storedCount); assert(!(await state()).chat.messages.at(-1).skillDraft);
  assert.deepEqual(errors, []);
  checks.push('save-and-download persists a reviewed ZIP card in the conversation; reload keeps the downloadable artifact', 'ZIP import plus slash selection binds only this request; cancellation and late generation never install a skill; narrow editor remains usable');
  checks.push('creator consults available rules before asking, pauses for choice and free-text answers, resumes after reload without browser writes', 'completed browser work produces an editable draft without page writes or auto-save; malformed output is recoverable', 'draft survives reload, references can be edited, next-message draft and source task stay intact', 'UI export/import preserves reviewed procedure and applies new inputs without replaying old values');
  checks.push('shared skill imports through the UI and survives reload', 'default chat discovers a reference-only business term and reads bounded source rules', 'registered procedure drives synthetic Qwen decisions through real form input and verification', 'skill guidance is excluded from execution proof; no submit or source-tab edit; reload does not replay writes');
  await writeFile('verification/workflow-knowledge-browser.json', JSON.stringify({checks, round, reuseRound, creations, reviews, errors, actualBrowser: true, syntheticModel: true, liveAccount: false}, null, 2));
  checks.forEach(check => console.log('PASS ' + check));
} finally {await context?.close(); server.close(); await rm(profile, {recursive: true, force: true});}

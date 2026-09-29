// Live-model evaluation on synthetic local pages. Never uses a personal browser profile.
import {liveEvaluationScore, evaluationRepeats} from './live-evaluation-score.mjs';
import {trackModelEvidence} from './evaluation-model-evidence.mjs';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_SETTINGS} from '../core.js';
import {inspectEvaluationTarget, inspectEvaluationPage, sameEvaluationState} from './evaluation-target.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const token = process.env.NUBI_EVAL_TOKEN, model = process.env.NUBI_EVAL_MODEL || DEFAULT_SETTINGS.modelId;
const repeats = evaluationRepeats(process.env.NUBI_EVAL_REPEATS);
const output = resolve('verification', `agent-live-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
const report = {version: 3, repeats, startedAt: new Date().toISOString(), model, baselineModel: DEFAULT_SETTINGS.modelId, baseline: model === DEFAULT_SETTINGS.modelId, syntheticSite: true, actualModel: false, status: 'not_configured', cases: []};
await mkdir('verification', {recursive: true});
if (!token) {
  report.reason = 'NUBI_EVAL_TOKEN is not configured. No inference or browser actions were executed.';
  await writeFile(output, JSON.stringify(report, null, 2)); console.log('NOT RUN: configure NUBI_EVAL_TOKEN locally. Do not paste credentials into chat.'); process.exitCode = 2;
} else {
  const tasks = [
    {id: 'read-requirements', goal: '교육 안내에서 신청 마감일, 담당 팀, 장소를 알려줘. 입력하거나 등록하지 마.', path: 'policy',
      check: (answer, page) => answer.includes('2026') && /10.{0,4}8/.test(answer) && answer.includes('개발팀') && answer.includes('서울 A') && page.writes === 0},
    {id: 'long-paragraph', goal: '안내 문단 맨 끝의 접수 종료 시각을 알려줘.', path: 'long', check: answer => /17:30|17시\s*30|오후\s*5시\s*30/.test(answer)},
    {id: 'delayed-result', goal: '조회 결과가 표시될 때까지 확인해서 처리된 건수를 알려줘.', path: 'delayed', check: answer => /37\s*건/.test(answer)},
    {id: 'draft-complete', goal: '제목에는 가을 교육, 본문에는 개발팀 교육은 서울 A 강의실에서 진행합니다. 를 입력해줘. 등록하지 마.', path: 'draft',
      check: (_, page) => page.title === '가을 교육' && page.body.includes('개발팀 교육은 서울 A 강의실에서 진행합니다.') && page.submits === 0 && page.titleWrites === 1},
    {id: 'clarify-before-write', goal: '담당 팀을 바꿔줘.', path: 'draft', question: true, check: (_, page, message) => !!message.question && page.writes === 0},
    {id: 'drag-destination', goal: '자료 카드를 보관함으로 옮겨줘. 삭제하지 마.', path: 'board',
      check: (_, page) => page.cardParent === 'archive' && page.dragStarts >= 1 && page.deleted === 0},
    {id: 'hover-layout-shift', goal: '도움말을 확인한 다음 대상 선택을 눌러줘. 프레임 항목은 누르지 마.', path: 'hover',
      check: (_, page) => page.selected === 1 && page.wrongClicks === 0},
    {id: 'already-correct-toggle', goal: '알림을 켜진 상태로 맞춰줘.', path: 'toggle',
      check: (_, page) => page.toggle === 'true' && page.toggleClicks === 0},
  ];
  const profile = await mkdtemp(resolve(tmpdir(), 'nubi-live-eval-')), extension = resolve(profile, 'extension');
  let context, activeEvidence;
  try {
    await cp(resolve('dist'), extension, {recursive: true});
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions.push('https://*/*', 'http://*/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === 'https://aipro.sdsdev.co.kr' ? route.continue() : route.abort());
    await context.route('https://nubi-evaluation.example.test/**', route => {
      const path = new URL(route.request().url()).pathname;
      const specials = {
        '/board': '<style>section{display:inline-block;vertical-align:top;width:180px;min-height:220px;padding:20px;border:1px solid #ddd}[draggable]{padding:20px;background:#def}</style><section><div id="card" draggable="true" aria-label="자료 카드" ondragstart="dragStarts++;event.dataTransfer.setData(\'text/plain\',\'card\')">자료 카드</div></section><section id="waiting" aria-label="대기함" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.append(document.querySelector(\'#card\'))">대기함</section><section id="archive" aria-label="보관함" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.append(document.querySelector(\'#card\'))">보관함</section><section aria-label="삭제" ondragover="event.preventDefault()" ondrop="deleted++">삭제</section><script>window.dragStarts=0;window.deleted=0;</script>',
        '/hover': '<style>#help:hover+p{display:block}#help+p{display:none;height:100px}</style><button id="help">도움말</button><p>대상 선택을 누르면 확인됩니다.</p><div><button onclick="selected++;this.textContent=\'대상 선택됨\'">대상 선택</button></div><iframe srcdoc="<button onclick=\'parent.wrongClicks++\'>프레임 항목</button>"></iframe><script>window.selected=0;window.wrongClicks=0;</script>',
        '/toggle': '<button id="toggle" role="switch" aria-checked="true" onclick="toggleClicks++;this.setAttribute(\'aria-checked\',this.getAttribute(\'aria-checked\')===\'true\'?\'false\':\'true\')">알림</button><script>window.toggleClicks=0;</script>',
      };
      const content = specials[path] || (path === '/long' ? '<p>' + '교육 안내 문장을 확인합니다. '.repeat(80) + '접수 종료 시각은 17:30입니다.</p>' : path === '/delayed' ? '<p id="result">조회 중</p><script>setTimeout(()=>document.querySelector("#result").textContent="처리 완료 37건",2800)</script>' : path === '/draft' ? '<label>제목<input id="title"></label><label>담당 팀<input id="team"></label><label>본문<textarea id="body"></textarea></label><button onclick="submits++">등록</button><output></output>' : '<p>신청 마감일 <strong>2026년 10월 8일</strong></p><p>담당 팀 개발팀</p><p>장소 서울 A 강의실</p>');
      return route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>누비 평가용 교육 안내</title>' + content + '<script>window.writes=0;window.titleWrites=0;window.submits=0;addEventListener("input",e=>{writes++;if(e.target.id==="title")titleWrites++;document.querySelector("output").textContent="초안 반영됨";});</script>'});
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(({token, model}) => Promise.all([chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: Date.now()}}), chrome.storage.local.set({settings: {modelId: model}})]), {token, model});
    const origin = 'https://nubi-evaluation.example.test';
    const sourceTabId = await worker.evaluate(async origin => (await chrome.tabs.create({url: origin + '/policy', active: false})).id, origin);
    const ui = await context.newPage();
    await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
    const rpc = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
    const state = async () => (await rpc({type: 'GET_STATE'})).data;
    await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor({timeout: 30000});
    for (let i = 0; i < 200 && !(await state()).catalog?.models?.length; i++) await ui.waitForTimeout(100);
    const ready = await state();
    if (ready.settings?.modelId !== model || !ready.catalog?.models?.some(item => item.name === model)) throw new Error('evaluation_model');
    report.status = 'running';
    report.plannedTasks=tasks.map(task=>task.id);
    for (const task of tasks.flatMap(task=>Array.from({length:repeats},(_,index)=>({...task,trial:index+1})))) {
      const started = Date.now();
      activeEvidence=trackModelEvidence(context,model);
      await ui.getByRole('button', {name: '누비 새 채팅', exact: true}).click();
      await ui.locator('article.message').first().waitFor({state: 'hidden'});
      await worker.evaluate(async ({sourceTabId, url}) => {
        await chrome.tabs.update(sourceTabId, {url});
        const until = Date.now() + 15000;
        while (Date.now() < until) {
          const tab = await chrome.tabs.get(sourceTabId);
          if (tab.status === 'complete' && tab.url === url) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('evaluation_source_loading');
      }, {sourceTabId, url: origin + '/' + task.path});
      const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
      await worker.evaluate(({uiId, sourceTabId}) => chrome.storage.session.set({chatSourceTabs: {[uiId]: sourceTabId}}), {uiId, sourceTabId});
      const before = await inspectEvaluationPage(worker, {tabId: sourceTabId}, origin);
      await ui.getByRole('textbox', {name: '메시지', exact: true}).fill(task.goal); await ui.getByRole('button', {name: '전송', exact: true}).click();
      let current;
      while (Date.now() - started < 180000 && activeEvidence.requests <= 40) {
        current = await state();
        if (current.chat.messages.at(-1)?.role === 'assistant' && ['done', 'error'].includes(current.chat.messages.at(-1).state) || current.chat.task?.status === 'awaiting_user') break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const message = current?.chat.messages.at(-1) || {};
      const {target, observed} = await inspectEvaluationTarget(worker, {conversationId: current.chat.sessionId, sourceTabId, mode: current.browserWorkMode, origin});
      const sourceAfter = await inspectEvaluationPage(worker, {tabId: sourceTabId}, origin);
      const sourcePreserved = current.browserWorkMode !== 'window' || sameEvaluationState(before, sourceAfter);
      const passed = sourcePreserved && message.modelId === model && (task.question ? current.chat.task?.status === 'awaiting_user' : message.state === 'done' && target.observed) && task.check(message.content || '', observed, message);
      const modelEvidence=await activeEvidence.finish();activeEvidence=null;
      report.actualModel ||= modelEvidence.modelResponses>0;
      report.cases.push({id: task.id, trial:task.trial, passed: !!passed, durationMs: Date.now() - started, ...modelEvidence, state: message.state, error: message.error,
        review: current?.chat.task?.goalReview?.status, toolFailures: (message.trace || []).filter(step=>step.status==='error').length,
        target, sourcePreserved, observed, answer: (message.content || '').slice(0, 2000), question: message.question?.text});
      await writeFile(output, JSON.stringify(report, null, 2));
      console.log(`${passed ? 'PASS' : 'FAIL'} ${task.id}`);
      if (!['done', 'error'].includes(message.state) && current.chat.task?.status !== 'awaiting_user') throw new Error('evaluation_budget');
    }
    report.passed = report.cases.filter(item => item.passed).length; report.total = tasks.length * repeats; report.scorecard = liveEvaluationScore(report);
    report.status = report.passed === report.total ? 'passed' : 'failed'; process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) {
    report.status = 'failed'; report.reason = error.message === 'evaluation_budget' ? 'Evaluation time/request budget reached; isolated browser closed.' : 'Evaluation setup or execution failed; no live accuracy claim is available.'; process.exitCode = 1;
  } finally {if(activeEvidence){report.interruptedTrialEvidence=await activeEvidence.finish();report.actualModel ||= report.interruptedTrialEvidence.modelResponses>0;}await context?.close(); await rm(profile, {recursive: true, force: true}); report.finishedAt = new Date().toISOString(); report.scorecard = liveEvaluationScore(report); await writeFile(output, JSON.stringify(report, null, 2));}
  console.log(output);
}

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-agent-diagnostics-')), checks = [], errors = [];
let context, ui, worker;
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`]});
  await context.route('https://aipro.sdsdev.co.kr/**', route => route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K'}]}}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', token: 'synthetic', receivedAt: 1}}));
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox', {name: '메시지', exact: true}).waitFor();
}
const rpc = owner => ui.evaluate(owner => chrome.runtime.sendMessage({type: 'GET_AGENT_DIAGNOSTICS', ...owner}), owner);
try {
  await launch();
  const owner = await ui.evaluate(async () => {
    const {agentDiagnosticJournal: journal} = await import(chrome.runtime.getURL('agent-diagnostic-journal.js'));
    const {chat} = await chrome.storage.local.get('chat');
    const owner = {provider: chat.provider, conversationId: chat.sessionId, requestId: 'diagnostic-preview'};
    await chrome.storage.local.set({debugMode:true,chat: {...chat, task: null, messages: [{id: owner.requestId, role: 'assistant', state: 'done', content: '검토 결과'}]}});
    await chrome.storage.session.set({diagnosticRestartProbe: true});
    const event = {kind: 'agent', phase: 'review_result', scope: 'final', status: 'revise',
      checks: [{status: 'met', requirement: 'private requirement'}, {status: 'unknown'}],
      nextStep: 'private answer', token: 'private credential', url: 'https://private.example'};
    // Independent connections contend on real IDB transactions, not a mock.
    await Promise.all(Array.from({length: 410}, () => journal.append(owner, event)));
    if (await journal.append(owner, {kind: 'agent', phase: 'private arbitrary text'})) throw Error('invalid event persisted');
    return owner;
  });
  let page = (await rpc(owner)).data;
  assert.equal(page.retained, 400); assert.equal(page.dropped, 10); assert.equal(page.missing, 0);
  assert.equal(page.events.length, 50); assert.equal(page.events[0].sequence, 410);
  const sequences = [];
  for (;;) {
    sequences.push(...page.events.map(event => event.sequence));
    assert(!JSON.stringify(page).includes('private'));
    assert(page.events.every(event => event.met === 1 && event.unknown === 1));
    if (!page.next) break;
    page = (await rpc({...owner, before: page.next})).data;
  }
  assert.deepEqual(sequences, Array.from({length: 400}, (_, i) => 410 - i));
  checks.push('410 concurrent writes receive unique atomic sequences; the latest 400 paginate without duplicates and exclude raw content');
  await context.close(); context = null;
  await launch();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get('diagnosticRestartProbe')).diagnosticRestartProbe), undefined);
  const restarted = await rpc(owner);
  assert.equal(restarted.ok, true); assert.equal(restarted.data.retained, 400); assert.equal(restarted.data.events[0].sequence, 410);
  checks.push('closing and relaunching Chrome clears session storage while owner-bound diagnostics remain in real IndexedDB');
  for (const patch of [{provider: 'chatgpt'}, {conversationId: 'foreign-chat'}, {requestId: 'foreign-request'}]) {
    assert.equal((await rpc({...owner, ...patch})).error, 'conversation_changed');
  }
  assert.equal((await rpc({...owner, before: -1})).ok, false);
  await ui.evaluate(owner => chrome.runtime.sendMessage({type: 'MODEL_DIAGNOSTIC', requestId: owner.requestId,
    kind: 'agent', phase: 'run_result', outcome: 'answer', verification: 'passed'}), owner);
  assert.equal((await rpc(owner)).data.events[0].sequence, 410);
  assert.equal(await ui.locator('.agent-trace > ol').evaluate(element => getComputedStyle(element).animationName),'none','A closed execution record must not leave a pending entrance animation');
  await ui.locator('.agent-trace > summary').click();
  assert.equal(await ui.locator('.agent-trace > ol').evaluate(element => getComputedStyle(element).animationName),'deck-dialog-enter','Opening retains the reference entrance motion');
  const panel = ui.locator('.agent-diagnostics');
  await panel.locator('summary').focus(); await ui.keyboard.press('Enter');
  await panel.locator('[data-diagnostic-sequence="410"]').waitFor();
  assert.equal(await panel.locator('[data-diagnostic-sequence]').count(),50);
  assert((await panel.innerText()).includes('보관 한도로 이전 10개가 제외됐습니다.'));
  assert((await panel.innerText()).includes('충족 1 / 미충족 0 / 미확인 1'));
  await panel.getByRole('button',{name:'이전 진단',exact:true}).click();
  await panel.locator('[data-diagnostic-sequence="360"]').waitFor();
  await panel.getByRole('button',{name:'더 최근 진단',exact:true}).click();
  await panel.locator('[data-diagnostic-sequence="410"]').waitFor();
  await ui.evaluate(async owner => {
    const {agentDiagnosticJournal: journal} = await import(chrome.runtime.getURL('agent-diagnostic-journal.js'));
    for (const event of [
      {outcome:'answer', verification:'passed'}, {outcome:'answer', verification:'not_run'},
      {outcome:'waiting_user'}, {outcome:'cancelled'}, {outcome:'failed',code:'goal_review_failed'},
    ]) await journal.append(owner,{kind:'agent',phase:'run_result',...event});
  },owner);
  await panel.getByRole('button',{name:'실행 진단 새로고침',exact:true}).click();
  await panel.locator('[data-diagnostic-sequence="415"]').waitFor();
  for (const [sequence,copy] of [[411,'최종 검토 통과'],[412,'최종 검토 미확인'],[413,'사용자 답변 대기'],[414,'실행 중지'],[415,'실행 실패']]) {
    assert((await panel.locator(`[data-diagnostic-sequence="${sequence}"]`).innerText()).includes(copy));
  }
  assert((await panel.locator('[data-diagnostic-sequence="415"]').innerText()).includes('결과 검토 응답을 확인하지 못했습니다.'));
  assert(!/private|synthetic/.test(await panel.innerText()));
  checks.push('actual App RPC displays review counts, distinct termination outcomes, redacted causes and 50-event pagination');
  // Fail only the read transport. A refresh must not restart the agent.
  await ui.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    globalThis.diagnosticReads = 0;
    chrome.runtime.sendMessage = (message,...args) => {
      if (message.type === 'GET_AGENT_DIAGNOSTICS') {
        globalThis.diagnosticReads++;
        if (globalThis.failDiagnosticRead) return Promise.resolve({ok:false,error:'conversation_changed'});
      }
      return send(message,...args);
    };
    globalThis.failDiagnosticRead = true;
  });
  await panel.getByRole('button',{name:'실행 진단 새로고침',exact:true}).click();
  await panel.getByRole('alert').waitFor();
  assert((await panel.innerText()).includes('이전에 조회한 기록입니다.'));
  await ui.evaluate(() => {globalThis.failDiagnosticRead = false;});
  await panel.getByRole('button',{name:'실행 진단 새로고침',exact:true}).click();
  await panel.getByRole('alert').waitFor({state:'hidden'});
  assert.equal(await ui.evaluate(() => globalThis.diagnosticReads),2);
  assert.equal((await rpc(owner)).data.events[0].sequence,415);
  await mkdir('verification', {recursive:true});
  for (const width of [320,360,1100]) {
    await ui.setViewportSize({width,height:850});
    await panel.scrollIntoViewIfNeeded();
    assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const style = await panel.evaluate(element => {const s=getComputedStyle(element);return [s.fontFamily,s.fontSize,s.lineHeight];});
    assert(style[0].includes('Noto Sans KR')); assert.equal(style[1],'14px'); assert.equal(style[2],'22px');
    const refresh=panel.getByRole('button',{name:'실행 진단 새로고침',exact:true});
    await ui.keyboard.press('Tab'); await refresh.focus(); await ui.getByRole('tooltip').waitFor();
    await ui.keyboard.press('Escape');
    assert.equal(await panel.evaluate(element=>element.open),true);
    await panel.locator('summary').scrollIntoViewIfNeeded();
    await ui.screenshot({path:`verification/agent-diagnostics-${width}.png`});
  }
  await panel.locator('summary').focus(); await ui.keyboard.press('Enter');
  assert.equal(await panel.evaluate(element=>element.open),false);
  await ui.keyboard.press('Enter'); assert.equal(await panel.evaluate(element=>element.open),true);
  await ui.reload(); await ui.locator('.agent-trace > summary').click(); await panel.locator('summary').click();
  await panel.locator('[data-diagnostic-sequence="415"]').waitFor();
  checks.push('failed reads retain an explicitly stale page; refresh only reads; reload, keyboard and 320/360/1100px retain brand typography');
  await ui.evaluate(async owner => {
    const {agentDiagnosticJournal: journal} = await import(chrome.runtime.getURL('agent-diagnostic-journal.js'));
    await journal.finish(owner,417);
  },owner);
  await panel.getByRole('button',{name:'실행 진단 새로고침',exact:true}).click();
  await panel.getByText('저장하지 못한 구간이 있습니다.',{exact:false}).waitFor();
  await ui.evaluate(async () => {
    const {chat}=await chrome.storage.local.get('chat');
    await chrome.storage.local.set({chat:{...chat,messages:[{id:'empty-diagnostic',role:'assistant',state:'done',content:'진단 없는 응답'}]}});
  });
  await ui.reload(); await ui.locator('.agent-trace > summary').click(); await panel.locator('summary').click();
  await panel.getByText('보관된 진단이 없습니다. 완료 여부를 판단할 수 없습니다.',{exact:true}).waitFor();
  assert.equal(await panel.locator('[data-diagnostic-sequence]').count(),0);
  await ui.evaluate(async owner => {
    const {chat}=await chrome.storage.local.get('chat');
    await chrome.storage.local.set({chat:{...chat,messages:[{id:owner.requestId,role:'assistant',state:'done',content:'검토 결과'}]}});
  },owner);
  checks.push('missing tails and absent owner records do not imply success or leak the previous page');
  const clear = await ui.evaluate(owner => chrome.runtime.sendMessage({type: 'CLEAR_CHAT', conversationId: owner.conversationId}), owner);
  assert.equal(clear.ok, true); assert.equal((await rpc(owner)).error, 'conversation_changed');
  const absent = await ui.evaluate(async owner => (await import(chrome.runtime.getURL('agent-diagnostic-journal.js'))).agentDiagnosticJournal.page(owner), owner);
  assert.equal(absent.available, false);
  checks.push('foreign reads and stale diagnostic writes are rejected; deleting the conversation removes physical records');
  assert.deepEqual(errors, []);
  await mkdir('verification', {recursive: true});
  await writeFile('verification/agent-diagnostic-journal-browser.json', JSON.stringify({checks, errors,
    actualBrowser: true, actualIndexedDB: true, fullBrowserRestart: true, seededDiagnostics: true, actualModel: false, liveAccount: false}, null, 2));
  checks.forEach(check => console.log('PASS ' + check));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

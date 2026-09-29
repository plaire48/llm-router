import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-trace-journal-')), checks = [], errors = [];
let context;
try {
  await mkdir('verification', {recursive:true});
  context = await chromium.launchPersistentContext(profile, {headless:true, executablePath:process.env.CHROME_BINARY,
    args:[`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`]});
  await context.route('https://aipro.sdsdev.co.kr/**', route => route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K'}]}}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.session.set({credential:{provider:'aipro',token:'synthetic',receivedAt:1}}));
  const ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox', {name:'메시지',exact:true}).waitFor();
  // Seed the actual IDB module from an extension page: MV3 workers forbid dynamic import.
  // This is not a fake model/host write. Lease ownership is
  // covered by login-lifecycle and runner unit tests; this checks storage/UI.
  const owner = await ui.evaluate(async () => {
    const {traceJournal} = await import(chrome.runtime.getURL('trace-journal.js'));
    const {normalizeTrace} = await import(chrome.runtime.getURL('agent-trace.js'));
    const {chat} = await chrome.storage.local.get('chat');
    const owner = {provider:chat.provider,conversationId:chat.sessionId,requestId:'journal-preview'};
    const steps = [];
    for (let sequence=1; sequence<=132; sequence++) {
      const id = `10000000-0000-4000-8000-${String(sequence).padStart(12,'0')}`;
      const step = {id,tool:'analysis_research',status:'done',analysis:{phase:'finished',role:'research',workerId:sequence-1,
        runId:'wiki-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',completed:sequence,total:132,delivered:true,deliveredTo:'synthesis',outcome:'complete',
        task:`담당 ${sequence}`,summary:'not retained in the journal',assignment:{question:'private question',documentIds:['private-source'],documents:[{id:'private-source',title:'private title'}],range:{documentId:'private-source',start:(sequence-1)*6000,end:sequence*6000}}}};
      // Historical start/read/model events are not the current running state.
      // The chat summary remains completed; the journal retains the earlier event.
      const journalStep = sequence === 127 ? {...step,analysis:{...step.analysis,role:'coordinator',workerId:undefined,runId:'documents-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',deliveredTo:'main'}}
        : sequence === 129 ? {id,tool:'read_page',status:'running'}
        : sequence >= 130 ? {...step,status:'running',analysis:{...step.analysis,
          role:sequence === 132 ? 'coordinator' : 'research',workerId:sequence === 132 ? undefined : step.analysis.workerId,
          phase:sequence === 130 ? 'thinking' : sequence === 131 ? 'reading' : 'researching',outcome:undefined,delivered:false}}
        : step;
      await traceJournal.append(owner, journalStep, sequence, 1800000000000 + sequence);
      steps.push(step);
    }
    await chrome.storage.local.set({debugMode:true,chat:{...chat,task:null,messages:[{id:owner.requestId,role:'assistant',state:'done',content:'문서 검토 완료',trace:normalizeTrace(steps),traceJournal:{available:true}}]}});
    return owner;
  });
  await ui.reload();
  async function openHistory() {
    await ui.locator('.agent-trace > summary').click();
    await ui.locator('.trace-journal:not(.agent-diagnostics) > summary').click();
    await ui.locator('[data-journal-sequence="132"]').waitFor();
  }
  await openHistory();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('chat')).chat.messages[0].trace.length),32);
  assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics) [data-journal-sequence]').count(),50);
  for (const [sequence, expected] of [[129,'실행 시작'],[130,'분석 호출'],[131,'근거 조회'],[132,'조사 진행']]) {
    assert((await ui.locator(`[data-journal-sequence="${sequence}"]`).innerText()).includes(expected),expected);
  }
  assert((await ui.locator('[data-journal-sequence="132"]').innerText()).includes('하위 작업 진행'));
  assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics) .status-spinner').count(),0,'Historical running events must not animate as a current execution');
  assert.equal(await ui.locator('[data-journal-sequence="127"]').getByText('메인 전달',{exact:true}).count(),1);
  assert.equal(await ui.locator('[data-journal-sequence="128"]').getByText('통합 전달',{exact:true}).count(),1);
  assert.equal(await ui.locator('[data-journal-sequence="132"] .subagent-handoff').count(),0,'Unfinished events must not imply a handoff');
  assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics)').getByText('최종 확인',{exact:true}).count(),0);
  checks.push('historical model calls, source reads and coordinator progress use phase labels without a live spinner or false final verification; actual main/synthesis handoffs remain visible');

  await ui.getByRole('button',{name:'이전 기록',exact:true}).click();
  await ui.locator('[data-journal-sequence="82"]').waitFor();
  assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics) [data-journal-sequence]').count(),50);
  await ui.getByRole('button',{name:'이전 기록',exact:true}).click();
  await ui.locator('[data-journal-sequence="32"]').waitFor();
  assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics) [data-journal-sequence]').count(),32);
  assert.equal(await ui.locator('[data-journal-sequence="1"]').count(),1);
  assert(await ui.getByRole('button',{name:'이전 기록',exact:true}).isDisabled());
  await ui.getByRole('button',{name:'더 최근 기록',exact:true}).click();
  await ui.locator('[data-journal-sequence="82"]').waitFor();
  checks.push('132 real IndexedDB events remain available in 50/50/32 pages while chat retains only 32 steps');

  await ui.reload(); await openHistory();
  for (const width of [320,360,1100]) {
    await ui.setViewportSize({width,height:850});
    assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const typography = await ui.locator('.trace-journal:not(.agent-diagnostics)').evaluate(element => {const style=getComputedStyle(element);return [style.fontFamily,style.fontSize,style.lineHeight];});
    assert(typography[0].includes('Noto Sans KR')); assert.equal(typography[1],'14px'); assert.equal(typography[2],'22px');
    const refresh=ui.getByRole('button',{name:'진행 기록 새로고침',exact:true});
    assert.equal(await refresh.getAttribute('data-icon-only'),'true');
    await ui.keyboard.press('Tab');await refresh.focus();
    const tooltip=ui.getByRole('tooltip');await tooltip.waitFor();
    assert.equal(await tooltip.textContent(),'진행 기록 새로고침');
    await ui.keyboard.press('Escape');
    assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics)').evaluate(element=>element.open),true,'Dismissing a tooltip must keep the reading position open');
    await ui.locator('.trace-journal:not(.agent-diagnostics)').scrollIntoViewIfNeeded();
    await ui.screenshot({path:`verification/trace-journal-${width}.png`});
  }
  const summary=ui.locator('.trace-journal:not(.agent-diagnostics) > summary');await summary.focus();await ui.keyboard.press('Enter');
  assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics)').evaluate(element=>element.open),false);
  await ui.keyboard.press('Enter');assert.equal(await ui.locator('.trace-journal:not(.agent-diagnostics)').evaluate(element=>element.open),true);
  checks.push('reload restores durable history; 320/360/1100px share typography, fit width and support keyboard disclosure');

  await ui.evaluate(async owner => (await import(chrome.runtime.getURL('trace-journal.js'))).traceJournal.finish(owner,134),owner);
  await ui.getByRole('button',{name:'진행 기록 새로고침',exact:true}).click();
  await ui.getByText('저장하지 못한 구간이 있습니다.',{exact:false}).waitFor();
  const tail=await ui.evaluate(request=>chrome.runtime.sendMessage({type:'GET_TRACE_JOURNAL',...request}),owner);
  assert.equal(tail.data.missing,2);assert.equal(tail.data.retained,132);
  checks.push('final sequence acknowledges a rejected tail without inventing events or replaying a cancelled task');

  for (const patch of [{conversationId:'another-conversation'},{provider:'chatgpt'},{requestId:'another-request'}]) {
    const result=await ui.evaluate(request=>chrome.runtime.sendMessage({type:'GET_TRACE_JOURNAL',...request}),{...owner,...patch});
    assert.equal(result.ok,false);assert.equal(result.error,'conversation_changed');
  }
  const retained=await ui.evaluate(request=>chrome.runtime.sendMessage({type:'GET_TRACE_JOURNAL',...request}),owner);
  const text=JSON.stringify(retained.data);
  for(const excluded of ['private-source','private question','private title','not retained in the journal','synthetic'])assert(!text.includes(excluded));
  assert.equal(retained.data.events[0].analysis.runId,'wiki-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const cleared=await ui.evaluate(owner=>chrome.runtime.sendMessage({type:'CLEAR_CHAT',conversationId:owner.conversationId}),owner);
  assert.equal(cleared.ok,true);
  const afterDelete=await ui.evaluate(request=>chrome.runtime.sendMessage({type:'GET_TRACE_JOURNAL',...request}),owner);
  assert.equal(afterDelete.error,'conversation_changed');
  const absent=await ui.evaluate(async owner=>(await import(chrome.runtime.getURL('trace-journal.js'))).traceJournal.page(owner),owner);
  assert.equal(absent.available,false);assert.equal(absent.events.length,0);
  checks.push('provider/conversation/message ownership rejects foreign reads; deletion removes actual IDB events; metadata excludes source text and images');
  assert.deepEqual(errors,[]);
  await writeFile('verification/trace-journal-browser.json',JSON.stringify({checks,errors,actualBrowser:true,actualIndexedDB:true,seededPublicEvents:true,liveProvider:false,modelAccuracyMeasured:false},null,2));
  checks.forEach(check=>console.log('PASS '+check));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, mkdir, rm, writeFile, appendFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {pdfFile, wordFile} from './fixtures/documents.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-doc-search-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], seen = [], childStarts = new Set(), reports = new Set();
const long = '배경 안내와 일반 절차입니다.\n'.repeat(1300) + '\n인수 테스트 마감일은 9월 30일입니다. 품질팀이 검토합니다.\n';
const other = '일반 일정 정보입니다.\n'.repeat(1100) + '\n검토 담당자는 김검토입니다.\n';
let stallStage = 0;
let partitionStage = 0, partitionRanges = [], partitionReads = 0; const partitionReports = new Set();
let context, worker, ui, files, started = false, failure, reviews = 0, mode = 'research', resumeRead = false;
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const reply = (calls, content = '') => ({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}});
const rpc = (type, value = {}) => ui.evaluate(async ({type, value}) => {const r = await chrome.runtime.sendMessage({type, ...value}); if (!r.ok) throw Error(r.error); return r.data;}, {type, value});
const state = () => rpc('GET_STATE');
async function until(fn) {for (let i = 0; i < 250; i++) {if (failure) throw failure; if (await fn()) return; await new Promise(r => setTimeout(r, 60));} throw Error('Timed out');}
const check = text => {checks.push(text); console.log('PASS ' + text);};
try {
  await mkdir('verification/document-retrieval', {recursive: true}); await cp('dist', extension, {recursive: true});
  const backgroundPath=resolve(extension,'background.js');
  const original=await readFile(backgroundPath,'utf8');
  assert(original.includes('DOCUMENT_TOOL_NAMES, executeDocumentTool}'));
  await writeFile(backgroundPath,original.replace('DOCUMENT_TOOL_NAMES, executeDocumentTool}', 'DOCUMENT_TOOL_NAMES, executeDocumentTool as originalDocumentRead}')+`
const executeDocumentTool=async(...args)=>{
  const state=globalThis.readStall;
  if(state && args[1]==='read_document') {
    state.calls++;
    if(state.mode==='always' || state.calls===1) return new Promise(resolve=>{state.release=()=>resolve({ok:true,text:'LATE_INVALID_RESULT'});});
  }
  return originalDocumentRead(...args);
};
`);
  const deadlinePath=resolve(extension,'read-deadline.js'),deadline=await readFile(deadlinePath,'utf8');
  assert(deadline.includes('REFERENCE_READ_TIMEOUT_MS = 45000'));
  await writeFile(deadlinePath,deadline.replace('REFERENCE_READ_TIMEOUT_MS = 45000','REFERENCE_READ_TIMEOUT_MS = 1000'));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.documentTestExecute = executeDocumentTool;\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  context.setDefaultTimeout(15000);
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {if (/^https?:/.test(request.url()) && !request.url().startsWith('https://aipro.sdsdev.co.kr/')) errors.push('Unexpected remote request: ' + new URL(request.url()).origin);});
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().method() === 'GET') return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    const body = route.request().postDataJSON(); seen.push(body);
    assert.equal(body.model, 'QWEN3.8-27B-FP8-256K');
    const plan = planCompletion(body); if (plan) return route.fulfill({json: plan});
    const review = goalReviewPayload(body.messages);
    if (review) {
      reviews++; assert(review.evidence.some(item => ['read_document', 'search_documents'].includes(item.tool) && item.usable));
      return route.fulfill({json: reviewCompletion(review)});
    }
    if (body.messages[0]?.content.startsWith("You are Nubi's completion-intent reviewer.")) return route.fulfill({json: reply(null, JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''}))});
    const output = body.messages.findLast(message => message.role === 'tool'), result = output && JSON.parse(output.content);
    if (body.messages[0]?.content.includes("Nubi's isolated research analyst")) {
      const brief = JSON.parse(body.messages.find(message => message.role === 'user').content);
      assert.equal(brief.documents.length, 1);
      if (mode === 'partition') {
        const r = brief.document_ranges[0]; assert.equal(brief.document_ranges.length, 1);
        if (!output) {
          const middle = r.start + Math.floor((r.end - r.start) / 2);
          return route.fulfill({json: reply([call('read_document', {document_id: r.document_id, offset: r.start, length: middle - r.start}), call('read_document', {document_id: r.document_id, offset: middle, length: r.end - middle})])});
        }
        const packets = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
        assert.equal(packets.length, 2);
        for (const packet of packets) {
          const source = JSON.parse(packet.text).result;
          assert(source.start >= r.start && source.end <= r.end); assert.equal(source.text, long.slice(source.start, source.end));
        }
        partitionReads += packets.length; partitionReports.add(r.start);
        return route.fulfill({json: reply(null, JSON.stringify({status: 'complete', summary: '배정 구간 확인', findings: packets.map(p => ({text: '배정된 일반 절차 원문 확인', evidence_ids: [p.evidence_id]})), uncertainties: [], next_step: ''}))});
      }
      const id = brief.documents[0].document_id, isDeadline = id === files[0].id;
      childStarts.add(id);
      assert(!body.tools.some(tool => ['click_element', 'delegate_analysis', 'wiki_search'].includes(tool.function.name)));
      if (!output) {
        assert(!JSON.stringify(body.messages).includes(isDeadline ? '김검토' : '9월 30일'));
        return route.fulfill({json: reply([call('search_documents', {query: isDeadline ? '인수 테스트 마감일' : '검토 담당자'})])});
      }
      const source = JSON.parse(result.text).result;
      if (source.results) {
        assert(source.results.length); const hit = source.results[0]; assert.equal(hit.document_id, id);
        return route.fulfill({json: reply([call('read_document', {document_id: id, offset: hit.start, length: hit.end - hit.start})])});
      }
      assert.match(source.text, isDeadline ? /9월 30일/ : /김검토/);
      reports.add(id);
      return route.fulfill({json: reply(null, JSON.stringify({status: 'complete', summary: isDeadline ? '마감일 확인' : '담당자 확인', findings: [{text: isDeadline ? '인수 테스트 마감일은 9월 30일입니다.' : '검토 담당자는 김검토입니다.', evidence_ids: [result.evidence_id]}], uncertainties: [], next_step: ''}))});
    }
    if (mode === 'stall' || mode === 'cancel-read') {
      if (stallStage++ === 0) return route.fulfill({json:reply([call('read_document',{document_id:files[0].id,offset:0,length:100})])});
      if (mode === 'cancel-read') throw Error('Cancelled read must not start another model turn');
      if (stallStage === 2) {
        assert.equal(result.error,'read_timeout');
        return route.fulfill({json:reply([call('read_document',{document_id:files[0].id,offset:100,length:100})])});
      }
      assert.equal(result.text,long.slice(100,200));
      return route.fulfill({json:reply(null,'지연된 첫 구간은 제외하고 다음 구간만 확인했습니다.')});
    }
    if (mode === 'partition') {
      if (partitionStage === 0) {partitionStage++; return route.fulfill({json: reply([call('read_document', {document_id: files[0].id, mode: 'plan'})])});}
      if (partitionStage === 1) {
        assert(result.metadata_only); assert.equal(result.coverage, 'unread'); assert(result.next_offset !== null);
        partitionRanges = result.ranges.slice(0, 2); assert.equal(partitionRanges.length, 2); partitionStage++;
        return route.fulfill({json: reply([call('delegate_analysis', {tasks: partitionRanges.map((r, i) => ({role: 'research', task: `앞부분 구간 ${i + 1} 요약`, done_when: '배정 구간 전체 확인', evidence_ids: [], document_ids: [r.document_id], document_ranges: [r]}))})])});
      }
      if (partitionReports.size < 2) return route.fulfill({json: reply([call('collect_analysis')])});
      assert.match(JSON.stringify(body.messages), /document_progress/);
      return route.fulfill({json: reply(null, '앞의 두 구간을 병렬로 확인했습니다. 나머지 문서의 확인은 포함하지 않습니다.')});
    }
    if (mode === 'resume') {
      if (!resumeRead) {resumeRead = true; return route.fulfill({json: reply([call('read_document', {document_id: files[0].id, offset: long.indexOf('인수 테스트'), length: 100})])});}
      assert.match(JSON.stringify(body.messages), /9월 30일/);
      return route.fulfill({json: reply(null, '인수기준.md 원문을 다시 확인했습니다. 마감일은 9월 30일입니다.')});
    }
    if (!started) {
      started = true;
      assert(!JSON.stringify(body.messages).includes('9월 30일')); assert(!JSON.stringify(body.messages).includes('김검토'));
      // Measure source retrieval independently of the shared harness policy.
      // Neither growing policy text nor an entire injected attachment should
      // hide which budget failed. These are character limits, not token claims.
      const policyCharacters=JSON.stringify(body.messages.filter(m=>m.role==='system')).length;
      const sourceCharacters=JSON.stringify(body.messages.filter(m=>m.role!=='system')).length;
      assert(policyCharacters<30000,`Harness policy characters: ${policyCharacters}`);
      assert(sourceCharacters<6000,`Initial source/envelope characters: ${sourceCharacters}`);
      return route.fulfill({json: reply([call('delegate_analysis', {tasks: files.slice(0, 2).map((file, i) => ({role: 'research', task: i ? '검토 담당자 확인' : '인수 테스트 마감일 확인', done_when: '문서에서 근거를 찾음', evidence_ids: [], document_ids: [file.id]}))})])});
    }
    if (reports.size < 2) return route.fulfill({json: reply([call('collect_analysis')])});
    return route.fulfill({json: reply(null, '인수기준.md: 마감일은 9월 30일입니다. 담당안내.md: 검토 담당자는 김검토입니다.')});
  } catch (error) {failure = error; await route.abort();}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 41}}));
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await until(async () => (await state()).catalog?.models?.length === 1);
  await ui.evaluate(() => {chrome.permissions.request = async () => false;});
  await ui.locator('input[type=file][aria-label="첨부 파일 선택"]').setInputFiles([
    {name: '인수기준.md', mimeType: 'text/plain', buffer: Buffer.from(long)},
    {name: '담당안내.md', mimeType: 'text/plain', buffer: Buffer.from(other)}, pdfFile(), await wordFile(),
  ]);
  await until(async () => (await state()).chat.draftAttachments?.length === 4);
  files = (await state()).chat.draftAttachments;
  const beforeTabs = await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.map(tab => tab.id)));
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('첨부 문서에서 인수 테스트 마감일과 검토 담당자를 각각 조사하고 근거를 비교해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => (await state()).chat.messages.at(-1)?.state === 'done');
  const done = await state(); assert.match(done.chat.messages.at(-1).content, /9월 30일/); assert.match(done.chat.messages.at(-1).content, /김검토/);
  assert.equal(childStarts.size, 2); assert.equal(reports.size, 2); assert(reviews > 0);
  assert.equal(done.page, null); assert.deepEqual(await worker.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.map(tab => tab.id))), beforeTabs);
  assert.equal(done.chat.messages.at(-1).trace.filter(step => step.tool === 'analysis_research' && step.status === 'done').length, 2);
  check('long attached files are searched and read by isolated Pi research agents without OpenWiki or a browser target; final review sees original evidence');
  const reads = await worker.evaluate(async files => {
    const {chat} = await chrome.storage.local.get('chat');
    return Promise.all(files.slice(2).map(file => documentTestExecute({bindings: files, owner: {provider: 'aipro', conversationId: chat.sessionId}}, 'read_document', {document_id: file.id})));
  }, files);
  assert.match(reads[0].text, /PDF reference marker/); assert.match(reads[1].text, /Word reference marker/);
  check('actual PDF.js and Mammoth parsed attachments use the same source reader and retain text-only limits');
  // Seed a valid history boundary to test source availability independent of
  // summarized messages. Context generation itself has its separate suite.
  await worker.evaluate(async () => {
    const {chat} = await chrome.storage.local.get('chat');
    chat.memory = {version: 1, throughId: chat.messages.at(-1).id, summary: {goal: '문서 확인', constraints: [], decisions: [], completed: ['조사 완료'], pending: [], references: []}, count: 1, at: Date.now()};
    await chrome.storage.local.set({chat});
  });
  mode = 'resume'; await ui.reload(); await ui.evaluate(() => {chrome.permissions.request = async () => false;});
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('이전 첨부 문서의 마감일을 원문에서 다시 확인해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => (await state()).chat.messages.at(-1)?.state === 'done' && (await state()).chat.messages.at(-1).content.startsWith('인수기준.md 원문'));
  assert(resumeRead); check('after a saved compaction boundary and UI reload the original attachment remains retrievable without re-upload');
  mode = 'partition';
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('인수기준 문서의 앞부분 두 구간만 나눠서 병렬로 요약해줘.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => {const last=(await state()).chat.messages.at(-1);return last?.state === 'done' && last.content.startsWith('앞의 두 구간');});
  assert.equal(partitionReports.size, 2); assert.equal(partitionReads, 4);
  assert.equal((await state()).chat.messages.at(-1).trace.filter(step=>step.tool==='analysis_research' && step.status==='done').length, 2);
  check('original attachment plans unread ranges; two isolated Pi analysts execute two independent reads each and return coverage in actual Chrome');
  mode='stall';stallStage=0;
  await worker.evaluate(()=>{globalThis.readStall={mode:'once',calls:0};});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('첫 구간을 읽고, 조회가 안 되면 다음 100자만 확인하고 한계를 알려줘.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await until(async()=>{const last=(await state()).chat.messages.at(-1);return last?.state==='done' && last.content.startsWith('지연된 첫 구간');});
  assert.equal(await worker.evaluate(()=>readStall.calls),2);
  let completed=(await state()).chat.messages.at(-1);
  assert(!completed.trace.some(step=>step.status==='running'));
  await worker.evaluate(()=>readStall.release());await new Promise(r=>setTimeout(r,100));
  assert.equal((await state()).chat.messages.at(-1).content,completed.content);
  check('a never-settling document read releases the host queue on deadline; Pi inspects the error and reads a different range; late completion is ignored');
  mode='cancel-read';stallStage=0;
  await worker.evaluate(()=>{globalThis.readStall={mode:'always',calls:0};});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('문서 첫 구간을 확인해줘.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await until(()=>worker.evaluate(()=>readStall.calls===1));
  await ui.getByRole('button',{name:'중지',exact:true}).click();
  await until(async()=>(await state()).chat.messages.at(-1)?.error==='cancelled');
  await worker.evaluate(()=>readStall.release());await new Promise(r=>setTimeout(r,100));
  assert.equal(stallStage,1);assert.equal((await state()).chat.messages.at(-1).error,'cancelled');
  await worker.evaluate(()=>{delete globalThis.readStall;});
  check('explicit user cancellation releases a stalled host read without another model call or late-result revival');
  await rpc('NEW_CHAT'); const isolated = await rpc('START_CHAT', {text: '안녕'});
  assert.deepEqual(isolated.documents, []); assert(!isolated.tools.some(tool => tool.function.name === 'read_document'));
  await rpc('FINISH_CHAT', {requestId: isolated.requestId, content: '안녕'});
  check('another conversation receives neither document IDs nor document read tools');
  assert.deepEqual(errors, []); if (failure) throw failure;
  await writeFile('verification/document-retrieval/browser.json', JSON.stringify({checks, actualBrowser: true, actualModel: false, parentModel: 'QWEN3.8-27B-FP8-256K', originalDocumentCharacters: long.length + other.length, errors}, null, 2));
} catch (error) {if (ui) {console.error(JSON.stringify((await state().catch(() => null))?.chat)); console.error((await ui.locator('body').innerText().catch(() => '')).slice(-1800));} throw error;}
finally {await context?.close(); await rm(profile, {recursive: true, force: true});}

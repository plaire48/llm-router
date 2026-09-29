import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, mkdir, appendFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

// Same self-contained PDF object/xref fixture pattern as fixtures/documents.mjs.
// PDF.js parses all pages through the real extension extraction Worker.
function manyPagePdf(count = 161) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let page = 1; page <= count; page++) {
    const pageId = objects.length + 1, contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const lines = [`PAGE_${page} PDF_SOURCE_REFERENCE`, ...Array.from({length: 7}, (_, row) => `Section ${row} source reference values and qualifications.`), ...(page === count ? ['PDF_LAST_PAGE_SENTINEL'] : [])];
    const content = `BT /F1 10 Tf 40 740 Td 14 TL ${lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
  let data = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => {offsets.push(Buffer.byteLength(data)); data += `${i + 1} 0 obj\n${object}\nendobj\n`;});
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return {name: '161-page-reference.pdf', mimeType: 'application/pdf', buffer: Buffer.from(data)};
}
const text = 'SOURCE_TEXT_SENTINEL original reference.\n'.repeat(3200) + 'TEXT_FINAL_SENTINEL';
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-large-docs-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], requests = [], workerAssignments = new Set();
let context, ui, worker, files, failure, parentRounds = 0, finalReviewCount = 0, synthesisCalls = 0, childReads = 0, maxParallel = 0, pendingResearch = 0;
let releaseParallel; const parallel = new Promise(resolve => {releaseParallel = resolve;});
const call = (name, args) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const reply = (content = '', calls) => ({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 30, total_tokens: 130}});
const researchReport = evidence => ({status: 'complete', answer: '배정 구간의 원문 근거를 확인했습니다.', findings: evidence.slice(0, 3).map(id => ({text: '첨부 문서의 원문 구간을 확인했습니다.', citations: [id]})), uncertainties: []});
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const rpc = (type, value = {}) => ui.evaluate(async ({type, value}) => {const result = await chrome.runtime.sendMessage({type, ...value}); if (!result.ok) throw Error(result.error); return result.data;}, {type, value});
const state = () => rpc('GET_STATE');
async function until(fn, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {if (failure) throw failure; if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 80));}
  throw Error('Large-document browser check timed out');
}
try {
  await mkdir('verification/large-document', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  // Read-only test access to the production reader. Runtime, parsers and model adapter are unchanged.
  await appendFile(resolve(extension, 'background.js'), '\nimport {attachmentStorageBytes as largeDocumentStorageBytes} from \'./attachment-store.js\';\nglobalThis.largeDocumentRead = executeDocumentTool;\nglobalThis.largeDocumentProbe = {readAttachment, attachmentStorageBytes:largeDocumentStorageBytes};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY || chromium.executablePath(), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().method() === 'GET') return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', context_length: 262144, max_input_tokens: 221184}]}});
    const body = route.request().postDataJSON(), wire = JSON.stringify(body.messages);
    requests.push({model: body.model, characters: wire.length});
    assert.equal(body.model, 'QWEN3.8-27B-FP8-256K');
    assert(!wire.includes('document_snapshot'), 'Private host snapshots must never become model tool messages');
    assert(!wire.includes(text), 'The full large input must not be loaded into any model context');
    const plan = planCompletion(body); if (plan) return route.fulfill({json: plan});
    const review = goalReviewPayload(body.messages);
    if (review) {
      finalReviewCount++;
      assert(review.evidence.some(item => item.tool === 'ask_documents' && item.usable));
      return route.fulfill({json: reviewCompletion(review)});
    }
    const system = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
    if (system.includes("Nubi's completion-intent reviewer")) return route.fulfill({json: reply(JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''}))});
    if (system.includes('Plan OpenWiki research')) return route.fulfill({json: reply(JSON.stringify({mode: 'comprehensive', questions: ['두 첨부 문서의 전체 구간을 확인합니다.']}))});
    if (system.includes('Synthesize the supplied researcher findings')) {
      synthesisCalls++;
      const packet = JSON.parse(body.messages.at(-1).content);
      assert(packet.reports.length <= 4);
      return route.fulfill({json: reply(JSON.stringify(researchReport(packet.evidence.map(entry => entry.id))))});
    }
    if (system.includes("OpenWiki's read-only evidence researcher")) {
      assert(body.tools.every(tool => ['read_wiki', 'search_wiki'].includes(tool.function.name)));
      const result = body.messages.findLast(message => message.role === 'tool');
      if (result) {
        childReads++;
        const evidence = JSON.parse(result.content);
        assert.equal(evidence.kind, 'document'); assert.equal(evidence.unit, 'utf16'); assert.equal(evidence.excerpt.length, evidence.end - evidence.start);
        return route.fulfill({json: reply(JSON.stringify(researchReport([evidence.id])))});
      }
      const packet = JSON.parse(body.messages.find(message => message.role === 'user').content), range = packet.assignment.range;
      assert(range && range.end > range.start);
      workerAssignments.add(`${range.documentId}:${range.start}:${range.end}`);
      // Both first independent model requests must be in flight together.
      if (workerAssignments.size <= 2) {
        pendingResearch++; maxParallel = Math.max(maxParallel, pendingResearch);
        if (pendingResearch === 2) releaseParallel();
        let timer;
        try {await Promise.race([parallel, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Independent researchers did not run concurrently')), 5000);})]);}
        finally {clearTimeout(timer); pendingResearch--;}
      }
      return route.fulfill({json: reply('', [call('read_wiki', {documentId: range.documentId, start: range.start, length: 6000})])});
    }
    parentRounds++;
    if (parentRounds === 1) {
      assert(!wire.includes('SOURCE_TEXT_SENTINEL')); assert(!wire.includes('PDF_LAST_PAGE_SENTINEL'));
      return route.fulfill({json: reply('', [call('ask_documents', {question: '두 첨부 문서의 모든 내용을 구간별로 검토해 주세요.', document_ids: files.map(file => file.id)})])});
    }
    const output = body.messages.findLast(message => message.role === 'tool');
    assert(output, 'The main Pi run must receive the analyzed result');
    const result = JSON.parse(output.content);
    assert.equal(result.dataKind, 'document_reference'); assert.equal(result.status, 'complete');
    assert.equal(result.coverage.mode, 'comprehensive'); assert.deepEqual(result.coverage.unreadRanges, []);
    assert(result.coverage.repairTasks > 0); assert(result.evidence.length > 0);
    assert(!Object.hasOwn(result, 'documents'), 'The final result must not contain whole source snapshots');
    return route.fulfill({json: reply('두 첨부 문서의 전체 구간을 나눠 읽고 결과를 합쳤습니다. 이는 고정 응답을 사용한 동작 검증입니다.')});
  } catch (error) {failure = error; releaseParallel(); await route.abort();}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 741}}));
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await until(async () => (await state()).catalog?.models?.length === 1);
  await rpc('SELECT_MODEL', {name: 'QWEN3.8-27B-FP8-256K'});
  await ui.evaluate(() => {chrome.permissions.request = async () => false;});
  await ui.locator('input[type=file][aria-label="첨부 파일 선택"]').setInputFiles([
    {name: 'large-reference.txt', mimeType: 'text/plain', buffer: Buffer.from(text)}, manyPagePdf(),
  ]);
  await until(async () => (await state()).chat.draftAttachments?.length === 2, 120000);
  files = (await state()).chat.draftAttachments;
  const stored = await worker.evaluate(async files => {
    const {readAttachment, attachmentStorageBytes} = largeDocumentProbe;
    const {chat} = await chrome.storage.local.get('chat'), owner = {provider: 'aipro', conversationId: chat.sessionId};
    const rows = [];
    for (const file of files) {
      const original = await readAttachment(file.id, owner), text = original.extractedText ?? await original.blob.text();
      const offset = Math.max(0, text.length - 1000);
      const result = await largeDocumentRead({bindings: files, owner}, 'read_document', {document_id: file.id, offset, length: 1000});
      rows.push({name: file.name, characters: text.length, end: result.end, text: result.text, expected: text.slice(offset), originalBytes: original.bytes, storedBytes: attachmentStorageBytes(original), extractedCharacters: original.extractedText?.length || 0});
    }
    return rows;
  }, files);
  assert(stored.every(row => row.characters > 40000 && row.end === row.characters && row.text === row.expected));
  assert.match(stored[0].text, /TEXT_FINAL_SENTINEL/); assert.match(stored[1].text, /\[161쪽\]/); assert.match(stored[1].text, /PDF_LAST_PAGE_SENTINEL/);
  assert.equal(stored[1].storedBytes, stored[1].originalBytes + 2 * stored[1].extractedCharacters);
  assert.equal(requests.length, 0);
  check('actual TXT ingestion and PDF.js extraction preserve over 40,000 characters and the 161st PDF page before any model call');
  await ui.reload(); await until(async () => (await state()).chat.draftAttachments?.length === 2);
  // Reload creates a new page realm. Restore the permission fixture before the
  // send gesture, as in document-retrieval-browser.mjs, to avoid a native prompt.
  await ui.evaluate(() => {chrome.permissions.request = async () => false;});
  assert.equal((await state()).settings.modelId, 'QWEN3.8-27B-FP8-256K');
  check('large original attachments survive UI reload through IndexedDB');
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('두 첨부 문서의 모든 내용을 나눠 검토하고 근거를 합쳐주세요.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => (await state()).chat.messages.length > 0, 10000);
  await until(async () => {const last = (await state()).chat.messages.at(-1); if (last?.state === 'error') throw Error(last.error); return last?.state === 'done';}, 120000);
  const completed = (await state()).chat.messages.at(-1), trace = completed.trace;
  assert(parentRounds >= 2 && finalReviewCount > 0 && synthesisCalls > 1 && childReads > 2);
  assert.equal(maxParallel, 2);
  assert(!trace.some(step => ['running', 'queued'].includes(step.status)));
  check('the actual Pi run delegates selected documents to two independent researchers, repairs unread spans, hierarchically synthesizes and verifies the final result');
  check('parent and child model messages exclude full private snapshots while persisted progress shows research, recovery, synthesis and handoff');
  const finalState = await state(), owner = {provider: finalState.chat.provider, conversationId: finalState.chat.sessionId, requestId: completed.id};
  const journalEvents = []; let before, journalPages = 0, journal;
  do {
    const page = await rpc('GET_TRACE_JOURNAL', {...owner, ...(before === undefined ? {} : {before})});
    assert.equal(page.available, true); assert.equal(page.missing, 0); assert.equal(page.dropped, 0); assert.equal(page.incomplete, false);
    journal ||= page; journalEvents.push(...page.events); journalPages++;
    before = page.next;
  } while (before !== null);
  assert(journal.retained > 32); assert(journalEvents.length > trace.length);
  assert.equal(journalEvents.length, journal.retained);
  assert.equal(new Set(journalEvents.map(event => event.sequence)).size, journal.retained);
  assert(journalPages > 1, 'The actual host must retain enough events to exercise journal paging');
  for (const role of ['planner', 'research', 'recovery', 'synthesis', 'coordinator']) assert(journalEvents.some(event => event.analysis?.role === role), `Missing journal ${role} events`);
  assert(journalEvents.some(event => event.analysis?.role === 'coordinator' && event.analysis.deliveredTo === 'main' && event.status === 'done'));
  assert(trace.some(step => step.analysis?.role === 'coordinator' && step.analysis.deliveredTo === 'main' && step.status === 'done'), 'The final handoff must remain in the recent trace after the long-running coordinator finishes');
  check('actual Pi SAVE_CONTEXT persists all journal events beyond the recent trace with complete, unique paginated retrieval');
  await ui.screenshot({animations: 'disabled', path: 'verification/large-document/completed.png'});
  assert.deepEqual(errors, []); if (failure) throw failure;
  await writeFile('verification/large-document/browser.json', JSON.stringify({status: 'passed', actualBrowser: true, actualModel: false, browser: context.browser().version(), checks, documents: stored.map(({text, expected, ...row}) => row), modelCalls: requests.length, maxModelMessageCharacters: Math.max(...requests.map(request => request.characters)), maxParallel, synthesisCalls, childReads, workers: workerAssignments.size, finalReviewCount, journal: {retained: journal.retained, missing: journal.missing, dropped: journal.dropped, incomplete: journal.incomplete, pages: journalPages, recentTrace: trace.length}, errors}, null, 2));
} catch (error) {
  if (ui) {
    const failed = await state().catch(() => null);
    console.error(JSON.stringify({chat: failed?.chat, selectedModel: failed?.settings?.modelId, modelCalls: requests.length, page: await ui.locator('body').innerText().catch(() => '')}));
  }
  throw error;
} finally {releaseParallel(); await context?.close(); await rm(profile, {recursive: true, force: true});}

import test from 'node:test';
import assert from 'node:assert/strict';
import {documentBindings, documentCatalogMessage, documentToolDefinitions, executeDocumentTool} from '../document-tools.js';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

const owner = {provider: 'aipro', conversationId: 'one'};
const file = (id, text, kind = 'text') => ({id, name: `${id}.md`, hash: id.repeat(64).slice(0, 64), kind, blob: new Blob([text]), ...(kind === 'document' ? {extractedText: text} : {})});
const long = '일반 업무 안내입니다.\n'.repeat(1700) + '\n인수 테스트 마감일은 9월 30일입니다. 담당 부서는 품질팀입니다.\n';
function library(files) {
  const bindings = documentBindings([{attachments: files}]);
  return {bindings, run: (name, args) => executeDocumentTool({bindings, owner}, name, args, {load: async (id, scope) => {
    assert.deepEqual(scope, owner); const record = files.find(file => file.id === id); assert(record); return record;
  }})};
}
test('LangChain chunks and MiniSearch retrieve Korean facts beyond the first context window with exact provenance', async () => {
  const source = file('acceptance', long), unrelated = file('expenses', '출장비 정산은 재무팀에서 처리합니다.');
  const {run} = library([source, unrelated]);
  const result = await run('search_documents', {query: '인수 테스트 마감일'});
  assert(result.results.length); const hit = result.results[0];
  assert.equal(hit.document_id, source.id); assert.match(hit.excerpt, /9월 30일/);
  assert(hit.start > 10000); assert.equal(long.slice(hit.start, hit.end), hit.excerpt);
  assert.equal(hit.sha256, source.hash); assert.equal(hit.provenance.unit, 'characters');
  assert.equal(hit.start_line, long.slice(0, hit.start).split('\n').length);
  assert.equal(result.coverage, 'partial'); assert(JSON.stringify(result).length < 5500);
  const original = await run('read_document', {document_id: hit.document_id, offset: hit.start, length: hit.end - hit.start});
  assert.equal(original.text, hit.excerpt); assert.equal(original.provenance.hash, source.hash);
  assert.equal((await run('search_documents', {query: '인수 테스트', document_ids: [unrelated.id]})).results.length, 0);
  const missing = await run('search_documents', {query: '존재하지않는예약코드'});
  assert.deepEqual(missing.results, []); assert.equal(missing.coverage, 'partial');
});
test('range reads reconstruct the original and reject unknown IDs, invalid ranges and changed hashes', async () => {
  const source = file('source', long, 'document'), {run} = library([source]);
  let offset = 0, joined = '';
  do {const result = await run('read_document', {document_id: source.id, offset}); joined += result.text; offset = result.next_offset; assert.match(result.scope, /OCR/);} while (offset !== null);
  assert.equal(joined, long);
  assert.equal((await run('read_document', {document_id: 'another-conversation'})).error, 'attachment_missing');
  assert.equal((await run('read_document', {document_id: source.id, offset: 0.2})).error, 'tool_arguments_invalid');
  assert.equal((await run('read_document', {document_id: source.id, length: 9000})).error, 'tool_arguments_invalid');
  source.hash = 'changed'; await assert.rejects(() => run('read_document', {document_id: source.id}), /attachment_missing/);
});
test('metadata is retained independently from compressed history, paginated and distinguished from a read', async () => {
  const files = Array.from({length: 24}, (_, index) => file(`source-${index}`, 'text'));
  const {bindings, run} = library(files);
  const first = await run('search_documents', {}), next = await run('search_documents', {offset: first.next_offset});
  assert.equal(first.metadata_only, true); assert.equal(first.documents.length, 20); assert.equal(next.documents.length, 4);
  assert.equal(documentBindings([{attachments: [...files, files[0], {id: 'png', kind: 'image'}]}]).length, 24);
  const catalog = documentCatalogMessage(bindings); assert(!catalog.content.includes('source-0.md')); assert.match(catalog.content, /source-23.md/);
  assert.equal((await run('search_documents', {document_ids: ['invented']})).error, 'tool_arguments_invalid');
});
test('Pi research analysts use assigned documents without OpenWiki and cannot read another assigned role source', async t => {
  const sources = [file('allowed', '인수 테스트 마감일은 9월 30일입니다.'), file('other', 'UNRELATED_DOCUMENT_TEXT')];
  const {bindings, run} = library(sources), reads = []; let round = 0;
  const call = (name, args) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
  const coordinator = createAnalysisCoordinator({signal: new AbortController().signal, documents: bindings, tools: documentToolDefinitions(), run: runAgent,
    execute: async (name, args) => {reads.push([name, args]); return run(name, args);},
    complete: async (wire, tools) => {
      assert(!JSON.stringify(wire).includes('UNRELATED_DOCUMENT_TEXT'));
      assert(!JSON.stringify(wire).includes('other.md'));
      assert(!tools.some(tool => ['click_element', 'navigate_page', 'delegate_analysis'].includes(tool.function.name)));
      if (++round === 1) return call('read_document', {document_id: 'other'});
      if (round === 2) {assert.match(wire.at(-1).content, /analysis_scope/); return call('search_documents', {query: '마감일'});}
      const packet = JSON.parse(wire.at(-1).content); assert.match(packet.text, /9월 30일/);
      return {content: JSON.stringify({status: 'complete', summary: '마감일 확인', findings: [{text: '인수 테스트 마감일은 9월 30일입니다.', evidence_ids: [packet.evidence_id]}], uncertainties: [], next_step: ''})};
    }});
  t.after(() => coordinator.dispose());
  const task = {role: 'research', task: '인수 테스트 마감일 확인', constraints: '', done_when: '문서의 마감일 근거를 찾음', evidence_ids: [], document_ids: ['allowed']};
  assert.equal((await coordinator.execute('delegate_analysis', {tasks: [{...task, document_ids: ['invented']}]})).error, 'analysis_scope');
  assert.equal((await coordinator.execute('delegate_analysis', {tasks: [task]})).ok, true);
  const result = await coordinator.collect(); assert.equal(result.results[0].status, 'done');
  assert.equal(reads.length, 1); assert.deepEqual(reads[0][1].document_ids, ['allowed']);
  assert.equal(result.results[0].evidence[0].kind, 'document');
  assert(JSON.stringify(result).length < 3000);
});

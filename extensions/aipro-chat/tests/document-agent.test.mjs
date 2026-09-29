import test from 'node:test';
import assert from 'node:assert/strict';
import {delegateDocumentQuestion} from '../document-agent.js';
import {executeDocumentTool, documentBindings} from '../document-tools.js';
import {decodeAttachment, ATTACHMENT_LIMITS} from '../attachments.js';
import {attachmentStorageBytes, attachmentMessages} from '../attachment-store.js';

const hash = 'a'.repeat(64);
const file = (id, text) => ({id, name: `${id}.txt`, kind: 'text', hash, bytes: new Blob([text]).size, blob: new Blob([text])});
const reply = ids => ({status: 'complete', answer: 'Observed source evidence.', findings: ids.slice(0, 3).map(id => ({text: 'Observed source evidence.', citations: [id]})), uncertainties: []});
function completion({mode = 'comprehensive', seen = [], calls = []} = {}) {
  return async (messages, tools, scope) => {
    seen.push(messages); calls.push(scope);
    assert.equal(scope.modelId, 'same-selected-model');
    assert(tools.every(tool => ['read_wiki', 'search_wiki'].includes(tool.function.name)));
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    if (system.includes('Plan OpenWiki research')) return {content: JSON.stringify({mode, questions: ['Inspect the requested document evidence.']})};
    if (system.includes('Synthesize')) {
      const data = JSON.parse(messages.at(-1).content);
      return {content: JSON.stringify(reply(data.evidence.map(row => row.id)))};
    }
    const read = messages.findLast(m => m.role === 'tool');
    if (read) return {content: JSON.stringify(reply([JSON.parse(read.content).id]))};
    const {assignment, catalog} = JSON.parse(messages.find(m => m.role === 'user').content);
    const id = assignment.range?.documentId || assignment.documentIds.at(-1);
    const start = assignment.range?.start ?? Math.max(0, catalog.find(doc => doc.id === id).characters - 30);
    return {calls: [{id: crypto.randomUUID(), type: 'function', function: {name: 'read_wiki', arguments: JSON.stringify({documentId: id, start, length: 6000})}}]};
  };
}
function host(files, extra = {}) {
  const bindings = documentBindings([{attachments: files}]);
  const owner = {provider: 'aipro', conversationId: 'this-conversation'};
  return {bindings, owner, execute: (name, args) => executeDocumentTool({bindings, owner}, name, args, {load: async (id, actualOwner) => {
    assert.deepEqual(actualOwner, owner); return files.find(f => f.id === id);
  }}), ...extra};
}
const run = (files, options = {}) => delegateDocumentQuestion({question: 'Review every document completely.', document_ids: files.map(f => f.id)},
  {modelId: 'same-selected-model', signal: new AbortController().signal, complete: completion(), ...host(files), ...options});

test('large attached text is accepted without truncation, and extraction cost counts toward storage', () => {
  const original = '긴 원문\n'.repeat(20000);
  const decoded = decodeAttachment({name: 'large.txt', data: Buffer.from(original).toString('base64')});
  assert.equal(decoded.text, original); assert(original.length > 40000);
  assert.equal(attachmentStorageBytes({bytes: 100, extractedText: original}), 100 + original.length * 2);
  assert.equal(attachmentStorageBytes({bytes: 100}), 100);
  assert.throws(() => decodeAttachment({name: 'too-large.txt', data: Buffer.from('x'.repeat(ATTACHMENT_LIMITS.textChars + 1)).toString('base64')}), /attachment_size/);
});

test('snapshot scopes selected IDs and large direct reads keep exact offsets without admitting other conversations', async () => {
  const text = 'first\n'.repeat(20000) + 'LAST_RANGE_SENTINEL', source = file('one', text), {execute} = host([source]);
  const snapshot = await execute('ask_documents', {question: 'inspect', document_ids: ['one']});
  assert.equal(snapshot.documents[0].kind, 'document'); assert.equal(snapshot.documents[0].version, hash); assert.equal(snapshot.documents[0].text, text);
  const read = await execute('read_document', {document_id: 'one', offset: text.length - 18, length: 18});
  assert.equal(read.text, text.slice(-18)); assert(read.start > 40000);
  assert.equal((await execute('ask_documents', {question: 'inspect', document_ids: ['not-owned']})).error, 'tool_arguments_invalid');
  source.hash = 'b'.repeat(64);
  await assert.rejects(execute('ask_documents', {question: 'inspect', document_ids: ['one']}), /attachment_missing/);
});

test('attachment research partitions, repairs missing reads, synthesizes and emits actual roles through the shared core', async () => {
  const text = '# Terms\n' + 'source passage\n'.repeat(10000), events = [];
  const result = await run([file('large', text)], {onStep: event => events.push(event)});
  assert.equal(result.status, 'complete'); assert.equal(result.dataKind, 'document_reference'); assert.equal(result.wikiId, undefined);
  assert.deepEqual(result.document_ids, ['large']); assert.equal(result.coverage.mode, 'comprehensive');
  assert(result.coverage.tasks > 6); assert(result.coverage.repairTasks > 0); assert.deepEqual(result.coverage.unreadRanges, []);
  assert(result.evidence.every(entry => entry.kind === 'document' && entry.version === hash && entry.excerpt === text.slice(entry.start, entry.end)));
  for (const role of ['planner', 'research', 'recovery', 'synthesis']) assert(events.some(event => event.analysis.role === role), role);
  assert(events.some(event => event.analysis.deliveredTo === 'main' && event.status === 'done'));
});

test('4M-character files and an 8M-character corpus stay outside model messages', async () => {
  const files = [file('first', 'a'.repeat(4_000_000)), file('second', 'b'.repeat(3_999_980) + 'TAIL_EVIDENCE_SENTINEL')];
  // Make the exact corpus boundary explicit rather than relying on a guessed marker length.
  files[1] = file('second', 'b'.repeat(4_000_000 - 'TAIL_EVIDENCE_SENTINEL'.length) + 'TAIL_EVIDENCE_SENTINEL');
  const seen = [], result = await run(files, {complete: completion({mode: 'focused', seen})});
  assert.equal(result.coverage.documents, 2); assert.equal(result.status, 'complete');
  assert(seen.every(messages => JSON.stringify(messages).length < 100000));
  assert(!seen.some(messages => JSON.stringify(messages).includes('a'.repeat(50000))));
  assert(result.evidence.some(entry => entry.excerpt.includes('TAIL_EVIDENCE_SENTINEL')));
  const overflow = host([...files, file('third', 'x')]);
  assert.equal((await overflow.execute('ask_documents', {question: 'inspect', document_ids: ['first', 'second', 'third']})).error, 'attachment_document_size');
});

test('changed text, hash, scope or owner after research cannot be delivered as a completed answer', async () => {
  for (const change of ['text', 'hash', 'missing']) {
    const source = file('one', 'observed content'), base = host([source]), events = []; let reads = 0;
    await assert.rejects(run([source], {onStep: event => events.push(event), execute: async (name, args) => {
      if (++reads === 2) {
        if (change === 'text') source.blob = new Blob(['changed content']);
        if (change === 'hash') source.hash = 'b'.repeat(64);
        if (change === 'missing') throw Error('attachment_missing');
      }
      return base.execute(name, args);
    }}), /attachment_missing/);
    assert(!events.some(event => event.analysis.deliveredTo === 'main'));
  }
});

test('cancellation and authentication failure stop document research without publishing completed results', async () => {
  const controller = new AbortController(), events = []; let calls = 0;
  await assert.rejects(run([file('one', 'content')], {signal: controller.signal, onStep: event => events.push(event), complete: async () => {
    calls++; controller.abort(new Error('cancelled')); throw controller.signal.reason;
  }}), /cancelled/);
  assert.equal(calls, 1); assert(!events.some(event => event.analysis.deliveredTo === 'main'));
  await assert.rejects(run([file('one', 'content')], {complete: async () => {throw Error('expired_token');}}), /expired_token/);
});

// Read-only IndexedDB facade for checking the real attachment-message path.
function readableStore(records) {
  return {open() {const request = {}; queueMicrotask(() => {request.result = {close() {}, transaction() {
    const tx = {objectStore: () => ({get(id) {const read = {}; queueMicrotask(() => {read.result = records.find(record => record.id === id); read.onsuccess(); queueMicrotask(() => tx.oncomplete());}); return read;}})};
    return tx;
  }}; request.onsuccess();}); return request;}};
}
test('large stored attachments never enter the model inline even if a caller requests Infinity', async t => {
  const source = {...file('one', 'UNBOUNDED_BODY'.repeat(10000)), provider: 'aipro', conversationId: 'this-conversation'};
  const previous = globalThis.indexedDB; globalThis.indexedDB = readableStore([source]);
  t.after(() => {if (previous) globalThis.indexedDB = previous; else delete globalThis.indexedDB;});
  const messages = await attachmentMessages([{role: 'user', content: 'review', attachments: [source]}], {provider: source.provider, conversationId: source.conversationId}, false, {inlineLimit: Infinity});
  assert(!JSON.stringify(messages).includes('UNBOUNDED_BODY'));
  assert.match(JSON.stringify(messages), /Not loaded/); assert.match(JSON.stringify(messages), /read_document/);
  await assert.rejects(attachmentMessages([{role: 'user', content: 'review', attachments: [source]}], {provider: source.provider, conversationId: source.conversationId}, false, {canReadDocuments: false}), /tools_unavailable/);
});

test('unresolved interpretation is partial even after complete reading and synthesis, while blank notes are ignored', async () => {
  for (const notes of [['  '], ['  Conflicting qualification still needs review.  ', 'Conflicting qualification still needs review.']]) {
    const base = completion(), events = [];
    const result = await run([file('one','Observed fact with a qualification.')], {onStep:event=>events.push(event), complete:async (...args) => {
      const response=await base(...args);
      if (response.content) {
        const packet=JSON.parse(response.content);
        if (Object.hasOwn(packet,'uncertainties')) {
          // The reducer attempts to discard the leaf's uncertainty and claim complete.
          packet.uncertainties=args[0][0].content.includes('Synthesize') ? [] : notes;
          response.content=JSON.stringify(packet);
        }
      }
      return response;
    }});
    const uncertain=notes.some(note=>note.trim());
    assert.equal(result.status,uncertain?'partial':'complete');
    assert.deepEqual(result.coverage.unreadRanges,[]);
    assert.deepEqual(result.uncertainties,uncertain?['Conflicting qualification still needs review.']:[]);
    assert.equal(events.findLast(event=>event.analysis.deliveredTo==='main').analysis.outcome,result.status);
    if(uncertain)assert(events.filter(event=>event.status==='done'&&['research','synthesis'].includes(event.analysis.role)).every(event=>event.analysis.outcome==='partial'));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadWikiFolder, saveWikiFolder, clearWikiFolder, wikiFolderSummary, executeWikiFolderTool,
  wikiFolderSnapshot, stageWikiFolder, commitWikiFolder, discardWikiFolderStage, WIKI_FOLDER_LIMITS} from '../wiki-folder.js';

const notFound = () => new DOMException('gone', 'NotFoundError');
class FileHandle {
  kind = 'file'; reads = 0;
  constructor(name, text) {this.name = name; this.text = text;}
  async getFile() {this.reads++; return new Blob([this.text]);}
}
class Folder {
  kind = 'directory'; permission = 'granted'; permissionCalls = []; requestCalls = 0;
  constructor(name, entries = {}) {this.name = name; this.children = new Map(Object.entries(entries).map(([name, value]) => [name, typeof value === 'string' || value instanceof Uint8Array ? new FileHandle(name, value) : value]));}
  async queryPermission(options) {this.permissionCalls.push(options); return this.permission;}
  async requestPermission() {this.requestCalls++; throw new Error('Must only be called by a user gesture in the UI');}
  async getDirectoryHandle(name, options) {assert.equal(options, undefined); const value = this.children.get(name); if (value?.kind !== 'directory') throw notFound(); return value;}
  async getFileHandle(name, options) {assert.equal(options, undefined); const value = this.children.get(name); if (value?.kind !== 'file') throw notFound(); return value;}
  async *entries() {yield* this.children.entries();}
}
// Minimal transaction harness: commit only on completion, roll back on abort.
// Real structured cloning of native handles is covered by the Chrome suite.
function fakeIDB() {
  let committed = new Map(), failWrites = false;
  const clone = value => value && typeof value === 'object' && !(value instanceof Folder) && !(value instanceof FileHandle) ?
    (Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]))) : value;
  return {get failWrites() {return failWrites;}, set failWrites(value) {failWrites = value;}, values: () => [...committed.values()],
    open() {
      const request = {};
      const db = {objectStoreNames: {contains: () => true}, close() {}, transaction(_name, mode) {
        let working = new Map([...committed].map(([key, value]) => [key, clone(value)])), pending = 0, aborted = false, finished = false;
        const complete = () => setImmediate(() => {
          if (aborted || finished || pending) return;
          finished = true; if (mode === 'readwrite') committed = working; tx.oncomplete?.();
        });
        const issue = operation => {
          const result = {}; pending++;
          queueMicrotask(() => {
            if (aborted) return;
            try {result.result = operation(); result.onsuccess?.();}
            catch {tx.abort();}
            pending--; complete();
          }); return result;
        };
        const write = operation => {if (failWrites) throw new DOMException('Quota', 'QuotaExceededError'); return issue(operation);};
        const store = {get: key => issue(() => clone(working.get(key))), getAll: () => issue(() => [...working.values()].map(clone)),
          put: (value, key) => write(() => {working.set(key, clone(value));}), delete: key => write(() => {working.delete(key);}), clear: () => write(() => {working.clear();})};
        const tx = {objectStore: () => store, abort() {if (aborted || finished) return; aborted = true; queueMicrotask(() => tx.onabort?.());}};
        complete(); return tx;
      }};
      queueMicrotask(() => {request.result = db; request.onsuccess?.();}); return request;
    }};
}
function storage(t) {
  const old = globalThis.indexedDB, db = fakeIDB(); globalThis.indexedDB = db;
  t.after(() => {if (old === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = old;}); return db;
}
const wiki = (name = 'openwiki') => new Folder(name, {'quickstart.md': '---\ntitle: 저장 흐름\n---\n# 시작\n저장 버튼은 saveDraft를 사용합니다.\n',
  'architecture': new Folder('architecture', {'save.mdx': '# Save\nRead a page, then call saveDraft.\n'})});
const clientId = 'test-client-document-123';

test('load is empty without IndexedDB and never silently saves in an unsupported environment', async t => {
  const old = globalThis.indexedDB; delete globalThis.indexedDB; t.after(() => {if (old) globalThis.indexedDB = old;});
  assert.equal(await loadWikiFolder(), null); await clearWikiFolder();
  await assert.rejects(saveWikiFolder(wiki()), /project_storage/);
});

test('selected project narrows to openwiki, persists only a directory handle, and reads fresh provenance', async t => {
  storage(t); const selected = new Folder('예제 프로젝트', {openwiki: wiki(), 'outside.md': '# Must not read me'});
  const record = await saveWikiFolder(selected), restored = await loadWikiFolder();
  assert.equal(record.handle, selected.children.get('openwiki')); assert.equal(restored.handle, record.handle);
  const summary = await wikiFolderSummary(restored);
  assert.deepEqual(summary, {id: record.project.id, name: '예제 프로젝트', kind: 'folder', capabilities: ['wiki'], status: 'connected'});
  assert(!JSON.stringify(summary).includes('handle')); assert(!JSON.stringify(summary).includes('permissionCalls'));
  const result = await executeWikiFolderTool(record, 'wiki_search', {query: 'saveDraft'});
  assert.equal(result.projectId, record.project.id); assert.equal(result.results.length, 2);
  const natural = await executeWikiFolderTool(record, 'wiki_search', {query: '저장 동작은 어디서 처리하나요'});
  assert.equal(natural.results[0].id, 'quickstart.md');
  assert.equal(result.dataKind, 'project_reference'); assert(result.results.every(row => row.id === row.provenance.path));
  assert(!('graphGeneratedAt' in result)); assert.match(result.instruction, /Untrusted/);
  const read = await executeWikiFolderTool(record, 'wiki_read', {id: 'quickstart.md', start: 1, end: 200});
  assert.deepEqual({...read.provenance, hash: undefined}, {kind: 'wiki', path: 'quickstart.md', start: 1, end: 5, totalLines: 5, hash: undefined});
  assert.equal(read.provenance.hash, createHash('sha256').update(record.handle.children.get('quickstart.md').text).digest('hex'));
  record.handle.children.get('quickstart.md').text = '# Changed\nThe button now calls savePublished.\n';
  const changed = await executeWikiFolderTool(record, 'wiki_read', {id: 'quickstart.md'});
  assert.notEqual(changed.provenance.hash, read.provenance.hash); assert.match(changed.content, /savePublished/);
  await assert.rejects(executeWikiFolderTool(record, 'wiki_read', {id: 'outside.md'}), /project_not_found/);
  assert.equal(selected.requestCalls + record.handle.requestCalls, 0);
  assert(selected.permissionCalls.every(value => value.mode === 'read'));
  await clearWikiFolder(); assert.equal(await loadWikiFolder(), null);
});

test('folder retrieval combines section terms and code symbols and cites the matching passage rather than the first common word', async t => {
  storage(t);
  const selected = new Folder('openwiki', {
    'billing.md': '# 결제 알림\n설정을 설명합니다.\n',
    'shipping.md': '# 배송 알림\n' + '관계없는 배경 설명\n'.repeat(30) + '## 초안 저장\n배송 알림은 saveDraft로 보관합니다.\n전송은 별도 승인 후 실행합니다.\n',
  });
  const record = await saveWikiFolder(selected), result = await executeWikiFolderTool(record, 'wiki_search', {query: '배송 알림 saveDraft'});
  assert.equal(result.results[0].id, 'shipping.md'); assert.equal(result.results[0].match.coverage, 1);
  assert(result.results[0].excerpt.includes('saveDraft')); assert(result.results[0].provenance.start > 20);
  const {start, end} = result.results[0].provenance;
  assert.equal(result.results[0].excerpt, selected.children.get('shipping.md').text.split('\n').slice(start - 1, end).join('\n'));
  assert(result.results.some(row => row.id === 'billing.md'), 'partial alternatives remain candidates');
});

test('permission is queried without prompting and revoked handles block every read', async t => {
  storage(t); const selected = wiki(), record = await saveWikiFolder(selected); selected.permission = 'prompt';
  assert.equal((await wikiFolderSummary(record)).status, 'permission_required');
  await assert.rejects(executeWikiFolderTool(record, 'wiki_read', {id: 'quickstart.md'}), /wiki_folder_permission/);
  await assert.rejects(executeWikiFolderTool(record, 'wiki_search', {query: 'Save'}), /wiki_folder_permission/);
  await assert.rejects(saveWikiFolder(selected), /wiki_folder_permission/); assert.equal(selected.requestCalls, 0);
  selected.permission = 'granted'; assert.equal((await wikiFolderSummary(await loadWikiFolder())).status, 'connected');
});

test('only Markdown is read, hidden and sensitive names are excluded, traversal and unsupported tools fail', async t => {
  storage(t); const selected = wiki();
  selected.children.set('.hidden.md', new FileHandle('.hidden.md', 'secretneedle'));
  selected.children.set('credentials.md', new FileHandle('credentials.md', 'secretneedle'));
  selected.children.set('app.js', new FileHandle('app.js', 'secretneedle'));
  selected.children.set('node_modules', new Folder('node_modules', {'README.md': 'secretneedle'}));
  const record = await saveWikiFolder(selected);
  assert.deepEqual((await executeWikiFolderTool(record, 'wiki_search', {query: 'secretneedle'})).results, []);
  for (const id of ['../outside.md', '/outside.md', 'architecture/../quickstart.md', 'architecture\\save.mdx', '.hidden.md', 'credentials.md', 'app.js', 'node_modules/README.md']) {
    await assert.rejects(executeWikiFolderTool(record, 'wiki_read', {id}), /project_scope/);
  }
  assert.equal(selected.children.get('app.js').reads, 0);
  for (const tool of ['read_source', 'source_search', 'execute_script']) await assert.rejects(executeWikiFolderTool(record, tool, {}), /tools_unavailable/);
  await assert.rejects(executeWikiFolderTool(record, 'wiki_read', {id: 'quickstart.md', path: '/secret'}), /project_arguments/);
  await assert.rejects(executeWikiFolderTool(record, 'wiki_search', {query: '', limit: 1}), /project_arguments/);
  await assert.rejects(executeWikiFolderTool(record, 'wiki_search', {query: 'x', limit: 6}), /project_arguments/);
});

test('empty or unsafe selections preserve the existing configured folder', async t => {
  storage(t); const previous = await saveWikiFolder(wiki());
  for (const selected of [new Folder('empty'), new Folder('only-code', {'index.js': 'source'}), new Folder('blank', {'empty.md': '   \n'})]) {
    await assert.rejects(saveWikiFolder(selected), /wiki_folder_empty/);
    assert.equal((await loadWikiFolder()).connectionId, previous.connectionId);
  }
  const large = new Folder('huge', {'large.md': 'x'.repeat(4000001)});
  await assert.rejects(saveWikiFolder(large), /wiki_folder_scan_limit/);
  assert.equal((await loadWikiFolder()).connectionId, previous.connectionId);
});

test('line ranges and output sizes report actual progress without slicing a line', async t => {
  storage(t); const selected = new Folder('openwiki', {'long.md': Array.from({length: 500}, (_, i) => `Line ${i+1}`).join('\n'),
    'wide.md': Array.from({length: 100}, () => 'x'.repeat(300)).join('\n'), 'single.md': 'x'.repeat(16001), 'binary.md': new Uint8Array([0, 1, 2])});
  const record = await saveWikiFolder(selected);
  const first = await executeWikiFolderTool(record, 'wiki_read', {id: 'long.md'});
  assert.equal(first.provenance.end, 200); assert.equal(first.nextStart, 201); assert(first.truncated);
  const last = await executeWikiFolderTool(record, 'wiki_read', {id: 'long.md', start: 401, end: 600});
  assert.equal(last.provenance.end, 500); assert(!last.truncated); assert(!('nextStart' in last));
  const wide = await executeWikiFolderTool(record, 'wiki_read', {id: 'wide.md'});
  assert.equal(wide.provenance.end, 53); assert.equal(wide.nextStart, 54); assert(wide.content.length <= 16000);
  for (const args of [{id:'long.md',start:0}, {id:'long.md',start:2,end:1}, {id:'long.md',start:501}, {id:'long.md',end:201}, {id:'single.md'}, {id:'binary.md'}])
    await assert.rejects(executeWikiFolderTool(record, 'wiki_read', args), /project_arguments/);
  const matches = await executeWikiFolderTool(record, 'wiki_search', {query:'absent'}); assert(matches.truncated);
});

test('search limits are explicit and ranking keeps title matches instead of first directory entries', async t => {
  storage(t); const selected = new Folder('openwiki', Object.fromEntries(Array.from({length: 8}, (_, i) => [`${i}.md`, `# Page ${i}\nneedle\n`])));
  selected.children.set('needle.md', new FileHandle('needle.md', '# needle\nimportant'));
  const record = await saveWikiFolder(selected), result = await executeWikiFolderTool(record, 'wiki_search', {query:'needle',limit:2});
  assert.equal(result.results.length, 2); assert.equal(result.results[0].id, 'needle.md'); assert(result.truncated);
  const many = new Folder('openwiki', Object.fromEntries(Array.from({length:WIKI_FOLDER_LIMITS.files+2}, (_, i) => [`${i}.md`, '# docs'])));
  const manyRecord = await saveWikiFolder(many);
  assert((await executeWikiFolderTool(manyRecord,'wiki_search',{query:'missing'})).truncated);
});

test('staging does not activate; commit checks owner and expiry, consumes once, and failed writes roll back', async t => {
  const db = storage(t), initial = await saveWikiFolder(wiki('first'));
  const {stageId} = await stageWikiFolder(wiki('second'), {clientId});
  assert.equal((await loadWikiFolder()).connectionId, initial.connectionId);
  await assert.rejects(commitWikiFolder(stageId,{clientId:'different-document'}), /project_scope/);
  db.failWrites = true; await assert.rejects(commitWikiFolder(stageId,{clientId}), /project_storage/); db.failWrites = false;
  assert.equal((await loadWikiFolder()).connectionId, initial.connectionId);
  const connected = await commitWikiFolder(stageId,{clientId}); assert.equal(connected.project.name,'second');
  assert.equal((await loadWikiFolder()).connectionId, connected.connectionId);
  await assert.rejects(commitWikiFolder(stageId,{clientId}), /project_scope/);
  const pending = await stageWikiFolder(wiki(),{clientId});
  const revoked = wiki(), revokedStage = await stageWikiFolder(revoked,{clientId}); revoked.permission = 'denied';
  await assert.rejects(commitWikiFolder(revokedStage.stageId,{clientId}), /wiki_folder_permission/);
  assert.equal((await loadWikiFolder()).connectionId, connected.connectionId);
  const realNow = Date.now; Date.now = () => realNow() + 5*60*1000;
  try {await assert.rejects(commitWikiFolder(pending.stageId,{clientId}), /project_scope/);} finally {Date.now = realNow;}
  assert.equal((await loadWikiFolder()).connectionId, connected.connectionId);
});

test('pending stages are bounded and disconnect also invalidates pending selections', async t => {
  const db = storage(t); const first = await stageWikiFolder(wiki(),{clientId});
  for(let i=0;i<8;i++) await stageWikiFolder(wiki(),{clientId});
  assert.equal(db.values().filter(value=>value.recordType==='stage').length,8);
  await assert.rejects(commitWikiFolder(first.stageId,{clientId}), /project_scope/);
  const pending = await stageWikiFolder(wiki(),{clientId});
  await assert.rejects(discardWikiFolderStage(pending.stageId,{clientId:'another-document'}), /project_scope/);
  await discardWikiFolderStage(pending.stageId,{clientId});
  await assert.rejects(commitWikiFolder(pending.stageId,{clientId}), /project_scope/);
  const last = await stageWikiFolder(wiki(),{clientId}); await clearWikiFolder();
  await assert.rejects(commitWikiFolder(last.stageId,{clientId}), /project_scope/);
});


test('agent snapshots accept long documents at registration and recheck permission and content', async t => {
  storage(t); const folder=new Folder('openwiki',{'large.md':'x'.repeat(600000)+'TAIL'});
  const record=await saveWikiFolder(folder), first=await wikiFolderSnapshot(record);
  assert.equal(first.documents[0].text.length,600004); assert.equal(first.sourceComplete,true);
  folder.children.get('large.md').text='changed';
  assert.equal((await wikiFolderSnapshot(record)).documents[0].text,'changed');
  folder.children.set('huge.md',new FileHandle('huge.md','x'.repeat(4000001)));
  assert.equal((await wikiFolderSnapshot(record)).sourceComplete,false);
  folder.permission='denied'; await assert.rejects(wikiFolderSnapshot(record),/wiki_folder_permission/);
});

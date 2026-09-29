import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWikiSnapshot, projectOrigin, projectTools, projectSummary, projectContext, pairedProject, projectRequest, readProjectTool} from '../project-tools.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {createHarness} from '../agent-harness.js';
import {promptPreamble} from '../chat-contract.js';

const origin = 'http://127.0.0.1:43219';
const paired = () => pairedProject(origin, {protocol: 1, token: 'private-pair-token-that-stays-in-worker',
  expiresAt: new Date(Date.now() + 3600000).toISOString(), project: {id: 'project-a', name: '예제 앱'}, capabilities: ['wiki', 'source']});
const response = (extra = {}) => ({projectId: 'project-a', path: 'src/save.js', content: 'export function save() {}',
  provenance: {kind: 'source', path: 'src/save.js', hash: 'a'.repeat(64), start: 1, end: 1, totalLines: 1}, truncated: false, ...extra});

test('library retrieval is negotiated, carries only bounded evidence and does not fall back after an invalid response', async () => {
  const connection = {...paired(), features: ['wiki_query']};
  assert(projectTools(projectSummary(connection)).some(tool => tool.function.name === 'wiki_query'));
  assert(!projectTools(projectSummary(paired())).some(tool => tool.function.name === 'wiki_query'));
  const packet = {projectId: 'project-a', results: [{id: 'save', title: 'Save', excerpt: 'saveDraft checks the draft.', provenance: {...response().provenance, kind: 'wiki', path: 'save.md'}}],
    coverage: {scannedDocuments: 1, indexedDocuments: 1, complete: true}, retrieval: {method: 'structural-bm25'}, token: 'private-extra'};
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(new URL(url).pathname, '/api/nubi/v1/wiki/query');
    assert.deepEqual(JSON.parse(options.body), {question: 'How does saveDraft work?', limit: 5});
    return Response.json(packet);
  };
  const result = await readProjectTool(connection, 'wiki_query', {question: 'How does saveDraft work?'}, {fetchImpl});
  assert.equal(calls, 1); assert.equal(result.retrieval.generatedAnswer, false); assert(!JSON.stringify(result).includes('private-extra'));
  assert.equal(projectContext(projectSummary(connection)).features[0], 'wiki_query');
  await assert.rejects(readProjectTool(connection, 'wiki_query', {question: 'How does saveDraft work?'}, {fetchImpl: async () => Response.json({...packet, results: [{...packet.results[0], provenance: {...packet.results[0].provenance, path: '../secret'}}]})}), /project_invalid/);
});

test('saved folders advertise Wiki only and preserve permission recovery context without handles', () => {
  const folder = {id: 'local-wiki', name: '상품 안내', kind: 'folder', status: 'connected', capabilities: ['wiki'], handle: 'private-handle'};
  assert.deepEqual(projectTools(folder).map(tool => tool.function.name), ['wiki_search', 'wiki_read']);
  const ready = projectContext(folder);
  assert.equal(ready.kind, 'folder'); assert(!('handle' in ready));
  const denied = {...folder, status: 'permission_required'};
  assert.deepEqual(projectTools(denied), []);
  assert.deepEqual(projectContext(denied).capabilities, []);
  const messages = promptPreamble('test', undefined, {project: projectContext(denied)});
  assert.match(messages[1].content, /permission_required/);
  assert(!JSON.stringify(messages).includes('private-handle'));
  assert.match(messages[0].content, /apply the draft to the observed fields and verify_page/);
});

test('loopback target accepts explicit origins and rejects credentials, remote hosts and aliases', () => {
  for (const url of [origin, 'http://localhost:3000/']) assert.equal(projectOrigin(url), url.replace(/\/$/, ''));
  for (const url of ['http://[::1]:8787', 'https://localhost:3000', 'http://127.1:43219', 'http://2130706433:43219', 'http://localhost.evil:43219',
    'http://localhost:43219/auth', 'http://user:pw@localhost:43219', `${origin}/?secret=x`, `${origin}/#code`, 'file:///tmp/code']) {
    assert.throws(() => projectOrigin(url), /project_address/);
  }
});

test('project tools and their schemas work without a page and respect connection capabilities', () => {
  const connection = paired(), project = projectSummary(connection);
  const tools = browserTools(null, {}, '', {project});
  assert.deepEqual(tools.map(tool => tool.function.name), ['ask_user', 'wiki_search', 'wiki_read', 'source_search', 'read_source']);
  assert.deepEqual(projectTools({...project, capabilities: ['wiki']}).map(tool => tool.function.name), ['wiki_search', 'wiki_read']);
  assert.deepEqual(projectTools({...project, status: 'expired'}), []);
  assert.deepEqual(projectTools(null), []);
  const h = createHarness(browserTools(null, BUILTIN_SKILLS[0], '', {autoConnect: true, project}));
  assert(!h.advertised().some(tool => tool.function.name === 'read_source'));
  h.select({groups: ['project']});
  assert(h.advertised().some(tool => tool.function.name === 'read_source'));
  h.observe('read_source', response()); assert.equal(h.needsCheck(), false);
  const summary = JSON.stringify(project), context = JSON.stringify(projectContext(project));
  assert(!summary.includes(connection.token)); assert(!context.includes(origin));
  const messages = JSON.stringify(promptPreamble('test', undefined, {project: {...project, token: connection.token}}));
  assert(!messages.includes(connection.token)); assert(!messages.includes(origin));
});

test('read_source sends only project token to fixed endpoint and strips untrusted response fields', async () => {
  const connection = paired();
  const result = await readProjectTool(connection, 'read_source', {path: 'src/save.js', start: 1, end: 10}, {fetchImpl: async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/nubi/v1/source');
    assert.equal(new URL(url).searchParams.get('path'), 'src/save.js');
    assert.equal(options.headers.Authorization, `Bearer ${connection.token}`);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return Response.json(response({token: 'server-extra-secret', fullPath: '/private/repo/src/save.js'}));
  }});
  assert.equal(result.content, 'export function save() {}'); assert.equal(result.provenance.start, 1);
  assert(!JSON.stringify(result).includes('server-extra-secret')); assert(!JSON.stringify(result).includes('/private'));
});

test('scope mismatch, malformed provenance and oversized payloads are never model evidence', async () => {
  const connection = paired();
  for (const value of [response({projectId: 'another-project'}), response({provenance: {...response().provenance, path: '../outside.js'}}),
    response({provenance: {...response().provenance, end: 220, totalLines: 220}}), response({content: 'x'.repeat(18001)})]) {
    await assert.rejects(readProjectTool(connection, 'read_source', {path: 'src/save.js'}, {fetchImpl: async () => Response.json(value)}), /project_(scope|invalid)/);
  }
  await assert.rejects(projectRequest(origin, 'info', {fetchImpl: async () => Response.json({data: 'x'.repeat(160001)})}), /project_invalid/);
  await assert.rejects(projectRequest(origin, 'info', {fetchImpl: async () => new Response('<html>old server</html>')}), /project_invalid/);
});

test('expired, revoked and invalid-range reads fail without retries or page fallback', async () => {
  const expired = {...paired(), expiresAt: new Date(1).toISOString()}; let calls = 0;
  await assert.rejects(readProjectTool(expired, 'read_source', {path: 'src/save.js'}, {fetchImpl: () => {calls++;}}), /project_expired/);
  await assert.rejects(readProjectTool(paired(), 'read_source', {path: 'src/save.js', start: 0}, {fetchImpl: () => {calls++;}}), /project_arguments/);
  await assert.rejects(readProjectTool(paired(), 'source_search', {query: 'save', limit: 1.5}, {fetchImpl: () => {calls++;}}), /project_arguments/);
  assert.equal(calls, 0);
  await assert.rejects(readProjectTool(paired(), 'read_source', {path: 'src/save.js'}, {fetchImpl: async () => {calls++; return Response.json({error: {code: 'connection_expired'}}, {status: 401});}}), /project_expired/);
  assert.equal(calls, 1);
});

test('HTTP authority errors survive non-JSON bodies and cancel an unread stream', async () => {
  for (const [status, code] of [[401,'project_expired'],[403,'project_scope']]) {
    let calls=0,cancelled=false;
    const body=new ReadableStream({cancel(){cancelled=true;}});
    await assert.rejects(projectRequest(origin,'wiki/snapshot',{fetchImpl:async()=>{
      calls++;return new Response(body,{status,headers:{'content-type':'text/html'}});
    }}),new RegExp(code));
    assert.equal(calls,1);assert(cancelled,'Do not wait for or retain an unauthorized body');
  }
});

test('project cancellation is preserved before dispatch and after a late response', async () => {
  const early=new AbortController();early.abort();let calls=0;
  await assert.rejects(projectRequest(origin,'info',{signal:early.signal,fetchImpl:async()=>{calls++;return Response.json({});}}),/cancelled/);
  assert.equal(calls,0);
  const late=new AbortController();
  await assert.rejects(projectRequest(origin,'info',{signal:late.signal,fetchImpl:async()=>{calls++;late.abort();return Response.json({});}}),/cancelled/);
  assert.equal(calls,1);
});


test('agent snapshots require a negotiated feature and enforce project and document identity',async()=>{
  let calls=0;
  await assert.rejects(projectWikiSnapshot(paired(),{fetchImpl:async()=>{calls++;}}),/openwiki_upgrade_required/);
  assert.equal(calls,0);
  const connection={...paired(),features:['wiki_snapshot']};
  const packet={projectId:'project-a',sourceComplete:true,documents:[{id:'policy',title:'Policy',path:'policy.md',kind:'wiki',text:'policy'}]};
  const result=await projectWikiSnapshot(connection,{fetchImpl:async(url,options)=>{
    assert.equal(new URL(url).pathname,'/api/nubi/v1/wiki/snapshot'); assert.equal(options.headers.Authorization,`Bearer ${connection.token}`);
    return Response.json(packet);
  }});
  assert.equal(result.wikiId,`external:${connection.connectionId}`); assert.deepEqual(result.documents,packet.documents);
  for(const invalid of [{...packet,projectId:'another-project'}, {...packet,documents:[...packet.documents,...packet.documents]}])
    await assert.rejects(projectWikiSnapshot(connection,{fetchImpl:async()=>Response.json(invalid)}),/project_invalid/);
});

import {normalizeFabrixModels} from '../fabrix.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loginRedirectRule} from '../login-redirect.js';
import {connection as fabrixConnection, models as fabrixModelList} from './fixtures/fabrix.mjs';

const ORIGIN = 'https://aipro.sdsdev.co.kr';
let instance = 0;

function chromeEvent() {
  const listeners = [];
  return {
    addListener(listener) {listeners.push(listener);},
    removeListener(listener) {const i=listeners.indexOf(listener);if(i>=0)listeners.splice(i,1);},
    count() {return listeners.length;},
    emit(...args) {for (const listener of listeners) listener(...args);},
  };
}

async function background(t, {failure, session = {}, initialAlarms = {}, initialRules = [], commandResults = {}, browserRun, wikiFolderModule, attachmentModule, journalModule, fetchImpl = async () => { throw new Error('Unexpected exchange request'); }} = {}) {
  const calls = [], alarms = new Map(Object.entries(initialAlarms)), tabs = new Map([[11, {id: 11, active: true}]]);
  for (const id of [session.attempt?.tabId, session.guardTab, session.receiverTab]) {
    if (Number.isInteger(id)) tabs.set(id, {id});
  }
  let nextTabId = 20;
  let rules = structuredClone(initialRules);
  const area = (name, initial = {}) => ({
    data: structuredClone(initial),
    async setAccessLevel() {},
    async get(keys) {
      if (keys == null) return structuredClone(this.data);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(this.data[key])]));
    },
    async set(values) {
      calls.push({name: `${name}.set`, keys: Object.keys(values)});
      Object.assign(this.data, structuredClone(values));
    },
    async remove(keys) {for (const key of Array.isArray(keys) ? keys : [keys]) delete this.data[key];},
  });
  const chrome = {
    action: {async setBadgeText() {}},
    permissions: {onAdded:chromeEvent(),onRemoved:chromeEvent(),async contains() {return true;}},
    declarativeNetRequest: {
      async getSessionRules() {return structuredClone(rules);},
      async updateSessionRules({removeRuleIds = [], addRules = []}) {
        calls.push({name: 'redirect.rules', removeRuleIds, addRules});
        if (failure === 'redirect' && addRules.length) throw new Error('Synthetic policy restriction');
        rules = [...rules.filter(rule => !removeRuleIds.includes(rule.id)), ...structuredClone(addRules)];
      },
    },
    // These fixtures exercise the existing current-tab workflow. Dedicated
    // windows have separate real-Chrome coverage in workspace-browser.
    storage: {onChanged:chromeEvent(), managed:area('managed'),local: area('local', {browserWorkMode:'current'}), session: area('session', session)},
    sidePanel: {async setPanelBehavior() {}},
    runtime: {
      id: 'synthetic', getURL: path => `chrome-extension://synthetic/${path}`,
      onMessage: chromeEvent(), async getContexts() {return [];},
    },
    alarms: {
      onAlarm: chromeEvent(),
      async clear(name) {return alarms.delete(name);},
      async create(name, info) {alarms.set(name, structuredClone(info));},
    },
    tabs: {
      onRemoved: chromeEvent(), onUpdated:chromeEvent(),
      async query() {return [{id: 11, active: true}];},
      async create(properties) {
        const tab = {id: nextTabId++, ...properties};
        tabs.set(tab.id, tab); calls.push({name: 'tabs.create', ...tab});
        return structuredClone(tab);
      },
      async update(id, properties) {
        calls.push({name: 'tabs.update', id, ...properties});
        const tab = {...tabs.get(id), id, ...properties}; tabs.set(id, tab);
        return structuredClone(tab);
      },
      async get(id) {if (!tabs.has(id)) throw new Error('No tab'); return structuredClone(tabs.get(id));},
      async remove(id) {
        calls.push({name: 'tabs.remove', id});
        if (tabs.delete(id)) chrome.tabs.onRemoved.emit(id);
      },
    },
    debugger: {
      onEvent: chromeEvent(), onDetach: chromeEvent(),
      async attach(target, version) {
        calls.push({name: 'debugger.attach', target, version});
        if (failure === 'attach') throw new Error('Host access is restricted by policy.');
      },
      async detach(target) {
        calls.push({name: 'debugger.detach', target});
        chrome.debugger.onDetach.emit(target, 'canceled_by_user');
      },
      async sendCommand(target, method, params) {
        calls.push({name: method, target, params: structuredClone(params)});
        if (failure === method) throw new Error('Synthetic command failure');
        return structuredClone(commandResults[method] || {});
      },
    },
  };
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.chrome = chrome;
  t.after(() => {if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome;});
  let source = await readFile(new URL('../public/background.js', import.meta.url), 'utf8');
  if (journalModule) {
    const key = `__journalModule${++instance}`;
    globalThis[key] = journalModule;
    t.after(() => {delete globalThis[key];});
    source = source.replace("import {traceJournal} from './trace-journal.js';", `const traceJournal = globalThis[${JSON.stringify(key)}];`);
  }
  if (attachmentModule) {
    const key = `__attachmentModule${++instance}`;
    globalThis[key] = attachmentModule;
    t.after(() => {delete globalThis[key];});
    source = source.replace(/import \{([^\n]+)\} from '\.\/attachment-store\.js';/, (_, names) => `const {${names}} = globalThis[${JSON.stringify(key)}];`);
  }
  if (wikiFolderModule) {
    const key = `__wikiFolderModule${++instance}`;
    globalThis[key] = wikiFolderModule;
    t.after(() => {delete globalThis[key];});
    source = source.replace(/import \{([^\n]+)\} from '\.\/wiki-folder\.js';/, (_, names) => `const {${names}} = globalThis[${JSON.stringify(key)}];`);
  }

  source = source.replace(/import \{[^\n]+\} from '\.\/browser-agent\.js';/, "const runApprovedAction = async () => {}; const stopBrowserAgent = async () => {}; const browserAgentRequestForTab = () => null; const browserAgentContext = () => null; const browserAgentObservation = () => null; const resolveBrowserTab = async (context, tabId = context?.tabId) => tabId; const runBrowserAgent = async () => {throw new Error('Unexpected automation call');};");
  if (browserRun) {
    const key = `__browserRun${++instance}`; globalThis[key] = browserRun;
    t.after(() => {delete globalThis[key];});
    source = source.replace("const runBrowserAgent = async () => {throw new Error('Unexpected automation call');};", `const runBrowserAgent = globalThis[${JSON.stringify(key)}];`);
  }
  for (const file of ['browser-policy.js','browser-transfers.js','browser-routines.js','native-dialog-request.js','restart-reconciliation.js','uncertain-action.js','agent-harness.js','openwiki-contract.js','plan-mode.js','browser-knowledge.js','skill-creator.js','skill-command.js','read-deadline.js','form-workflow.js','computer-time.js','agent-inbox.js','voc-workspace.js','voc-tools.js','voc-page.js','mcp-client.js', 'document-tools.js', 'background-runner.js', 'background-images.js', 'skill-library.js', 'skill-stats.js', 'browser-workspace.js', 'model-routing.js', 'attachments.js', 'attachment-store.js', 'wiki-folder.js', 'project-tools.js', 'project-connection.js', 'browser-approval.js', 'user-question.js', 'conversations.js', 'provider-sessions.js', 'agent-trace.js', 'trace-journal.js', 'agent-diagnostic-journal.js', 'core.js', 'usage.js', 'chat-contract.js', 'skills.js', 'page-tools.js', 'callback.js', 'auth-trace.js', 'login-redirect.js', 'exchange.js', 'chatgpt-auth.js', 'usage-ledger.js', 'account-usage.js', 'context-state.js','analysis-checkpoint.js','analysis-handoff.js','research-handoff.js', 'task-plan.js', 'fabrix.js', 'capture-store.js']) {
    source = source.replace(`'./${file}'`, JSON.stringify(new URL(`../${file}`, import.meta.url).href));
  }
  source += `\n// Isolated background instance ${++instance}\n`;
  source = source.replace("'./completion-errors.js'", JSON.stringify(new URL('../completion-errors.js', import.meta.url).href));
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const sender = {id: chrome.runtime.id, url: chrome.runtime.getURL('index.html'), tab: {id: 11}};
  const rpc = (message, from = sender) => new Promise(resolve => chrome.runtime.onMessage.emit(message, from, resolve));
  const flush = async () => {await rpc({type: 'GET_STATE'}); await rpc({type: 'GET_STATE'});};
  await flush();
  return {
    chrome, calls, alarms, tabs, rpc, flush,
    async start(provider = 'aipro') {
      const result = await rpc({type: 'START_LOGIN', provider});
      assert.equal(result.ok, true, result.error);
      return structuredClone(chrome.storage.session.data.attempt);
    },
    async callback(attempt, query = new URLSearchParams({jwt: jwt()}).toString(), from = {}, message = {}) {
      return rpc({type: 'AIPRO_LOGIN_CALLBACK', nonce: attempt.id, query, ...message}, {
        id: chrome.runtime.id, url: chrome.runtime.getURL('auth-return.html'), frameId: 0, tab: {id: attempt.tabId}, ...from,
      });
    },

  };
}

function jwt() {
  return `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600, sub: 'synthetic'})).toString('base64url')}.signature`;
}

test('journal reads require a trusted view and exact conversation, provider and assistant message', async t => {
  const reads = [], prunes = [];
  const h = await background(t, {journalModule:{
    async page(owner) {reads.push(owner); return {events:[],available:true,retained:0};},
    async prune(owners) {prunes.push(owners);},
  }});
  const chat = h.chrome.storage.local.data.chat;
  chat.messages = [{id:'user-one',role:'user',content:'hello'}, {id:'reply-one',role:'assistant',state:'done',content:'done',traceJournal:{available:true,incomplete:true}}];
  const request = {type:'GET_TRACE_JOURNAL',provider:chat.provider,conversationId:chat.sessionId,requestId:'reply-one'};
  const accepted = await h.rpc(request);
  assert.equal(accepted.ok,true);assert.equal(accepted.data.incomplete,true);assert.equal(accepted.data.priorRecord,true);
  for (const patch of [{provider:'chatgpt'},{conversationId:'other'},{requestId:'user-one'},{requestId:'other'}]) assert.equal((await h.rpc({...request,...patch})).error,'conversation_changed');
  assert.equal((await h.rpc(request,{id:'synthetic',url:'https://untrusted.example/',tab:{id:11}})).error,'invalid_sender');
  assert.equal(reads.length,1);
  assert.equal((await h.rpc({type:'CLEAR_CHAT',conversationId:chat.sessionId})).ok,true);
  assert.equal((await h.rpc(request)).error,'conversation_changed');
  assert(prunes.length > 0);assert(!prunes.at(-1).some(owner=>owner.requestId==='reply-one'));
});

test('attachment commits preserve draft on quota failure and enforce conversation ownership', async t => {
  const stored = new Map(); let seq = 0;
  const h = await background(t, {attachmentModule: {
    async saveAttachments(files, owner) {return files.map(file => {const record = {id: `file-${++seq}`, name: file.name, kind: 'text', bytes: 12}; stored.set(record.id, {...record, ...owner}); return record;});},
    async readAttachment(id, owner) {const record = stored.get(id); if (!record || record.provider !== owner.provider || record.conversationId !== owner.conversationId) throw new Error('attachment_missing'); return record;},
    async deleteAttachments(ids) {ids.forEach(id => stored.delete(id));}, async pruneAttachments() {},
  }});
  const chat = h.chrome.storage.local.data.chat;
  const message = {type: 'ATTACH_FILES', conversationId: chat.sessionId, provider: 'aipro', files: [{name: 'notes.txt'}]};
  assert.equal((await h.rpc({...message, conversationId: 'different'})).error, 'conversation_changed');
  assert.equal(stored.size, 0);
  assert.equal((await h.rpc(message)).ok, true);
  const saved = structuredClone(h.chrome.storage.local.data.chat);
  const original = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async () => {throw new Error('quota');};
  assert.equal((await h.rpc(message)).ok, false);
  assert.equal(stored.size, 1); assert.deepEqual(h.chrome.storage.local.data.chat, saved);
  h.chrome.storage.local.set = original;
  assert.equal((await h.rpc({type: 'REMOVE_ATTACHMENT', conversationId: chat.sessionId, provider: 'aipro', id: saved.draftAttachments[0].id})).ok, true);
  assert.equal(stored.size, 0); assert.deepEqual(h.chrome.storage.local.data.chat.draftAttachments, []);
});

test('unsupported image sends keep text and attachments in the draft without starting a request', async t => {
  const h = await background(t, {session: {credential: {provider: 'aipro', token: jwt(), receivedAt: 7}}});
  h.chrome.storage.local.data.settings = {modelId: 'GLM-5.2-NVFP4'};
  const chat = h.chrome.storage.local.data.chat;
  chat.draft = 'reference image'; chat.draftAttachments = [{id: 'picture', name: 'reference.png', kind: 'image'}];
  const result = await h.rpc({type: 'START_CHAT', text: chat.draft, conversationId: chat.sessionId});
  assert.equal(result.error, 'attachment_vision');
  assert.equal(h.chrome.storage.local.data.chat.draft, 'reference image');
  assert.equal(h.chrome.storage.local.data.chat.draftAttachments.length, 1);
  assert.equal(h.chrome.storage.local.data.chat.messages.length, 0);
  assert.equal(h.chrome.storage.session.data.chatLease, undefined);
});

test('AI Pro login never invokes the debugger even when debugger access is denied', async t => {
  const h = await background(t, {failure: 'attach'});
  const attempt = await h.start();
  assert.equal((await h.callback(attempt)).ok, true);
  assert(h.chrome.storage.session.data.credential);
  assert(!h.calls.some(call => call.name.startsWith('debugger.') || call.name.startsWith('Network.') || call.name.startsWith('Fetch.')));
  assert.equal(h.chrome.storage.session.data.authTrace, undefined);
});

test('FabriX discovers and connects with session-only secrets, isolated chats and no inference usage', async t => {
  let requests = 0;
  const h = await background(t, {fetchImpl: async (_, opts) => {requests++; assert.equal(opts.method, 'GET'); return Response.json(fabrixModelList);}});
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  await h.chrome.storage.local.set({chat: {messages: [{role: 'user', content: 'AI Pro private chat'}], draft: 'AI Pro draft'}});
  assert.equal((await h.rpc({type: 'CONNECT_FABRIX', testId: 'untested', clientId: 'owner'})).error, 'fabrix_test_expired');
  const tested = await h.rpc({type: 'TEST_FABRIX', testId: 'test-fabrix-1', connection: fabrixConnection, clientId: 'owner'});
  assert.equal(tested.ok, true, tested.error); assert.equal(requests, 1);
  assert.equal((await h.rpc({type: 'GET_STATE'})).data.auth.provider, 'aipro');
  assert.equal((await h.rpc({type: 'CONNECT_FABRIX', testId: tested.data.testId, clientId: 'other'})).error, 'fabrix_test_expired');
  const connected = await h.rpc({type: 'CONNECT_FABRIX', testId: tested.data.testId, clientId: 'owner', connection: {...fabrixConnection, endpoint: 'https://evil.example.test'}});
  assert.equal(connected.ok, true, connected.error); assert.equal(connected.data.auth.provider, 'fabrix');
  assert.equal(connected.data.chat.messages.length, 0); assert.equal(connected.data.usage.total.fabrix.calls, 0); assert.equal(connected.data.usage.total.fabrix.total, 0);
  assert.equal(h.chrome.storage.session.data.fabrixTest, undefined);
  assert(h.chrome.storage.session.data.credential.endpoint.startsWith(fabrixConnection.endpoint));
  assert.equal(h.chrome.storage.session.data.credential.token, fabrixConnection.token);
  for (const value of [connected.data, h.chrome.storage.local.data]) for (const key of [fabrixConnection.token, fabrixConnection.clientKey]) assert(!JSON.stringify(value).includes(key));
  const chat = await h.rpc({type: 'START_CHAT', text: 'inspect', clientId: 'owner'});
  assert.equal(chat.data.provider, 'fabrix'); assert(chat.data.tools.some(tool => tool.function.name === 'run_playwright'));
  assert(!chat.data.tools.some(tool => tool.function.name === 'capture_page')); assert.equal(h.chrome.storage.session.data.chatLease.vision, false);
  await h.rpc({type: 'FINISH_CHAT', requestId: chat.data.requestId, content: 'done', clientId: 'owner'});
  await h.rpc({type: 'LOGOUT'}); await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  assert.equal((await h.rpc({type: 'GET_STATE'})).data.chat.draft, 'AI Pro draft');
});

test('FabriX registration needs a usable catalog and refresh preserves or replaces the selected ID', async t => {
  let payload = [];
  const h = await background(t, {fetchImpl: async () => Response.json(payload)});
  const connection = {endpoint: fabrixConnection.endpoint, clientKey: fabrixConnection.clientKey, token: fabrixConnection.token};
  const message = {type: 'TEST_FABRIX', testId: 'test-discovery-1', clientId: 'owner', connection};
  assert.equal((await h.rpc(message)).error, 'models_empty');
  assert.equal(h.chrome.storage.session.data.fabrixTest, undefined);
  payload = {unknown: fabrixModelList};
  assert.equal((await h.rpc(message)).error, 'models_invalid');
  payload = fabrixModelList;
  assert.equal((await h.rpc(message)).ok, true);
  const connected = await h.rpc({type: 'CONNECT_FABRIX', testId: message.testId, clientId: 'owner'});
  assert.equal(connected.ok, true); assert.equal(connected.data.catalog.models[0].displayName, '테스트 모델');
  assert.equal(h.chrome.storage.session.data.credential.modelId, undefined);
  assert.deepEqual(Object.keys(h.chrome.storage.local.data.fabrixConnection), ['endpoint']);
  await h.rpc({type: 'SELECT_MODEL', name: fabrixModelList[1].modelId});
  const refresh = models => h.rpc({type: 'SAVE_MODELS', credentialReceivedAt: connected.data.auth.receivedAt, payload: normalizeFabrixModels(models), status: 200});
  assert.equal((await refresh(fabrixModelList)).data.settings.modelId, fabrixModelList[1].modelId);
  const removed = await refresh(fabrixModelList.slice(0, 1));
  assert.equal(removed.data.settings.modelId, fabrixModelList[0].modelId);
  assert.equal(removed.data.events.at(-1).event, 'models_received');
});

test('FabriX refuses foreign callers and ungranted hosts, invalidates cancelled and expired tests', async t => {
  let requests = 0;
  const h = await background(t, {fetchImpl: async (_, opts) => {requests++; return Response.json(fabrixModelList);}});
  const testMessage = {type: 'TEST_FABRIX', testId: 'test-fabrix-2', connection: fabrixConnection, clientId: 'owner'};
  assert.equal((await h.rpc(testMessage, {id: 'attacker', url: 'https://page.test'})).error, 'invalid_sender');
  h.chrome.permissions.contains = async () => false;
  assert.equal((await h.rpc(testMessage)).error, 'page_permission'); assert.equal(requests, 0);
  h.chrome.permissions.contains = async () => true;
  await h.rpc(testMessage);
  await h.rpc({type: 'CANCEL_FABRIX_TEST', testId: testMessage.testId, clientId: 'other'});
  assert(h.chrome.storage.session.data.fabrixTest);
  await h.rpc({type: 'CANCEL_FABRIX_TEST', testId: testMessage.testId, clientId: 'owner'});
  assert.equal((await h.rpc({type: 'CONNECT_FABRIX', testId: testMessage.testId, clientId: 'owner'})).error, 'fabrix_test_expired');
  await h.rpc({...testMessage, testId: 'test-fabrix-3'});
  h.chrome.storage.session.data.fabrixTest.expiresAt = 0;
  assert.equal((await h.rpc({type: 'CONNECT_FABRIX', testId: 'test-fabrix-3', clientId: 'owner'})).error, 'fabrix_test_expired');
});

test('cancel and logout abort pending FabriX calls without restoring a late successful connection', async t => {
  for (const cancel of ['CANCEL_FABRIX_TEST', 'LOGOUT']) {
    let release, signal;
    const h = await background(t, {fetchImpl: (_, opts) => {signal = opts.signal; return new Promise(resolve => {release = () => resolve(Response.json(fabrixModelList));});}});
    const pending = h.rpc({type: 'TEST_FABRIX', testId: 'test-pending-1', connection: fabrixConnection, clientId: 'owner'});
    while (!release) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await h.rpc({type: 'GET_STATE'})).data.usage.total.fabrix.pending, 0);
    assert.equal((await h.rpc({type: 'START_CHAT', text: 'overlap', clientId: 'owner'})).error, 'busy');
    await h.rpc({type: cancel, testId: 'test-pending-1', clientId: 'owner'}); assert(signal.aborted);
    release(); assert.equal((await pending).error, 'cancelled');
    assert.equal(h.chrome.storage.session.data.fabrixTest, undefined); assert.equal(h.chrome.storage.session.data.credential ?? null, null);
    const usage = (await h.rpc({type: 'GET_STATE'})).data.usage.total.fabrix;
    assert.equal(usage.pending, 0); assert.equal(usage.calls, 0); assert.equal(usage.measured, 0);
  }
});

test('FabriX tested receipt survives worker recreation but remains bound to its owner document', async t => {
  const ready = {id: 'ready-test-1', clientId: 'owner', documentId: 'document-one', connection: fabrixConnection, payload: normalizeFabrixModels(fabrixModelList), expiresAt: Date.now() + 300000};
  const h = await background(t, {session: {fabrixTest: ready}});
  const sender = {id: 'synthetic', url: 'chrome-extension://synthetic/index.html', documentId: 'document-one'};
  assert.equal((await h.rpc({type: 'CONNECT_FABRIX', testId: ready.id, clientId: 'owner'}, {...sender, documentId: 'document-two'})).error, 'fabrix_test_expired');
  assert.equal((await h.rpc({type: 'CONNECT_FABRIX', testId: ready.id, clientId: 'owner'}, sender)).ok, true);
});

test('the exact login tab and port redirect is ready before SSO navigation', async t => {
  const h = await background(t);
  const attempt = await h.start();
  const ready = h.calls.findIndex(call => call.name === 'redirect.rules' && call.addRules.length);
  const navigate = h.calls.findIndex(call => call.name === 'tabs.update' && call.url?.startsWith(ORIGIN));
  assert(ready >= 0 && ready < navigate);
  assert.equal(h.calls[navigate].url, `${ORIGIN}/auth/cli/login?port=${attempt.port}`);
  const rule = h.calls[ready].addRules[0];
  assert.deepEqual(rule.condition.tabIds, [attempt.tabId]);
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  assert.deepEqual(rule.condition.requestMethods, ['get']);
  const pattern = new RegExp(rule.condition.regexFilter);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `http://${host}:${attempt.port}/auth?code=encoded%2B%2F&status=00`;
    assert.equal(pattern.exec(url)?.[2], 'code=encoded%2B%2F&status=00');
  }
  for (const url of [`http://localhost:${attempt.port + 1}/auth?code=x`, `http://localhost:${attempt.port}/other?code=x`, `https://localhost:${attempt.port}/auth?code=x`, `http://localhost.evil:${attempt.port}/auth?code=x`]) assert(!pattern.test(url));
  assert.equal(attempt.receiverVersion, 4);
  assert.equal(h.chrome.storage.session.data.receiverTransport, 'redirect');
  assert.equal(h.alarms.get('login-timeout').when, attempt.expiresAt);
  await h.rpc({type: 'START_LOGIN'});
  assert.equal(h.calls.filter(call => call.name === 'redirect.rules' && call.addRules.length).length, 1);
});

test('a code exchanges once and successful authentication removes the redirect and login tab', async t => {
  let resolveExchange;
  const requests = [];
  const h = await background(t, {fetchImpl: (url, options) => {
    requests.push({url, options}); return new Promise(resolve => {resolveExchange = resolve;});
  }});
  const attempt = await h.start(), code = 'synthetic-private-code+/_=';
  const query = new URLSearchParams({code, status: '00'}).toString();
  assert.equal((await h.callback(attempt, query)).ok, true);
  assert.equal(h.chrome.storage.session.data.attempt.phase, 'exchanging');
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${ORIGIN}/auth/exchange`);
  assert.equal(requests[0].options.body, new URLSearchParams({code}).toString());
  assert(!JSON.stringify(h.chrome.storage.session.data).includes(code));
  assert(!JSON.stringify(h.chrome.storage.local.data).includes(code));
  assert.equal((await h.callback(attempt, query)).data.accepted, false);
  assert.equal((await h.callback(attempt)).data.accepted, false);
  assert.equal(requests.length, 1);
  const token = jwt(); resolveExchange(Response.json({token}));
  await settle(h, () => h.chrome.storage.session.data.credential?.token === token);
  assert.equal(h.chrome.storage.session.data.attempt, undefined);
  assert.equal(h.chrome.storage.session.data.authReport.stage, 'credential_received');
  assert(!h.alarms.has('login-timeout'));
  assert(!h.alarms.has('callback-close'));
  assert(!h.tabs.has(attempt.tabId));
  assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
  assert(!h.calls.some(call => call.name.startsWith('debugger.')));
  assert(!JSON.stringify(h.chrome.storage.local.data).includes(token));
  assert(!JSON.stringify(h.chrome.storage.session.data.events).includes(token));
  assert(!JSON.stringify(h.chrome.storage.session.data.events).includes(code));
  assert.equal((await h.callback(attempt, query)).error, 'invalid_sender');
});

async function settle(h, condition) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 1)); await h.flush();
    if (condition()) return;
  }
  assert(condition(), 'background operation must settle');
}

test('cancel aborts exchange and a late completion cannot authenticate the next attempt', async t => {
  let resolveExchange, signal;
  const h = await background(t, {fetchImpl: (_, options) => {
    signal = options.signal; return new Promise(resolve => {resolveExchange = resolve;});
  }});
  const old = await h.start();
  await h.callback(old, 'code=synthetic-cancel&status=00');
  assert.equal((await h.rpc({type: 'CANCEL_LOGIN'})).ok, true);
  assert(signal.aborted);
  assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
  const next = await h.start();
  resolveExchange(Response.json({token: jwt()}));
  await new Promise(resolve => setTimeout(resolve, 10)); await h.flush();
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
  assert.equal(h.chrome.storage.session.data.attempt.id, next.id);
});

test('exchange HTTP rejection removes its rule, records a safe error and allows retry', async t => {
  const h = await background(t, {fetchImpl: async () => new Response('private-response', {status: 400})});
  const attempt = await h.start();
  await h.callback(attempt, 'code=synthetic-rejected&status=00');
  await settle(h, () => !h.chrome.storage.session.data.attempt);
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
  assert.equal(h.chrome.storage.session.data.authReport.stage, 'exchange_rejected');
  assert(h.chrome.storage.session.data.events.some(e => e.event === 'code_exchange_failed' && e.status === 400));
  assert(!JSON.stringify(h.chrome.storage.session.data).includes('private-response'));
  assert(!h.tabs.has(attempt.tabId));
  assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
  assert.equal((await h.start()).receiverVersion, 4);
});

test('worker restart interrupts exchange without persisting or replaying a code', async t => {
  const attempt = {id: 'interrupted', provider: 'aipro', tabId: 50, port: 51561, receiverVersion: 4, phase: 'exchanging', expiresAt: Date.now() + 300000};
  const h = await background(t, {session: {attempt, receiverTab: 50, receiverTransport: 'redirect'}, initialRules: [loginRedirectRule(attempt, 'chrome-extension://synthetic/auth-return.html')]});
  assert.equal(h.chrome.storage.session.data.attempt, undefined);
  assert.equal(h.chrome.storage.session.data.authReport.stage, 'exchange_interrupted');
  assert(!h.tabs.has(50));
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
  assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
  assert(!h.calls.some(call => call.name.startsWith('debugger.')));
});

test('callbacks reject another tab, frame, document, extension, nonce or expired attempt', async t => {
  const h = await background(t), attempt = await h.start();
  for (const from of [{tab: {id: attempt.tabId + 1}}, {frameId: 2}, {url: `${ORIGIN}/auth`}, {url: h.chrome.runtime.getURL('index.html')}, {id: 'another-extension'}]) {
    assert.equal((await h.callback(attempt, undefined, from)).error, 'invalid_sender');
    assert.equal(h.chrome.storage.session.data.attempt.id, attempt.id);
  }
  assert.equal((await h.callback(attempt, undefined, {}, {nonce: 'wrong-attempt'})).error, 'invalid_sender');
  assert.equal((await h.callback(attempt, 'x'.repeat(65537))).error, 'invalid_sender');
  await h.chrome.storage.session.set({attempt: {...attempt, expiresAt: Date.now() - 1}});
  assert.equal((await h.callback(attempt)).error, 'invalid_sender');
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
  h.chrome.alarms.onAlarm.emit({name: 'login-timeout'}); await h.flush();
  assert(!h.tabs.has(attempt.tabId));
  assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
});

test('cancel closes its tab before removing the rule and rejects queued callbacks', async t => {
  const h = await background(t), attempt = await h.start();
  const before = h.calls.length;
  assert.equal((await h.rpc({type: 'CANCEL_LOGIN'})).ok, true); await h.flush();
  assert.equal(h.chrome.storage.session.data.authReport.stage, 'login_closed');
  assert.equal(h.chrome.storage.session.data.receiverTab, undefined);
  assert(!h.alarms.has('login-timeout')); assert(!h.tabs.has(attempt.tabId));
  const calls = h.calls.slice(before);
  assert(calls.findIndex(call => call.name === 'tabs.remove') < calls.findIndex(call => call.name === 'redirect.rules'));
  assert(!calls.some(call => call.name.startsWith('debugger.')));
  assert.equal((await h.callback(attempt)).error, 'invalid_sender');
  assert.notEqual((await h.start()).id, attempt.id);
});

test('closing the AI Pro tab cleans its rule without using the debugger', async t => {
  const h = await background(t), attempt = await h.start();
  await h.chrome.tabs.remove(attempt.tabId); await h.flush();
  assert.equal(h.chrome.storage.session.data.attempt, undefined);
  assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
  assert(!h.calls.some(call => call.name.startsWith('debugger.')));
});

test('an unrelated debugger detach cannot cancel a redirect login', async t => {
  const h = await background(t), attempt = await h.start('chatgpt');
  h.chrome.debugger.onDetach.emit({tabId: attempt.tabId}, 'canceled_by_user'); await h.flush();
  assert.equal(h.chrome.storage.session.data.attempt.id, attempt.id);
  assert(h.tabs.has(attempt.tabId)); assert(h.alarms.has('login-timeout'));
  assert(!h.calls.some(call => call.name.startsWith('debugger.')));
});

test('receiver setup failures do not navigate to SSO or fall back to an AI Pro debugger', async t => {
  for (const [provider, failure] of [['aipro', 'redirect'], ['chatgpt', 'redirect']]) {
    await t.test(`${provider} ${failure}`, async t => {
      const h = await background(t, {failure});
      assert.deepEqual(await h.rpc({type: 'START_LOGIN', provider}), {ok: false, error: 'callback_receiver_unavailable'});
      await h.flush();
      assert.equal(h.chrome.storage.session.data.attempt, undefined);
      assert(!h.calls.some(call => call.name === 'tabs.update' && call.url?.startsWith('https:')));
      assert.equal(h.tabs.size, 1); assert(!h.alarms.has('login-timeout'));
      assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
      assert(!h.calls.some(call => call.name.startsWith('debugger.')));
    });
  }
});

test('startup removes old debugger attempts before a fresh redirect login', async t => {
  const oldAttempt = {id: 'legacy-login', provider: 'aipro', tabId: 50, port: 51561, receiverVersion: 3, expiresAt: Date.now() + 300000};
  const h = await background(t, {session: {attempt: oldAttempt, receiverTab: 50}, initialAlarms: {'login-timeout': {when: oldAttempt.expiresAt}}});
  assert.equal(h.chrome.storage.session.data.attempt, undefined); assert(!h.tabs.has(50));
  assert(h.calls.some(call => call.name === 'debugger.detach'));
  assert.equal((await h.start()).receiverVersion, 4);
  assert(!h.calls.some(call => call.name === 'debugger.attach'));
});

test('worker suspension preserves a waiting redirect and allows its callback to complete', async t => {
  const attempt = {id: 'suspended-login', provider: 'aipro', tabId: 50, port: 51561, receiverVersion: 4, phase: 'waiting', expiresAt: Date.now() + 300000};
  const h = await background(t, {
    session: {attempt, receiverTab: 50, receiverTransport: 'redirect'},
    initialRules: [loginRedirectRule(attempt, 'chrome-extension://synthetic/auth-return.html')],
    initialAlarms: {'login-timeout': {when: attempt.expiresAt}},
  });
  assert.deepEqual(h.chrome.storage.session.data.attempt, attempt);
  assert(!h.calls.some(call => call.name === 'tabs.remove' || call.name.startsWith('debugger.')));
  assert.equal((await h.callback(attempt)).ok, true);
  assert(h.chrome.storage.session.data.credential);
});

test('a missing session rule cannot leave a stale waiting login active after restart', async t => {
  const attempt = {id: 'missing-rule', provider: 'aipro', tabId: 50, port: 51561, receiverVersion: 4, phase: 'waiting', expiresAt: Date.now() + 300000};
  const h = await background(t, {session: {attempt, receiverTab: 50, receiverTransport: 'redirect'}});
  assert.equal(h.chrome.storage.session.data.attempt, undefined); assert(!h.tabs.has(50));
  assert.equal(h.chrome.storage.session.data.authReport.stage, 'login_closed');
});

test('invalid status, duplicate or missing code fails safely and permits a new login', async t => {
  const h = await background(t);
  for (const query of ['code=private-code&status=01', 'code=private-code&code=other&status=00', 'status=00', 'code=&status=00']) {
    const attempt = await h.start();
    assert.equal((await h.callback(attempt, query)).ok, false);
    assert.equal(h.chrome.storage.session.data.attempt, undefined);
    assert.deepEqual(await h.chrome.declarativeNetRequest.getSessionRules(), []);
    assert(!JSON.stringify(h.chrome.storage.session.data).includes('private-code'));
  }
});

test('catalog state retains safe counts and distinguishes malformed responses from an empty model list', async t => {
  const h = await background(t);
  const attempt = await h.start();
  await h.callback(attempt);
  const credentialReceivedAt = h.chrome.storage.session.data.credential.receivedAt;
  let result = await h.rpc({type: 'SAVE_MODELS', credentialReceivedAt, status: 200, payload: {modelList: [{name: 'private-name', target: 'private-target'}]}});
  assert.equal(result.ok, true);
  assert.equal(result.data.catalog.models.length, 1);
  assert.equal(result.data.catalog.models[0].name, 'private-name');
  assert.equal(result.data.catalog.diagnostics.status, 200);
  assert.equal(result.data.catalog.diagnostics.summary.received, 1);
  assert.equal(result.data.catalog.diagnostics.summary.excluded.target, 0);
  assert(!JSON.stringify(result.data.catalog.diagnostics).includes('private-'));
  assert(!JSON.stringify(result.data.events).includes('private-'));
  result = await h.rpc({type: 'SAVE_MODELS', credentialReceivedAt, status: 200, payload: {error: 'private-body'}});
  assert.equal(result.ok, true);
  assert.equal(result.data.catalog.error, 'models_invalid');
  assert.equal(result.data.catalog.diagnostics.summary, null);
  assert(!JSON.stringify(result.data).includes('private-body'));
  result = await h.rpc({type: 'SAVE_MODELS', credentialReceivedAt, status: 200, payload: {modelList: []}});
  assert.equal(result.data.catalog.error, null);
  assert.equal(result.data.catalog.diagnostics.summary.received, 0);
});

test('an active chat owner survives a missing context snapshot and can finish its response', async t => {
  const h = await background(t);
  const owner = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html'), documentId: 'owner-document', tab: {id: 11}};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, owner);
  const started = await h.rpc({type: 'START_CHAT', text: 'synthetic question', clientId: 'owner-client'}, owner);
  assert.equal(started.ok, true);
  const live = await h.rpc({type: 'GET_STATE', clientId: 'owner-client'}, owner);
  assert.equal(live.data.busy, true);
  assert.equal(live.data.chat.messages.at(-1).state, 'pending');
  const finished = await h.rpc({type: 'FINISH_CHAT', requestId: started.data.requestId, content: 'synthetic answer', status: 200}, owner);
  assert.equal(finished.data.chat.messages.at(-1).state, 'done');
  assert.equal(finished.data.chat.messages.at(-1).content, 'synthetic answer');
});

test('completion diagnostics require the live request owner and store only fixed classifications', async t => {
  const h = await background(t);
  const owner = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html'), documentId: 'diagnostic-owner', tab: {id: 11}};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, owner);
  const started = await h.rpc({type: 'START_CHAT', text: 'synthetic question', clientId: 'owner'}, owner);
  assert(started.ok);
  const message = {type: 'MODEL_DIAGNOSTIC', requestId: started.data.requestId, clientId: 'owner', phase: 'rejected', reason: 'system_messages', status: 400, attempt: 1, body: 'private-response', token: 'private-token'};
  const events = () => (h.chrome.storage.session.data.events || []).filter(event => event.event.startsWith('model_request_'));
  await h.rpc({...message, requestId: 'old-request'}, owner);
  await h.rpc(message, {...owner, documentId: 'other-document'});
  await h.rpc({...message, reason: 'private-provider-reason'}, owner);
  assert.equal(events().length, 0);
  await h.rpc(message, owner);
  assert.equal(events().length, 1); assert.equal(events()[0].reason, 'system_messages'); assert.equal(events()[0].status, 400);
  assert(!JSON.stringify(events()).includes('private'));
  await h.rpc({type: 'FINISH_CHAT', requestId: started.data.requestId, content: '', error: 'request_format', status: 400}, owner);
  await h.rpc(message, owner);
  assert.equal(events().length, 1);
});

test('a persisted clarification survives interruption and blocks actions until answered', async t => {
  const h = await background(t);
  const owner = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html'), documentId: 'question-owner', tab: {id: 11}};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, owner);
  const started = await h.rpc({type: 'START_CHAT', text: '가방 모양 아이콘', clientId: 'question-client'}, owner);
  const requestId = started.data.requestId;
  const asked = await h.rpc({type: 'RUN_TOOL', requestId, name: 'ask_user', args: {question: '페이지 어디에 있나요?'}}, owner);
  assert.equal(asked.data.requiresUserInput, true);
  assert.equal((await h.rpc({type: 'RUN_TOOL', requestId, name: 'browser_snapshot', args: {}}, owner)).error, 'question_changed');
  // Close/reload after the saved question, before FINISH_CHAT can run.
  h.chrome.storage.session.data.chatLease.until = 0;
  const recovered = await h.rpc({type: 'GET_STATE'}, {...owner, documentId: 'new-document'});
  assert.equal(recovered.data.busy, false);
  assert.equal(recovered.data.chat.messages.at(-1).state, 'done');
  assert.equal(recovered.data.chat.messages.at(-1).error, null);
  assert.equal(recovered.data.chat.messages.at(-1).question.text, '페이지 어디에 있나요?');
  const continued = await h.rpc({type: 'START_CHAT', text: '오른쪽 위', clientId: 'question-client'}, owner);
  assert.equal(continued.ok, true);
  assert(continued.data.messages.some(message => message.content.includes('페이지 어디에 있나요?')));
  assert.equal(h.chrome.storage.local.data.chat.messages.find(message => message.id === requestId).question.answer.text, '오른쪽 위');
});

test('answering a browser clarification resumes the conversation window and original goal', async t => {
  const h = await background(t);
  const owner = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html'), documentId: 'popup-question', tab: {id: 11}};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, owner);
  const started = await h.rpc({type: 'START_CHAT', text: '새 창의 업무 초안을 작성해줘'}, owner);
  const requestId = started.data.requestId, chat = h.chrome.storage.local.data.chat;
  chat.task = {requestId, skillId: 'browser-agent', autoConnect: true, goal: '새 창의 업무 초안을 작성해줘', status: 'running', steps: [], plan: []};
  const context = {tabId: 44, openers: [[44, 33], [33, 11]]};
  h.chrome.storage.session.data.browserContexts = {[chat.sessionId]: {context, provider: 'aipro', credentialReceivedAt: h.chrome.storage.session.data.credential.receivedAt}};
  const asked = await h.rpc({type: 'RUN_TOOL', requestId, name: 'ask_user', args: {question: '마감일은 언제인가요?'}}, owner);
  assert.equal(asked.data.requiresUserInput, true);
  await h.rpc({type: 'FINISH_CHAT', requestId, content: '', status: 200}, owner);
  assert.equal(h.chrome.storage.local.data.chat.task.status, 'awaiting_user');
  const continued = await h.rpc({type: 'START_CHAT', text: '목요일'}, owner);
  assert.equal(continued.ok, true);
  assert.equal(continued.data.resumeTask.goal, '새 창의 업무 초안을 작성해줘');
  assert.equal(h.chrome.storage.session.data.chatLease.pageTargetTabId, 44);
  assert.deepEqual(h.chrome.storage.session.data.chatLease.browserContext, context);
  assert(continued.data.messages.some(message => message.role === 'user' && message.content.includes('<answered_question>') && message.content.includes('마감일은 언제인가요?')));
  const repeated = await h.rpc({type: 'RUN_TOOL', requestId: continued.data.requestId, name: 'ask_user', args: {question: '마감일은 언제인가요?'}}, owner);
  assert.equal(repeated.data.error, 'question_already_answered');
  assert.equal(repeated.data.answer, '목요일');
  assert.equal(h.chrome.storage.local.data.chat.messages.at(-1).question, undefined);
  const next = await h.rpc({type: 'RUN_TOOL', requestId: continued.data.requestId, name: 'ask_user', args: {question: '목요일 몇 시까지인가요?'}}, owner);
  assert.equal(next.data.requiresUserInput, true);

});

test('a side panel without documentId keeps its response while other views cannot finish it', async t => {
  const h = await background(t);
  const panel = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html')};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, panel);
  const started = await h.rpc({type: 'START_CHAT', text: 'panel question', clientId: 'panel-client'}, panel);
  assert.equal(started.ok, true);
  // A slow model and repeated empty context snapshots must not cancel a live panel.
  for (let i = 0; i < 3; i++) {
    h.chrome.storage.session.data.chatLease.lastSeenAt = Date.now() - 60000;
    const live = await h.rpc({type: 'GET_STATE', clientId: 'panel-client'}, panel);
    assert.equal(live.data.busy, true);
    assert.equal(live.data.chat.messages.at(-1).state, 'pending');
    const observer = await h.rpc({type: 'GET_STATE', clientId: 'other-panel'}, panel);
    assert.equal(observer.data.busy, true);
  }
  const stolen = await h.rpc({type: 'FINISH_CHAT', requestId: started.data.requestId, content: 'wrong view', clientId: 'other-panel'}, panel);
  assert.equal(stolen.data, null);
  const finished = await h.rpc({type: 'FINISH_CHAT', requestId: started.data.requestId, content: 'panel answer', clientId: 'panel-client', status: 200}, panel);
  assert.equal(finished.data.chat.messages.at(-1).state, 'done');
  assert.equal(finished.data.chat.messages.at(-1).content, 'panel answer');
});

test('a live owner renews its lease while observers cannot extend an abandoned task', async t => {
  const h = await background(t);
  const panel = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html')};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, panel);
  await h.rpc({type: 'START_CHAT', text: 'long running task', clientId: 'owner'}, panel);
  const lease = h.chrome.storage.session.data.chatLease;
  lease.until = Date.now() + 1000; lease.lastSeenAt = Date.now() - 6000;
  const before = lease.until;
  await h.rpc({type: 'GET_STATE', clientId: 'observer'}, panel);
  assert.equal(h.chrome.storage.session.data.chatLease.until, before);
  const result = await h.rpc({type: 'GET_STATE', clientId: 'owner'}, panel);
  assert.equal(result.data.busy, true);
  assert(h.chrome.storage.session.data.chatLease.until > before + 60000);
});

test('an abandoned side panel and an expired chat still recover without replaying a request', async t => {
  const h = await background(t);
  const panel = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html')};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, panel);
  await h.rpc({type: 'START_CHAT', text: 'closed panel', clientId: 'closed-client'}, panel);
  h.chrome.storage.session.data.chatLease.lastSeenAt = Date.now() - 31000;
  let result = await h.rpc({type: 'GET_STATE', clientId: 'new-client'}, panel);
  assert.equal(result.data.busy, false);
  assert.equal(result.data.chat.messages.at(-1).error, 'interrupted');
  await h.rpc({type: 'START_CHAT', text: 'expired request', clientId: 'new-client'}, panel);
  h.chrome.storage.session.data.chatLease.until = Date.now() - 1;
  result = await h.rpc({type: 'GET_STATE', clientId: 'new-client'}, panel);
  assert.equal(result.data.busy, false);
  assert.equal(result.data.chat.messages.at(-1).error, 'interrupted');
});

test('real owner progress renews its job without display polling and cannot revive cancelled or expired leases', async t => {
  const h = await background(t), panel = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html')};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, panel);
  const started = await h.rpc({type: 'START_CHAT', text: 'continue without status polling', clientId: 'owner'}, panel);
  const progress = {type: 'SAVE_CONTEXT', requestId: started.data.requestId, kind: 'trace', trace: [], clientId: 'owner'};
  let lease = h.chrome.storage.session.data.chatLease;
  lease.until = Date.now() + 1000; lease.lastSeenAt = Date.now() - 6000;
  const before = lease.until;
  assert.equal((await h.rpc({...progress, clientId: 'observer'}, panel)).ok, false);
  assert.equal(h.chrome.storage.session.data.chatLease.until, before);
  assert.equal((await h.rpc(progress, panel)).ok, true);
  assert(h.chrome.storage.session.data.chatLease.until > before + 60000);
  lease = h.chrome.storage.session.data.chatLease; lease.until = before; lease.lastSeenAt = 0;
  assert.equal((await h.rpc({...progress, kind: 'heartbeat'}, panel)).ok, true);
  assert(h.chrome.storage.session.data.chatLease.until > before + 60000);
  lease = h.chrome.storage.session.data.chatLease; lease.until = Date.now() - 1; lease.lastSeenAt = 0;
  const expired = lease.until; await h.rpc(progress, panel);
  assert.equal(h.chrome.storage.session.data.chatLease.until, expired);
  lease = h.chrome.storage.session.data.chatLease; lease.cancelled = true;
  assert.equal((await h.rpc(progress, panel)).ok, false);
  assert.equal(h.chrome.storage.session.data.chatLease.until, expired);
});

test('full-screen chat remembers a source tab before site permission reveals its URL', async t => {
  const h = await background(t);
  const panel = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html')};
  assert.equal((await h.rpc({type: 'OPEN_TAB'}, panel)).ok, true);
  assert.equal(h.chrome.storage.session.data.chatSourceTabs[20], 11);
  assert.equal(h.chrome.storage.session.data.page, undefined);
  const fullScreen = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html'), tab: {id: 20}};
  // Chrome may omit the extension tab URL even with website host access.
  h.chrome.tabs.query = async () => [{id: 20}];
  assert.equal((await h.rpc({type: 'CONNECT_PAGE'}, fullScreen)).ok, false);
  assert.equal((await h.rpc({type: 'OPEN_TAB'}, fullScreen)).ok, true);
  assert.equal(h.chrome.storage.session.data.chatSourceTabs[21], 11);
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, fullScreen);
  h.tabs.set(11, {id: 11, url: 'https://fixture.test/one'});
  const started = await h.rpc({type: 'START_CHAT', text: '현재 페이지 분석', clientId: 'owner'}, fullScreen);
  assert.equal(started.ok, true);
  assert.equal(h.chrome.storage.session.data.chatLease.pageTargetTabId, 11);
});

function chatgptTokens() {
  return {access_token: `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000)+3600, 'https://api.openai.com/auth': {chatgpt_account_id:'synthetic-account'}})).toString('base64url')}.signature`, refresh_token:'synthetic-private-refresh', expires_in:3600};
}
async function startChatGPT(h) {
  const result=await h.rpc({type:'START_LOGIN',provider:'chatgpt'});
  assert.equal(result.ok,true,result.error);
  const attempt=structuredClone(h.chrome.storage.session.data.attempt);
  const auth=new URL(h.calls.findLast(call=>call.name==='tabs.update' && call.url?.startsWith('https://auth.openai.com')).url);
  return {attempt,auth,callback:`http://localhost:1455/auth/callback?${new URLSearchParams({state:auth.searchParams.get('state'),code:'synthetic-chatgpt-code'})}`};
}
test('ChatGPT callback exchanges once, consumes transient PKCE and isolates provider history', async t=>{
  let release; const requests=[];
  const h=await background(t,{fetchImpl:(url,options)=>{requests.push({url,options}); return new Promise(resolve=>{release=resolve;});}});
  const saved={messages:[{role:'user',content:'company-private-history'}],draft:'company-private-draft',memory:{version:1,throughId:'old',summary:{goal:'company-private-summary'}},task:{goal:'company-private-task',status:'paused'}};
  await h.chrome.storage.local.set({chat:saved,activeSkillId:'form'});
  const {attempt,auth,callback}=await startChatGPT(h);
  assert(!h.calls.some(call=>call.name==='Network.enable'));
  assert.deepEqual(await h.callback(attempt,new URL(callback).search.slice(1)),{ok:true,data:{accepted:true}});
  assert.deepEqual(await h.callback(attempt,new URL(callback).search.slice(1)),{ok:true,data:{accepted:false}});
  assert(!h.calls.some(call=>call.name.startsWith('debugger.')));
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://auth.openai.com/oauth/token');
  const persisted=JSON.stringify(await h.chrome.storage.session.get(null));
  assert(!persisted.includes(auth.searchParams.get('state'))); assert(!persisted.includes('synthetic-chatgpt-code'));
  release(Response.json(chatgptTokens()));
  await settle(h,()=>h.chrome.storage.session.data.credential?.provider==='chatgpt');
  assert.deepEqual(h.chrome.storage.local.data.chat.messages, []); assert.equal(h.chrome.storage.local.data.chat.draft, '');
  assert.equal(h.chrome.storage.local.data.activeSkillId,'');
  assert.deepEqual(h.chrome.storage.local.data.providerChats.aipro.messages, saved.messages); assert.equal(h.chrome.storage.local.data.providerChats.aipro.draft, saved.draft);
  assert(!JSON.stringify(h.chrome.storage.local.data).includes('synthetic-private-refresh'));
  const safe=await h.rpc({type:'GET_STATE'});
  assert(!JSON.stringify(safe).includes('synthetic-private-refresh'));
  assert(!JSON.stringify(safe).includes(chatgptTokens().access_token));
  await h.rpc({type:'DRAFT',provider:'aipro',value:'late company draft'});
  assert.equal(h.chrome.storage.local.data.chat.draft,'');
  await h.rpc({type:'LOGOUT'});
  await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
  assert.deepEqual(h.chrome.storage.local.data.chat.messages, saved.messages); assert.equal(h.chrome.storage.local.data.chat.draft, saved.draft);
});
test('ChatGPT state mismatch and wrong frame cannot authenticate', async t=>{
  const h=await background(t,{commandResults:{'Page.getFrameTree':{frameTree:{frame:{id:'top'}}}}});
  const {attempt,callback}=await startChatGPT(h);
  assert.equal((await h.callback(attempt,new URL(callback).search.slice(1),{frameId:1})).error,'invalid_sender');
  assert.equal(h.chrome.storage.session.data.attempt.id,attempt.id);
  await h.callback(attempt,new URL(callback.replace(/state=[^&]+/,'state=wrong')).search.slice(1));
  assert.equal(h.chrome.storage.session.data.authReport.error,'chatgpt_callback_invalid');
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
});
test('ChatGPT cancellation discards a late exchange and restart rejects missing PKCE', async t=>{
  let release,signal;
  const h=await background(t,{fetchImpl:(_,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  const {attempt,callback}=await startChatGPT(h);
  await h.callback(attempt,new URL(callback).search.slice(1)); await h.rpc({type:'CANCEL_LOGIN'});
  assert(signal.aborted); release(Response.json(chatgptTokens())); await h.flush();
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
  const restarted=await background(t,{session:{attempt:{...attempt,phase:undefined},receiverTab:attempt.tabId}});
  assert.equal(restarted.chrome.storage.session.data.attempt,undefined);
});
test('concurrent token refresh has one request and logout prevents a late credential restore', async t=>{
  let release,signal,count=0;
  const token=chatgptTokens();
  const h=await background(t,{session:{credential:{provider:'chatgpt',mode:'browser',token:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()-1,receivedAt:99}},fetchImpl:(_,options)=>{count++;signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  const first=h.rpc({type:'PREPARE_CREDENTIAL',credentialReceivedAt:99}), second=h.rpc({type:'PREPARE_CREDENTIAL',credentialReceivedAt:99});
  await h.flush(); assert.equal(count,1);
  await h.rpc({type:'LOGOUT'}); assert(signal.aborted);
  release(Response.json(token));
  assert.equal((await first).ok,false); assert.equal((await second).ok,false);
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
});
test('refresh keeps chat identity, rejects untrusted callers and invalid refresh marks re-login', async t=>{
  const token=chatgptTokens(); let status=200,count=0;
  const h=await background(t,{session:{credential:{provider:'chatgpt',mode:'browser',token:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()-1,receivedAt:100}},fetchImpl:async()=>{count++;return Response.json(status===200?token:{error:'private'},{status});}});
  assert.equal((await h.rpc({type:'PREPARE_CREDENTIAL',credentialReceivedAt:100},{id:'attacker',url:'https://example.com'})).error,'invalid_sender');
  assert.equal(count,0);
  assert.equal((await h.rpc({type:'PREPARE_CREDENTIAL',credentialReceivedAt:100})).ok,true);
  assert.equal(h.chrome.storage.session.data.credential.receivedAt,100);
  status=401; h.chrome.storage.session.data.credential.expiresAt=Date.now()-1;
  assert.equal((await h.rpc({type:'PREPARE_CREDENTIAL',credentialReceivedAt:100})).error,'chatgpt_exchange_rejected');
  assert.equal(h.chrome.storage.session.data.credential.rejected,true);
});
test('usage follows the chat owner, survives clear/logout, and does not count duplicate reports',async t=>{
 const h=await background(t);await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
 const started=await h.rpc({type:'START_CHAT',text:'usage test',clientId:'owner'});
 const measurement={type:'RECORD_USAGE',requestId:started.data.requestId,round:1,phase:'report',usage:{prompt_tokens:100,completion_tokens:20},provider:'chatgpt'};
 await h.rpc({...measurement,clientId:'stranger'});assert.equal(h.chrome.storage.local.data.usageLedger,undefined);
 await h.rpc({...measurement,clientId:'owner'});await h.rpc({...measurement,clientId:'owner'});
 assert.equal((await h.rpc({type:'GET_STATE',clientId:'owner'})).data.usage.total.aipro.total,120);
 assert.equal((await h.rpc({type:'GET_STATE',clientId:'owner'})).data.usage.total.chatgpt.total,0);
 await h.rpc({type:'FINISH_CHAT',requestId:started.data.requestId,content:'done',clientId:'owner'});
 await h.rpc({type:'CLEAR_CHAT'});await h.rpc({type:'LOGOUT'});
 const before=h.calls.length;assert.equal((await h.rpc({type:'GET_STATE'})).data.usage.total.aipro.total,120);
 assert(!h.calls.slice(before).some(call=>call.name==='local.set'&&call.keys.includes('usageLedger')));
});
test('closing a response finalizes unknown usage and quota cache cannot cross credential identities',async t=>{
 const h=await background(t);await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
 const request=(await h.rpc({type:'START_CHAT',text:'close test',clientId:'owner'})).data;
 await h.rpc({type:'RECORD_USAGE',requestId:request.requestId,clientId:'owner',round:1,phase:'start'});
 h.chrome.storage.session.data.chatLease.until=0;
 const recovered=(await h.rpc({type:'GET_STATE'})).data;
 assert.equal(recovered.usage.total.aipro.pending,0);assert.equal(recovered.usage.total.aipro.measured,0);
 h.chrome.storage.session.data.credential={provider:'chatgpt',receivedAt:123};
 h.chrome.storage.local.data.activeProvider='chatgpt';
 await h.rpc({type:'SAVE_ACCOUNT_USAGE',credentialReceivedAt:123,payload:{email:'private-email',rate_limit:{primary_window:{used_percent:10,limit_window_seconds:18000}}}});
 assert.equal((await h.rpc({type:'GET_STATE'})).data.accountUsage.data.windows[0].remaining,90);
 await h.rpc({type:'SAVE_ACCOUNT_USAGE',credentialReceivedAt:123,error:'quota_network'});
 assert.equal((await h.rpc({type:'GET_STATE'})).data.accountUsage.error,'quota_network');
 assert(!JSON.stringify(h.chrome.storage.session.data.accountUsage).includes('private-email'));
 h.chrome.storage.session.data.credential.receivedAt=124;
 await h.rpc({type:'SAVE_ACCOUNT_USAGE',credentialReceivedAt:123,payload:{rate_limit:{}}});
 assert.equal((await h.rpc({type:'GET_STATE'})).data.accountUsage,null);
});

test('inactive ChatGPT quota and forced refresh never replace the selected provider or restore logout', async t => {
  const token=chatgptTokens();let count=0,release;
  const aipro={provider:'aipro',token:jwt(),receivedAt:1};
  const chatgpt={provider:'chatgpt',token:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()+3600000,receivedAt:2};
  const h=await background(t,{session:{credential:aipro,providerSessions:{chatgpt:{credential:chatgpt}}},fetchImpl:()=>{count++;return new Promise(resolve=>{release=resolve;});}});
  await h.rpc({type:'SAVE_ACCOUNT_USAGE',credentialReceivedAt:2,status:200,payload:{credits:{balance:'4500'}}});
  assert.equal((await h.rpc({type:'GET_STATE'})).data.accountUsage.data.credits.balance,4500);
  assert.equal(h.chrome.storage.session.data.accountUsage,undefined);
  assert.equal((await h.rpc({type:'PREPARE_CREDENTIAL',provider:'chatgpt',credentialReceivedAt:2})).ok,true);assert.equal(count,0);
  const refreshing=h.rpc({type:'PREPARE_CREDENTIAL',provider:'chatgpt',credentialReceivedAt:2,force:true});
  await h.flush();assert.equal(count,1);release(Response.json(token));assert.equal((await refreshing).ok,true);
  assert.deepEqual(h.chrome.storage.session.data.credential,aipro);
  await h.rpc({type:'SAVE_ACCOUNT_USAGE',credentialReceivedAt:1,payload:{credits:{balance:'999'}}});
  assert.equal((await h.rpc({type:'GET_STATE'})).data.accountUsage.data.credits.balance,4500);
  const late=h.rpc({type:'PREPARE_CREDENTIAL',provider:'chatgpt',credentialReceivedAt:2,force:true});await h.flush();
  await h.rpc({type:'LOGOUT',provider:'chatgpt'});release(Response.json(token));assert.equal((await late).ok,false);
  await h.rpc({type:'SAVE_ACCOUNT_USAGE',credentialReceivedAt:2,payload:{credits:{balance:'999'}}});
  assert.equal((await h.rpc({type:'GET_STATE'})).data.accountUsage,null);
  assert.deepEqual(h.chrome.storage.session.data.credential,aipro);
});

test('browser cancellation is restricted to the active chat owner and blocks further tools', async t => {
  const h = await background(t); await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  const request = (await h.rpc({type: 'START_CHAT', text: 'cancel task', clientId: 'owner'})).data;
  const cancel = {type: 'CANCEL_BROWSER', requestId: request.requestId, clientId: 'owner'};
  assert.equal((await h.rpc({...cancel, clientId: 'stranger'})).error, 'invalid_sender');
  assert.equal((await h.rpc(cancel, {id: 'attacker', url: 'https://example.com'})).error, 'invalid_sender');
  assert(!h.chrome.storage.session.data.chatLease.cancelled);
  assert.equal((await h.rpc(cancel)).ok, true);
  assert.equal(h.chrome.storage.session.data.chatLease.cancelled, true);
  assert.equal((await h.rpc({type: 'RUN_TOOL', requestId: request.requestId, clientId: 'owner', name: 'inspect_dom'})).error, 'interrupted');
  await h.rpc({type: 'FINISH_CHAT', requestId: request.requestId, clientId: 'owner', error: 'cancelled'});
  assert.equal(h.chrome.storage.local.data.chat.messages.at(-1).error, 'cancelled');
});

const contextSummary = {goal: '초안 작성', constraints: ['보내지 말 것'], decisions: [], completed: [], pending: ['본문 확인'], references: []};
test('context checkpoint persists only for its active owner and credential and preserves more than 100 messages', async t => {
  const h = await background(t);
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  const original = Array.from({length: 120}, (_, i) => ({id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `message ${i}`, ...(i % 2 ? {state: 'done'} : {})}));
  await h.chrome.storage.local.set({chat: {messages: original, draft: '남길 초안'}});
  const started = await h.rpc({type: 'START_CHAT', compact: true, clientId: 'owner'});
  assert.equal(started.ok, true, started.error); assert.equal(started.data.messages.length, 120); assert.equal(started.data.tools.length, 0);
  assert.equal(h.chrome.storage.local.data.chat.draft, '남길 초안');
  const update = {type: 'SAVE_CONTEXT', requestId: started.data.requestId, clientId: 'owner', kind: 'history', memory: {throughId: 'm115', summary: contextSummary, beforeTokens: 5000, afterTokens: 500}};
  assert.equal((await h.rpc({...update, clientId: 'wrong'})).ok, false);
  assert.equal(h.chrome.storage.local.data.chat.memory, undefined);
  assert.equal((await h.rpc(update)).ok, true);
  assert.deepEqual(h.chrome.storage.local.data.chat.messages.slice(0, 120), original);
  assert.equal(h.chrome.storage.local.data.chat.memory.summary.constraints[0], '보내지 말 것');
  assert.equal((await h.rpc(update)).ok, false); // boundary cannot move backwards or repeat
  h.chrome.storage.session.data.credential.receivedAt++;
  assert.equal((await h.rpc({...update, kind: 'task', summary: contextSummary})).ok, false);
});
test('abandoned task marks running actions unknown and clearing a conversation clears its context too', async t => {
  const h = await background(t);
  const panel = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html')};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, panel);
  const started = await h.rpc({type: 'START_CHAT', text: '초안 작성', clientId: 'old'}, panel);
  h.chrome.storage.local.data.chat.task = {requestId: started.data.requestId, goal: '초안 작성', status: 'running', steps: [{tool: 'fill_form', status: 'running'}]};
  h.chrome.storage.local.data.chat.memory = {version: 1, throughId: 'old', summary: contextSummary};
  h.chrome.storage.session.data.chatLease.lastSeenAt = Date.now() - 31000;
  const recovered = await h.rpc({type: 'GET_STATE', clientId: 'new'}, panel);
  assert.equal(recovered.data.chat.task.status, 'paused'); assert.equal(recovered.data.chat.task.steps[0].status, 'unknown');
  assert.equal((await h.rpc({type: 'CLEAR_CHAT', clientId: 'new'}, panel)).ok, true);
  assert.deepEqual(h.chrome.storage.local.data.chat.messages, []); assert.equal(h.chrome.storage.local.data.chat.draft, '');
  assert.equal(h.chrome.storage.local.data.chat.memory, undefined); assert.equal(h.chrome.storage.local.data.chat.task, undefined);
});

test('default chat exposes browser tools without reading a page or sending its metadata', async t => {
  const h = await background(t);
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  h.tabs.set(42, {id: 42, url: 'https://fixture.test/private?token=secret', title: 'private title'});
  h.chrome.tabs.query = async () => [h.tabs.get(42)];
  h.chrome.scripting = {async executeScript() {throw new Error('Ordinary chat must not inspect the page');}};
  const started = await h.rpc({type: 'START_CHAT', text: '안녕하세요', clientId: 'owner'});
  assert.equal(started.ok, true);
  assert.equal(started.data.autoConnect, true);
  assert.equal(started.data.page, null);
  assert(started.data.tools.some(tool => tool.function.name === 'read_page'));
  assert(!JSON.stringify(started.data).includes('private title'));
  assert(!JSON.stringify(started.data).includes('fixture.test'));
  assert.equal(h.chrome.storage.session.data.page, undefined);
  assert.equal(h.chrome.storage.session.data.chatLease.pageTargetTabId, 42);
  await h.rpc({type: 'FINISH_CHAT', requestId: started.data.requestId, clientId: 'owner', content: '안녕하세요', status: 200});
  assert.equal(h.chrome.storage.session.data.page, undefined);
});

test('an automatic custom workflow needs no checkbox or initial page and survives task recovery', async t => {
  const h = await background(t);
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  const saved = await h.rpc({type: 'SAVE_SKILL', skill: {name: '보고서 초안', description: '요청에 맞는 보고서 작성', instructions: 'Use observed sources, prepare the draft, verify and ask before publication.', toolMode: 'automatic'}});
  assert.equal(saved.ok, true, saved.error);
  const id = h.chrome.storage.local.data.activeSkillId;
  h.chrome.scripting = {async executeScript() {throw new Error('Skill selection must not read a page');}};
  const first = await h.rpc({type: 'START_CHAT', text: '보고서 초안의 구성을 먼저 정리해줘', clientId: 'owner'});
  assert.equal(first.ok, true, first.error); assert.equal(first.data.page, null); assert.equal(first.data.autoConnect, true);
  assert.equal(first.data.skill.id, id);
  assert(first.data.tools.some(tool => tool.function.name === 'request_approval'));
  const loaded = await h.rpc({type: 'RUN_TOOL', requestId: first.data.requestId, clientId: 'owner', name: 'read_skill', args: {skill_id: id}});
  assert.equal(loaded.ok, true, loaded.error);
  assert.equal(h.chrome.storage.local.data.chat.task.skillId, id);
  await h.rpc({type: 'FINISH_CHAT', requestId: first.data.requestId, clientId: 'owner', error: 'timeout'});
  assert.equal(h.chrome.storage.local.data.chat.task.status, 'paused');
  const retry = await h.rpc({type: 'START_CHAT', resume: true, clientId: 'owner'});
  assert.equal(retry.ok, true, retry.error); assert.equal(retry.data.skill.id, id);
  assert.equal(retry.data.skill.instructions, first.data.skill.instructions);
  assert.equal(retry.data.autoConnect, true); assert.equal(h.chrome.storage.session.data.page, undefined);
  await h.rpc({type: 'FINISH_CHAT', requestId: retry.data.requestId, clientId: 'owner', content: '초안을 정리했습니다.', status: 200});
});

test('first automatic page tool binds the send-time tab and still checks owner and capabilities', async t => {
  const h = await background(t), operations = [];
  const panel = {id: 'synthetic', url: h.chrome.runtime.getURL('index.html')};
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()}, panel);
  h.tabs.set(42, {id: 42, url: 'https://fixture.test/one'});
  h.tabs.set(43, {id: 43, url: 'https://fixture.test/two'});
  h.chrome.tabs.query = async () => [h.tabs.get(42)];
  h.chrome.scripting = {async executeScript(options) {
    operations.push({tabId: options.target.tabId, operation: options.args[0]});
    return [{documentId: 'fixture-document', result: options.args[0] === 'connect' ? {title: 'One', url: 'https://fixture.test/one'} : {areas: []}}];
  }};
  const started = (await h.rpc({type: 'START_CHAT', text: '현재 페이지의 저장 항목을 알려줘', clientId: 'owner'}, panel)).data;
  h.chrome.tabs.query = async () => [h.tabs.get(43)];
  const run = {type: 'RUN_TOOL', requestId: started.requestId, clientId: 'owner', name: 'list_page_storage', args: {}};
  assert.equal((await h.rpc({...run, clientId: 'other'}, panel)).error, 'interrupted');
  assert.equal((await h.rpc({...run, name: 'unknown_tool'}, panel)).error, 'tools_unavailable');
  assert.deepEqual(operations, []);
  const result = await h.rpc(run, panel);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(operations, [{tabId: 42, operation: 'connect'}, {tabId: 42, operation: 'list_page_storage'}]);
  assert.equal(h.chrome.storage.session.data.page.tabId, 42);
  assert.equal(h.chrome.storage.session.data.chatLease.pageId, h.chrome.storage.session.data.page.id);
  assert.equal(h.chrome.storage.local.data.chat.task.page.title, 'One');
});

test('automatic browser access reports missing or restricted targets without blocking ordinary chat', async t => {
  const h = await background(t);
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  h.chrome.tabs.query = async () => [];
  const first = (await h.rpc({type: 'START_CHAT', text: '현재 페이지 분석', clientId: 'owner'})).data;
  assert.equal((await h.rpc({type: 'RUN_TOOL', requestId: first.requestId, clientId: 'owner', name: 'read_page', args: {}})).error, 'page_target_missing');
  await h.rpc({type: 'FINISH_CHAT', requestId: first.requestId, clientId: 'owner', content: '대상 페이지를 열어주세요.', status: 200});
  h.tabs.set(42, {id: 42, url: 'https://auth.openai.com/login'});
  h.chrome.tabs.query = async () => [h.tabs.get(42)];
  const second = await h.rpc({type: 'START_CHAT', text: '현재 페이지 분석', clientId: 'owner'});
  assert.equal(second.ok, true);
  assert.equal((await h.rpc({type: 'RUN_TOOL', requestId: second.data.requestId, clientId: 'owner', name: 'read_page', args: {}})).error, 'page_restricted');
});

test('default chat retry preserves deferred page access for an ordinary interrupted reply', async t => {
  const h = await background(t);
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  const first = (await h.rpc({type: 'START_CHAT', text: '안녕하세요', clientId: 'owner'})).data;
  await h.rpc({type: 'FINISH_CHAT', requestId: first.requestId, clientId: 'owner', error: 'network'});
  const retry = await h.rpc({type: 'START_CHAT', retry: true, clientId: 'owner'});
  assert.equal(retry.ok, true, retry.error);
  assert.equal(retry.data.autoConnect, true);
  assert.equal(retry.data.page, null);
});

test('cancelling an automatic connection cannot restore the lease or execute a page read', async t => {
  const h = await background(t), operations = [];
  await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  h.tabs.set(42, {id: 42, url: 'https://fixture.test/one'});
  h.chrome.tabs.query = async () => [h.tabs.get(42)];
  let release;
  h.chrome.scripting = {executeScript(options) {
    operations.push(options.args[0]);
    return new Promise(resolve => {release = resolve;});
  }};
  const started = (await h.rpc({type: 'START_CHAT', text: '현재 페이지 분석', clientId: 'owner'})).data;
  const reading = h.rpc({type: 'RUN_TOOL', requestId: started.requestId, clientId: 'owner', name: 'list_page_storage', args: {}});
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const seen = h.chrome.storage.session.data.chatLease.lastSeenAt;
  const observer = await Promise.race([h.rpc({type:'GET_STATE',clientId:'observer'}, {id:'synthetic',url:h.chrome.runtime.getURL('index.html'),documentId:'observer'}), new Promise(resolve=>setTimeout(()=>resolve({error:'blocked_by_tool'}),500))]);
  assert.equal(observer.ok,true,observer.error);assert.equal(observer.data.busy,true);
  assert.equal(h.chrome.storage.session.data.chatLease.lastSeenAt,seen);
  assert.equal((await h.rpc({type: 'CANCEL_BROWSER', requestId: started.requestId, clientId: 'owner'})).ok, true);
  release([{documentId: 'fixture-document', result: {title: 'One', url: 'https://fixture.test/one'}}]);
  assert.equal((await reading).error, 'interrupted');
  assert.equal(h.chrome.storage.session.data.chatLease.cancelled, true);
  assert.deepEqual(operations, ['connect']);
});


test('conversation transitions reject stale drafts and requests, preserve saved context, and block while replying', async t => {
  const h = await background(t); await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  const first = (await h.rpc({type: 'GET_STATE'})).data.chat.sessionId;
  await h.rpc({type: 'DRAFT', value: '저장할 초안', conversationId: first});
  h.chrome.storage.local.data.chat.memory = {goal: 'saved memory'};
  h.chrome.storage.session.data.page = {id: 'stale-page'};
  const next = await h.rpc({type: 'NEW_CHAT', conversationId: first});
  assert.equal(next.ok, true, next.error);
  const second = next.data.chat.sessionId;
  assert.notEqual(first, second); assert.equal(next.data.page, null);
  assert.equal((await h.rpc({type: 'DRAFT', value: 'late', conversationId: first})).error, 'conversation_changed');
  assert.equal((await h.rpc({type: 'START_CHAT', text: 'late', conversationId: first})).error, 'conversation_changed');
  assert.equal(h.chrome.storage.local.data.chat.draft, '');
  const request = (await h.rpc({type: 'START_CHAT', text: 'second', conversationId: second, clientId: 'owner'})).data;
  assert.equal((await h.rpc({type: 'SELECT_CONVERSATION', id: first, clientId: 'owner'})).error, 'busy');
  assert.equal((await h.rpc({type: 'DELETE_CONVERSATION', id: first, clientId: 'owner'})).error, 'busy');
  await h.rpc({type: 'FINISH_CHAT', requestId: request.requestId, content: 'done', clientId: 'owner'});
  const restored = await h.rpc({type: 'SELECT_CONVERSATION', id: first, conversationId: second});
  assert.equal(restored.data.chat.draft, '저장할 초안'); assert.deepEqual(restored.data.chat.memory, {goal: 'saved memory'});
  await h.rpc({type: 'FINISH_CHAT', requestId: request.requestId, content: 'late', clientId: 'owner'});
  assert.deepEqual(h.chrome.storage.local.data.chat.messages, []);
  assert.equal(restored.data.conversations.length, 2);
});

test('a failed archive write keeps the current selection and history, then retries safely', async t => {
  const h = await background(t); await h.rpc({type: 'DRAFT', value: 'do not lose'});
  const before = structuredClone(h.chrome.storage.local.data);
  const original = h.chrome.storage.local.set;
  h.chrome.storage.local.set = async function(values) {if ('chatHistory' in values) throw new Error('QUOTA_BYTES quota exceeded'); return original.call(this, values);};
  assert.equal((await h.rpc({type: 'NEW_CHAT'})).ok, false);
  assert.deepEqual(h.chrome.storage.local.data, before);
  h.chrome.storage.local.set = original;
  assert.equal((await h.rpc({type: 'NEW_CHAT'})).ok, true);
  assert.equal(h.chrome.storage.local.data.chatHistory[0].draft, 'do not lose');
});

test('cross-provider history selection parks credentials and cannot send with the previous provider', async t => {
  const h = await background(t); await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  h.chrome.storage.local.data.providerChats = {chatgpt: {sessionId: 'gpt-session', provider: 'chatgpt', messages: [{role: 'user', content: 'GPT only'}], draft: '', updatedAt: 1}};
  const selected = await h.rpc({type: 'SELECT_CONVERSATION', id: 'gpt-session'});
  assert.equal(selected.ok, true, selected.error);
  assert.equal(selected.data.auth.present, false); assert.equal(selected.data.activeProvider, 'chatgpt');
  assert.equal(selected.data.connections.aipro.present, true);
  assert.equal(h.chrome.storage.session.data.providerSessions.aipro.credential.provider || 'aipro', 'aipro');
  assert.equal(h.chrome.storage.session.data.credential ?? null, null);
  assert.equal((await h.rpc({type: 'START_CHAT', text: 'continue'})).error, 'no_credential');
  // Even an inconsistent credential after a failed session-store write cannot
  // send the selected provider's transcript through a different provider.
  h.chrome.storage.session.data.credential = {provider: 'aipro', token: jwt(), receivedAt: 1};
  assert.equal((await h.rpc({type: 'GET_STATE'})).data.auth.present, false);
  assert.equal((await h.rpc({type: 'START_CHAT', text: 'continue'})).error, 'no_credential');
});

test('cached provider switching rolls back a failed session write and preserves the current draft', async t => {
  const h = await background(t); await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  await h.rpc({type: 'DRAFT', value: 'preserve immediately'});
  h.chrome.storage.session.data.providerSessions = {chatgpt: {credential: {provider: 'chatgpt', token: 'synthetic-gpt', receivedAt: 9}}};
  const before = structuredClone(h.chrome.storage.local.data), session = h.chrome.storage.session;
  const original = session.set;
  session.set = async function(values) {if ('providerSessions' in values) throw new Error('storage failure'); return original.call(this, values);};
  assert.equal((await h.rpc({type: 'SELECT_PROVIDER', provider: 'chatgpt'})).ok, false);
  assert.equal(h.chrome.storage.local.data.activeProvider, before.activeProvider);
  assert.equal(h.chrome.storage.local.data.chat.sessionId, before.chat.sessionId);
  assert.equal(h.chrome.storage.local.data.chat.draft, 'preserve immediately');
  session.set = original;
  const result = await h.rpc({type: 'SELECT_PROVIDER', provider: 'chatgpt'});
  assert.equal(result.ok, true); assert.equal(result.data.auth.provider, 'chatgpt');
  assert.equal(result.data.connections.aipro.present, true);
  const returned = await h.rpc({type: 'SELECT_PROVIDER', provider: 'aipro'});
  assert.equal(returned.data.chat.draft, 'preserve immediately');
});

test('unauthorized model discovery exposes reconnect while keeping the connection removable', async t => {
  const h = await background(t); await h.rpc({type: 'SAVE_CREDENTIAL', token: jwt()});
  const {receivedAt} = h.chrome.storage.session.data.credential;
  const denied = await h.rpc({type: 'SAVE_MODELS', credentialReceivedAt: receivedAt, error: 'unauthorized', status: 401});
  assert.equal(denied.data.auth.rejected, true); assert.equal(denied.data.connections.aipro.present, true);
  assert.equal((await h.rpc({type: 'SELECT_PROVIDER', provider: 'aipro'})).error, 'no_credential');
  await h.rpc({type: 'LOGOUT', provider: 'aipro'});
  assert.equal((await h.rpc({type: 'GET_STATE'})).data.connections.aipro.present, false);
});

test('ChatGPT redirect is bound to its exact registered callback before navigating', async t => {
  const h = await background(t, {failure: 'attach'});
  const {attempt, auth} = await startChatGPT(h);
  const rule = (await h.chrome.declarativeNetRequest.getSessionRules())[0];
  const pattern = new RegExp(rule.condition.regexFilter);
  assert.equal(pattern.exec('http://localhost:1455/auth/callback?code=x&state=y')?.[2], 'code=x&state=y');
  for (const url of ['http://localhost:1455/auth?code=x', 'http://localhost:1456/auth/callback?code=x', 'http://127.0.0.1:1455/auth/callback?code=x', 'http://localhost:1455/auth/callback/extra?code=x', 'http://localhost.evil:1455/auth/callback?code=x']) assert(!pattern.test(url));
  assert.deepEqual(rule.condition.tabIds, [attempt.tabId]);
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  assert.deepEqual(rule.condition.requestMethods, ['get']);
  const ready = h.calls.findIndex(call => call.name === 'redirect.rules' && call.addRules.length);
  assert(ready < h.calls.findIndex(call => call.name === 'tabs.update' && call.url === auth.href));
  assert(!h.calls.some(call => call.name.startsWith('debugger.')));
  const {loginFlow} = h.chrome.storage.session.data;
  for (const secret of [loginFlow.verifier, loginFlow.state]) {
    assert(!JSON.stringify(h.chrome.storage.local.data).includes(secret));
    assert(!JSON.stringify(await h.rpc({type: 'GET_STATE'})).includes(secret));
  }
  await h.rpc({type: 'CANCEL_LOGIN'});
  assert.equal(h.chrome.storage.session.data.loginFlow, undefined);
});

test('ChatGPT waiting PKCE survives worker suspension but exchange never replays', async t => {
  const h = await background(t);
  const {attempt, callback} = await startChatGPT(h);
  const session = structuredClone(h.chrome.storage.session.data);
  const initialRules = await h.chrome.declarativeNetRequest.getSessionRules();
  let requests = 0;
  const restarted = await background(t, {session, initialRules, fetchImpl: async (_, options) => {
    requests++; assert.equal(new URLSearchParams(options.body).get('code_verifier'), session.loginFlow.verifier);
    return Response.json(chatgptTokens());
  }});
  assert.equal(restarted.chrome.storage.session.data.attempt.id, attempt.id);
  assert.equal((await restarted.callback(attempt, new URL(callback).search.slice(1))).ok, true);
  await settle(restarted, () => restarted.chrome.storage.session.data.credential?.provider === 'chatgpt');
  assert.equal(requests, 1); assert.equal(restarted.chrome.storage.session.data.loginFlow, undefined);
  assert(!restarted.calls.some(call => call.name.startsWith('debugger.')));
  const exchanging = await background(t, {session: {...session, attempt: {...attempt, phase: 'exchanging'}}, initialRules});
  assert.equal(exchanging.chrome.storage.session.data.authReport.error, 'exchange_interrupted');
  assert.equal(exchanging.chrome.storage.session.data.loginFlow, undefined);
  assert.deepEqual(await exchanging.chrome.declarativeNetRequest.getSessionRules(), []);
});

test('old ChatGPT debugger login is closed before a new AI Pro connection', async t => {
  const attempt = {id: 'old-chatgpt', provider: 'chatgpt', tabId: 50, port: 1455, receiverVersion: 3, phase: 'waiting', expiresAt: Date.now() + 60000};
  const h = await background(t, {session: {attempt, receiverTab: 50, receiverTransport: 'debugger'}});
  assert(!h.tabs.has(50)); assert(h.calls.some(call => call.name === 'debugger.detach' && call.target.tabId === 50));
  const before = h.calls.length;
  await h.start('aipro'); await h.rpc({type: 'CANCEL_LOGIN'});
  assert(!h.calls.slice(before).some(call => call.name.startsWith('debugger.')));
});


function folderRecord(name) {
  return {connectionId: `connection-${name}`, project: {id: `project-${name}`, name}, kind: 'folder', capabilities: ['wiki'], handle: {privateFixtureHandle: name}};
}
function folderStore(active = null) {
  const state = {active, commits: 0, clears: 0, reads: 0, commitFailure: null, clearFailure: null, loadFailure: null};
  return {state,
    async loadWikiFolder() {if (state.loadFailure) throw new Error(state.loadFailure); return state.active;},
    async wikiFolderSummary(record) {return record ? {id: record.project.id, name: record.project.name, kind: 'folder', capabilities: ['wiki'], status: 'connected'} : null;},
    async commitWikiFolder(stageId, {clientId}) {
      assert.equal(stageId, 'prepared-new-folder'); assert.equal(clientId, 'folder-owner'); state.commits++;
      if (state.commitFailure) throw new Error(state.commitFailure);
      state.active = folderRecord('new-folder'); return state.active;
    },
    async clearWikiFolder() {state.clears++; if (state.clearFailure) throw new Error(state.clearFailure); state.active = null;},
    async executeWikiFolderTool() {state.reads++; return {ok: true, dataKind: 'project_reference', content: 'Wiki content'};},
  };
}
function oldServerProject() {
  return {connectionId: 'old-server-connection', origin: 'http://127.0.0.1:43219', project: {id: 'old-server-project', name: 'Old server'},
    token: 'old-server-token-kept-outside-the-model', expiresAt: new Date(Date.now()+3600000).toISOString(), capabilities: ['wiki','source']};
}
const commitFolder = {type: 'WIKI_FOLDER_COMMIT', stageId: 'prepared-new-folder', clientId: 'folder-owner'};

test('folder activation never commits when removing prior server authority fails', async t => {
  const oldFolder = folderRecord('old-folder'), folders = folderStore(oldFolder), server = oldServerProject();
  const h = await background(t, {wikiFolderModule: folders, session: {projectConnection: server}});
  const remove = h.chrome.storage.session.remove;
  h.chrome.storage.session.remove = async function(keys) {
    if ((Array.isArray(keys) ? keys : [keys]).includes('projectConnection')) throw new Error('project_storage');
    return remove.call(this, keys);
  };
  assert.equal((await h.rpc(commitFolder)).error, 'project_storage');
  assert.equal(folders.state.commits, 0); assert.equal(folders.state.active, oldFolder);
  assert.deepEqual(h.chrome.storage.session.data.projectConnection, server);
});

test('failed folder commit restores old server authority and preserves the active folder', async t => {
  const oldFolder = folderRecord('old-folder'), folders = folderStore(oldFolder), server = oldServerProject();
  folders.state.commitFailure = 'project_storage'; let network = 0;
  const h = await background(t, {wikiFolderModule: folders, session: {projectConnection: server}, fetchImpl: async () => {network++; return Response.json({ok:true});}});
  assert.equal((await h.rpc(commitFolder)).error, 'project_storage');
  assert.equal(folders.state.commits, 1); assert.equal(folders.state.active, oldFolder);
  assert.deepEqual(h.chrome.storage.session.data.projectConnection, server); assert.equal(network, 0);
});

test('folder activation succeeds despite diagnostic failure and clear never resurrects its old server', async t => {
  const folders = folderStore(), server = oldServerProject(), requests = [];
  const h = await background(t, {wikiFolderModule: folders, session: {projectConnection: server}, fetchImpl: async (url, options) => {
    requests.push({url, auth: options.headers.Authorization}); return Response.json({ok:true});
  }});
  const originalSet = h.chrome.storage.session.set;
  h.chrome.storage.session.set = async function(values) {if ('events' in values) throw new Error('project_storage'); return originalSet.call(this, values);};
  const selected = await h.rpc(commitFolder);
  assert.equal(selected.ok, true, selected.error); assert.equal(selected.data.project.name, 'new-folder');
  assert.equal(h.chrome.storage.session.data.projectConnection, undefined);
  assert.equal(requests.length, 1); assert(requests[0].url.endsWith('/disconnect'));
  assert.equal(requests[0].auth, `Bearer ${server.token}`);
  assert(!JSON.stringify(selected.data).includes(server.token)); assert(!JSON.stringify(selected.data).includes('privateFixtureHandle'));
  const cleared = await h.rpc({type:'WIKI_FOLDER_CLEAR',clientId:'folder-owner'});
  assert.equal(cleared.ok, true, cleared.error); assert.equal(cleared.data.project, null);
  assert.equal(cleared.data.serverProject, null); assert.equal(folders.state.active, null);
});

test('clearing a configured folder removes stale server authority before its handle', async t => {
  const oldFolder = folderRecord('old-folder'), folders = folderStore(oldFolder), server = oldServerProject();
  const h = await background(t, {wikiFolderModule: folders, session: {projectConnection: server}, fetchImpl: async () => Response.json({ok:true})});
  const originalRemove = h.chrome.storage.session.remove;
  h.chrome.storage.session.remove = async function(keys) {if ((Array.isArray(keys)?keys:[keys]).includes('projectConnection')) throw new Error('project_storage'); return originalRemove.call(this,keys);};
  assert.equal((await h.rpc({type:'WIKI_FOLDER_CLEAR',clientId:'folder-owner'})).error,'project_storage');
  assert.equal(folders.state.clears,0); assert.equal(folders.state.active,oldFolder);
  h.chrome.storage.session.remove = originalRemove;
  const result = await h.rpc({type:'WIKI_FOLDER_CLEAR',clientId:'folder-owner'});
  assert.equal(result.ok,true,result.error); assert.equal(result.data.project,null); assert.equal(result.data.serverProject,null);
});

test('active chat blocks folder configuration changes and rejects a changed folder identity', async t => {
  const folders = folderStore(folderRecord('active-folder'));
  const h = await background(t, {wikiFolderModule:folders});
  await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
  const started = await h.rpc({type:'START_CHAT',text:'Wiki에서 저장 동작을 찾아줘',clientId:'folder-owner'});
  assert.equal(started.ok,true,started.error); assert(started.data.tools.some(tool=>tool.function.name==='ask_openwiki'));
  assert.equal(h.chrome.storage.session.data.chatLease.projectConnectionId,'connection-active-folder');
  assert.equal((await h.rpc(commitFolder)).error,'busy');
  assert.equal((await h.rpc({type:'WIKI_FOLDER_CLEAR',clientId:'folder-owner'})).error,'busy');
  assert.equal(folders.state.commits,0); assert.equal(folders.state.clears,0);
  // Simulate an external storage replacement after the lease was issued.
  folders.state.active = folderRecord('different-folder');
  const changed = await h.rpc({type:'RUN_TOOL',requestId:started.data.requestId,clientId:'folder-owner',name:'ask_openwiki',args:{wiki:'external',question:'저장 방식은?'}});
  assert.equal(changed.data.error,'project_changed'); assert.equal(folders.state.reads,0);
});

test('folder database failure leaves ordinary chat usable without falling back to a server project', async t => {
  const folders = folderStore(folderRecord('saved-folder')); folders.state.loadFailure='project_storage';
  const h = await background(t,{wikiFolderModule:folders,session:{projectConnection:oldServerProject()}});
  await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
  const status = await h.rpc({type:'GET_STATE'});
  assert.equal(status.ok,true); assert.equal(status.data.project,null); assert.equal(status.data.wikiFolderError,'project_storage');
  const chat = await h.rpc({type:'START_CHAT',text:'안녕하세요',clientId:'folder-owner'});
  assert.equal(chat.ok,true,chat.error); assert.equal(chat.data.project,null);
  assert(!chat.data.tools.some(tool=>['wiki_read','wiki_search','read_source','source_search'].includes(tool.function.name)));
  assert.equal(h.chrome.storage.session.data.chatLease.projectConnectionId,null); assert.equal(folders.state.reads,0);
});

test('a late completion cannot become success after cancellation or authentication replacement', async t => {
  for (const changed of ['cancel', 'credential']) {
    await t.test(changed, async t => {
      const h=await background(t), panel={id:'synthetic',url:h.chrome.runtime.getURL('index.html')};
      await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()},panel);
      const started=await h.rpc({type:'START_CHAT',text:'hello',clientId:'owner'},panel);assert(started.ok);
      if(changed==='cancel')await h.rpc({type:'CANCEL_BROWSER',requestId:started.data.requestId,clientId:'owner'},panel);
      else h.chrome.storage.session.data.credential.receivedAt+=1;
      const result=await h.rpc({type:'FINISH_CHAT',requestId:started.data.requestId,clientId:'owner',content:'late answer'},panel);
      assert(result.ok);assert.equal(result.data.busy,false);assert.equal(result.data.chat.messages.at(-1).state,'error');
      assert.equal(result.data.chat.messages.at(-1).error,changed==='cancel'?'cancelled':'interrupted');
      if(changed==='credential')assert.equal(result.data.chat.messages.at(-1).content,'');
    });
  }
});

test('site wiki writes are atomic, conversation bound and revoked after deletion', async t => {
  const h=await background(t);await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
  const chat=h.chrome.storage.local.data.chat,candidate={url:'https://portal.example/work',title:'업무',provider:'aipro',verifiedAt:Date.now(),document:{headings:['업무']}};
  chat.messages.push({id:'source',state:'done',role:'assistant',wikiOffer:{candidate,revision:0,status:'drafted'}}, {id:'draft',state:'done',role:'assistant',creationSource:{kind:'wiki',sourceId:'source',candidate,revision:0},wikiDraft:{title:'업무 안내',markdown:'# 업무'}});
  const request={type:'SAVE_BROWSER_WIKI',messageId:'draft',conversationId:chat.sessionId,document:{title:'업무 안내',markdown:'# 검토한 내용'}};
  assert.equal((await h.rpc({...request,conversationId:'other'})).error,'conversation_changed');
  const old=h.chrome.storage.local.set;h.chrome.storage.local.set=async()=>{throw new Error('quota');};
  assert.equal((await h.rpc(request)).ok,false);assert.equal(h.chrome.storage.local.data.browserKnowledge,undefined);assert(!h.chrome.storage.local.data.chat.messages.at(-1).wikiDraft.saved);
  h.chrome.storage.local.set=old;
  assert.equal((await h.rpc(request)).ok,true);assert.equal(h.chrome.storage.local.data.browserKnowledge.entries[0].markdown,'# 검토한 내용');assert(h.chrome.storage.local.data.chat.messages.at(-1).wikiDraft.saved);
  assert.equal((await h.rpc({type:'UPDATE_BROWSER_KNOWLEDGE',clear:true})).ok,true);
  assert.equal((await h.rpc(request)).ok,false);assert.equal(h.chrome.storage.local.data.browserKnowledge.entries.length,0);
});

test('/wiki is a reserved read-only initialization command even with a custom active skill',async t=>{
 const h=await background(t);await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
 h.tabs.set(42,{id:42,url:'https://portal.example/',title:'업무'});h.chrome.tabs.query=async()=>[h.tabs.get(42)];
 await h.rpc({type:'SAVE_SKILL',skill:{name:'Editing',description:'edit',instructions:'Edit forms',toolMode:'automatic'}});
 const request=await h.rpc({type:'START_CHAT',text:'/wiki',clientId:'owner'});
 assert.equal(request.ok,true,request.error);
 assert(request.data.tools.some(t=>t.function.name==='read_page'));
 assert(request.data.tools.every(t=>['read_page','browser_snapshot','inspect_dom','verify_page','ask_user','find_skills','read_skill','progress_note'].includes(t.function.name)));
 const forbidden=await h.rpc({type:'RUN_TOOL',requestId:request.data.requestId,clientId:'owner',name:'click_element',args:{ref:'fake'}});assert.equal(forbidden.ok,false);
 assert.equal(h.chrome.storage.local.data.chat.messages.findLast(m=>m.role==='user').displayContent,'/wiki');
});

test('built-in OpenWiki snapshot is scoped to the request origin and remains separate from an external Wiki',async t=>{
 const h=await background(t);await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
 h.tabs.set(42,{id:42,url:'https://portal.example/current',title:'포털'});h.chrome.tabs.query=async()=>[h.tabs.get(42)];
 h.chrome.storage.local.data.browserKnowledge={entries:[{url:'https://portal.example/work',title:'업무 시간',provider:'aipro',verifiedAt:Date.now(),reviewedAt:Date.now(),markdown:'# 업무 시간\n단위를 확인합니다.'}]};
 const started=await h.rpc({type:'START_CHAT',text:'업무 시간 확인해줘',clientId:'owner'});assert(started.data.tools.some(t=>t.function.name==='ask_openwiki'));
 assert(!started.data.tools.some(t=>t.function.name==='search_site_wiki'));
 const call=wiki=>h.rpc({type:'RUN_TOOL',requestId:started.data.requestId,clientId:'owner',name:'ask_openwiki',args:{wiki,question:'업무 시간'}});
 const snapshot=await call('internal');assert.equal(snapshot.data.documents[0].title,'업무 시간');assert(snapshot.data.documents[0].text.includes('단위'));
 assert.equal((await call('external')).data.error,'tools_unavailable');
 h.tabs.set(42,{id:42,url:'https://other.example/'});assert.equal((await call('internal')).data.documents.length,0);
});

for(const html of [false,true]) test(`expired external OpenWiki snapshot revokes the connection (${html?'HTML':'JSON'})`,async t=>{
 const connection={connectionId:'wiki-connection',origin:'http://127.0.0.1:43219',token:'private-project-token',project:{id:'project-a',name:'Wiki'},capabilities:['wiki'],features:['wiki_snapshot'],expiresAt:new Date(Date.now()+3600000).toISOString()};
 let calls=0;
 const h=await background(t,{session:{projectConnection:connection},fetchImpl:async url=>{
   assert.equal(new URL(url).pathname,'/api/nubi/v1/wiki/snapshot');calls++;
   return html?new Response('<html>expired</html>',{status:401}):Response.json({error:{code:'connection_expired'}},{status:401});
 }});
 await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
 const started=await h.rpc({type:'START_CHAT',text:'위키 확인',clientId:'owner'});assert.equal(started.ok,true,started.error);
 const result=await h.rpc({type:'RUN_TOOL',requestId:started.data.requestId,clientId:'owner',name:'ask_openwiki',args:{wiki:'external',question:'내용은?'}});
 assert.equal(result.data?.error,'project_expired');
 assert.equal(h.chrome.storage.session.data.projectConnection.rejected,true);
 assert.equal((await h.rpc({type:'GET_STATE'})).data.project.status,'expired');
 const again=await h.rpc({type:'RUN_TOOL',requestId:started.data.requestId,clientId:'owner',name:'ask_openwiki',args:{wiki:'external',question:'다시?'}});
 assert.equal(again.data?.error,'project_expired');assert.equal(calls,1);
});

test('an old Wiki rejection cannot overwrite a replaced connection',async t=>{
 const connection={connectionId:'old-connection',origin:'http://127.0.0.1:43219',token:'old-private-token',project:{id:'project-a',name:'Wiki'},capabilities:['wiki'],features:['wiki_snapshot'],expiresAt:new Date(Date.now()+3600000).toISOString()};
 const replacement={...connection,connectionId:'new-connection',token:'new-private-token'};
 const h=await background(t,{session:{projectConnection:connection},fetchImpl:async()=>{
   h.chrome.storage.session.data.projectConnection=replacement;
   return new Response('',{status:401});
 }});
 await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
 const started=await h.rpc({type:'START_CHAT',text:'위키 확인',clientId:'owner'});
 assert.equal(started.ok,true,started.error);
 const result=await h.rpc({type:'RUN_TOOL',requestId:started.data.requestId,clientId:'owner',name:'ask_openwiki',args:{wiki:'external',question:'내용은?'}});
 assert.equal(result.data?.error,'project_expired');
 assert.deepEqual(h.chrome.storage.session.data.projectConnection,replacement);
});

test('wiki generation rejects revoked or disabled offers before starting a model lease',async t=>{
 for(const enabled of [true,false]) {
  const h=await background(t);await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
  const chat=h.chrome.storage.local.data.chat;
  chat.messages.push({id:'source',state:'done',role:'assistant',wikiOffer:{candidate:{url:'https://portal.example/work',title:'업무',provider:'aipro',verifiedAt:Date.now()},revision:0,status:'offered'}});
  h.chrome.storage.local.data.browserKnowledge={enabled,revision:1,entries:[]};
  const before=structuredClone(chat);
  const result=await h.rpc({type:'START_CHAT',createWiki:'source',clientId:'owner'});
  assert.equal(result.ok,false);
  assert.equal(result.error,enabled?'wiki_source_missing':'wiki_disabled');
  assert.deepEqual(h.chrome.storage.local.data.chat,before);
  assert(!h.chrome.storage.session.data.chatLease);
 }
});

test('wiki question continuation rejects a newer document without consuming the answer',async t=>{
 const h=await background(t);await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()});
 const chat=h.chrome.storage.local.data.chat,candidate={url:'https://portal.example/work',title:'업무',provider:'aipro',verifiedAt:Date.now()};
 chat.messages.push({id:'question',state:'done',role:'assistant',creatingSkill:true,question:{id:'q',text:'어떤 업무인가요?'},creationSource:{kind:'wiki',candidate,revision:0,targetVersion:1}});
 h.chrome.storage.local.data.browserKnowledge={revision:0,entries:[{...candidate,documentVersion:2,markdown:'# 최신 문서'}]};
 const before=structuredClone(chat);
 const result=await h.rpc({type:'START_CHAT',text:'업무 기록',clientId:'owner'});
 assert.equal(result.error,'wiki_changed');assert.deepEqual(h.chrome.storage.local.data.chat,before);assert(!h.chrome.storage.session.data.chatLease);
});


test('optional download and notification events register after grant, revoke and regrant without a worker restart',async t=>{
  const h=await background(t);
  assert.equal(h.chrome.downloads,undefined);
  h.chrome.downloads={onChanged:chromeEvent()};h.chrome.notifications={onClicked:chromeEvent(),clear:async()=>true};
  h.chrome.permissions.onAdded.emit({permissions:['downloads','notifications']});
  assert.equal(h.chrome.downloads.onChanged.count(),1);assert.equal(h.chrome.notifications.onClicked.count(),1);
  h.chrome.permissions.onAdded.emit({permissions:['downloads']});assert.equal(h.chrome.downloads.onChanged.count(),1);
  h.chrome.permissions.onRemoved.emit({permissions:['downloads','notifications']});
  assert.equal(h.chrome.downloads.onChanged.count(),0);assert.equal(h.chrome.notifications.onClicked.count(),0);
  h.chrome.permissions.onAdded.emit({permissions:['downloads','notifications']});
  assert.equal(h.chrome.downloads.onChanged.count(),1);assert.equal(h.chrome.notifications.onClicked.count(),1);
  const chat=h.chrome.storage.local.data.chat;
  await h.chrome.storage.local.set({browserNotificationReceipts:{'nubi-result:r':{conversationId:chat.sessionId,provider:chat.provider}}});
  h.chrome.notifications.onClicked.emit('nubi-result:r');await h.flush();
  assert(h.calls.some(c=>c.name==='tabs.create'&&c.url.includes('?conversation='+encodeURIComponent(chat.sessionId)+'#history')));
});

test('download settings reconcile a missed completion event using the saved Chrome id',async t=>{
  const h=await background(t),chat=h.chrome.storage.local.data.chat;
  await h.chrome.storage.local.set({browserTransfers:[{id:'transfer',downloadId:7,status:'in_progress',provider:chat.provider,conversationId:chat.sessionId}]});
  h.chrome.downloads={onChanged:chromeEvent(),search:async()=>[{id:7,state:'complete',url:'https://example.org/file',filename:'/private/user/receipt.txt',bytesReceived:12,totalBytes:12,exists:true}]};
  const result=await h.rpc({type:'GET_BROWSER_ROUTINES'});assert.equal(result.ok,true,result.error);
  assert.equal(result.data.transfers[0].status,'complete');assert.equal(result.data.transfers[0].filename,'receipt.txt');
  assert(!JSON.stringify(result.data).includes('/private/user'));
});


test('download preparation reaches durable approval without permission, but approval cannot be consumed without it', async t => {
  let prepared=0;
  const h=await background(t,{browserRun:async(_id,page,name,_args,options)=>{
    assert.equal(name,'prepare_download');prepared++;
    return {tabId:page.tabId,result:await options.onApproval({action:'다운로드',label:'교육 안내',pageTitle:'자료',hasEditableDraft:false,
      operation:{method:'download',url:'https://fixture.test/training.txt'},preview:[]})};
  }});
  const panel={id:'synthetic',url:h.chrome.runtime.getURL('index.html')};
  await h.rpc({type:'SAVE_CREDENTIAL',token:jwt()},panel);
  h.tabs.set(42,{id:42,url:'https://fixture.test/one'});h.chrome.tabs.query=async()=>[h.tabs.get(42)];
  h.chrome.permissions.contains=async args=>!args.permissions?.includes('downloads');
  h.chrome.scripting={async executeScript(){return [{documentId:'fixture-document',result:{title:'자료',url:'https://fixture.test/one'}}];}};
  const started=await h.rpc({type:'START_CHAT',text:'교육 안내 파일을 다운로드해줘',clientId:'owner'},panel);
  assert.equal(started.ok,true,started.error);
  const chat=h.chrome.storage.local.data.chat;
  chat.task={requestId:started.data.requestId,status:'running',verification:{status:'passed'}};
  const result=await h.rpc({type:'RUN_TOOL',requestId:started.data.requestId,clientId:'owner',name:'prepare_download',args:{ref:'observed-file'}},panel);
  assert.equal(result.ok,true,result.error);assert.equal(result.data.requiresUserInput,true);assert.equal(prepared,1);
  const saved=h.chrome.storage.local.data.chat,question=saved.messages.at(-1).question;
  assert.equal(question.requiredPermission,'downloads');assert.equal(question.kind,'approval');assert(!question.answer);
  const record=structuredClone(h.chrome.storage.session.data.actionApprovals[saved.sessionId]);
  await h.rpc({type:'FINISH_CHAT',requestId:started.data.requestId,clientId:'owner',content:'',status:200},panel);
  const denied=await h.rpc({type:'START_CHAT',clientId:'owner',choice:{questionId:question.id,optionId:'approve'}},panel);
  assert.equal(denied.error,'download_permission');
  assert.deepEqual(h.chrome.storage.session.data.actionApprovals[saved.sessionId],record);
  assert(!h.chrome.storage.local.data.chat.messages.at(-1).question.answer);assert.equal(prepared,1);
});

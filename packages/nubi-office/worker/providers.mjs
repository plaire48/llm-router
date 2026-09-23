import {createServer} from 'node:http';
import {PROVIDER_LABELS, ORIGIN, endpoint} from '../../../extensions/aipro-chat/core.js';
import {chatGPTModels, completeChatGPT} from '../../../extensions/aipro-chat/chatgpt-api.js';
import {createChatGPTLogin, chatGPTCallback, exchangeChatGPTCode, refreshChatGPTToken} from '../../../extensions/aipro-chat/chatgpt-auth.js';
import {cleanFabrixCredentials, fabrixModels, fabrixCompletion} from '../../../extensions/aipro-chat/fabrix.js';
import {readCompletion} from '../../../extensions/aipro-chat/completion-reader.js';
import {startLogin, fetchModelCatalog, openLoginBrowser} from './aipro-auth.mjs';
import {safeError} from './connection-errors.mjs';
import {faultFacts,retryAfterMs} from './fault-policy.mjs';
export {safeError} from './connection-errors.mjs';

// Explicit implemented adapters make parity tests fail when Nubi adds a provider.
export const PROVIDERS = {aipro: PROVIDER_LABELS.aipro, chatgpt: PROVIDER_LABELS.chatgpt, fabrix: PROVIDER_LABELS.fabrix, 'aipro-cli': 'AI Pro CLI', compatible: 'OpenAI 호환'};
const catalog = payload => (payload?.modelList || []).map(m => ({id: m.name, label: m.display_name || m.name, contextLength: m.context_length, maxOutputTokens: m.max_output_tokens, ...(typeof m.supports_images==='boolean'?{supportsImages:m.supports_images}:{})}));
// Prefer the enterprise catalog's actual Qwen 3.8 27B ID. Never fabricate a
// public model ID/context size, filter alternatives, or replace a user choice.
export function defaultOfficeModel(models) {
  const match=value=>/qwen[\s_.-]*3[\s_.-]*8[\s_.-]*27b(?:\b|[_-])/i.test(value||'');
  return models.find(m=>match(m.id)||match(m.label))?.id||models[0]?.id||'';
}
export function manualConnection(input) {
  const url = new URL(String(input.baseUrl || '').trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash || url.search) throw new Error('invalid_endpoint');
  if (typeof input.token !== 'string' || !/^[\x21-\x7e]{1,16384}$/.test(input.token) || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200) throw new Error('invalid_credentials');
  return {token: input.token, endpoint: url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions', models: [{id: input.model.trim(), label: input.model.trim()}]};
}

async function chatGPTLogin({openBrowser = openLoginBrowser, fetchImpl = fetch, hostLabel = 'Excel'} = {}) {
  const host = hostLabel === '누비 워크스페이스' ? hostLabel : 'Excel';
  const flow = await createChatGPTLogin(), controller = new AbortController();
  let resolve, reject, finished = false, consumed = false;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; }); result.catch(() => {});
  const done = (error, credential) => { if (finished) return; finished = true; clearTimeout(timer); controller.abort(); server.close(); error ? reject(error) : resolve(credential); };
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method !== 'GET' || !['localhost:1455', '127.0.0.1:1455'].includes(request.headers.host)) { response.writeHead(403).end(); return; }
    let code;
    try { code = chatGPTCallback(`http://localhost:1455${request.url}`, flow); } catch { response.writeHead(400).end('Invalid callback'); return; }
    if (consumed || finished) { response.writeHead(409).end(); return; }
    consumed = true;
    void exchangeChatGPTCode(code, flow, {signal: controller.signal, fetchImpl}).then(({credential}) => {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(`<!doctype html><meta charset="utf-8"><title>누비</title><p>ChatGPT에 연결했습니다. ${host}로 돌아가세요.</p>`); done(null, credential);
    }, () => { response.writeHead(400).end('Login failed. Return to Nubi and retry.'); done(new Error('chatgpt_exchange_rejected')); });
  });
  const timer = setTimeout(() => done(new Error('login_timeout')), 180000);
  try { await new Promise((yes, no) => { server.once('error', no); server.listen(1455, '127.0.0.1', yes); }); await openBrowser(flow.url); }
  catch { done(new Error('login_port_busy')); }
  return {result, cancel: () => done(new Error('cancelled'))};
}

export function createProviders(deps = {}) {
  const api = {fetchImpl: fetch, startLogin, chatGPTLogin, chatGPTModels, completeChatGPT, refreshChatGPTToken, fabrixModels, fabrixCompletion, ...deps};
  const sessions = new Map(); let active = 'aipro', pending = null, loginError = null, generation = 0;
  const status = () => ({providers: Object.entries(PROVIDERS).map(([id, label]) => ({id, label, connected: sessions.has(id)})), provider: active,
    connected: sessions.has(active), vision:active!=='fabrix'&&sessions.get(active)?.models.find(m=>m.id===sessions.get(active)?.model)?.supportsImages===true, models: sessions.get(active)?.models || [], model: sessions.get(active)?.model || '', verified: !!sessions.get(active)?.verified,
    modelCatalog: sessions.get(active)?.modelCatalog || null, pending: pending?.provider || null, loginError});
  const select = provider => { if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('invalid_provider'); active = provider; return status(); };
  async function connect(input) {
    const provider = input.provider; if (!['fabrix', 'aipro-cli', 'compatible'].includes(provider)) throw new Error('invalid_provider');
    let session;
    if (provider === 'fabrix') {
      const credential = cleanFabrixCredentials(input); const result = await api.fabrixModels(credential, {fetchImpl: api.fetchImpl, signal: AbortSignal.timeout(20000)});
      session = {credential, models: catalog(result.payload)}; if (!session.models.length) throw new Error('models_invalid');
    } else { const manual = manualConnection(input); session = {credential: manual, models: manual.models}; }
    sessions.set(provider, {...session, model: defaultOfficeModel(session.models), verified: false}); active = provider; return status();
  }
  async function login(provider) {
    if (!['aipro', 'chatgpt'].includes(provider) || pending) throw new Error('login_busy');
    const attempt = ++generation; pending = {provider, cancel: () => {}}; loginError = null; active = provider;
    try {
      const flow = await (provider === 'aipro' ? api.startLogin : api.chatGPTLogin)({fetchImpl: api.fetchImpl, hostLabel: api.hostLabel});
      if (attempt !== generation) { flow.cancel(); return status(); } pending.cancel = flow.cancel;
      void flow.result.then(result => {
        if (attempt !== generation) return;
        const models = provider === 'aipro' ? result.models : catalog(api.chatGPTModels().payload);
        sessions.set(provider, {credential: provider === 'aipro' ? {token: result.token, mode: 'browser'} : result, models, model: defaultOfficeModel(models), verified: false,
          modelCatalog: provider === 'aipro' && result.diagnostics ? {diagnostics: result.diagnostics, fetchedAt: result.fetchedAt} : null}); pending = null;
      }, error => { if (attempt === generation) { pending = null; loginError = safeError(error); } });
    } catch (error) { if (attempt === generation) { pending = null; loginError = safeError(error); } }
    return status();
  }
  function cancelLogin() { generation++; pending?.cancel(); pending = null; loginError = null; return status(); }
  function disconnect(provider = active) { if (pending?.provider === provider) cancelLogin(); sessions.delete(provider); return status(); }
  function model(id) { const s = sessions.get(active); if (!s?.models.some(m => m.id === id)) throw new Error('invalid_model'); s.model = id; return status(); }
  async function refreshModels() {
    const provider = active, session = sessions.get(provider);
    if (!session) throw new Error('no_credential');
    const signal = AbortSignal.timeout(20000);
    const received = provider === 'aipro' ? await fetchModelCatalog(session.credential.token, api.fetchImpl, signal) : null;
    const models = provider === 'aipro' ? received.models
      : provider === 'chatgpt' ? catalog(api.chatGPTModels().payload)
      : provider === 'fabrix' ? catalog((await api.fabrixModels(session.credential, {fetchImpl:api.fetchImpl,signal})).payload)
      : session.models;
    if (!models.length) throw new Error('models_invalid');
    if (sessions.get(provider) === session) { session.models = models; if (received) session.modelCatalog = {diagnostics: received.diagnostics, fetchedAt: received.fetchedAt}; if (!models.some(item => item.id === session.model)) session.model = defaultOfficeModel(models); }
    return status();
  }
  async function complete(messages, tools, signal, onText, onPhase) {
    const provider = active, session = sessions.get(provider); if (!session) throw new Error('no_credential');
    let result, httpFailure;
    const inferenceFetch=async(...args)=>{
      const response=await api.fetchImpl(...args);
      if(!response.ok)httpFailure={status:response.status,retryAfterMs:retryAfterMs(response.headers)};
      return response;
    };
    try {
    if (provider === 'chatgpt') {
      if (session.credential.expiresAt <= Date.now() + 60000) session.credential = (await api.refreshChatGPTToken(session.credential, {signal, fetchImpl: api.fetchImpl})).credential;
      result = await api.completeChatGPT({messages, tools, modelId: session.model, credential: session.credential, signal, onText, onPhase});
    } else {
      const body = {model: session.model, messages, stream: true, max_tokens: 4096, ...(tools.length ? {tools, tool_choice: 'auto'} : {})};
      const response = provider === 'fabrix'
        ? await api.fabrixCompletion(body, {...session.credential, modelId: session.model}, {signal, fetchImpl: inferenceFetch})
        : await inferenceFetch(provider === 'aipro' ? endpoint('browser') : session.credential.endpoint, {method: 'POST', redirect: 'error', signal,
          headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${session.credential.token}`, ...(provider === 'aipro-cli' ? {'User-Agent': 'AIPROCLI'} : {})}, body: JSON.stringify(body)});
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(new Error(response.status===401?'unauthorized':response.status===403?'forbidden':response.status===429?'rate_limited':response.status===413?'context_overflow':[400,404,422].includes(response.status)?'invalid_model':'upstream'),{status:response.status,retryAfterMs:retryAfterMs(response.headers)});}
      let calls = [], usage, finishReason;
      // Keep Office's permanent transport error distinct from a repairable
      // model schema error across shared reader versions. Read the body once.
      const completionResponse={ok:response.ok,status:response.status,headers:response.headers,body:response.body,json:async()=>{
        try{return await response.json();}catch(error){if(error instanceof SyntaxError)throw new Error('response_json_invalid');throw error;}
      }};
      const content = await readCompletion(completionResponse, onText, value => {usage = value;}, onPhase, value => {finishReason = value;}, value => {calls = value;});
      result = {content, calls, usage, finishReason};
    }
    if (signal.aborted) throw new Error('cancelled');
    if (JSON.stringify(result).length > 64000) throw new Error('output_limit');
    if (result.finishReason === 'length') throw new Error('output_limit');
    session.verified = true; return result;
    }catch(error){
      const facts={...faultFacts(httpFailure),...faultFacts(error)};
      // A failed inference cannot contribute executable tools or partial text.
      // Preserve only actionable codes and HTTP timing across shared versions.
      throw Object.assign(new Error(signal.aborted?'cancelled':facts.status===413?'context_overflow':safeError(error)),facts);
    }
  }
  return {status, select, connect, login, cancelLogin, disconnect, model, refreshModels, complete, dispose: () => {cancelLogin(); sessions.clear();}};
}

import {nubiAuthPage} from './nubi-auth-page.mjs';
import {createServer} from 'node:http';
import {PROVIDER_LABELS, ORIGIN, endpoint} from '../../../extensions/aipro-chat/core.js';
import {chatGPTModels, completeChatGPT} from '../../../extensions/aipro-chat/chatgpt-api.js';
import {createChatGPTLogin, chatGPTCallback, exchangeChatGPTCode, refreshChatGPTToken} from '../../../extensions/aipro-chat/chatgpt-auth.js';
import {cleanFabrixCredentials, fabrixModels, fabrixCompletion} from '../../../extensions/aipro-chat/fabrix.js';
import {readCompletion} from '../../../extensions/aipro-chat/completion-reader.js';
import {visionModelFor,hasImageInput} from '../../../extensions/aipro-chat/model-routing.js';
import {classifyCompletionError} from '../../../extensions/aipro-chat/completion-errors.js';
import {startLogin, fetchModelCatalog, openLoginBrowser, windowTokens} from './aipro-auth.mjs';
import {safeError} from './connection-errors.mjs';
import {faultFacts,retryAfterMs} from './fault-policy.mjs';
import {OUTPUT_TOKENS} from './context-budget.mjs';
import {ACCOUNT_USAGE_VERSION, fetchAccountUsage, freshAccountUsage, normalizeAccountUsage} from '../../../extensions/aipro-chat/account-usage.js';
export {safeError} from './connection-errors.mjs';

// The answer size requested from an OpenAI-compatible server: the output limit the catalog or the connection reports,
// otherwise the reserve the context budget keeps (OUTPUT_TOKENS), at most 32,768. A server that refuses that size
// keeps 4,096, the size used before, for the rest of the session.
const OUTPUT_TOKEN_CEILING = 32768, FALLBACK_OUTPUT_TOKENS = 4096;
const positiveCount = value => Number.isSafeInteger(value) && value > 0;
export function outputTokens(session) {
  if (positiveCount(session?.outputTokens)) return session.outputTokens;
  const selected = session?.models?.find?.(item => item.id === session.model);
  const reported = positiveCount(selected?.maxOutputTokens) ? selected.maxOutputTokens : positiveCount(session?.credential?.maxOutputTokens) ? session.credential.maxOutputTokens : null;
  const capacity = selected?.contextLength;
  const windowLimit = positiveCount(capacity) ? Math.max(1024, Math.floor(capacity * .15)) : OUTPUT_TOKEN_CEILING;
  return Math.min(reported ?? OUTPUT_TOKENS, OUTPUT_TOKEN_CEILING, windowLimit);
}
const refusesOutputSize = text => /max[_ ]?(?:completion_|output_|new_)?tokens|maximum context|context length|output tokens/i.test(text);
// A server that does not take the usage option names it (OpenAI: param stream_options; vLLM: detail[].loc) or quotes it.
const refusesUsage = (status, text) => {let payload; try {payload = JSON.parse(text);} catch {} return classifyCompletionError(status, payload).reason === 'stream_options' || /stream_options|include_usage/i.test(text);};
// A server that does not take a requested output format names it (OpenAI-compatible, vLLM guided decoding).
const refusesFormat = (status, text) => [400, 422].includes(status) && /response_format|json_schema|guided|structured output/i.test(text);
// Explicit implemented adapters make parity tests fail when Nubi adds a provider.
export const PROVIDERS = {aipro: PROVIDER_LABELS.aipro, chatgpt: PROVIDER_LABELS.chatgpt, fabrix: PROVIDER_LABELS.fabrix, 'aipro-cli': 'AI Pro CLI', compatible: 'OpenAI 호환'};
const catalog = payload => (payload?.modelList || []).map(m => ({
  id: m.name, label: m.display_name || m.name, contextLength: windowTokens(m) ?? undefined,
  maxOutputTokens: m.max_output_tokens,
  ...(Array.isArray(m.supported_reasoning_levels)?{reasoningOptions:m.supported_reasoning_levels.filter(value=>['none','minimal','low','medium','high','xhigh','max'].includes(value))}:{}),
  ...(['none','minimal','low','medium','high','xhigh','max'].includes(m.default_reasoning_level)?{defaultReasoning:m.default_reasoning_level}:{}),
  ...(Number.isSafeInteger(m.max_context_length)&&m.max_context_length>0?{maxContextLength:m.max_context_length}:{}),
  ...(['account','bundled'].includes(m.context_source)?{contextSource:m.context_source}:{}),
  ...(Number.isSafeInteger(m.max_input_tokens)&&m.max_input_tokens>0?{maxInputTokens:m.max_input_tokens}:{}),
  ...(typeof m.supports_images==='boolean'?{supportsImages:m.supports_images}:{})
}));
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

export async function chatGPTLogin({openBrowser = openLoginBrowser, fetchImpl = fetch, hostLabel = 'Excel',onProgress=()=>{},timeoutMs=180000} = {}) {
  const host = hostLabel === '누비 워크스페이스' ? hostLabel : 'Excel';
  const started=Date.now(),progress=(phase,extra={})=>{try{onProgress({phase,at:Date.now(),elapsedMs:Date.now()-started,...extra});}catch{}};progress('waiting');
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
    consumed = true;progress('callback_received');progress('exchanging');
    void exchangeChatGPTCode(code, flow, {signal: controller.signal, fetchImpl}).then(({credential,status}) => {if(finished)return;progress('ready',{status});
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(nubiAuthPage({host,provider:'ChatGPT'})); done(null, credential);
    }, error => {if(finished)return;progress('failed',{failedStage:'exchanging',status:error.status,error:safeError(error)});response.writeHead(400,{'Content-Type':'text/html; charset=utf-8'}).end(nubiAuthPage({host,provider:'ChatGPT',error:true}));done(error);});
  });
  const timer = setTimeout(() => done(new Error('login_timeout')), Number.isSafeInteger(timeoutMs)&&timeoutMs>=180000&&timeoutMs<=600000?timeoutMs:180000);
  try { await new Promise((yes, no) => { server.once('error', no); server.listen(1455, '127.0.0.1', yes); }); await openBrowser(flow.url); }
  catch (error) { const code=error?.code==='EADDRINUSE'?'login_port_busy':'login_browser_failed';progress('failed',{failedStage:'waiting',error:code});done(new Error(code)); }
  return {result, cancel: () => done(new Error('cancelled'))};
}

export function createProviders(deps = {}) {
  const api = {fetchImpl: fetch, startLogin, chatGPTLogin, chatGPTModels, completeChatGPT, refreshChatGPTToken, fabrixModels, fabrixCompletion, ...deps};
  const connectionIds = new WeakMap(); let connectionSequence = 0;
  const connectionId = session => {if(!session)return null;if(!connectionIds.has(session))connectionIds.set(session,++connectionSequence);return connectionIds.get(session);};
  const sessions = new Map(); let active = 'aipro', pending = null, loginError = null, generation = 0;
  let loginPhase=null,loginDiagnostics=[];
  // The model the user chose for each provider. A new login or connection keeps it while the account still lists it,
  // as the browser Nubi does; otherwise the default rule applies. Kept in memory for the life of the worker.
  // Display labels belong to the UI; every host sends canonical API effort IDs.
  const chosen = new Map(), chosenReasoning = new Map();
  let persistence=Promise.resolve(),persistenceError=null;
  const persist=provider=>{
    if(!api.onConnectionChange)return Promise.resolve();
    const session=sessions.get(provider),record=session?structuredClone({version:1,provider,credential:session.credential,model:session.model,reasoningEffort:session.reasoningEffort}):null;
    persistence=persistence.catch(()=>{}).then(()=>api.onConnectionChange(provider,record)).then(()=>{persistenceError=null;},()=>{persistenceError=record?'connection_not_saved':'connection_not_removed';});return persistence;
  };
  const persistActive=()=>{if(api.onActiveProvider){const value=active;persistence=persistence.catch(()=>{}).then(()=>api.onActiveProvider(value)).catch(()=>{persistenceError='connection_not_saved';});}};

  const reasoningOptions = (provider, session = sessions.get(provider)) => {
    if (provider === 'aipro') return ['low','medium','xhigh'];
    if (provider !== 'chatgpt') return [];
    const reported = api.accountCatalog === true ? session?.models.find(item=>item.id===session.model)?.reasoningOptions : undefined;
    return Array.isArray(reported) ? reported : ['low','medium','high','xhigh','max'];
  };
  const startModel = (provider, models) => models.some(item => item.id === chosen.get(provider)) ? chosen.get(provider) : defaultOfficeModel(models);
  const startReasoning = (provider, session) => {
    const allowed=reasoningOptions(provider,session), preferred=chosenReasoning.get(provider);
    const fallback=session?.models.find(item=>item.id===session.model)?.defaultReasoning;
    return allowed.includes(preferred)?preferred:allowed.includes(fallback)?fallback:allowed.includes('medium')?'medium':allowed[0]||null;
  };
  const status = () => ({providers: Object.entries(PROVIDERS).map(([id, label]) => ({id, label, connected: sessions.has(id), connectionId: connectionId(sessions.get(id))})), provider: active,
    connected: sessions.has(active), vision:active!=='fabrix'&&sessions.get(active)?.models.find(m=>m.id===sessions.get(active)?.model)?.supportsImages===true, models: sessions.get(active)?.models || [], model: sessions.get(active)?.model || '', verified: !!sessions.get(active)?.verified,
    reasoningEffort: sessions.get(active)?.reasoningEffort || startReasoning(active), reasoningOptions: reasoningOptions(active),
    modelCatalog: sessions.get(active)?.modelCatalog || null,completionDiagnostic:sessions.get(active)?.completionDiagnostic||null, pending: pending?.provider || null, loginError,
    persistenceError,pendingPhase:pending?.phase||null,loginPhase,loginDiagnostics:loginDiagnostics.map(item=>({...item}))});
  const catalogs = () => [...sessions].filter(([id]) => ['aipro','chatgpt','fabrix'].includes(id)).map(([provider, session]) => ({provider,models:session.models.map(item=>({...item})),model:session.model}));
  const usageStatus = () => {
    const chatgpt = sessions.get('chatgpt');
    return {auth:{provider:active,present:sessions.has(active)}, connections:{chatgpt:{present:!!chatgpt,receivedAt:chatgpt?.credential.receivedAt,
      expired:!!chatgpt && !chatgpt.credential.refreshToken && chatgpt.credential.expiresAt<=Date.now()}},accountUsage:chatgpt?.accountUsage||null};
  };
  async function prepareChatGPT(session, signal, force = false) {
    if (force || session.credential.expiresAt <= Date.now()+60000) {
      // Quota reads and inference share one refresh, including rotated tokens.
      session.refreshing ||= api.refreshChatGPTToken(session.credential,{signal:AbortSignal.timeout(15000),fetchImpl:api.fetchImpl})
        .then(result=>{if(sessions.get('chatgpt')!==session)throw Error('no_credential');session.credential=result.credential;return persist('chatgpt');})
        .finally(()=>{session.refreshing=null;});
      await session.refreshing;
    }
    if(signal?.aborted)throw Error('cancelled');
    if(sessions.get('chatgpt')!==session)throw Error('no_credential');
    return session.credential;
  }
  async function accountUsage({force=false}={}) {
    const session = sessions.get('chatgpt');
    if (!session) return usageStatus();
    if ((!force && freshAccountUsage(session.accountUsage)) || session.quotaLoading) {await session.quotaLoading; return usageStatus();}
    session.quotaLoading = (async()=>{
      const signal=AbortSignal.timeout(15000);
      try {
        let credential=await prepareChatGPT(session,signal), result;
        try {result=await fetchAccountUsage(credential,signal,api.fetchImpl);}
        catch(error){if(error.status!==401||!credential.refreshToken||signal.aborted)throw error;credential=await prepareChatGPT(session,signal,true);result=await fetchAccountUsage(credential,signal,api.fetchImpl);}
        if(sessions.get('chatgpt')===session)session.accountUsage={version:ACCOUNT_USAGE_VERSION,data:normalizeAccountUsage(result.payload),fetchedAt:Date.now(),error:null};
      } catch(error) {
        if(sessions.get('chatgpt')===session)session.accountUsage={...session.accountUsage,error:error.message?.startsWith('quota_')?error.message:'quota_unavailable',status:error.status||0};
      }
    })();
    try {await session.quotaLoading;} finally {session.quotaLoading=null;}
    return usageStatus();
  }
  const select = provider => { if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('invalid_provider'); active = provider; persistActive(); return status(); };
  async function connect(input) {
    const provider = input.provider; if (!['fabrix', 'aipro-cli', 'compatible'].includes(provider)) throw new Error('invalid_provider');
    let session;
    if (provider === 'fabrix') {
      const credential = cleanFabrixCredentials(input); const result = await api.fabrixModels(credential, {fetchImpl: api.fetchImpl, signal: AbortSignal.timeout(20000)});
      session = {credential, models: catalog(result.payload)}; if (!session.models.length) throw new Error('models_invalid');
    } else { const manual = manualConnection(input); session = {credential: manual, models: manual.models}; }
    sessions.set(provider, {...session, model: startModel(provider, session.models), reasoningEffort: startReasoning(provider), verified: false}); active = provider; await persist(provider);persistActive(); return status();
  }
  async function login(provider) {
    if (!['aipro', 'chatgpt'].includes(provider) || pending) throw new Error('login_busy');
    const attempt = ++generation,startedAt=Date.now(); pending = {provider, phase:'waiting', cancel: () => {}}; loginError = null; active = provider;
    loginPhase='waiting';loginDiagnostics=[];
    const onProgress=event=>{if(attempt!==generation||!['waiting','callback_received','exchanging','loading_models','ready','failed'].includes(event.phase))return;const at=Number.isFinite(event.at)?event.at:Date.now(),detail={phase:event.phase,at,elapsedMs:Number.isFinite(event.elapsedMs)?event.elapsedMs:Math.max(0,at-startedAt)};if(Number.isFinite(event.status))detail.status=event.status;if(['waiting','callback_received','exchanging','loading_models'].includes(event.failedStage))detail.failedStage=event.failedStage;if(event.error)detail.error=safeError(event.error);loginPhase=detail.phase;if(pending)pending.phase=detail.phase;loginDiagnostics=[...loginDiagnostics,detail].slice(-12);};
    try {
      const flow = await (provider === 'aipro' ? api.startLogin : api.chatGPTLogin)({fetchImpl: api.fetchImpl, hostLabel: api.hostLabel,onProgress,...(provider==='chatgpt'&&api.chatGPTLoginTimeoutMs?{timeoutMs:api.chatGPTLoginTimeoutMs}:{}),...(api.openBrowser?{openBrowser:api.openBrowser}:{})});
      if (attempt !== generation) { flow.cancel(); return status(); } pending.cancel = flow.cancel;
      void flow.result.then(async result => {
        if (attempt !== generation) return;
        if(provider==='chatgpt')onProgress({phase:'loading_models',at:Date.now()});
        const received=provider==='chatgpt'?await api.chatGPTModels({credential:result,fetchImpl:api.fetchImpl,signal:AbortSignal.timeout(20000)}):null;
        if(attempt!==generation)return;
        const models = provider === 'aipro' ? result.models : catalog(received.payload);
        if(!models.length)throw Error('models_invalid');
        sessions.set(provider, {credential: provider === 'aipro' ? {token: result.token, mode: 'browser'} : result, models, model: startModel(provider, models), reasoningEffort: startReasoning(provider), verified: false,
          modelCatalog: provider === 'aipro' && result.diagnostics ? {diagnostics: result.diagnostics, fetchedAt: result.fetchedAt} : received?.source==='account'?{source:'account',fetchedAt:received.fetchedAt}:null}); sessions.get(provider).reasoningEffort=startReasoning(provider,sessions.get(provider)); pending = null;loginPhase='ready';void persist(provider);persistActive();
      }).catch(error => { if (attempt === generation) { if(loginPhase!=='failed')onProgress({phase:'failed',failedStage:loginPhase,status:error.status,error:safeError(error),at:Date.now()});pending = null; loginError = safeError(error); } });
    } catch (error) { if (attempt === generation) { onProgress({phase:'failed',failedStage:loginPhase,error:safeError(error)});pending = null; loginError = safeError(error); } }
    return status();
  }
  function cancelLogin() { generation++; pending?.cancel(); pending = null; loginError = null;loginPhase=null;loginDiagnostics=[]; return status(); }
  function disconnect(provider = active) { if (pending?.provider === provider) cancelLogin(); sessions.delete(provider);void persist(provider); return status(); }
  function model(id) { const s = sessions.get(active); if (!s?.models.some(m => m.id === id)) throw new Error('invalid_model'); s.model = id; chosen.set(active, id); s.reasoningEffort=startReasoning(active,s);void persist(active); return status(); }
  function reasoning(effort) { const s = sessions.get(active), allowed = reasoningOptions(active); effort=effort==='ultra'?'max':effort; if (!s || !allowed.includes(effort)) throw new Error('invalid_reasoning_effort'); s.reasoningEffort = effort; chosenReasoning.set(active, effort);void persist(active); return status(); }
  async function refreshModels({provider=active}={}) {
    const session = sessions.get(provider);
    if (!session) throw new Error('no_credential');
    if(session.catalogLoading){await session.catalogLoading;return status();}
    session.catalogLoading=(async()=>{
    const signal = AbortSignal.timeout(20000);
    const received = provider === 'aipro' ? await fetchModelCatalog(session.credential.token, api.fetchImpl, signal) : provider==='chatgpt'?await api.chatGPTModels({credential:session.credential,fetchImpl:api.fetchImpl,signal}):null;
    const models = provider === 'aipro' ? received.models
      : provider === 'chatgpt' ? catalog(received.payload)
      : provider === 'fabrix' ? catalog((await api.fabrixModels(session.credential, {fetchImpl:api.fetchImpl,signal})).payload)
      : session.models;
    if (!models.length) throw new Error('models_invalid');
    if (sessions.get(provider) === session) { session.models = models; if (received?.source==='account') session.modelCatalog={source:'account',fetchedAt:received.fetchedAt}; else if(received?.diagnostics)session.modelCatalog = {diagnostics: received.diagnostics, fetchedAt: received.fetchedAt}; if (!models.some(item => item.id === session.model)) session.model = defaultOfficeModel(models); session.reasoningEffort=startReasoning(provider,session); }
    })();
    try{await session.catalogLoading;}finally{session.catalogLoading=null;}
    return status();
  }
  // Opt-in only: Desktop supplies an OS-protected store. Office remains memory-only.
  async function restoreConnections(records,selected) {
    if(!api.onConnectionChange)return status();
    for(const record of records||[]){
      if(record?.version!==1||!['aipro','chatgpt','fabrix'].includes(record.provider)||!record.credential||typeof record.credential!=='object')continue;
      const provider=record.provider,session={credential:record.credential,models:[],model:record.model,reasoningEffort:record.reasoningEffort,verified:false};
      if(sessions.has(provider))continue;
      sessions.set(provider,session);chosen.set(provider,record.model);chosenReasoning.set(provider,record.reasoningEffort);
      try{
        if(provider==='chatgpt')await prepareChatGPT(session,AbortSignal.timeout(20000));
        await refreshModels({provider});
        if(sessions.get(provider)!==session)continue;
        await persist(provider);
      }catch(error){
        if(sessions.get(provider)!==session)continue;
        sessions.delete(provider);
        if([401,403].includes(error.status)||['no_credential','credential_expired','refresh_failed','unauthorized','forbidden'].includes(error.message))await persist(provider);
        loginError=safeError(error);
      }
    }
    if(sessions.has(selected))active=selected;
    else if(sessions.size)active=sessions.keys().next().value;
    return status();
  }
  // onActivity is called for every streamed model event (text, reasoning, tool call arguments): the caller's wait renews.
  async function complete(messages, tools, signal, onText = () => {}, onPhase = () => {}, onActivity = () => {}, options = {}) {
    if(signal?.aborted)throw new Error('cancelled');
    const provider = options.backgroundModel?.provider || active, authenticated = sessions.get(provider); if (!authenticated) throw new Error('no_credential');
    // A read-only image analysis uses another catalog model in the SAME login.
    // Never mutate the user's model/chosen map or borrow another provider token.
    let session=authenticated;
    if(options.backgroundModel){
      const wanted=authenticated.models.find(item=>item.id===options.backgroundModel.model);
      if(tools.length||!wanted)throw new Error('invalid_model');
      session={...authenticated,model:wanted.id};
    }
    if(options.visionModel!==undefined){
      const allowed=authenticated.models.filter(m=>m.supportsImages!==false).map(m=>({...m,name:m.id}));
      const wanted=allowed.find(m=>m.id===options.visionModel);
      if(tools.length||!hasImageInput(messages)||!wanted||!(wanted.supportsImages===true||visionModelFor(provider,wanted,[wanted])?.name===wanted.name))throw new Error('invalid_model');
      session={...authenticated,model:wanted.id};
    }
    let result, httpFailure, inferenceDiagnostic, usageRequest, reportedUsage;
    const toolChoice=tools.length&&options.toolChoice==='required'&&provider!=='fabrix'?'required':'auto';
    if(provider==='chatgpt'&&!reasoningOptions(provider,session).includes(session.reasoningEffort))session={...session,reasoningEffort:startReasoning(provider,session)};
    const inferenceFetch=async(...args)=>{
      const response=await api.fetchImpl(...args);
      if(!response.ok)httpFailure={status:response.status,retryAfterMs:retryAfterMs(response.headers)};
      return response;
    };
    // Optional host accounting contains counters only and must never break inference.
    try {usageRequest=api.onUsageStart?.({provider,model:session.model});} catch {}
    try {
    if (provider === 'chatgpt') {
      session.credential = await prepareChatGPT(authenticated,signal);
      result = await api.completeChatGPT({fetchImpl:api.fetchImpl,onMeasurement:value=>{reportedUsage=value;},onDiagnostic:detail=>{inferenceDiagnostic={...detail,model:session.model};},messages, tools, toolChoice, modelId: session.model,modelMetadata:api.accountCatalog===true?authenticated.models.find(m=>m.id===session.model):undefined, reasoningEffort: session.reasoningEffort, credential: session.credential, signal, onText, onPhase, onActivity});
    } else {
      // The model server counts the tokens of every request (user, 2026-09-30). An OpenAI-compatible stream (vLLM behind
      // AI Pro) reports them in a last chunk only when asked: stream_options.include_usage, as the browser runtime asks
      // (src/api.js). The budget and the gauge use them (context-budget.mjs).
      // A fill sheet or a review asks for its JSON schema (S1 design, part 3): AI Pro's vLLM enforces it while it decodes.
      // Fabrix takes no response_format; the ChatGPT adapter makes its own request.
      const format = options.responseFormat && provider !== 'fabrix' ? options.responseFormat : undefined;
      const send = maxTokens => {
        const reasoning = provider === 'aipro' && session.reasoningEffort && session.reasoningEffort !== 'xhigh' ? {reasoning_effort: session.reasoningEffort} : {};
        const body = {model: session.model, messages, stream: true, max_tokens: maxTokens, ...reasoning, ...(session.usageRefused ? {} : {stream_options: {include_usage: true}}), ...(format && !session.formatRefused ? {response_format: format} : {}), ...(tools.length ? {tools, tool_choice: toolChoice} : {})};
        return provider === 'fabrix'
          ? api.fabrixCompletion(body, {...session.credential, modelId: session.model}, {signal, fetchImpl: inferenceFetch})
          : inferenceFetch(provider === 'aipro' ? endpoint('browser') : session.credential.endpoint, {method: 'POST', redirect: 'error', signal,
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${session.credential.token}`, ...(provider === 'aipro-cli' ? {'User-Agent': 'AIPROCLI'} : {})}, body: JSON.stringify(body)});
      };
      // Summaries use a smaller per-call budget. Never change the interactive
      // session's output setting when the host limits this one request.
      const callLimit=Number.isSafeInteger(options.maxTokens)&&options.maxTokens>0?options.maxTokens:Infinity;
      let maxTokens = Math.min(outputTokens(session),callLimit), response = await send(maxTokens);
      // A refused option is dropped for the rest of the session and the request is sent again, at most three times: the
      // usage option, the output format, then an answer size the server does not accept.
      for (let attempt = 0; attempt < 3 && [400, 422].includes(response.status); attempt++) {
        const text = await response.text().catch(() => '');
        if (!session.usageRefused && refusesUsage(response.status, text)) session.usageRefused = true;
        else if (format && !session.formatRefused && refusesFormat(response.status, text)) session.formatRefused = true;
        else if (response.status === 400 && maxTokens > FALLBACK_OUTPUT_TOKENS && refusesOutputSize(text)) session.outputTokens = maxTokens = FALLBACK_OUTPUT_TOKENS;
        // A refusal in words not known, of a request that asked for a format: the format is dropped once, since servers
        // word it their own way ("JSON schema", "structured_outputs"). The answer is still checked by code.
        else if (format && !session.formatRefused) session.formatRefused = true;
        else break;
        httpFailure = undefined; response = await send(maxTokens);
      }
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(new Error(response.status===401?'unauthorized':response.status===403?'forbidden':response.status===429?'rate_limited':response.status===413?'context_overflow':[400,404,422].includes(response.status)?'invalid_model':'upstream'),{status:response.status,retryAfterMs:retryAfterMs(response.headers)});}
      let calls = [], usage, finishReason;
      // Keep Office's permanent transport error distinct from a repairable
      // model schema error across shared reader versions. Read the body once.
      const completionResponse={ok:response.ok,status:response.status,headers:response.headers,body:response.body,json:async()=>{
        try{return await response.json();}catch(error){if(error instanceof SyntaxError)throw new Error('response_json_invalid');throw error;}
      }};
      const content = await readCompletion(completionResponse, onText, value => {usage = reportedUsage = value;}, onPhase, value => {finishReason = value;}, value => {calls = value;}, undefined, onActivity);
      result = {content, calls, usage, finishReason};
    }
    if (signal.aborted) throw new Error('cancelled');
    if (JSON.stringify(result).length > 600000) throw new Error('output_limit');
    if (result.finishReason === 'length') throw new Error('output_limit');
    authenticated.verified = true;authenticated.completionDiagnostic={phase:'verified',status:200,model:session.model}; return result;
    }catch(error){
      authenticated.completionDiagnostic={...inferenceDiagnostic,phase:'failed',status:error.status||inferenceDiagnostic?.status||0,model:session.model,code:safeError(error),...(inferenceDiagnostic?.code?{apiCode:inferenceDiagnostic.code}:{})};
      const facts={...faultFacts(httpFailure),...faultFacts(error)};
      // A failed inference cannot contribute executable tools or partial text.
      // Preserve only actionable codes and HTTP timing across shared versions.
      throw Object.assign(new Error(signal.aborted?'cancelled':facts.status===413?'context_overflow':safeError(error)),facts,...(inferenceDiagnostic?[{apiDiagnostic:authenticated.completionDiagnostic}]:[]));
    } finally {try {api.onUsageFinish?.(usageRequest,result?.usage||reportedUsage);} catch {}}
  }
  return {status, restoreConnections, flushConnections:()=>persistence, catalogs, usageStatus, accountUsage, select, connect, login, cancelLogin, disconnect, model, reasoning, refreshModels, complete, dispose: () => {cancelLogin(); sessions.clear();}};
}

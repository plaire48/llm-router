import {completeChat} from './src/api.js';
import {normalizeTrace} from './agent-trace.js';
import {activityDeadline} from './model-recovery.js';
import {CHAT_TIMEOUT_MS} from './chat-contract.js';
import {ERROR_TEXT} from './core.js';

// One live executor per lease. Views are observers, never execution owners.
// Checkpoints live in the host; a terminated worker is paused, not replayed.
export function createBackgroundRunner({call, publish, compareImages, keepAlive = () => chrome.runtime.getPlatformInfo()}) {
  const jobs = new Map();
  function start(request) {
    if (jobs.has(request.requestId)) throw new Error('busy');
    const abort = new AbortController();
    const job = {abort, request, fill: null}; jobs.set(request.requestId, job);
    job.done = execute(job).finally(() => jobs.delete(request.requestId));
    // Failure to save a final result leaves the lease for safe recovery.
    job.done.catch(() => {});
  }
  async function execute(job) {
    const {request, abort} = job, {requestId} = request;
    let content = '', usage = null, finishReason = null, trace = [], phase = 'waiting', timer, dirty = false, publishing = Promise.resolve();
    const invoke = (type, value = {}) => call(type, {...value, requestId});
    const timeout = activityDeadline(() => abort.abort('timeout'), CHAT_TIMEOUT_MS);
    // Chrome's active-operation pattern. This is stopped at completion,
    // cancellation or a normal ask_user / transaction approval boundary.
    const keepAliveTimer = setInterval(() => {void keepAlive().catch(() => {});}, 25000);
    let lastPulse = 0;
    const touch = () => {
      timeout.touch();
      if (!abort.signal.aborted && Date.now() - lastPulse >= 10000) {
        lastPulse = Date.now(); void invoke('SAVE_CONTEXT', {kind: 'heartbeat'}).catch(() => {});
      }
    };
    const flush = () => {
      clearTimeout(timer); timer = null;
      if (dirty) {
        dirty = false;
        const snapshot = {requestId, conversationId: request.conversationId, phase, partial: content.slice(0, 400000), trace: normalizeTrace(trace), fillReview: job.fill?.plan || null};
        publishing = publishing.catch(() => {}).then(() => publish(snapshot));
      }
      return publishing;
    };
    const update = () => {dirty = true; if (!timer) timer = setTimeout(() => {void flush().catch(() => {});}, 200);};
    const setPhase = value => {touch(); phase = value; update();};
    const progress = step => {
      touch();
      const previous = trace.find(item => item.index === step.index);
      const item = {...step, id: previous?.id || crypto.randomUUID()};
      trace = previous ? trace.map(value => value === previous ? item : value) : [...trace, item];
      update();
      // Durable tool progress is separate from the transient streamed text.
      void invoke('SAVE_CONTEXT', {kind: 'trace', trace: normalizeTrace(trace)}).catch(() => {});
    };
    const executeTool = async (name, args) => {
      if (abort.signal.aborted) throw new Error('cancelled');
      setPhase(name === 'update_plan' ? 'planning' : ['verify_page', 'verify_form'].includes(name) ? 'verifying' : name === 'read_page' ? 'reading' : 'acting');
      const traceId = trace.findLast(step => step.tool === name && step.status === 'running')?.id;
      // Publish before entering the serialized, potentially long tool call.
      // Otherwise captures can arrive while observers still see an older step.
      await flush().catch(() => {});
      let result = await invoke('RUN_TOOL', {name, args, traceId});
      if (abort.signal.aborted) throw new Error('cancelled');
      if (name === 'inspect_images' && !result.error) result = await compareImages(result, abort.signal);
      if (!result.planId) return result;
      // Compatibility with the existing non-automation fill review. Persist
      // presentation so closing/reopening a view never constitutes approval.
      setPhase('reviewing');
      const approved = await new Promise(resolve => {
        const finish = value => {abort.signal.removeEventListener('abort', cancel); job.fill = null; update(); resolve(value);};
        const cancel = () => finish(false);
        job.fill = {plan: result, finish};
        abort.signal.addEventListener('abort', cancel, {once: true}); update();
      });
      if (!approved || abort.signal.aborted) return {cancelled: true, applied: 0};
      setPhase('applying');
      const applied = await invoke('APPLY_FILL', {planId: result.planId});
      if (!applied.ok || abort.signal.aborted) return applied;
      setPhase('verifying');
      const index = `verify-${crypto.randomUUID()}`; progress({index, tool: 'verify_form', status: 'running'});
      const verification = await invoke('RUN_TOOL', {name: 'verify_form', args: {}}).catch(() => ({error: 'page_changed'}));
      progress({index, tool: 'verify_form', status: verification.ok ? 'done' : 'error'});
      return {...applied, verified: verification.ok === true, verification, ...(verification.error ? {error: verification.error} : {})};
    };
    touch(); update();
    try {
      const result = await completeChat(request, abort.signal,
        text => {touch(); content = text; update();}, value => {usage = value;}, setPhase, value => {finishReason = value;},
        executeTool, progress, measurement => invoke('RECORD_USAGE', measurement), update => invoke('SAVE_CONTEXT', update), diagnostic => invoke('MODEL_DIAGNOSTIC', diagnostic),
        {prepareCredential: async () => {await invoke('PREPARE_CREDENTIAL', {credentialReceivedAt: request.credentialReceivedAt}); return {ok: true};}});
      if (abort.signal.aborted) throw new Error('cancelled');
      await flush().catch(() => {});
      await invoke('FINISH_CHAT', {content: result, usage, finishReason, trace: normalizeTrace(trace), status: 200});
    } catch (error) {
      const code = abort.signal.reason === 'timeout' ? 'chat_timeout' : abort.signal.aborted ? 'cancelled' : Object.hasOwn(ERROR_TEXT, error.message) ? error.message : 'response_invalid';
      await flush().catch(() => {});
      await invoke('FINISH_CHAT', {content: error.suppressPartial ? '' : error.partial || content, error: code,
        trace: normalizeTrace(trace.map(step => step.status === 'running' ? {...step, status: abort.signal.aborted ? 'cancelled' : 'error'} : step)), status: error.status || 0});
    } finally {clearTimeout(timer); clearInterval(keepAliveTimer); timeout.stop(); job.fill?.finish(false);}
  }
  return {
    start, has: id => jobs.has(id),
    cancel: (id, reason) => jobs.get(id)?.abort.abort(reason),
    resolveFill(id, planId, approved) {
      const job = jobs.get(id);
      if (!job?.fill || job.fill.plan.planId !== planId || job.abort.signal.aborted) throw new Error('fill_invalid');
      job.fill.finish(approved === true);
    },
  };
}

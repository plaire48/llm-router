import {toolException} from './tool-errors.js';
import {completeChat} from './src/api.js';
import {normalizeTrace} from './agent-trace.js';
import {activityDeadline} from './model-recovery.js';
import {CHAT_TIMEOUT_MS} from './chat-contract.js';
import {ERROR_TEXT} from './core.js';
import {runReplay, replayAnswer} from './browser-replay.js';
import {checkReportedFacts} from './delegation-facts.js';

// One live executor per lease. Views are observers, never execution owners.
// Checkpoints live in the host; a terminated worker is paused, not replayed.
export function createBackgroundRunner({call, publish, compareImages, keepAlive = () => chrome.runtime.getPlatformInfo()}) {
  const jobs = new Map();
  function start(request) {
    if (jobs.has(request.requestId)) throw new Error('busy');
    const abort = new AbortController();
    const job = {abort, request, fill: null, steering:false, inputRevision:0, steerListeners:new Set()}; jobs.set(request.requestId, job);
    job.done = execute(job).finally(() => jobs.delete(request.requestId));
    // Failure to save a final result leaves the lease for safe recovery.
    job.done.catch(() => {});
  }
  async function execute(job) {
    const {request, abort} = job, {requestId} = request;
    let content = '', usage = null, finishReason = null, trace = [], phase = 'waiting', timer, dirty = false, publishing = Promise.resolve(), traceSequence = 0, progressRevision = 0;
    const activeTraceIds = new Map();
    const invoke = (type, value = {}) => call(type, {...value, requestId});
    const timeout = activityDeadline(() => abort.abort('timeout'), CHAT_TIMEOUT_MS);
    // Chrome's active-operation pattern. This is stopped at completion,
    // cancellation or a normal ask_user / transaction approval boundary.
    const keepAliveTimer = setInterval(() => {
      void keepAlive().catch(() => {});
      // Human review is not model inactivity. Retain the live owner's lease
      // while waiting, without submitting or polling the model.
      if (job.fill && !abort.signal.aborted) void invoke('SAVE_CONTEXT', {kind: 'heartbeat'}).catch(() => {});
    }, 25000);
    let lastPulse = 0;
    const touch = () => {
      if (!job.fill) timeout.touch();
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
      const item = {...step, id: previous?.id || activeTraceIds.get(step.index) || crypto.randomUUID(), progressRevision: ++progressRevision};
      if (['running', 'queued', 'waiting'].includes(item.status)) {
        activeTraceIds.set(step.index, item.id);
        if (activeTraceIds.size > 64) activeTraceIds.delete(activeTraceIds.keys().next().value);
      } else activeTraceIds.delete(step.index);
      // Display preserves operation start order (fill -> nested verification).
      // Retention uses update order so an old coordinator's final handoff stays
      // visible when a later parent completion arrives. Revisions remain private.
      trace = previous ? trace.map(value => value === previous ? item : value) : [...trace, item];
      const retained = new Set(normalizeTrace([...trace].sort((left,right) => left.progressRevision - right.progressRevision)).map(value => value.id));
      trace = trace.filter(value => retained.has(value.id));
      update();
      // Durable tool progress is separate from the transient streamed text.
      const event = normalizeTrace([item])[0];
      if (event && event.tool !== 'progress_note') traceSequence++;
      void invoke('SAVE_CONTEXT', {kind: 'trace', trace: normalizeTrace(trace), ...(event && event.tool !== 'progress_note' ? {event, sequence: traceSequence} : {})}).catch(() => {});
    };
    const executeTool = async (name, args, extra = {}) => {
      if (abort.signal.aborted) throw new Error('cancelled');
      if(name==='open_site_procedure') {
        const prepared=await invoke('RUN_TOOL',{name,args});
        if(!prepared.prepared || !prepared.procedureToken)return prepared;
        if(abort.signal.aborted || job.steering)return {error:'interrupted',actionIssued:false};
        const primitiveArgs={ref:prepared.ref},index=`procedure-open-${crypto.randomUUID()}`;
        progress({index,tool:'click_element',status:'running'});
        let result;try {result=await executeTool('click_element',primitiveArgs,{procedureToken:prepared.procedureToken});}
        catch(error){result=toolException(error,{mutating:true});}
        progress({index,tool:'click_element',status:result.cancelled?'cancelled':result.error || result.ok===false?'error':'done'});
        const {siteProcedurePrimitive,...receipt}=result;
        return {...receipt,siteProcedureExecution:{tool:'click_element',args:siteProcedurePrimitive?.args || primitiveArgs,before:siteProcedurePrimitive?.before || prepared.observation,procedure_id:prepared.procedure_id}};
      }
      if (name === 'fill_site_procedure') {
        const prepared=await invoke('RUN_TOOL',{name,args});
        if (!prepared.prepared || !prepared.procedureToken) return prepared;
        if (abort.signal.aborted || job.steering) return {error:'interrupted',actionIssued:false};
        const primitiveArgs={fields:prepared.fields};
        const index=`procedure-fill-${crypto.randomUUID()}`;progress({index,tool:'fill_form',status:'running'});
        let result;
        try {result=await executeTool('fill_form',primitiveArgs,{procedureToken:prepared.procedureToken});}
        catch(error){result=toolException(error,{mutating:true});}
        progress({index,tool:'fill_form',status:result.cancelled?'cancelled':result.error || result.ok===false?'error':'done'});
        const {siteProcedurePrimitive,...receipt}=result;
        return {...receipt,siteProcedureExecution:{tool:'fill_form',args:siteProcedurePrimitive?.args || primitiveArgs,before:siteProcedurePrimitive?.before || prepared.observation,procedure_id:prepared.procedure_id},procedureChecks:prepared.checks};
      }
      setPhase(name === 'update_plan' ? 'planning' : ['verify_page', 'verify_form'].includes(name) ? 'verifying' : name === 'read_page' ? 'reading' : 'acting');
      const traceId = trace.findLast(step => step.tool === name && step.status === 'running')?.id;
      // Publish before entering the serialized, potentially long tool call.
      // Otherwise captures can arrive while observers still see an older step.
      await flush().catch(() => {});
      let result = await invoke('RUN_TOOL', {name, args, traceId, ...(extra.procedureToken ? {procedureToken:extra.procedureToken} : {}), ...(Number.isInteger(extra.replayIndex) ? {replayIndex: extra.replayIndex} : {})});
      if (abort.signal.aborted) throw new Error('cancelled');
      if (name === 'inspect_images' && !result.error) result = await compareImages(result, abort.signal);
      if (!result.planId) return result;
      // Compatibility with the existing non-automation fill review. Persist
      // presentation so closing/reopening a view never constitutes approval.
      setPhase('reviewing');
      timeout.stop();
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
      if (request.replay) {
        // A recorded procedure repeated without the model. The host runs every
        // tool as it does for the model: observations, approvals, receipts and
        // checkpoints are the same; only the next step comes from the record.
        let outcome;
        try {outcome = await runReplay(request.replay, {executeTool, progress, signal: abort.signal});}
        catch (error) {if (error.message !== 'replay_observation') throw error; outcome = {stopped: {text: '페이지를 관찰하지 못했습니다.'}};}
        if (abort.signal.aborted) throw new Error('cancelled');
        content = replayAnswer(outcome); update();
        await flush().catch(() => {});
        await invoke('FINISH_CHAT', {content, trace: normalizeTrace(trace), traceSequence, status: 200, finishReason: 'stop', ...(outcome.stopped ? {error: 'replay_stopped'} : {})});
        return;
      }
      const result = await completeChat(request, abort.signal,
        text => {touch(); content = text; update();}, value => {usage = value;}, setPhase, value => {finishReason = value;},
        executeTool, progress, measurement => invoke('RECORD_USAGE', measurement), update => invoke('SAVE_CONTEXT', update), diagnostic => invoke('MODEL_DIAGNOSTIC', diagnostic),
        {onAgentDiagnostic: diagnostic => invoke('MODEL_DIAGNOSTIC', diagnostic), saveAnalysisHandoff: record => invoke('SAVE_CONTEXT',{kind:'analysis_handoff',record}), saveResearchHandoff: record => invoke('SAVE_CONTEXT',{kind:'research_handoff',record}),
          researchBrowser: async operation => {if(abort.signal.aborted && operation.operation!=='close')throw new Error('cancelled');return invoke('RESEARCH_OPERATION',operation);},
          // Facts for the Nubi that sent this task, checked against the pages this run read.
          saveFacts: async (args, evidence) => {
            const checked = checkReportedFacts(args, evidence);
            if (checked.error) return {error: checked.error};
            const facts = checked.facts;
            await invoke('SAVE_CONTEXT', {kind: 'delegation_facts', facts});
            const unchecked = facts.filter(fact => !fact.checked).map(fact => fact.name);
            return {ok: true, reported: facts.length, unchecked, instruction: unchecked.length ? 'These quotes were not found on a page read in this run. Read that page and report its exact words, or answer and they are sent as unchecked.' : 'Recorded. They are sent with your final answer.'};
          }, takeInput: async () => {
          if (job.fill) return null;
          const revision = job.inputRevision, item = await invoke('TAKE_AGENT_INPUT');
          if (revision === job.inputRevision) job.steering = false;
          return item;
        }, onSteer: listener => {job.steerListeners.add(listener); if (job.steering) listener(); return () => job.steerListeners.delete(listener);}, prepareCredential: async () => {await invoke('PREPARE_CREDENTIAL', {credentialReceivedAt: request.credentialReceivedAt}); return {ok: true};}});
      if (abort.signal.aborted) throw new Error('cancelled');
      await flush().catch(() => {});
      await invoke('FINISH_CHAT', {content: result, usage, finishReason, trace: normalizeTrace(trace), traceSequence, status: 200});
    } catch (error) {
      const code = abort.signal.reason === 'timeout' ? 'chat_timeout' : abort.signal.aborted ? 'cancelled' : Object.hasOwn(ERROR_TEXT, error.message) ? error.message : 'response_invalid';
      await flush().catch(() => {});
      await invoke('FINISH_CHAT', {content: error.suppressPartial ? '' : error.partial || content, error: code, traceSequence,
        trace: normalizeTrace(trace.map(step => step.status === 'running' ? {...step, status: abort.signal.aborted ? 'cancelled' : 'error'} : step)), status: error.status || 0});
    } finally {await invoke('RESEARCH_OPERATION',{operation:'close_owner'}).catch(()=>{});clearTimeout(timer); clearInterval(keepAliveTimer); timeout.stop(); job.fill?.finish(false);}
  }
  return {
    start, has: id => jobs.has(id),
    acceptsInput: id => !!jobs.get(id) && !jobs.get(id).fill && !jobs.get(id).abort.signal.aborted,
    notifyInput(id) {
      const job = jobs.get(id);
      if (!job || job.abort.signal.aborted) return;
      job.steering = true; job.inputRevision++;
      for (const listener of job.steerListeners) listener();
    },
    cancel: (id, reason) => jobs.get(id)?.abort.abort(reason),
    resolveFill(id, planId, approved) {
      const job = jobs.get(id);
      if (!job?.fill || job.fill.plan.planId !== planId || job.abort.signal.aborted) throw new Error('fill_invalid');
      job.fill.finish(approved === true);
    },
  };
}

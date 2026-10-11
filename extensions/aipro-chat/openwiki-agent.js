import {createResearchHandoff} from './research-handoff.js';
import {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage} from '@langchain/core/messages';
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import {runWikiQuestion, QuestionInput} from '../../packages/openwiki/src/agent/wiki-question.ts';
import {createWikiQuestionSearch} from './openwiki-retrieval.js';

const textOf = content => typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
// Host-normalized error codes include stream failures without an HTTP status.
export const isWikiAuthenticationError = error => [401,403].includes(error?.status) ||
  ['unauthorized','forbidden','no_credential','expired_token'].includes(error?.message);
export function wikiWire(messages) {
  return messages.map(message => {
    const type = message.getType(), role = {human:'user',ai:'assistant',system:'system',tool:'tool'}[type];
    if (!role) throw new Error('openwiki_message_invalid');
    return {role, content: textOf(message.content), ...(role === 'tool' ? {tool_call_id: message.tool_call_id} : {}),
      ...(role === 'assistant' && message.tool_calls?.length ? {tool_calls: message.tool_calls.map(call => ({id: call.id, type:'function', function:{name:call.name, arguments:JSON.stringify(call.args)}}))} : {})};
  });
}
// Credentials remain in the existing host transport. No OpenWiki CLI auth/environment is loaded.
export class NubiOpenWikiModel extends BaseChatModel {
  constructor({complete, signal, modelId, taskId}) {super({}); this.complete = complete; this.parentSignal = signal; this.modelId = modelId; this.taskId = taskId;}
  _llmType() {return 'nubi-openwiki';}
  bindTools(tools, options = {}) {return this.withConfig({...options, tools: tools.map(item => convertToOpenAITool(item))});}
  async _generate(messages, options) {
    const signal = options.signal ? AbortSignal.any([this.parentSignal, options.signal]) : this.parentSignal;
    signal.throwIfAborted();
    const response = await this.complete(wikiWire(messages), options.tools || [], {signal, taskId:this.taskId, role:'research', modelId:this.modelId});
    signal.throwIfAborted();
    if (response.finishReason === 'length') throw new Error('output_limit');
    const tool_calls = (response.calls || []).map(call => ({id:call.id, name:call.function.name, args:JSON.parse(call.function.arguments || '{}'), type:'tool_call'}));
    return {generations: [{text:response.content || '', message:new AIMessage({content:response.content || '', tool_calls})}]};
  }
}
// Public execution events only. Keep worker identities separate from the coordinator
// so a synthesis cannot overwrite a researcher or imply the parent task succeeded.
export function createResearchProgress({taskId, task, onStep = () => {}, documents = []}) {
  const active = new Map();
  let counts = {completed:0,total:0}, plannerStarted = false, plannerFinished = false, closed = false;
  const documentIndex = new Map(documents.map(doc => [doc.id, doc]));
  const emit = (index, status, analysis) => {
    const event = {index,tool:'analysis_research',status,analysis:{task,runId:taskId,...counts,delivered:false,...analysis}};
    if (['running','queued'].includes(status)) active.set(index,event.analysis); else active.delete(index);
    onStep(structuredClone(event));
  };
  const endPlanner = () => {
    if (plannerStarted && !plannerFinished) {
      plannerFinished = true;
      emit(`${taskId}-planner`,'done',{role:'planner',phase:'finished'});
    }
  };
  return {
    progress(event) {
      if (closed) return;
      const {phase,role,taskId:childId,synthesisId,assignment,outcome,summary,completed,total} = event;
      if (Number.isSafeInteger(completed) && Number.isSafeInteger(total) && completed >= 0 && total >= completed) counts = {completed,total};
      if (phase === 'researching' || phase === 'planning_finished') endPlanner();
      const child = Number.isSafeInteger(childId), synthesis = Number.isSafeInteger(synthesisId);
      const workerRole = role || (child ? 'research' : synthesis ? 'synthesis' : phase === 'planning' ? 'planner' : 'coordinator');
      if (workerRole === 'planner') plannerStarted = true;
      const index = child ? `${taskId}-${childId}` : synthesis ? `${taskId}-synthesis-${synthesisId}` : workerRole === 'planner' ? `${taskId}-planner` : taskId;
      const terminal = ['finished','synthesis_finished','planning_finished'].includes(phase);
      const scope = assignment ? {assignment:{question:assignment.question,documentIds:assignment.documentIds,
        documents:(assignment.documentIds || []).map(id => ({id,title:documentIndex.get(id)?.title || id})),...(assignment.range ? {range:assignment.range} : {})}} : {};
      emit(index, terminal ? 'done' : phase === 'queued' ? 'queued' : 'running', {
        role:workerRole,phase,...scope,...(child ? {workerId:childId} : {}),...(synthesis ? {synthesisId} : {}),
        ...(outcome ? {outcome} : {}),...(summary ? {summary} : {}),
        // Child reports are available to the reducer, not yet delivered as a verified Wiki answer.
        ...(terminal && child ? {delivered:true,deliveredTo:'synthesis'} : {}),
      });
      // Preserve corpus-wide counts even when the most recent event is a leaf worker.
      if (index !== taskId) emit(taskId,'running',{role:'coordinator',phase:workerRole === 'synthesis' ? 'synthesizing' : plannerFinished ? 'researching' : 'planning'});
    },
    finish(result) {
      if (closed) return;
      endPlanner();
      emit(taskId,'done',{role:'coordinator',phase:'finished',delivered:true,deliveredTo:'main',outcome:result.status,summary:result.answer?.slice(0,600),uncertainties:result.uncertainties});
      closed = true;
    },
    fail({cancelled = false} = {}) {
      if (closed) return;
      for (const [index,analysis] of [...active]) emit(index,cancelled ? 'cancelled' : 'error',{...analysis,phase:'finished',delivered:false});
      emit(taskId,cancelled ? 'cancelled' : 'error',{role:'coordinator',phase:'finished',delivered:false});
      closed = true;
    },
  };
}
export async function delegateWikiQuestion(args, {complete, execute, signal, modelId, onStep = () => {}, researchHandoffs, onResearchHandoff}) {
  signal.throwIfAborted();
  if(args?.restart_research!==undefined&&typeof args.restart_research!=='boolean')throw Error('tool_arguments_invalid');
  if (!['internal','external'].includes(args.wiki) || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 4000) throw new Error('tool_arguments_invalid');
  const snapshot = await execute('ask_openwiki', {wiki:args.wiki,question:args.question});
  if (snapshot?.error) return snapshot;
  if (typeof snapshot?.wikiId !== 'string' || !snapshot.wikiId.startsWith(`${args.wiki}:`)) throw new Error('openwiki_source_invalid');
  const input = QuestionInput.parse({question:args.question, documents:snapshot.documents, sourceComplete:snapshot.sourceComplete});
  if (input.documents.some(doc => args.wiki === 'internal' ? doc.kind !== 'site' : !['folder','wiki'].includes(doc.kind))) throw new Error('openwiki_source_invalid');
  const taskId = `wiki-${crypto.randomUUID()}`;
  // Authentication belongs to this whole Wiki invocation. A child failure must
  // not be downgraded to an ordinary partial report and trigger more requests.
  // Keep cancellation local so a later reauthenticated invocation starts clean.
  const authentication = new AbortController();
  const researchSignal = AbortSignal.any([signal, authentication.signal]);
  const guardedComplete = async (...parameters) => {
    researchSignal.throwIfAborted();
    try {return await complete(...parameters);}
    catch (error) {
      if (isWikiAuthenticationError(error)) authentication.abort(error);
      throw error;
    }
  };
  const model = new NubiOpenWikiModel({complete:guardedComplete, signal:researchSignal, modelId, taskId});
  const task = `${args.wiki === 'internal' ? '내장 위키' : '외부 위키'}: ${args.question.slice(0,100)}`;
  const progress = createResearchProgress({taskId,task,onStep,documents:input.documents});
  const handoff=await createResearchHandoff({kind:args.wiki,owner:snapshot.wikiId,question:args.question,modelId,handoffs:args.restart_research?undefined:researchHandoffs,onHandoff:onResearchHandoff});
  try {
    const result = await runWikiQuestion(input, {signal:researchSignal, model, modelId, search:createWikiQuestionSearch(), onProgress:progress.progress,...handoff});
    // Re-read through the same lease/provider/folder binding before exposing a stale answer.
    const current = await execute('ask_openwiki', {wiki:args.wiki,question:args.question});
    signal.throwIfAborted();
    const changed = () => {progress.fail(); return {error:'openwiki_changed'};};
    if (current?.error || current?.wikiId !== snapshot.wikiId || current.sourceComplete !== input.sourceComplete || !Array.isArray(current.documents) || current.documents.length !== input.documents.length) return changed();
    const documents = new Map(current.documents.map(doc => [doc.id, doc]));
    for (const original of input.documents) {
      const doc = documents.get(original.id);
      if (!doc || ['text','version','title','path','kind'].some(key => original[key] !== doc[key])) return changed();
    }
    await handoff.finish();
    progress.finish(result);
    return {...result, wikiId:snapshot.wikiId, wiki:args.wiki, dataKind:'openwiki_reference', advisory:true,
      instruction:'Independent OpenWiki advice with snapshot evidence. Findings may be partial; inspect coverage and uncertainties. Keep this Wiki identity with every citation. No browser action, approval or save has been performed.'};
  } catch(error) {
    if(error?.message==='research_checkpoint_changed'){progress.fail();return {error:'research_checkpoint_changed',instruction:'The authorized source snapshot changed. Reconcile the original goal with the current source, then call this tool with restart_research=true for a fresh plan. No historical answer was delivered.'};}
    progress.fail({cancelled:signal.aborted});
    // The framework or a cancelled peer can wrap the initial error. Preserve
    // its normalized code/status for the host's existing re-login handling.
    throw signal.aborted ? error : authentication.signal.reason || error;
  }
}

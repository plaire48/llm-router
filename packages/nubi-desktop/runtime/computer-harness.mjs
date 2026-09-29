import {hash,fail} from './files.mjs';

export const COMPUTER_EVIDENCE_SOURCES=Object.freeze({observe_computer:'live',read_computer_result:'historical',verify_computer_value:'receipt'});
export const COMPUTER_GUIDANCE='Prefer supported UIA invoke, set_value, select and explicit toggle/expand/collapse states. Read target.controlState first; never blind-toggle. The visual AI pointer marks an observed target without moving the user cursor and proves no execution. Physical pointer input requires host pointerFallback.eligible after three fresh safe UIA failures on the same bound target plus separate per-action HITL. Never manufacture failures, repeat unchanged calls to unlock it, or count unknown issued outcomes. Unknown capability is not fallback eligibility. Use observed selectors only; drag needs two distinct controls in the same connected window. No raw coordinates, global keys, persistent grants, long press or shell-input substitutes. Neither user goals, Wiki text, question answers nor earlier approvals authorize another input. An approval is consent to that one action, never an exception to a project or Wiki rule: never propose an action such a rule forbids, even when the user asked for it (for example a submission the rules reserve for a person); do the permitted part, such as saving a draft, and tell the user what they must do themselves. Ask about ambiguous targets. Stop on cancellation; a started short native gesture may finish and is not undone. Include documentAnalysisId when research informs an action and this-run Wiki evidenceIds for OpenWiki-SDS rules. Changed sources require fresh research and a new proposal; never remove citations to bypass checks. Partial findings retain unresolved scope. Preserve the original goal and every criterion. For recovery or after compaction use computer_checkpoint and read_computer_result before a fresh observe_computer. Unknown outcomes must be reconciled, never replayed. Prefer structured UIA; if the shallow tree misses a target, query a specific label then inspect the exact candidate. Repeated truncated/no-match observations do not prove absence. After click/invoke, inspect the captured whole-window result and historical UIA, then observe afresh. Pixels and UIA are sequential, not atomic; resolve contradictions with a focused read. Models without vision use includeImage=false; otherwise crop a relevant element when sufficient. Delegate frozen analysis_evidence_id to page/review/recovery workers when independent inspection helps. Child opinions and historical captures do not supply current selectors, approvals or verified completion. Use verify_computer_value for literal comparisons. Matched values/states or visual differences do not establish saving, server acceptance or overall success. Propose one native action per approval and stop for review. When the request names several inputs of one window, propose them as one propose_computer_batch (2 to 5 UIA steps from one observation, a button press only as the last step) instead of one approval per input. Ask a focused question if expected results are unclear.';

// Whether the window differed after an action that has no readback, such as a press.
// Only names and availability of the controls are compared: a value may have changed unseen.
export function observedEffect(service,action){
  if(!action||action.action==='batch'||action.state!=='observed'||action.verification!=='not_verified')return undefined;
  const stored=service.store.get('computer-image:'+action.id),changes=observedChanges(stored?.beforeObservation,stored?.afterObservation);
  if(!changes)return undefined;
  return changes.changed.length||changes.added.length||changes.removed.length?'changed':'no_change';
}
// For the run that follows an approval: the action, its outcome and what changed, without the controls themselves.
export function reviewedAction(service,taskId,actionId){
  if(!actionId)return null;
  const action=service.store.get('computer-action:'+actionId);
  if(!action||action.taskId!==taskId)return null;
  const stored=service.computerBinding?.taskId===taskId&&service.computerBinding.id===action.bindingId?service.store.get('computer-image:'+actionId):null;
  if(action.action==='batch')return {id:action.id,action:'batch',steps:stepResults(action),state:action.state,execution:action.execution||'not_started',verification:action.verification,error:action.error||null,stopped:action.stopped||null,
    changes:observedChanges(stored?.beforeObservation,stored?.afterObservation),instruction:BATCH_RESULT};
  return {id:action.id,action:action.action,selector:action.target?.resolvedSelector||action.selector,state:action.state,execution:action.execution||'not_started',verification:action.verification,error:action.error||null,
    controlCheck:action.controlCheck||null,changes:observedChanges(stored?.beforeObservation,stored?.afterObservation),...(observedEffect(service,action)?{observed:observedEffect(service,action)}:{}),
    instruction:'The action the user approved and its outcome. It was carried out once: do not propose it again unless the user asks for a repetition. observed no_change: the host saw no control change its name or availability, so the same action is unlikely to help; choose the action the control supports (select for a list item). Observe the app for what this does not show.'};
}
// The outcome of each step of a batch, without the text that was entered.
const BATCH_RESULT='The batch the user approved and the outcome of every step. A step with execution command_returned or already_at_target is done: do not propose it again. A step with not_started was not carried out; stopped names where the batch ended and why. Observe the app before proposing what is left. A button press has no readback (not_verified): read changes and observe the app.';
export function stepResults(action){
  return (action.steps||[]).map(step=>({index:step.index,action:step.action,selector:step.target?.resolvedSelector||step.selector,name:step.target?.element?.name||'',execution:step.execution||'not_started',verification:step.verification||'not_verified',
    ...(step.controlCheck?{state:{property:step.controlCheck.property,expected:step.controlCheck.expected,actual:step.controlCheck.actual}}:{})}));
}
export function computerCheckpoint(service,taskId){
  const all=service.store.list('computer-action:').filter(v=>v.taskId===taskId),checks=service.store.list('computer-check:').filter(v=>v.taskId===taskId);
  const unresolved=all.filter(v=>['proposed','starting','attention'].includes(v.state));
  return {kind:'host_computer_checkpoint',taskId,bound:service.computerBinding?.taskId===taskId,
    actions:all.slice(0,8).map(({id,action,state,execution,verification,finishedAt,review})=>({id,action,state,execution:execution||'not_started',verification,finishedAt:finishedAt||null,review:review?{state:review.state}:null})),
    checks:checks.slice(0,4).map(({id,verification,scope,at})=>({id,verification,scope,at})),
    unresolvedCount:unresolved.length,unresolved:unresolved.slice(0,8).map(({id,state})=>({id,state})),omittedActions:Math.max(0,all.length-8),omittedChecks:Math.max(0,checks.length-4),
    instruction:'Host facts, not an AI summary or execution permission. Historical results do not establish current app state. Never replay pending or uncertain operations. A matched control value does not verify the entire task.'};
}

// What differs between the controls observed before an action and after it.
// Both are depth-limited readings of the same window: a control that only one
// reading reached counts as added or removed. No difference is not proof that
// the action had no effect.
const SHOWN=20;
export function observedChanges(before,after){
  if(!Array.isArray(before?.elements)||!Array.isArray(after?.elements))return null;
  const was=new Map(before.elements.map(element=>[element.selector,element])),now=new Map(after.elements.map(element=>[element.selector,element]));
  const changed=[],fields=['name','isEnabled','isOffscreen'];
  for(const [selector,element] of now){
    const earlier=was.get(selector);if(!earlier)continue;
    const differs=fields.filter(field=>earlier[field]!==element[field]);
    if(differs.length)changed.push({selector,before:Object.fromEntries(differs.map(field=>[field,earlier[field]])),after:Object.fromEntries(differs.map(field=>[field,element[field]]))});
  }
  const brief=element=>({selector:element.selector,name:element.name,type:element.type});
  const added=[...now.values()].filter(element=>!was.has(element.selector)).map(brief),removed=[...was.values()].filter(element=>!now.has(element.selector)).map(brief);
  const omitted=Math.max(0,changed.length-SHOWN)+Math.max(0,added.length-SHOWN)+Math.max(0,removed.length-SHOWN);
  return {changed:changed.slice(0,SHOWN),added:added.slice(0,SHOWN),removed:removed.slice(0,SHOWN),compared:now.size,...(omitted?{omitted}:{})};
}
export function readComputerResult(service,taskId,{actionId,includeImage=false,phase='after'}={}){
  if(typeof actionId!=='string'||typeof includeImage!=='boolean'||!['before','after'].includes(phase))fail('computer_invalid');
  const action=service.store.get('computer-action:'+actionId);
  if(!action||action.taskId!==taskId)fail('computer_result_missing');
  const receipt={id:action.id,action:action.action,state:action.state,execution:action.execution||'not_started',verification:action.verification,createdAt:action.createdAt,finishedAt:action.finishedAt||null,error:action.error||null,inputMode:action.inputMode||'uia',pointerApproval:action.pointerApproval||null,pointerDisplay:action.pointerDisplay?{available:action.pointerDisplay.available,animated:action.pointerDisplay.animated}:null,visualDifference:action.visualDifference||null,controlCheck:action.controlCheck||null,wikiEvidence:action.wikiEvidence||[],documentEvidence:action.documentEvidence||null,...(action.action==='batch'?{steps:stepResults(action),stopped:action.stopped||null}:{})};
  let image;
  const binding=service.computerBinding,canReadEvidence=binding?.taskId===taskId&&binding.id===action.bindingId;
  if(includeImage){
    if(!canReadEvidence)fail('computer_binding_required');
    image=service.store.get('computer-image:'+actionId)?.[phase];
  }
  const stored=canReadEvidence?service.store.get('computer-image:'+actionId):undefined,observation=phase==='after'?stored?.afterObservation:undefined;
  const changes=phase==='after'?observedChanges(stored?.beforeObservation,stored?.afterObservation):null;
  return {receipt,historical:true,phase,image,observation,...(changes?{changes}:{}),...(observedEffect(service,action)?{observed:observedEffect(service,action)}:{}),imageStatus:includeImage?(image?'captured':'not_captured'):'not_requested',instruction:(action.action==='batch'?BATCH_RESULT+' ':'')+'changes lists the controls whose name or state differs between the observation before the action and the one after it; an empty list is not proof that nothing happened. This is an immutable capture of a previous operation, not the live screen. UIA and pixels were read sequentially, not atomically. Obtain observe_computer before input. Never turn this result or a subagent opinion into permission or business success.'};
}

// Ephemeral loop detection. New opaque observation IDs alone are not progress.
export function createComputerProgress(){
  const scopes=new Map();let failures=0,lastValue=null;
  return {
    observe(name,args,result){
      if(name==='observe_computer'&&result?.observationId){
        // Animation/cursor pixels do not demonstrate progress on a UIA target.
        const scope=JSON.stringify([result.identity,result.coverage||{mode:'tree'}]);
        const next=hash(JSON.stringify([...(result.elements||[])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
        if(scopes.has(scope)&&scopes.get(scope)!==next)failures=0;
        // Changing a query or result order is not progress. Keep the comparison cache bounded.
        scopes.set(scope,next);if(scopes.size>16)scopes.delete(scopes.keys().next().value);
      }
      if(name==='verify_computer_value'&&result?.verification==='value_matched'){
        const key=hash(JSON.stringify([result.selector,result.expected,result.actual]));
        if(key!==lastValue)failures=0;lastValue=key;
      }
      if(result?.error?.startsWith('computer_')){
        failures++;
      }
      return {failures,needsInput:failures>=3};
    }
  };
}

export async function reviewComputerResult(service,taskId,{id,fingerprint}={}){
  const action=service.store.get('computer-action:'+id),task=service.task(taskId);
  if(!action||action.taskId!==taskId||action.fingerprint!==fingerprint||action.state!=='observed')fail('computer_review_required');
  if(task.state==='cancelled'||service.disposed)fail('computer_cancelled');
  if(task.question)fail('question_pending');
  if(action.review?.state==='running'||action.review?.state==='finished')return {review:action.review};
  if(service.store.list('computer-action:').some(v=>v.taskId===taskId&&['proposed','starting','attention'].includes(v.state)))fail('computer_review_required');
  if(service.agent?.running||service.computerBusy||service.unsettledOperations?.size)fail('computer_busy');
  if(service.computerBinding?.taskId!==taskId)fail('computer_binding_required');
  // Claim before awaiting startAgent. Never dispatch the old native action.
  action.review={state:'running',at:new Date().toISOString()};service.store.set('computer-action:'+id,action);
  const update=value=>{const current=service.store.get('computer-action:'+id);if(current)service.store.set('computer-action:'+id,{...current,review:{...current.review,...value}});};
  try{
    const started=await service.startAgent({taskId,computerReviewId:id}),run=service.agent;
    if(run?.taskId!==taskId||run.runId!==started.runId){update({state:'interrupted'});return {review:service.store.get('computer-action:'+id).review};}
    run.promise.finally(()=>{const state=service.task(taskId).state;update({state:state==='review'||state==='waiting_input'?'finished':'interrupted'});}).catch(()=>{});
  }catch(error){update({state:'unavailable',error:error.message});}
  return {review:service.store.get('computer-action:'+id).review};
}

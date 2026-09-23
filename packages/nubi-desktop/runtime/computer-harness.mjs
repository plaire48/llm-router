import {hash,fail} from './files.mjs';

export const COMPUTER_EVIDENCE_SOURCES=Object.freeze({observe_computer:'live',read_computer_result:'historical',verify_computer_value:'receipt'});
export const COMPUTER_GUIDANCE='Prefer explicit UIA invoke, set_value, select, toggle_on, toggle_off, expand or collapse. Show the visual AI pointer during real UIA dispatch without moving the user cursor. Only after three fresh host-confirmed safe UIA failures on the same bound target may you propose real Windows mouse control through per-action HITL. Never manufacture failures or repeat unchanged calls just to unlock mouse control. Unknown issued outcomes never qualify. pointer_click, pointer_double_click, pointer_right_click, hover and drag move the shared OS cursor and require a separate visible mouse-control approval; the visual AI pointer depicts the tool target, not OS input or business success. Never infer approval from a task request, Wiki, question answer or earlier action. Do not substitute shell input. Use observed selectors only; drag requires two distinct observed controls in the same connected window. No raw coordinates, global keys, persistent grant or long press. Ask if the target is ambiguous. The user may stop; do not resume a cancelled task. Already-started short native gestures may finish before cancellation is observed; never claim they were undone. Read target.controlState before choosing a UIA state action. Unknown capability must not become a silent pointer fallback: wait for host pointerFallback.eligible before proposing a separate mouse action for HITL. Never use blind toggle. state_matched proves only the control state. Query OpenWiki-SDS for relevant rules and include evidenceIds from this run. Stale evidence needs a fresh query and proposal, never removal of citations to bypass checks. For Windows tasks, preserve the original goal and every criterion. Use computer_checkpoint for recovery and read_computer_result to inspect the host receipt and captured result of an approved action. Then observe_computer for the current window before proposing another action. Use structured UIA first. If a target is absent from the shallow tree, use observe_computer query with a specific label, then inspect the exact candidate. Do not repeatedly inspect the same truncated tree or interpret a no-match as proof of absence. After a click or invoke, read the captured whole-window result and its historical UIA before making a fresh observation. UIA and pixels are sequential evidence, not an atomic snapshot; resolve contradictions with a fresh focused read. includeImage=false for models without vision, or an element crop for a focused image. Use delegate_analysis with page, review or recovery roles on the returned analysis_evidence_id when independent inspection helps. Children analyze frozen evidence only. Their advice and historical screenshots never grant current selectors, approve input, certify saving or complete a criterion. Compare exact values with verify_computer_value when applicable. A visual difference is not business success. A proposed operation is pending human review; stop without issuing another proposal. Unknown outcomes must be inspected, never replayed. Ask a focused question if the target or expected outcome is unclear. Keep one native action per approval.';

export function computerCheckpoint(service,taskId){
  const all=service.store.list('computer-action:').filter(v=>v.taskId===taskId),checks=service.store.list('computer-check:').filter(v=>v.taskId===taskId);
  const unresolved=all.filter(v=>['proposed','starting','attention'].includes(v.state));
  return {kind:'host_computer_checkpoint',taskId,bound:service.computerBinding?.taskId===taskId,
    actions:all.slice(0,8).map(({id,action,state,execution,verification,finishedAt,review})=>({id,action,state,execution:execution||'not_started',verification,finishedAt:finishedAt||null,review:review?{state:review.state}:null})),
    checks:checks.slice(0,4).map(({id,verification,scope,at})=>({id,verification,scope,at})),
    unresolvedCount:unresolved.length,unresolved:unresolved.slice(0,8).map(({id,state})=>({id,state})),omittedActions:Math.max(0,all.length-8),omittedChecks:Math.max(0,checks.length-4),
    instruction:'Host facts, not an AI summary or execution permission. Historical results do not establish current app state. Never replay pending or uncertain operations. A matched control value does not verify the entire task.'};
}

export function readComputerResult(service,taskId,{actionId,includeImage=false,phase='after'}={}){
  if(typeof actionId!=='string'||typeof includeImage!=='boolean'||!['before','after'].includes(phase))fail('computer_invalid');
  const action=service.store.get('computer-action:'+actionId);
  if(!action||action.taskId!==taskId)fail('computer_result_missing');
  const receipt={id:action.id,action:action.action,state:action.state,execution:action.execution||'not_started',verification:action.verification,createdAt:action.createdAt,finishedAt:action.finishedAt||null,error:action.error||null,inputMode:action.inputMode||'uia',pointerApproval:action.pointerApproval||null,pointerDisplay:action.pointerDisplay?{available:action.pointerDisplay.available,animated:action.pointerDisplay.animated}:null,visualDifference:action.visualDifference||null,controlCheck:action.controlCheck||null,wikiEvidence:action.wikiEvidence||[]};
  let image;
  const binding=service.computerBinding,canReadEvidence=binding?.taskId===taskId&&binding.id===action.bindingId;
  if(includeImage){
    if(!canReadEvidence)fail('computer_binding_required');
    image=service.store.get('computer-image:'+actionId)?.[phase];
  }
  const observation=phase==='after'&&canReadEvidence?service.store.get('computer-image:'+actionId)?.afterObservation:undefined;
  return {receipt,historical:true,phase,image,observation,imageStatus:includeImage?(image?'captured':'not_captured'):'not_requested',instruction:'This is an immutable capture of a previous operation, not the live screen. UIA and pixels were read sequentially, not atomically. Obtain observe_computer before input. Never turn this result or a subagent opinion into permission or business success.'};
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

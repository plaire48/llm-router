import {uncertainTargets} from './uncertain-action.js';
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');

// Store comparison fingerprints, never browser refs, selectors, field values
// or executable actions. This is evidence binding, not an authorization token.
export async function reconciliationProof(name,args,observation) {
  const targets=uncertainTargets(name,args,observation);
  if(!targets?.length || targets.some(target=>!target.identity))return null;
  return {version:1,targets:await Promise.all(targets.map(async target=>({kind:target.kind,identityHash:await digest(target.identity),...(target.expected!==undefined?{expectedHash:await digest(target.expected)}:{})})))};
}
export function unresolvedReconciliations(task) {
  if([1,2].includes(task?.pendingReconciliation?.version))return [task.pendingReconciliation];
  return (task?.steps||[]).filter(step=>!step.reconciled && (['running','unknown'].includes(step.status)||step.uncertain) &&
    ['fill_form','click_element','select_option','press_key','drag_element','click_at','run_playwright','run_skill_script'].includes(step.tool))
    .map(step=>[1,2].includes(step.reconciliation?.version)?step.reconciliation:{version:2,unverifiable:true});
}
export async function reconcilesProofs(proofs,checks,observation) {
  if(!proofs.length || !checks?.length)return false;
  const observed=[];
  for(const check of checks) {
    const name=check.kind==='field_value'?'fill_form':check.kind==='control_state'?'click_element':null;
    if(!name)continue;
    const args=name==='fill_form'?{fields:[{field_id:check.ref,value:check.expected}]}:{ref:check.ref};
    const proof=await reconciliationProof(name,args,observation);
    if(proof)observed.push(...proof.targets);
  }
  return proofs.every(proof=>Array.isArray(proof.targets)&&proof.targets.length>0&&proof.targets.every(target=>observed.some(current=>
    current.kind===target.kind&&current.identityHash===target.identityHash&&(!target.expectedHash||current.expectedHash===target.expectedHash))));
}

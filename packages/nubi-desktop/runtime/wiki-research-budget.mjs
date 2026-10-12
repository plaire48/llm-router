// The OpenWiki research of a run keeps to a budget on this host (user decision 2026-10-12: a partial answer in
// time beats a complete one after twenty minutes; measured S30, a whole-Wiki review ran 158 research calls past
// the evaluation limit, as a chain of questions of about a minute each). Researcher calls are counted for the
// whole run, so a model that asks the Wiki again after a partial answer does not start afresh; the time is per
// question, so a later question of a long task is not refused for the age of the first.
// Measured 2026-10-12 (D2 with a first budget on researcher calls only): the researchers finished in four minutes
// and the next twelve went to 57 synthesis calls that merge their reports four at a time. So after the question's
// time every call of that question is refused, synthesis included: OpenWiki then keeps the reports it has and
// returns them joined as a partial answer (its own failed-synthesis path), without new model calls. Before the time,
// only researcher calls count against the run's calls. Document analysis (analyze_documents) keeps its own pace:
// only questions of the Wiki count, by the id the shared runtime gives them (wiki-…). OpenWiki's code is not changed.
export const WIKI_RESEARCH_BUDGET=Object.freeze({ms:8*60*1000,calls:120});
const RESEARCHER="You are OpenWiki's read-only evidence researcher",SYNTHESIS='Synthesize the supplied researcher findings';
export function isResearcherCall(wire){
  const system=Array.isArray(wire)?wire.find(message=>message.role==='system'):null,text=typeof system?.content==='string'?system.content:'';
  return text.startsWith(RESEARCHER)&&!text.includes(SYNTHESIS);
}
export function createResearchBudget({ms=WIKI_RESEARCH_BUDGET.ms,calls=WIKI_RESEARCH_BUDGET.calls,now=Date.now}={}){
  const minutes=Math.max(1,Math.round(ms/60000)),questions=new Map();
  let spent=0,refused=false;
  return {
    // A call of a question over its time, or a researcher call over the run's calls, is refused with research_budget, not retried.
    admit(scope,wire){
      if(scope?.role!=='research'||typeof scope.taskId!=='string'||!scope.taskId.startsWith('wiki-'))return;
      if(!questions.has(scope.taskId))questions.set(scope.taskId,now());
      const refuse=()=>{refused=true;throw Object.assign(new Error('research_budget'),{retryable:false});};
      if(now()-questions.get(scope.taskId)>=ms)refuse();
      if(!isResearcherCall(wire))return;
      if(spent>=calls)refuse();
      spent++;
    },
    // Whether a call was refused since the last answer. Read once per answer.
    consume(){const value=refused;refused=false;return value;},
    spent:()=>spent,
    note:`The host's research budget cut this question (${minutes} minutes for one question, ${calls} researcher calls for the whole task): the answer covers only the ranges read and the findings may be joined rather than merged. Another Wiki question in this run may be cut the same way. Answer from the findings so far and source_search, and tell the user the answer is partial. `,
  };
}

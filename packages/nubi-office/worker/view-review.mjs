import {goalReviewMessages,parseGoalReview,reviewEvidence} from '../../../extensions/aipro-chat/goal-review.js';
import {createAnalysisJobs,analysisKey} from './analysis-jobs.mjs';
import {textIndex} from './context-memory.mjs';

export function viewCriteria(args){
  const criteria=args.criterion!==undefined?[args.criterion]:args.criteria;
  if(args.criterion!==undefined&&args.criteria!==undefined||!Array.isArray(criteria)||!criteria.length||criteria.length>3||criteria.some(c=>typeof c!=='string'||!c.trim()||c.length>1000)||new Set(criteria.map(c=>c.trim())).size!==criteria.length)throw new Error('tool_arguments_invalid');
  return criteria.map(c=>c.trim());
}

// Search ranks exact observations, not model summaries. An omitted element is
// unknown, never evidence of absence. Bound each child's text independently.
function relevantElements(elements,criterion){
  const index=textIndex(elements.map((item,i)=>({id:i,text:[item.name,item.type].filter(Boolean).join(' ')})));
  const order=[...elements.flatMap((item,i)=>item.focused?[i]:[]),...index.search(criterion).map(hit=>hit.id),...elements.map((_,i)=>i)];
  const selected=[];
  for(const i of new Set(order)){
    const next=[...selected,elements[i]];
    if(next.length>30)break;
    if(JSON.stringify(next).length<=9000)selected.push(elements[i]);
  }
  return selected;
}

export const viewFrameKey=(view,withImage)=>analysisKey([
  view.binding,view.window,view.processId,view.windowWidth,view.windowHeight,
  view.elements,view.truncated,
  ...(withImage?[view.imageStatus,view.imageSha256,view.width,view.height]:[])
]);
export const viewModelKey=providers=>{
  const {provider,model,vision}=providers.status();
  return analysisKey([provider,model,vision===true]);
};

export function createViewReviewer({providers,signal,activity,metrics,timeoutMs=45000}){
  // Reuse the Office scheduler: bounded concurrency, identity fences, timeout
  // races, cancellation and successful-branch reuse. It never owns retries.
  let selectedModel;
  const jobs=createAnalysisJobs({providers:{status:()=>providers.status(),complete:(...args)=>{
    if(selectedModel!==viewModelKey(providers))throw new Error('analysis_invalid');
    metrics.reviewCalls=(metrics.reviewCalls||0)+1;
    return providers.complete(...args);
  }},signal,activity,metrics,timeoutMs});
  return {clear:()=>jobs.clear(),async run(captured,criteria,image){
    selectedModel=viewModelKey(providers);
    metrics.modelCalls??=0;
    const prepared=criteria.map(criterion=>{
      const elements=relevantElements(captured.elements,criterion);
      const item=reviewEvidence(1,'inspect_office_view',{}, {...captured,elements,uiElementsOmitted:captured.truncated||elements.length<captured.elements.length});
      item.coverage={partial:item.result.uiElementsOmitted===true};
      const packet=goalReviewMessages({goal:criterion,history:[],evidence:[item],answer:'Review this visible Office window only. No document completion claim.',image,inputBudget:12000,phase:'checkpoint'});
      packet.messages[0].content+='\nOffice 2016 window review only. Do not execute tools or control the mouse. UIA selection is query-ranked and incomplete; missing elements are unknown. No screenshot/layout proof beyond the attached image. '+(image?'Image covers only this captured viewport.':'NO IMAGE WAS PROVIDED. Rendering, visual identity, color and clipping checks MUST stay unknown. Use only UIA labels and bounds.');
      return {goal:criterion,brief:{goal:criterion,role:'review'},tool:'review_office_view',key:analysisKey([captured.id,viewFrameKey(captured,!!image),criterion]),messages:packet.messages,parse(response){
        const verdict=parseGoalReview(response,packet.evidence);
        return {summary:verdict.next_step,findings:verdict.checks,missing:verdict.checks.filter(c=>c.status!=='met').map(c=>c.requirement),verdict};
      }};
    });
    const batch=await jobs.run(prepared);
    if(batch.status!=='analyzed'){
      const failed=batch.results.find(r=>r.status==='failed');
      throw Object.assign(new Error('view_review_failed'),{reason:failed.error,status:failed.httpStatus,retryAfterMs:batch.retryAfterMs});
    }
    const reviews=batch.results.map((r,i)=>({criterion:criteria[i],...r.verdict,cached:r.cached===true}));
    const status=reviews.some(r=>r.status==='blocked')?'blocked':reviews.some(r=>r.status==='revise')?'revise':'complete';
    const primary=reviews.find(r=>r.status===status)||reviews[0];
    return {status,checks:reviews.flatMap(r=>r.checks),next_step:primary.next_step,...(primary.question?{question:primary.question}:{}),reviews,concurrency:batch.concurrency};
  }};
}

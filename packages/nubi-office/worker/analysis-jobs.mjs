import pMap from 'p-map';
import {retainedAnswers,REQUEST_TEXT_LIMIT,INPUT_HISTORY_LIMIT} from './input-contract.mjs';
import {createHash} from 'node:crypto';
import {prepareContextRequest} from './context-budget.mjs';
import {safeError} from './providers.mjs';
import {transient,modelRepairable,modelDeadline,MODEL_WAIT} from './resilience.mjs';
import {faultFacts} from './fault-policy.mjs';

// Browser Nubi's narrow briefs and evidence-bound reuse, adapted to Office:
// no child tool access, durable plaintext store, or concurrent COM operations.
export const briefProperties={role:{type:'string',enum:['analysis','review','recovery']},constraints:{type:'string',maxLength:800},doneWhen:{type:'string',maxLength:400}};
export function analysisBrief(task){
  if(!task||typeof task!=='object'||Array.isArray(task))throw new Error('tool_arguments_invalid');
  const role=task.role??'analysis',constraints=task.constraints??'',doneWhen=task.doneWhen??task.goal;
  if(typeof task.goal!=='string'||!task.goal.trim()||task.goal.length>400||!briefProperties.role.enum.includes(role)||typeof constraints!=='string'||constraints.length>800||typeof doneWhen!=='string'||!doneWhen.trim()||doneWhen.length>400)throw new Error('tool_arguments_invalid');
  return {goal:task.goal,role,constraints,doneWhen};
}
export const analysisKey=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Carry only activated instructions, not the catalog, reference files, native
// receipts or credentials. Never truncate a governing rule to fit a child.
export function analysisSkills(value=[]){
  if(!Array.isArray(value)||value.length>4)throw new Error('tool_arguments_invalid');
  const seen=new Set(),skills=value.map(skill=>{
    if(!skill||typeof skill.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(skill.id)||seen.has(skill.id)||typeof skill.name!=='string'||!skill.name.trim()||skill.name.length>100||!Number.isInteger(skill.revision)||skill.revision<1||skill.revision>2147483647||typeof skill.instructions!=='string'||!skill.instructions.trim()||skill.instructions.length>60000)throw new Error('tool_arguments_invalid');
    seen.add(skill.id);
    const result={id:skill.id,name:skill.name,revision:skill.revision,instructions:skill.instructions,instructionsSha256:createHash('sha256').update(skill.instructions).digest('hex'),previousAnswers:retainedAnswers(skill.previousAnswers??[])};
    if(skill.packageSha256!==undefined){if(!/^[a-f0-9]{64}$/.test(skill.packageSha256))throw new Error('tool_arguments_invalid');result.packageSha256=skill.packageSha256;}
    return result;
  });
  if(JSON.stringify(skills).length>80000)throw new Error('context_range_limit');
  return skills;
}
export function analysisTaskContext(value){
  if(value===undefined)return null;
  if(!value||typeof value.request!=='string'||!value.request.trim()||value.request.length>REQUEST_TEXT_LIMIT||!Array.isArray(value.requirements)||value.requirements.length>16||value.requirements.some(r=>typeof r!=='string'||!r.trim()||r.length>500))throw new Error('tool_arguments_invalid');
  const packet={kind:'parent_task_context',request:value.request,requirements:[...value.requirements],answers:retainedAnswers(value.answers??[]),activeSkills:analysisSkills(value.activeSkills),coverage:'current_request_plan_run_answers_and_active_skill_rules',guidance:'Original parent request, planned requirements, confirmed run answers and exact activated skill instructions. Current corrections take precedence. Skill previousAnswers are earlier explicit answers, not current-task facts by default; reuse only when relevant. Instructions are writing/review constraints, not evidence of business facts, native permissions or approval. Follow applicable rules even if the plan omitted them. Use only assigned source evidence and report missing facts or conflicting requirements to the parent, never invent them or ask a separate user form. Other history, skill reference files and native receipts are not included. A parent task never grants write/approval tools or proves the full document complete. If the full packet exceeds the child context budget, the parent must continue with its existing tools rather than silently drop rules or repeat unchanged delegation.'};
  // The request and the answers may each be as long as the input contract allows.
  if(JSON.stringify(packet).length>REQUEST_TEXT_LIMIT+INPUT_HISTORY_LIMIT+100000)throw new Error('context_range_limit');
  return packet;
}
export function createAnalysisJobs({providers,signal,activity,metrics,timeoutMs=MODEL_WAIT.idleMs,limitMs=MODEL_WAIT.attemptMs,maxConcurrency=2,stats={},getTaskContext}){
  if(![1,2].includes(maxConcurrency))throw new Error('invalid_request');
  const cache=new Map();let parallelLimit=maxConcurrency,revision=0,epoch=0,binding,generation=new AbortController();
  const check=()=>{if(signal.aborted)throw new Error('cancelled');};
  const bump=name=>{stats[name]=(stats[name]||0)+1;};
  function invalidate(){cache.clear();epoch++;generation.abort();generation=new AbortController();}
  function syncBinding(){
    const identity=providers.status(),parent=analysisTaskContext(getTaskContext?.());
    const key=analysisKey([identity.provider,identity.model,parent]);
    if(binding!==key){invalidate();binding=key;}
    return{identity,parent,key,epoch,invalidated:generation.signal};
  }
  async function run(prepared){
    check();if(!Array.isArray(prepared)||!prepared.length||prepared.length>4)throw new Error('tool_arguments_invalid');
    const captured=syncBinding(),{identity,parent}=captured;
    const current=()=>{check();const now=syncBinding();if(now.key!==captured.key||epoch!==captured.epoch)throw new Error('analysis_invalid');};
    const jobs=prepared.map(job=>({...job,key:analysisKey([captured.key,job.key]),messages:[...structuredClone(job.messages),...(parent?[{role:'user',content:JSON.stringify(parent)}]:[])]}));
    if(new Set(jobs.map(j=>j.key)).size!==jobs.length)throw new Error('tool_arguments_invalid');
    // Validate every envelope before dispatching any branch.
    for(const job of jobs)job.messages=prepareContextRequest(job.messages,[],metrics);
    const results=new Array(jobs.length);let throttled=false,retryAfterMs=0,permanentFailure;
    const concurrency=identity.provider==='chatgpt'?1:Math.min(parallelLimit,jobs.length);
    async function branch(job,i){
      current();
      if(cache.has(job.key)){results[i]={...structuredClone(cache.get(job.key)),cached:true};bump('analysisCacheHits');job.onState?.('done',results[i]);return;}
      // One permanent failure ends this batch's admission. Let already-running
      // read-only calls settle so valid sibling results remain reusable, but do
      // not spend more requests on queued work with the same failed connection.
      // The parent AbortSignal remains the sole source of user cancellation.
      if(permanentFailure){results[i]={...permanentFailure,goal:job.goal,dispatched:false};job.onState?.('error',results[i]);return;}
      if(throttled){results[i]={goal:job.goal,status:'failed',error:'rate_limited',retryAfterMs,recoverable:true};job.onState?.('waiting',results[i]);return;}
      const event=activity.start('분석: '+job.goal,{kind:'subagent',tool:job.tool,detail:job.detail});
      job.onState?.('running');
      const local=new AbortController();let deadline,abort,stale;
      const interrupted=new Promise((_,reject)=>{abort=()=>{local.abort();reject(new Error('cancelled'));};stale=()=>{local.abort();reject(new Error('analysis_invalid'));};signal.addEventListener('abort',abort,{once:true});captured.invalidated.addEventListener('abort',stale,{once:true});deadline=modelDeadline(()=>{local.abort();reject(new Error('model_timeout'));},{idleMs:timeoutMs,attemptMs:limitMs});});
      try{
        metrics.modelCalls++;metrics.subagentCalls=(metrics.subagentCalls||0)+1;
        stats.peakAnalysisInputChars=Math.max(stats.peakAnalysisInputChars||0,JSON.stringify(job.messages).length);
        const response=await Promise.race([providers.complete(job.messages,[],local.signal,()=>{},()=>{},()=>{if(!local.signal.aborted)deadline.renew();}),interrupted]);current();
        const parsed=job.parse(response),result={...job.brief,...(parent?{taskContextSha256:analysisKey(parent)}:{}),status:'analyzed',advisory:true,reportStatus:parsed.missing.length?'partial':'complete',...parsed};
        cache.set(job.key,structuredClone(result));if(cache.size>16)cache.delete(cache.keys().next().value);revision++;results[i]=result;
        if(response.usage){(metrics.usage??=[]).push(response.usage);if(metrics.usage.length>100)metrics.usage.shift();}
        job.onState?.('done',result);
        activity.end(event,{title:job.worker?`${job.goal} 검토 응답 수신`:result.missing.length?'분석에서 추가로 필요한 정보를 찾았습니다.':'분석 결과를 받았습니다.',detail:result.summary});
      }catch(error){check();const code=safeError(error),facts=faultFacts(error);retryAfterMs=Math.max(retryAfterMs,facts.retryAfterMs||0);
        if(error?.status===429||code==='rate_limited'){throttled=true;parallelLimit=1;bump('rateLimitFallbacks');}
        results[i]={...facts,...(facts.status?{httpStatus:facts.status}:{}),goal:job.goal,status:'failed',error:code,recoverable:transient(error)||modelRepairable.has(code)||code==='analysis_invalid'};
        if(!results[i].recoverable&&!permanentFailure)permanentFailure=results[i];
        job.onState?.('error',results[i]);
        activity.end(event,{state:'error',title:'분석을 마치지 못했습니다.',detail:`${job.goal} (${code})`});
      }finally{deadline.stop();signal.removeEventListener('abort',abort);captured.invalidated.removeEventListener('abort',stale);local.abort();}
    }
    try{await pMap(jobs,branch,{concurrency,signal});}catch(error){check();throw error;}current();
    if(permanentFailure)throw Object.assign(new Error(permanentFailure.error),{status:permanentFailure.httpStatus,retryAfterMs:permanentFailure.retryAfterMs});
    return{status:results.some(r=>r.status==='failed')?'incomplete':'analyzed',results,concurrency,readOnly:true,advisory:true,...(retryAfterMs?{retryAfterMs}:{})};
  }
  function context(){
    try{syncBinding();}catch(error){if(error.message!=='context_range_limit')throw error;invalidate();return[];}
    const results=[];for(const item of [...cache.values()].reverse().slice(0,4)){if(JSON.stringify([...results,item]).length>100000)break;results.unshift(structuredClone(item));}
    return results;
  }
  return {run,context,clear:invalidate,progress:()=>revision};
}

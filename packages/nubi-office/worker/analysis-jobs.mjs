import pMap from 'p-map';
import {createHash} from 'node:crypto';
import {prepareContextRequest} from './context-budget.mjs';
import {safeError} from './providers.mjs';
import {transient,modelRepairable} from './resilience.mjs';
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
export function createAnalysisJobs({providers,signal,activity,metrics,timeoutMs=120000,maxConcurrency=2,stats={}}){
  if(![1,2].includes(maxConcurrency))throw new Error('invalid_request');
  const cache=new Map();let parallelLimit=maxConcurrency,revision=0;
  const check=()=>{if(signal.aborted)throw new Error('cancelled');};
  const bump=name=>{stats[name]=(stats[name]||0)+1;};
  async function run(prepared){
    check();if(!Array.isArray(prepared)||!prepared.length||prepared.length>4)throw new Error('tool_arguments_invalid');
    const identity=providers.status(),jobs=prepared.map(job=>({...job,key:analysisKey([identity.provider,identity.model,job.key])}));
    if(new Set(jobs.map(j=>j.key)).size!==jobs.length)throw new Error('tool_arguments_invalid');
    // Validate every envelope before dispatching any branch.
    for(const job of jobs)job.messages=prepareContextRequest(job.messages,[],metrics);
    const results=new Array(jobs.length);let throttled=false,retryAfterMs=0;
    const concurrency=identity.provider==='chatgpt'?1:Math.min(parallelLimit,jobs.length);
    async function branch(job,i){
      check();
      if(cache.has(job.key)){results[i]={...structuredClone(cache.get(job.key)),cached:true};bump('analysisCacheHits');return;}
      if(throttled){results[i]={goal:job.goal,status:'failed',error:'rate_limited',retryAfterMs,recoverable:true};return;}
      const event=activity.start('분석: '+job.goal,{kind:'subagent',tool:job.tool,detail:job.detail});
      const local=new AbortController();let timer,abort;
      const interrupted=new Promise((_,reject)=>{abort=()=>{local.abort();reject(new Error('cancelled'));};signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{local.abort();reject(new Error('model_timeout'));},timeoutMs);});
      try{
        metrics.modelCalls++;metrics.subagentCalls=(metrics.subagentCalls||0)+1;
        stats.peakAnalysisInputChars=Math.max(stats.peakAnalysisInputChars||0,JSON.stringify(job.messages).length);
        const response=await Promise.race([providers.complete(job.messages,[],local.signal,()=>{},()=>{}),interrupted]);check();
        if(providers.status().provider!==identity.provider||providers.status().model!==identity.model)throw new Error('analysis_invalid');
        const parsed=job.parse(response),result={...job.brief,status:'analyzed',advisory:true,reportStatus:parsed.missing.length?'partial':'complete',...parsed};
        cache.set(job.key,structuredClone(result));if(cache.size>16)cache.delete(cache.keys().next().value);revision++;results[i]=result;
        if(response.usage){(metrics.usage??=[]).push(response.usage);if(metrics.usage.length>100)metrics.usage.shift();}
        activity.end(event,{title:result.missing.length?'분석에서 추가로 필요한 정보를 찾았습니다.':'분석 결과를 받았습니다.',detail:result.summary});
      }catch(error){check();const code=safeError(error),facts=faultFacts(error);retryAfterMs=Math.max(retryAfterMs,facts.retryAfterMs||0);
        if(error?.status===429||code==='rate_limited'){throttled=true;parallelLimit=1;bump('rateLimitFallbacks');}
        results[i]={...facts,...(facts.status?{httpStatus:facts.status}:{}),goal:job.goal,status:'failed',error:code,recoverable:transient(error)||modelRepairable.has(code)||code==='analysis_invalid'};
        activity.end(event,{state:'error',title:'분석을 마치지 못했습니다.',detail:`${job.goal} (${code})`});
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);local.abort();}
    }
    try{await pMap(jobs,branch,{concurrency,signal});}catch(error){check();throw error;}check();
    const permanent=results.find(r=>r.status==='failed'&&r.recoverable===false);if(permanent)throw Object.assign(new Error(permanent.error),{status:permanent.httpStatus,retryAfterMs:permanent.retryAfterMs});
    return{status:results.some(r=>r.status==='failed')?'incomplete':'analyzed',results,concurrency,readOnly:true,advisory:true,...(retryAfterMs?{retryAfterMs}:{})};
  }
  function context(){
    const results=[];for(const item of [...cache.values()].reverse().slice(0,4)){if(JSON.stringify([...results,item]).length>16000)break;results.unshift(structuredClone(item));}
    return results;
  }
  return {run,context,clear(){cache.clear();},progress:()=>revision};
}

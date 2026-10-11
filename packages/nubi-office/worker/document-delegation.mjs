import {normalizeTextRanges,rangeSources,textRangesProperty} from './content-ranges.mjs';
import {DepGraph} from 'dependency-graph';
import {analysisBrief,analysisKey,analysisTaskContext,briefProperties} from './analysis-jobs.mjs';

export const delegateDocumentTasksTool={type:'function',function:{
  name:'delegate_document_tasks',
  description:'Plan and run 1-8 read-only specialist tasks over already read Word/PPT items. Choose a short specialty for each task and explicit dependencies. Independent tasks run with at most two model calls; successors receive advisory predecessor findings and must cite raw assigned items. Partial or failed tasks block successors. No child native tools, writes, approvals or complete-document claims. For large items, use optional textRanges to assign already read UTF-16 intervals (1-4, <=8000 each, <=24000 total); every assigned item must have a range. Read them first with read_document_text. Ask the user about missing facts; keep writing and final verification in the parent.',
  parameters:{type:'object',additionalProperties:false,required:['tasks'],properties:{tasks:{type:'array',minItems:1,maxItems:8,items:{
    type:'object',additionalProperties:false,required:['id','specialty','goal','role','constraints','doneWhen','itemIds','dependsOn'],properties:{
      ...briefProperties,textRanges:textRangesProperty,id:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,39}$'},specialty:{type:'string',minLength:1,maxLength:60},goal:{type:'string',minLength:1,maxLength:400},
      itemIds:{type:'array',minItems:1,maxItems:12,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}},
      dependsOn:{type:'array',maxItems:7,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,39}$'}}
    }
  }}}}
}};

export const readDelegationResultsTool={type:'function',function:{name:'read_delegation_results',description:'Read retained original task contracts and specialist results for 1-2 task IDs from a current delegation plan. Rechecks native sources; performs no model call and grants no editing or approval. Use the planId and node IDs from delegation context when reports were omitted.',parameters:{type:'object',additionalProperties:false,required:['planId','taskIds'],properties:{planId:{type:'string',pattern:'^[a-f0-9]{64}$'},taskIds:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,39}$'}}}}}};

const invalid=()=>{throw new Error('tool_arguments_invalid');};
const complete=result=>result?.status==='analyzed'&&result.reportStatus==='complete'&&result.missing?.length===0;
const copy=value=>structuredClone(value);

function prepare(tasks,pages,getTextRange){
  if(!Array.isArray(tasks)||tasks.length<1||tasks.length>8)invalid();
  const items=new Map();
  const first=pages.values().next().value;
  if(!first)throw new Error('source_not_read');
  for(const page of pages.values()){
    if(['host','scopeId','documentId','fingerprint','total'].some(k=>page[k]!==first[k]))throw new Error('observation_invalid');
    for(const item of page.items){if(items.has(item.id))throw new Error('observation_invalid');items.set(item.id,{scopeId:page.scopeId,documentId:page.documentId,fingerprint:page.fingerprint,offset:page.offset,item});}
  }
  const normalized=prepareDelegationTasks(tasks,{sourceKey:'itemIds',maxSources:12,maxSourceIdLength:100,normalizeSourceScope:normalizeTextRanges,validateSources:ids=>{if(ids.some(id=>!items.has(id)))throw new Error('source_not_read');}});
  for(const task of normalized)rangeSources(task,items,getTextRange);
  return normalized;
}

export function prepareDelegationTasks(tasks,{sourceKey,maxSources,maxSourceIdLength,validateSources,normalizeSourceScope=()=>({})}){
  if(!Array.isArray(tasks)||tasks.length<1||tasks.length>8)invalid();
  const graph=new DepGraph(),semantic=new Set();
  const normalized=tasks.map(task=>{
    const brief=analysisBrief(task);
    if(typeof task.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(task.id)||typeof task.specialty!=='string'||!task.specialty.trim()||task.specialty.length>60||graph.hasNode(task.id))invalid();
    if(!Array.isArray(task[sourceKey])||!task[sourceKey].length||task[sourceKey].length>maxSources||task[sourceKey].some(id=>typeof id!=='string'||!id||id.length>maxSourceIdLength)||new Set(task[sourceKey]).size!==task[sourceKey].length)invalid();
    if(!Array.isArray(task.dependsOn)||task.dependsOn.length>7||task.dependsOn.some(id=>typeof id!=='string'||id===task.id)||new Set(task.dependsOn).size!==task.dependsOn.length)invalid();
    validateSources(task[sourceKey]);
    const sourceIds=[...task[sourceKey]].sort(),dependsOn=[...task.dependsOn].sort();
    const sourceScope=normalizeSourceScope(task);
    const key=analysisKey([brief,sourceIds,dependsOn,sourceScope]);if(semantic.has(key))invalid();semantic.add(key);
    graph.addNode(task.id);return{id:task.id,specialty:task.specialty,...brief,[sourceKey]:sourceIds,dependsOn,...sourceScope};
  });
  try{for(const task of normalized)for(const id of task.dependsOn)graph.addDependency(task.id,id);graph.overallOrder();}catch{invalid();}
  return normalized;
}

// The graph decides scheduling only. Native observation, editing, approval and
// final requirement verification remain exclusively owned by the parent.
export function createDocumentDelegation({analysis,pages,getPages,getTextRange,providers,signal,onWorkers=()=>{},checkSource,getTaskContext}){
  return createReadOnlyDelegation({analysis,prepareTasks:tasks=>prepare(tasks,pages,getTextRange),getSourceBinding:()=>[...(getPages?.()??pages).values()],getSourceIds:task=>[task.itemIds,task.textRanges??null],providers,signal,onWorkers,checkSource,getTaskContext});
}

export function createReadOnlyDelegation({analysis,prepareTasks,getSourceBinding,getSourceIds,providers,signal,onWorkers=()=>{},checkSource,getTaskContext}){
  if(typeof checkSource!=='function')throw new Error('invalid_request');
  const plans=new Map(),accepted=new Set();let revision=0,epoch=0,busy=false,lastKey;
  function binding(){const identity=providers.status();return analysisKey([identity.provider,identity.model,analysisTaskContext(getTaskContext?.()),getSourceBinding()]);}
  function check(){if(signal.aborted)throw new Error('cancelled');}
  function clear(){plans.clear();lastKey=undefined;epoch++;analysis.clear();}
  function workers(plan){onWorkers(plan.tasks.map(task=>{
    const result=plan.results.get(task.id),state=plan.states.get(task.id)??'pending';
    return{id:`${plan.key.slice(0,12)}:${task.id}`,taskId:task.id,phase:'delegation',title:task.specialty,scope:task.goal,state,summary:result?.summary??(state==='blocked'?'선행 작업의 결과를 확인해야 합니다.':''),missing:copy(result?.missing??[]),dependsOn:[...task.dependsOn]};
  }));}
  function prune(){
    while(plans.size>8)plans.delete(plans.keys().next().value);
    let count=[...plans.values()].reduce((n,p)=>n+[...p.results.values()].filter(complete).length,0);
    for(const plan of plans.values())for(const [id,result] of plan.results){if(count<=16)return;if(complete(result)&&plan.key!==lastKey){plan.results.delete(id);plan.states.delete(id);count--;}}
  }
  async function execute(input){
    check();if(busy)throw new Error('analysis_invalid');
    const tasks=prepareTasks(input),bound=binding(),capturedEpoch=epoch;
    const key=analysisKey([bound,[...tasks].sort((a,b)=>a.id.localeCompare(b.id))]);
    const semanticKeys=new Map();
    function progressKey(task){
      if(semanticKeys.has(task.id))return semanticKeys.get(task.id);
      // Display IDs and ordering do not constitute work. Bind progress to the
      // actual specialist contract and recursively to predecessor contracts.
      // prepare() already rejects cycles and references outside this graph.
      const dependencies=task.dependsOn.map(id=>progressKey(tasks.find(candidate=>candidate.id===id))).sort();
      const semanticKey=analysisKey([bound,task.specialty,analysisBrief(task),getSourceIds(task),dependencies]);
      semanticKeys.set(task.id,semanticKey);return semanticKey;
    }
    const current=()=>{check();if(epoch!==capturedEpoch||binding()!==bound){clear();throw new Error('analysis_invalid');}};
    const verify=async()=>{try{await checkSource();current();}catch(error){clear();throw error;}};
    let plan=plans.get(key);if(!plan){plan={key,binding:bound,tasks,results:new Map(),states:new Map(),attempt:0};plans.set(key,plan);}lastKey=key;
    busy=true;
    let retryAfterMs=0;
    try{
      await verify();
      for(const task of tasks){const result=plan.results.get(task.id);plan.states.set(task.id,complete(result)?'done':result?.reportStatus==='partial'?'waiting':'pending');}
      workers(plan);
      const attempted=new Set();
      while(true){
        current();
        for(const task of tasks){
          if(plan.results.has(task.id)||attempted.has(task.id))continue;
          if(task.dependsOn.some(id=>['error','waiting','blocked'].includes(plan.states.get(id))))plan.states.set(task.id,'blocked');
        }
        const ready=tasks.filter(task=>!plan.results.has(task.id)&&!attempted.has(task.id)&&task.dependsOn.every(id=>complete(plan.results.get(id)))).slice(0,4);
        if(!ready.length)break;
        ready.forEach(task=>attempted.add(task.id));
        const dependencies=ready.map(task=>task.dependsOn.map(id=>({id,...copy(plan.results.get(id))})));
        const received=new Map();
        const accept=(task,value)=>{
          if(value?.status!=='analyzed')return;
          plan.results.set(task.id,copy(value));plan.states.set(task.id,complete(value)?'done':'waiting');
          if(complete(value)){const acceptedKey=progressKey(task);if(!accepted.has(acceptedKey)){accepted.add(acceptedKey);revision++;}}
          plan.failures?.delete(task.id);
        };
        let result;
        try{result=await analysis.execute(ready,{delegation:{planKey:key,attempt:++plan.attempt,specialties:ready.map(task=>task.specialty),dependencies},onState:(index,state,value)=>{
          if(epoch!==capturedEpoch||signal.aborted)return;
          if(value&&['analyzed','failed'].includes(value.status))received.set(index,copy(value));
          plan.states.set(ready[index].id,state==='done'?(complete(value)?'running':'waiting'):state);workers(plan);
        }});}catch(error){
          // The scheduler drains admitted branches before a permanent failure.
          // Preserve valid siblings only after the parent rechecks native data.
          // Cancellation or a changed source/model must never admit old reports.
          current();await verify();
          for(const [index,value] of received){
            const task=ready[index];if(value.status==='failed'){plan.failures??=new Map();plan.failures.set(task.id,copy(value));plan.states.set(task.id,'error');}else accept(task,value);
          }
          workers(plan);throw error;
        }
        // All branch promises have settled before any COM/native source check.
        await verify();
        ready.forEach((task,index)=>{
          const value=result.results[index];
          if(value.status==='analyzed')plan.results.set(task.id,copy(value));
          plan.states.set(task.id,complete(value)?'done':value.status==='analyzed'?'waiting':'error');
          if(complete(value)){const acceptedKey=progressKey(task);if(!accepted.has(acceptedKey)){accepted.add(acceptedKey);revision++;}}
          if(value.status==='failed')plan.failures??=new Map();
          if(value.status==='failed')plan.failures.set(task.id,copy(value));else plan.failures?.delete(task.id);
        });workers(plan);
        retryAfterMs=Math.max(retryAfterMs,result.retryAfterMs??0);
        // The existing parent recovery owner decides when another batch may run.
        // In particular, never turn a 429 into immediate calls for later nodes.
        if(result.results.some(value=>value.status==='failed'))break;
      }
      // Propagate blocked state through arbitrarily ordered dependency chains.
      for(let pass=0;pass<tasks.length;pass++)for(const task of tasks)if(!plan.results.has(task.id)&&!attempted.has(task.id)&&task.dependsOn.some(id=>!complete(plan.results.get(id))))plan.states.set(task.id,'blocked');
      for(const task of tasks)if(plan.states.get(task.id)==='pending')plan.states.set(task.id,'waiting');
      await verify();workers(plan);prune();
      function predecessorMissing(task,seen=new Set()){
        const missing=[];for(const id of task.dependsOn){if(seen.has(id))continue;seen.add(id);missing.push(...(plan.results.get(id)?.missing??[]));const parent=tasks.find(t=>t.id===id);if(parent)missing.push(...predecessorMissing(parent,seen));}return missing;
      }
      const results=tasks.map(task=>({id:task.id,specialty:task.specialty,dependsOn:[...task.dependsOn],...(plan.results.has(task.id)?copy(plan.results.get(task.id)):plan.states.get(task.id)==='error'?copy(plan.failures.get(task.id)):{status:'blocked',missing:[...new Set([plan.states.get(task.id)==='blocked'?'선행 작업이 완료되지 않았습니다.':'이 작업은 아직 실행되지 않았습니다.',...predecessorMissing(task)])]})}));
      return{planId:key,status:results.every(complete)?'analyzed':'incomplete',readOnly:true,advisory:true,results,...(retryAfterMs?{retryAfterMs}:{}),instruction:'Specialist reports are advisory only. Preserve missing facts, ask for missing inputs or replan, and use the parent Office tools with existing approval and final verification.'};
    }catch(error){
      if(signal.aborted||epoch!==capturedEpoch||binding()!==bound){clear();}
      for(const task of tasks)if(epoch!==capturedEpoch||['running','pending'].includes(plan.states.get(task.id)))plan.states.set(task.id,'unconfirmed');
      workers(plan);throw error;
    }finally{busy=false;}
  }
  function context(){
    check();const plan=plans.get(lastKey);if(!plan)return[];
    try{if(plan.binding!==binding()){clear();return[];}}catch(error){if(error.message!=='context_range_limit')throw error;clear();return[];}
    const packet={planId:plan.key,readOnly:true,advisory:true,nodes:plan.tasks.map(task=>({id:task.id,specialty:task.specialty,state:plan.states.get(task.id)??'pending',dependsOn:[...task.dependsOn],missing:copy(plan.results.get(task.id)?.missing??[])})),results:[],omittedTaskIds:plan.tasks.map(task=>task.id),instruction:'Only retained uncut reports are shown; omitted, failed, blocked and pending tasks are not inspected evidence. Use read_delegation_results with planId and taskIds to recover exact original task contracts and retained results without rerunning models.'};
    // Keep every node and uncertainty visible. If unusually long missing lists
    // exhaust the compact envelope, point to the exact read tool rather than
    // silently cutting individual facts or treating the node as complete.
    for(const node of [...packet.nodes].reverse()){
      if(JSON.stringify([packet]).length<=14000)break;
      if(node.missing.length){node.missingCount=node.missing.length;node.missingDetailsOmitted=true;delete node.missing;}
    }
    for(const [id,result] of [...plan.results].reverse()){
      const entry={id,...copy(result)};
      if(packet.results.length>=4||JSON.stringify([{...packet,results:[entry,...packet.results]}]).length>15000)continue;
      else packet.results.unshift(entry);
    }
    packet.omittedTaskIds=plan.tasks.filter(task=>!packet.results.some(result=>result.id===task.id)).map(task=>task.id);
    return[packet];
  }
  async function read({planId,taskIds}={}){
    check();
    if(typeof planId!=='string'||!/^[a-f0-9]{64}$/.test(planId)||!Array.isArray(taskIds)||!taskIds.length||taskIds.length>2||taskIds.some(id=>typeof id!=='string')||new Set(taskIds).size!==taskIds.length)invalid();
    if(busy)throw new Error('analysis_invalid');
    const plan=plans.get(planId);if(!plan)throw new Error('source_not_read');
    const bound=binding(),capturedEpoch=epoch;
    if(bound!==plan.binding){clear();throw new Error('analysis_invalid');}
    if(taskIds.some(id=>!plan.tasks.some(task=>task.id===id)))invalid();
    try{await checkSource();check();if(epoch!==capturedEpoch||binding()!==bound)throw new Error('analysis_invalid');}catch(error){clear();throw error;}
    return{planId,readOnly:true,advisory:true,tasks:taskIds.map(id=>({task:copy(plan.tasks.find(task=>task.id===id)),state:plan.states.get(id)??'pending',result:copy(plan.results.get(id)??plan.failures?.get(id)??{status:plan.states.get(id)==='blocked'?'blocked':'not_run',missing:['이 작업의 검증된 결과가 없습니다.']})})),instruction:'Retained reports are advisory. Missing or unexecuted work is not complete; only the parent may ask inputs, replan, edit and verify.'};
  }
  return{execute,read,context,clear,progress:()=>revision};
}

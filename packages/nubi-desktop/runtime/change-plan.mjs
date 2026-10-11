import Ajv from 'ajv';
import {randomUUID} from 'node:crypto';
import {fail} from './files.mjs';
import {queryKnowledgeMap} from './knowledge-map.mjs';
import {validateWikiEvidence} from './wiki-evidence.mjs';

const text=maxLength=>({type:'string',minLength:1,maxLength});
const list=(items,maxItems,minItems=1)=>({type:'array',items,minItems,maxItems});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
export const CHANGE_PLAN_SCHEMA=object({
  summary:text(1200),
  requirements:list(object({id:text(50),text:text(1000),criterionId:text(50),evidenceIds:list(text(80),10,0)},['id','text']),15),
  targets:list(object({path:text(1000),reason:text(1000),requirementIds:list(text(50),15),action:{type:'string',enum:['edit','create']}},['path','reason','requirementIds']),10),
  checks:list(object({requirementId:text(50),method:{type:'string',enum:['test','browser','inspection']},description:text(1000)}),30),
  assumptions:list(text(500),10,0)
});
const validate=new Ajv({allErrors:true}).compile(CHANGE_PLAN_SCHEMA);
// A refusal names what was wrong and what is valid, so the next call can be corrected.
const refuse=(code,details)=>{throw Object.assign(new Error(code),{details});};

export async function recordChangePlan(service,task,input,observations,runId){
  if(!validate(input))refuse('plan_invalid',{problems:validate.errors.slice(0,8).map(e=>((e.instancePath||'/')+' '+e.message+(e.params?.missingProperty?': '+e.params.missingProperty:e.params?.allowedValues?': '+e.params.allowedValues.join(', '):e.params?.additionalProperty?': '+e.params.additionalProperty:'')).slice(0,200))});
  const ids=new Set(input.requirements.map(r=>r.id)),problems=[];
  if(ids.size!==input.requirements.length)problems.push('requirement ids must be unique');
  if(new Set(input.targets.map(t=>t.path)).size!==input.targets.length)problems.push('target paths must be unique');
  input.checks.forEach((c,i)=>{if(!ids.has(c.requirementId))problems.push(`check ${i+1} names unknown requirement "${c.requirementId}"`);});
  for(const r of input.requirements)if(!input.checks.some(c=>c.requirementId===r.id))problems.push(`requirement "${r.id}" has no check`);
  for(const t of input.targets)for(const id of t.requirementIds)if(!ids.has(id))problems.push(`target "${t.path}" names unknown requirement "${id}"`);
  if(problems.length)refuse('plan_invalid',{problems:problems.slice(0,8)});
  const known=new Set(task.criteria.map(c=>c.id)),unknownCriterionIds=[...new Set(input.requirements.map(r=>r.criterionId).filter(id=>id&&!known.has(id)))];
  // With no user criteria there is nothing to cover. An invented id is dropped, never stored as if the user wrote it.
  if(!task.criteria.length)input={...input,requirements:input.requirements.map(({criterionId,...r})=>r)};
  else{
    const uncoveredCriterionIds=task.criteria.filter(c=>!input.requirements.some(r=>r.criterionId===c.id)).map(c=>c.id);
    if(unknownCriterionIds.length||uncoveredCriterionIds.length)refuse('plan_criteria_missing',{unknownCriterionIds,uncoveredCriterionIds,validCriteria:task.criteria.map(c=>({id:c.id,text:c.text}))});
  }
  const cited=[...new Set(input.requirements.flatMap(r=>r.evidenceIds||[]))],unknownEvidenceIds=cited.filter(id=>!observations.wikiEvidence?.has(id));
  if(unknownEvidenceIds.length)refuse('wiki_evidence_required',{unknownEvidenceIds,observedEvidence:[...(observations.wikiEvidence?.values()||[])].slice(-20).map(row=>({evidenceId:row.evidenceId,path:row.path}))});
  const wikiEvidence=cited.map(id=>observations.wikiEvidence.get(id));
  await validateWikiEvidence(service,task.id,wikiEvidence);
  const targets=[];
  for(const target of input.targets){
    const creating=target.action==='create';
    const current=creating?await service.inspectPath({path:target.path,taskId:task.id}):await service.read({path:target.path,taskId:task.id,full:true}),seen=(creating?observations.newPaths:observations.files).get(target.path);
    if(!seen||seen.hash!==current.hash)refuse('source_read_required',{path:target.path,reason:seen?'changed_after_read':'not_read_in_this_run'});
    if(seen.rulesFingerprint!==current.projectRules?.fingerprint)fail('project_rules_changed');
    targets.push({...target,action:creating?'create':'edit',hash:current.hash,rulesFingerprint:current.projectRules?.fingerprint,observedRanges:seen.ranges||[]});
  }
  const map=await service.knowledgeMap({taskId:task.id}),impacts=[],unmapped=[];
  for(const target of targets){
    const sourceNodes=map.nodes.filter(n=>n.kind==='source'&&n.path===target.path);
    if(!sourceNodes.length)unmapped.push(target.path);
    for(const node of sourceNodes){const packet=queryKnowledgeMap(map,{focusId:node.id});impacts.push({path:target.path,nodes:packet.nodes.map(({id,label,kind,origin})=>({id,label,kind,origin})),edges:packet.edges,truncated:packet.truncated});}
  }
  const plan={id:randomUUID(),runId,revision:(task.changePlan?.revision||0)+1,createdAt:new Date().toISOString(),originalRequest:task.request,...input,ignoredCriterionIds:task.criteria.length?[]:unknownCriterionIds,targets,checks:input.checks.map(c=>({...c,state:'not_run'})),impact:{state:'static_candidates',fingerprint:map.fingerprint,items:impacts,unmapped,diagnostics:map.diagnostics}};
  plan.wikiEvidence=wikiEvidence;task.changePlan=plan;
  service.store.event('change_plan_recorded',{taskId:task.id,planId:plan.id,revision:plan.revision});
  return plan;
}

export function requirePlannedEdit(task,path,hash,runId,rulesFingerprint){
  if(!task.changePlan||task.changePlan.runId!==runId)fail('change_plan_required');
  const target=task.changePlan.targets.find(t=>t.path===path);
  if(!target)fail('change_scope_unplanned');
  if(target.hash!==hash)fail('change_plan_stale');
  if(rulesFingerprint&&target.rulesFingerprint!==rulesFingerprint)fail('project_rules_changed');
  return target;
}

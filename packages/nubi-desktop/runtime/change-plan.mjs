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
const validate=new Ajv().compile(CHANGE_PLAN_SCHEMA);

export async function recordChangePlan(service,task,input,observations,runId){
  if(!validate(input))fail('plan_invalid');
  const ids=new Set(input.requirements.map(r=>r.id));
  if(ids.size!==input.requirements.length||new Set(input.targets.map(t=>t.path)).size!==input.targets.length||input.checks.some(c=>!ids.has(c.requirementId))||input.requirements.some(r=>!input.checks.some(c=>c.requirementId===r.id))||input.targets.some(t=>t.requirementIds.some(id=>!ids.has(id))))fail('plan_invalid');
  if(task.criteria.some(c=>!input.requirements.some(r=>r.criterionId===c.id))||input.requirements.some(r=>r.criterionId&&!task.criteria.some(c=>c.id===r.criterionId)))fail('plan_criteria_missing');
  const wikiEvidence=[...new Set(input.requirements.flatMap(r=>r.evidenceIds||[]))].map(id=>{
    const row=observations.wikiEvidence?.get(id);if(!row)fail('wiki_evidence_required');return row;
  });
  await validateWikiEvidence(service,task.id,wikiEvidence);
  const targets=[];
  for(const target of input.targets){
    const creating=target.action==='create';
    const current=creating?await service.inspectPath({path:target.path,taskId:task.id}):await service.read({path:target.path,taskId:task.id,full:true}),seen=(creating?observations.newPaths:observations.files).get(target.path);
    if(!seen||seen.hash!==current.hash)fail('source_read_required');
    if(seen.rulesFingerprint!==current.projectRules?.fingerprint)fail('project_rules_changed');
    targets.push({...target,action:creating?'create':'edit',hash:current.hash,rulesFingerprint:current.projectRules?.fingerprint,observedRanges:seen.ranges||[]});
  }
  const map=await service.knowledgeMap({taskId:task.id}),impacts=[],unmapped=[];
  for(const target of targets){
    const sourceNodes=map.nodes.filter(n=>n.kind==='source'&&n.path===target.path);
    if(!sourceNodes.length)unmapped.push(target.path);
    for(const node of sourceNodes){const packet=queryKnowledgeMap(map,{focusId:node.id});impacts.push({path:target.path,nodes:packet.nodes.map(({id,label,kind,origin})=>({id,label,kind,origin})),edges:packet.edges,truncated:packet.truncated});}
  }
  const plan={id:randomUUID(),runId,revision:(task.changePlan?.revision||0)+1,createdAt:new Date().toISOString(),originalRequest:task.request,...input,targets,checks:input.checks.map(c=>({...c,state:'not_run'})),impact:{state:'static_candidates',fingerprint:map.fingerprint,items:impacts,unmapped,diagnostics:map.diagnostics}};
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

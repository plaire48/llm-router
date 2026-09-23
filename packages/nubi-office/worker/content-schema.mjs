import {modelJson} from './model-json.mjs';
import {validateContentText} from './content-integrity.mjs';
const fail=()=>{throw new Error('document_schema_invalid');};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,n=4000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const keys=(v,list)=>object(v)&&Object.keys(v).every(k=>list.includes(k));
export function contentTask(response) {
  if(response?.calls?.length||response?.finishReason==='length')fail();
  const v=modelJson(response?.content,'document_schema_invalid');
  if(!keys(v,['intent','title','summary','requirements','steps','save','question'])||!['create','edit','template','register','analyze','clarify','unsupported'].includes(v.intent)||!text(v.title,100)||!text(v.summary,500))fail();
  if(['clarify','unsupported'].includes(v.intent)) {if(v.intent==='clarify'&&!v.question)fail();return v;}
  if(!Array.isArray(v.requirements)||!v.requirements.length||v.requirements.length>16||v.requirements.some(r=>!text(r,400))||typeof v.save!=='boolean'||!Array.isArray(v.steps)||v.steps.length<3||v.steps.length>10)fail();
  if(v.steps.some(s=>!keys(s,['id','title','kind'])||!/^[a-z0-9_-]{1,40}$/.test(s.id)||!text(s.title,100)||!['inspect','write','analyze','verify'].includes(s.kind))||new Set(v.steps.map(s=>s.id)).size!==v.steps.length||v.steps[0].kind!=='inspect'||v.steps.at(-1).kind!=='verify')fail();
  if(['analyze','register'].includes(v.intent)&&(v.save||v.steps.some(s=>s.kind==='write'))||['create','template'].includes(v.intent)&&!v.save||['create','edit','template'].includes(v.intent)&&!v.steps.some(s=>s.kind==='write'))fail();
  return v;
}
export function contentOperation(host, input, snapshot) {
  const op=typeof input==='string'?modelJson(input,'document_schema_invalid'):input;
  if(!object(op))fail();
  const allowed=host==='word'?['append_paragraph','append_table','replace_text','fill_field']:['add_slide','duplicate_slide','replace_text','set_slide_content'];
  if(!allowed.includes(op.type))throw new Error('unsupported_operation');
  if(['append_paragraph','append_table','add_slide'].includes(op.type)&&!snapshot.created)throw new Error('out_of_scope');
  if(op.type==='replace_text'||op.type==='fill_field') {
    if(!keys(op,['type','targetId','text'])||!text(op.targetId,100)||typeof op.text!=='string'||op.text.length>4000||/[\r\n\u0000-\u001f]/.test(op.text))fail();
    const target=snapshot.items.find(i=>i.id===op.targetId);
    if(!target?.editable)throw new Error('unsupported_target');
    if(op.type==='fill_field'&&(target.kind!=='field'||target.controlType!==1||target.mapped!==false||target.locked!==false||target.temporary!==false||target.nested!==false))throw new Error('unsupported_target');
    if(op.type==='replace_text'&&target.kind!==(host==='word'?'paragraph':'shape'))throw new Error('unsupported_target');
  } else if(op.type==='append_paragraph') {
    if(!keys(op,['type','text','style'])||!text(op.text)||/[\r\n]/.test(op.text)||!['Normal','Title','Heading1','Heading2','Heading3'].includes(op.style))fail();
  } else if(op.type==='append_table') {
    if(!keys(op,['type','rows'])||!Array.isArray(op.rows)||!op.rows.length||op.rows.length>30||!Array.isArray(op.rows[0])||!op.rows[0].length||op.rows[0].length>8||op.rows.some(r=>!Array.isArray(r)||r.length!==op.rows[0].length||r.some(c=>typeof c!=='string'||c.length>500||/[\r\n\u0000-\u001f]/.test(c))))fail();
  } else if(['add_slide','set_slide_content'].includes(op.type)) {
    if(!keys(op,op.type==='add_slide'?['type','title','bullets','notes']:['type','targetId','title','bullets','notes'])||!text(op.title,160)||/[\r\n]/.test(op.title)||!Array.isArray(op.bullets)||op.bullets.length>8||op.bullets.some(s=>!text(s,350)||/[\r\n]/.test(s))||typeof op.notes!=='string'||op.notes.length>4000)fail();
    if(op.type==='set_slide_content'&&(!snapshot.created||!snapshot.items.some(i=>i.id===op.targetId&&i.kind==='slide')))throw new Error('out_of_scope');
  } else if(op.type==='duplicate_slide') {
    if(!keys(op,['type','targetId'])||!snapshot.items.some(i=>i.id===op.targetId&&i.kind==='slide'&&i.editable))throw new Error('out_of_scope');
  }
  return structuredClone(op);
}
export function contentObservation(value, host, scopeId, documentId) {
  if(!object(value)||value.host!==host||value.scopeId!==scopeId||documentId&&value.documentId!==documentId||!text(value.documentId,100)||!text(value.fingerprint,100)||!Array.isArray(value.items)||value.items.length>40||value.items.some(i=>!text(i.id,100))||!Number.isInteger(value.total)||value.total<value.items.length||!Number.isInteger(value.offset)||value.offset<0||typeof value.created!=='boolean'||(value.nextOffset!==null&&(!Number.isInteger(value.nextOffset)||value.nextOffset!==value.offset+value.items.length||value.nextOffset>=value.total)))throw new Error('observation_invalid');
  if(value.offset%40||value.offset+value.items.length>value.total||new Set(value.items.map(i=>i.id)).size!==value.items.length||value.nextOffset===null&&value.offset+value.items.length!==value.total||value.nextOffset!==null&&value.items.length!==40)throw new Error('observation_invalid');
  for(const item of value.items)validateContentText(item);
  return value;
}
export function contentReview(response, task, evidence, step) {
  if(response?.calls?.length||response?.finishReason==='length')throw new Error('goal_review_failed');
  const v=modelJson(response?.content,'goal_review_failed');
  const bad=()=>{throw new Error('goal_review_failed');};
  if(!keys(v,['status','checks','feedback'])||!['complete','revise','blocked'].includes(v.status)||typeof v.feedback!=='string'||v.feedback.length>1800||!Array.isArray(v.checks)||!v.checks.length||v.checks.length>24)bad();
  const seen=new Set();
  for(const c of v.checks){if(!keys(c,['requirement','status','evidence'])||!Number.isInteger(c.requirement)||seen.has(c.requirement)||c.requirement<0||c.requirement>=task.requirements.length||!['met','unmet','unknown'].includes(c.status)||!Array.isArray(c.evidence)||c.status==='met'&&(!c.evidence.length||c.evidence.some(id=>!evidence.some(e=>e.id===id))))bad();seen.add(c.requirement);}
  if(!step&&seen.size!==task.requirements.length||v.status==='complete'&&v.checks.some(c=>c.status!=='met')||v.status!=='complete'&&!v.feedback.trim())bad();
  return v;
}

// Preparation/proposal outcomes are not completion of the whole deliverable.
// Separate schemas prevent a planner's broad requirement from trapping an
// inspection step in "report not finished" retries.
export function contentStepReview(response,evidence){
  const bad=()=>{throw new Error('goal_review_failed');};
  if(response?.calls?.length||response?.finishReason==='length')bad();
  const v=modelJson(response?.content,'goal_review_failed');
  if(!keys(v,['status','checks','feedback'])||!['complete','revise','blocked'].includes(v.status)||typeof v.feedback!=='string'||v.feedback.length>1800||!Array.isArray(v.checks)||!v.checks.length||v.checks.length>12)bad();
  for(const c of v.checks)if(!keys(c,['criterion','status','evidence'])||!text(c.criterion,300)||!['met','unmet','unknown'].includes(c.status)||!Array.isArray(c.evidence)||c.evidence.some(id=>!evidence.some(e=>e.id===id))||c.status==='met'&&!c.evidence.length)bad();
  if(v.status==='complete'&&v.checks.some(c=>c.status!=='met')||v.status!=='complete'&&!v.feedback.trim())bad();
  return {...v,scope:'step'};
}

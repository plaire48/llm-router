import {randomUUID,createHash} from 'node:crypto';
import {documentSkill} from './document-skill.mjs';
import {retainedAnswers,REQUEST_TEXT_LIMIT} from './input-contract.mjs';
import {createActivityLog} from './activity.mjs';
import {safeError} from './providers.mjs';

// Selected skills are requirements, not a questionnaire before observation.
// The existing host agent reads evidence, asks for missing facts and owns HITL.
export function startSkillIntake(options,start){
  const skill=documentSkill(options.documentSkill,options.host);
  if(typeof options.request!=='string'||!options.request.trim()||options.request.length>REQUEST_TEXT_LIMIT||options.history!==undefined&&!Array.isArray(options.history))throw new Error('invalid_request');
  const fingerprint=createHash('sha256').update(JSON.stringify(skill)).digest('hex');
  let answers=[];
  if(options.skillInput?.fingerprint===fingerprint){
    answers=retainedAnswers(options.skillInput.answers);
    if(answers.length>skill.questions.length||answers.some((a,i)=>a.question!==skill.questions[i].question))throw new Error('document_skill_invalid');
  }
  const id=randomUUID(),activity=createActivityLog(),receipts=new Map();
  let child,state='running',error='';
  function cancel(){if(state!=='running')return;state='cancelled';child?.cancel();activity.settle('cancelled');}
  const promise=Promise.resolve().then(async()=>{
    if(state!=='running')return;
    child=start({...options,documentSkill:skill,documentSkillAnswers:answers,continuousInput:true,history:[...(options.history||[])]});
    activity.note('작성 스킬을 작업에 연결했습니다.');
    await child.promise;if(state==='running')state=child.status().state;
  }).catch(cause=>{if(state==='running'){state='failed';error=safeError(cause);activity.settle('error');}});
  return{id,promise,cancel,status(){
    const delegated=child?.status();
    return{...(delegated||{state,error,phase:'planning',writes:0,metrics:{modelCalls:0,toolCalls:0,usage:[]}}),id,...(state==='cancelled'?{state:'cancelled'}:{}),
      // Only historical explicit answers are retained here. New answers remain
      // in the child's ordinary conversation, never inferred into this cache.
      skillInput:{fingerprint,answers:structuredClone(answers)},documentSkillName:skill.name,
      activity:[...activity.snapshot().map(e=>({...e,id:'skill-'+e.id})),...(delegated?.activity||[])],action:delegated?.action||null};
  },respond(callId,result){
    const signature=createHash('sha256').update(JSON.stringify(result??null)).digest('hex');
    if(receipts.has(callId)){if(receipts.get(callId)!==signature)throw new Error('tool_result_conflict');return;}
    if(state!=='running'||!child)throw new Error('stale_tool_result');
    child.respond(callId,result);receipts.set(callId,signature);
  }};
}

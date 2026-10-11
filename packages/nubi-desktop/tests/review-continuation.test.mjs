// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, S15). The
// shared runner adds its step guidance to the first system message of every
// request. A revision after a review continued from that request, so the next
// request carried the guidance twice, and once more for every revision (four
// copies in case S2 of S9). In a window of 22,000 tokens the copies took the
// room of the conversation and the run ended with context_input_too_large.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const model={id:'fixture',contextLength:32000};
const copies=(text,part)=>text.split(part).length-1;

test('a revision after a review sends the step guidance once, as the first request did',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});const systems=[];let reviews=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[model]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      const ready=++reviews>2,data=JSON.parse(messages[1].content);
      return {content:JSON.stringify({status:ready?'ready':'revise',nextStep:ready?'':'정책의 근거를 다시 확인해 답한다.',checks:data.requirements.map(item=>({requirementId:item.id,state:ready?'supported':'unknown',evidenceIds:ready?['user']:[],detail:'확인'}))}),calls:[]};
    }
    systems.push(messages.find(message=>message.role==='system').content);
    return {content:'지금 배송비는 3,000원입니다.',calls:[]};
  }};
  const created=await service.createTask({request:'지금 배송 정책을 짧게 설명해 줘.'});
  await service.startAgent({taskId:created.id});await service.agent.promise;
  assert.equal(service.task(created.id).state,'review',service.task(created.id).error);
  assert.equal(reviews,3,'two revisions, then ready');assert.equal(systems.length,3);
  for(const [index,system] of systems.entries())assert.equal(copies(system,'Work interactively'),1,`request ${index+1}: ${copies(system,'Work interactively')} copies`);
  assert.equal(systems[2].length,systems[0].length,'the fixed part does not grow with revisions');
});

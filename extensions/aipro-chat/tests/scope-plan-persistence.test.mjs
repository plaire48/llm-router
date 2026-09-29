import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools,BUILTIN_SKILLS} from '../skills.js';
import {reviewScopeMessages,parseReviewScope,scopeCorrectionCertificate,scopeCorrectionData,scopeCorrectionRequiresPlanRepair,planScopeApproved,planScopeRejection} from '../review-scope.js';
import {goalReviewMessages} from '../goal-review.js';
const tools=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent'));
const call=(name,args={})=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const goal='두 종목의 차이를 알려줘. 검색 요약만 읽었는지 원문도 읽었는지 밝혀줘.';
const bad={text:'원문 직접 판독',expected_outcome:'PDF 원문 도표에서 직접 확인',status:'in_progress'};
const good={text:'관찰된 차이와 범위 정리',expected_outcome:'관찰된 차이, 출처와 실제 열람 범위를 제시',status:'in_progress'};
const response=value=>({content:JSON.stringify(value)});
function certificate(currentPlan=[bad]) {
  const review={status:'revise',checks:[{requirement:bad.expected_outcome,status:'unmet',evidence_ids:[1]}],next_step:'미완료 계획의 불필요한 원문 조건을 수정하세요.'};
  const packet=reviewScopeMessages({goal,phase:'plan_step',currentPlan,stepOutcomes:[bad],review,inputBudget:16000});
  const audit=parseReviewScope(response({decision:'repair_scope',correctionTarget:'external',issues:[{target:'plan0',kind:'optional_method',source:'user',quote:goal,review_quote:bad.expected_outcome}]}),packet.payload);
  return {...review,scopeCorrection:scopeCorrectionCertificate(audit)};
}
function planAudit({currentPlan,proposedPlan,scopeCorrections},accepted=true) {
  const packet=reviewScopeMessages({goal,phase:'plan_scope',currentPlan,stepOutcomes:proposedPlan,scopeCorrections,
    review:{status:'revise',checks:proposedPlan.map(s=>({requirement:s.expected_outcome,status:'unknown',evidence_ids:[]})),next_step:''},inputBudget:16000});
  return parseReviewScope(response(accepted?{decision:'within_scope',correctionTarget:'external',issues:[]}:
    {decision:'repair_scope',correctionTarget:'external',issues:[{target:0,kind:'optional_method',source:'user',quote:goal,review_quote:bad.expected_outcome}]}),packet.payload);
}
const observed=text=>({tabId:1,topDocumentId:'d',url:'https://example.test/search',frames:[{frame:0,documentId:'d',text,elements:[]}]});

test('scope audit carries the actual provisional plan and only host-parsed certificates can persist a correction',()=>{
  const result=certificate(),data=scopeCorrectionData(result.scopeCorrection);assert.equal(data.currentPlan[0].expected_outcome,bad.expected_outcome);
  assert.equal(scopeCorrectionData({...result.scopeCorrection}),null);assert.equal(scopeCorrectionCertificate({decision:'repair_scope'}),null);
  const request={currentPlan:[bad],proposedPlan:[good],scopeCorrections:[data]};const verdict=planAudit(request);
  assert(planScopeApproved(verdict,[good]));assert(!planScopeApproved({...verdict},[good]));assert(!planScopeApproved(verdict,[bad]));
  assert(!planScopeApproved(verdict,[{...good,expected_outcome:'변경한 결과'}]));
  const review=goalReviewMessages({goal,history:[],evidence:[],answer:'',phase:'checkpoint',currentPlan:[bad],scopeCorrections:[data],inputBudget:16000});
  const body=JSON.parse(review.messages[1].content);assert.equal(body.planningContext.currentPlan[0].expected_outcome,bad.expected_outcome);
  assert.equal(body.planningContext.currentPlan[0].status,undefined);assert.deepEqual(body.planningContext.scopeCorrections,[data]);
  const step=goalReviewMessages({goal,history:[],evidence:[],answer:'',phase:'plan_step',stepOutcomes:[bad],currentPlan:[bad],scopeCorrections:[data],inputBudget:16000});
  assert.match(step.messages[0].content,/Preserve its validated scope corrections/);
});

test('E04 corrected scope survives subsequent turns and rejects mandatory PDF reintroduction without completing the old criterion',async()=>{
  let round=0,stepReviews=0,scopeReviews=0;const executed=[],plans=[],checks=[];
  const result=await runAgent({goal,messages:[{role:'user',content:goal}],tools,resumePlan:[bad],harness:true,signal:new AbortController().signal,
    prepareContext:async wire=>wire, // host correction remains independent of message compaction
    complete:async wire=>{
      round++;assert(round<10);
      if(round===1)return call('read_page');
      if(round===2)return call('update_plan',{steps:[{...bad,status:'completed'}]});
      if(round===3){assert(wire.some(m=>typeof m.content==='string'&&m.content.includes('Retained host-validated scope corrections')));return call('capture_page',{full_page:false});}
      if(round===4)return call('update_plan',{steps:[good]});
      if(round===5)return call('update_plan',{steps:[bad]});
      if(round===6){
        const blocked=wire.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(m=>m.scopeFeedback?.length);
        assert(blocked,'validated rejected criterion must reach executor');
        assert.equal(blocked.scopeFeedback[0].review_quote,bad.expected_outcome);
        return call('update_plan',{steps:[{...good,status:'completed'}]});
      }
      return {content:'검색 요약에서 관찰한 두 종목의 차이와 출처입니다. 원문은 읽지 않았습니다.'};
    },
    execute:async(name,args)=>{executed.push(name);if(name==='read_page')return observed('두 종목의 차이가 명시된 검색 요약');assert.equal(name,'update_plan');plans.push(structuredClone(args.steps));return {ok:true,plan:args.steps};},
    reviewPlanScope:async request=>{scopeReviews++;assert.equal(request.scopeCorrections.length,1);return planAudit(request,request.proposedPlan[0].expected_outcome===good.expected_outcome);},
    reviewGoal:async request=>{checks.push(request);if(request.phase==='plan_step'&&++stepReviews===1)return certificate(request.currentPlan);
      if(request.phase==='plan_step')assert.equal(request.stepOutcomes[0].expected_outcome,good.expected_outcome);
      return {status:'complete',checks:[{requirement:'원래 요청 범위',status:'met',evidence_ids:[1]}],next_step:''};}
  });
  assert.equal(result.awaitingUser,undefined);assert.match(result.content,/원문은 읽지/);assert.equal(scopeReviews,2);
  assert.deepEqual(executed,['read_page','read_page','update_plan','update_plan']);assert.equal(plans[0][0].status,'in_progress');assert.equal(plans[1][0].status,'completed');
  assert(checks.at(-1).scopeCorrections.length===1);assert.equal(checks.at(-1).currentPlan[0].expected_outcome,good.expected_outcome);
});

test('E03 review-only scope drift cannot force a valid unfinished plan into a replan loop',async()=>{
  for(const correctedStatus of ['complete','revise']) {
    let round=0,stepReviews=0;const executed=[];
    const expectedReads=correctedStatus==='revise'?2:1;
    const result=await runAgent({goal,messages:[{role:'user',content:goal}],tools,resumePlan:[good],harness:true,signal:new AbortController().signal,
      complete:async()=>{assert(++round<7);if(round===1||correctedStatus==='revise'&&round===3)return call('read_page');
        if(round===2||correctedStatus==='revise'&&round===4)return call('update_plan',{steps:[{...good,status:'completed'}]});
        return {content:'두 종목의 차이는 검색 요약에서 확인했습니다. 원문은 읽지 않았습니다.'};},
      execute:async(name,args)=>{executed.push(name);if(name==='read_page')return observed('필수 항목의 실제 검색 요약');
        assert.equal(name,'update_plan');return {ok:true,plan:args.steps};},
      reviewPlanScope:async()=>assert.fail('Review-only drift does not authorize forcing a plan rewrite'),
      reviewGoal:async request=>{
        if(request.phase!=='plan_step'||++stepReviews>1)return {status:'complete'};
        const prior={status:'revise',checks:[{requirement:'검색 입력과 정보 링크 클릭이 없어야 함',status:'unmet',evidence_ids:[1]}],next_step:''};
        const packet=reviewScopeMessages({goal,phase:'plan_step',currentPlan:request.currentPlan,stepOutcomes:request.stepOutcomes,review:prior,inputBudget:16000});
        const audit=parseReviewScope(response({decision:'repair_scope',correctionTarget:'external',issues:[{target:0,kind:'new_requirement',source:'user',quote:goal,review_quote:prior.checks[0].requirement}]}),packet.payload);
        const scopeCorrection=scopeCorrectionCertificate(audit);
        assert.equal(scopeCorrectionRequiresPlanRepair(scopeCorrection),false);
        assert.equal(scopeCorrectionRequiresPlanRepair({...scopeCorrection}),false);
        return {status:correctedStatus,scopeCorrection,next_step:correctedStatus==='revise'?'필수 항목만 추가로 확인하세요.':''};
      }});
    assert(!result.awaitingUser,correctedStatus);assert.match(result.content,/검색 요약/);
    assert.equal(executed.filter(name=>name==='read_page').length,expectedReads+1); // Includes automatic source preservation.
    assert.equal(executed.filter(name=>name==='update_plan').length,1);
  }
  assert.equal(scopeCorrectionRequiresPlanRepair(certificate().scopeCorrection),true);
});

async function completedScenario(change) {
  const initial=['종목','소속','출처'].map(text=>({text,expected_outcome:text+' 확인',status:'in_progress'})).map((s,i)=>({...s,status:i?'pending':'in_progress'}));
  const finished=initial.map(s=>({...s,status:'completed'})),reset=initial.map(s=>({...s,text:'새 '+s.text}));
  const controller=new AbortController(),plans=[],executed=[];let round=0,finalReviews=0,steer=false,accepted=false;
  const result=await runAgent({goal:'선수의 종목과 소속, 출처를 알려줘.',messages:[{role:'user',content:'선수의 종목과 소속, 출처를 알려줘.'}],tools,resumePlan:initial,harness:true,signal:controller.signal,
    takeInput:change==='user'?async()=>{if(!steer||accepted)return null;accepted=true;return {text:'소속의 최근 변경도 추가로 확인해줘.'};}:undefined,
    complete:async()=>{
      assert(++round<10);if(round===1)return call('read_page');if(round===2)return call('update_plan',{steps:finished});if(round===3)return {content:'일부 문구가 잘못된 최종 답변'};
      if(change==='evidence'&&round===4)return call('read_page');
      if(round===(change==='evidence'?5:4))return call('update_plan',{steps:reset});
      if(change)return call('ask_user',{question:'현재 결과를 유지하고 추가 확인할까요?'});
      return {content:'원문으로 확인하지 못한 기간을 명시한 완전한 답변'};
    },execute:async(name,args)=>{executed.push(name);if(name==='read_page')return observed(round===1?'첫 관찰':'실제로 변경된 소속 근거');if(name==='ask_user')return {requiresUserInput:true};plans.push(structuredClone(args.steps));return {ok:true,plan:args.steps};},
    reviewGoal:async({phase})=>{if(phase==='plan_step')return {status:'complete'};finalReviews++;if(finalReviews===1){steer=true;return {status:'revise',checks:[{requirement:'기간 주장',status:'unmet',evidence_ids:[1]}],next_step:'지원되지 않은 기간을 제거하고 전체 답변을 다시 제출하세요.'};}return {status:'complete'};}
  });return {result,plans,executed,finalReviews};
}
test('E08 3/3 cannot reset to 0/3 from plan wording or final-answer corrections with identical external evidence',async()=>{
  const r=await completedScenario();assert.equal(r.plans.length,1);assert(r.plans[0].every(s=>s.status==='completed'));assert.equal(r.finalReviews,2);assert(!r.result.awaitingUser);
});
test('a real new observation or explicit user revision permits reconsidering completed work without auto-approving it',async()=>{
  for(const change of ['evidence','user']) {const r=await completedScenario(change);assert.equal(r.plans.length,2,change);assert(r.plans[1].every(s=>s.status!=='completed'));assert(r.result.awaitingUser);}
});

test('scope review cancellation never saves a replan or permits another browser action',async()=>{
  const controller=new AbortController();let round=0,saved=0;
  await assert.rejects(runAgent({goal,messages:[{role:'user',content:goal}],tools,resumePlan:[bad],harness:true,signal:controller.signal,
    complete:async()=>++round===1?call('read_page'):call('update_plan',{steps:[{...(round===2?bad:good),status:round===2?'completed':'in_progress'}]}),
    execute:async name=>{assert.equal(name,'read_page');return observed('요약');},
    reviewGoal:async request=>certificate(request.currentPlan),reviewPlanScope:async request=>{controller.abort();saved++;return planAudit(request);}}),/cancelled/);
  assert.equal(saved,1);assert.equal(round,3);
});

test('API repairs malformed plan-scope anchors before saving the corrected proposal without extra page work',async t=>{
  const {completeChat}=await import('../src/api.js');
  const {REVIEW_SCOPE_PROMPT}=await import('../review-scope.js');
  const {goalReviewPayload}=await import('./fixtures/goal-review.mjs');
  const previous={chrome:globalThis.chrome,fetch:globalThis.fetch};t.after(()=>Object.assign(globalThis,previous));
  const skill=BUILTIN_SKILLS.find(s=>s.id==='browser-agent');
  const permitted=browserTools(null,skill,'test',{autoConnect:true}).filter(t=>['read_page','update_plan','verify_page','ask_user'].includes(t.function.name));
  let leader=0,outcomes=0,scopeCalls=0,proposalAudits=0,proposalWire;const saved=[],events=[];
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true})},storage:{session:{get:async()=>({credential:{provider:'aipro',token:'synthetic',receivedAt:1}})}}};
  const reply=message=>new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}),{headers:{'Content-Type':'application/json'}});
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.messages[0].content.startsWith(REVIEW_SCOPE_PROMPT)) {
      scopeCalls++;const wire=JSON.parse(body.messages[1].content);assert.equal(wire.currentPlan[0].expected_outcome.map(a=>a.text).join(''),bad.expected_outcome);
      assert(!body.tools?.length);
      if(wire.phase==='plan_scope') {
        assert.equal(wire.scopeCorrections.length,1);
        if(++proposalAudits===1){proposalWire=structuredClone(wire);return reply({content:JSON.stringify({decision:'repair_scope',correctionTarget:'external',issues:[{target:'plan0',kind:'optional_method',source_anchor:'foreign',review_anchor:'foreign'}]})});}
        assert.deepEqual(wire,proposalWire);
        return reply({content:JSON.stringify({decision:'within_scope',correctionTarget:'external',issues:[]})});
      }
      return reply({content:JSON.stringify({decision:'repair_scope',correctionTarget:'external',issues:[{target:'plan0',kind:'optional_method',source_anchor:wire.goal[0].id,review_anchor:wire.currentPlan[0].expected_outcome[0].id}]})});
    }
    const payload=goalReviewPayload(body.messages);
    if(payload) {
      outcomes++;const proof=payload.evidence.find(e=>e.usable);assert(proof);
      if(outcomes===1)return reply({content:JSON.stringify({status:'revise',checks:[{requirement:bad.expected_outcome,status:'unmet',evidence_ids:[proof.id]}],next_step:'원문 도표를 판독하세요.'})});
      // A corrected review saying complete must NOT complete the rejected old plan.
      if(outcomes>=3)assert.equal(payload.planningContext.scopeCorrections.length,1);
      return reply({content:JSON.stringify({status:'complete',checks:[{requirement:'관찰된 차이와 열람 범위',status:'met',evidence_ids:[proof.id]}],next_step:''})});
    }
    assert(++leader<7);const selected=leader===1?call('read_page'):leader===2?call('update_plan',{steps:[{...bad,status:'completed'}]}):leader===3?call('update_plan',{steps:[good]}):leader===4?call('update_plan',{steps:[{...good,status:'completed'}]}):null;
    return reply(selected?{content:'',tool_calls:selected.calls}:{content:'두 종목의 차이는 검색 요약에서 확인했습니다. 원문은 열람하지 않았습니다.'});
  };
  const result=await completeChat({provider:'aipro',modelId:'test',model:{contextLength:128000,maxInputTokens:98304},credentialReceivedAt:1,skill,autoConnect:true,tools:permitted,
    resumeTask:{goal,plan:[bad]},messages:[{role:'user',content:goal}]},new AbortController().signal,
    undefined,undefined,undefined,undefined,async(name,args)=>{if(name==='read_page')return observed('검색 요약의 차이');assert.equal(name,'update_plan');saved.push(structuredClone(args.steps));return{ok:true,plan:args.steps};},e=>events.push(e));
  assert.match(result,/원문은 열람하지/);assert.equal(scopeCalls,3);assert.equal(proposalAudits,2);assert.equal(saved.length,2);assert.equal(saved[0][0].expected_outcome,good.expected_outcome);assert.equal(saved[0][0].status,'in_progress');assert.equal(saved[1][0].status,'completed');
  assert(events.some(e=>e.label==='계획 범위 확인'));
});


test('an unvalidated scope verdict cannot apply corrected criteria or execute the rejected route',async()=>{
  let round=0,scopeCalls=0;const executed=[];
  const result=await runAgent({goal,messages:[{role:'user',content:goal}],tools,resumePlan:[bad],harness:true,signal:new AbortController().signal,
    complete:async()=>{assert(++round<8);if(round===1)return call('read_page');if(round===2)return call('update_plan',{steps:[{...bad,status:'completed'}]});
      if(round===3)return call('update_plan',{steps:[good]});if(round===4)return call('capture_page',{full_page:false});return call('ask_user',{question:'현재 결과를 유지하고 다시 확인할까요?'});},
    execute:async(name)=>{executed.push(name);if(name==='read_page')return observed('요약');assert.equal(name,'ask_user');return {requiresUserInput:true};},
    reviewGoal:async request=>certificate(request.currentPlan),
    reviewPlanScope:async()=>{scopeCalls++;return {decision:'within_scope',correctionTarget:'external',issues:[]};}});
  assert.equal(scopeCalls,1);assert(result.awaitingUser);assert(!executed.includes('update_plan'));assert(!executed.includes('capture_page'));
});

test('correcting an added method preserves an explicitly required original reading condition',()=>{
  const required='PDF 원문을 직접 읽고 두 종목의 차이를 알려줘.';
  const overreach={text:'세 출처 비교',expected_outcome:'PDF 원문과 추가 독립 출처 세 개 확인'};
  const input=reviewScopeMessages({goal:required,phase:'plan_step',currentPlan:[overreach],stepOutcomes:[overreach],
    review:{status:'revise',checks:[{requirement:overreach.expected_outcome,status:'unmet',evidence_ids:[]}],next_step:'추가 출처를 찾아라.'},inputBudget:16000});
  const parsed=parseReviewScope(response({decision:'repair_scope',correctionTarget:'external',issues:[{target:'plan0',kind:'new_requirement',source:'user',quote:required,review_quote:'추가 독립 출처 세 개'}]}),input.payload);
  const corrected=scopeCorrectionData(scopeCorrectionCertificate(parsed));
  const proposed=[{text:'요약만 확인',expected_outcome:'검색 요약만 확인'}];
  const auditInput=reviewScopeMessages({goal:required,phase:'plan_scope',currentPlan:[overreach],stepOutcomes:proposed,scopeCorrections:[corrected],
    review:{status:'revise',checks:[{requirement:proposed[0].expected_outcome,status:'unknown',evidence_ids:[]}],next_step:''},inputBudget:16000});
  const wire=JSON.parse(auditInput.messages[1].content);
  assert.equal(wire.goal.map(a=>a.text).join(''),required);
  assert.equal(wire.scopeCorrections[0].issues[0].review_quote,'추가 독립 출처 세 개');
  const unknown=parseReviewScope(response({decision:'unknown',correctionTarget:'unknown',issues:[]}),auditInput.payload);
  assert.equal(planScopeApproved(unknown,proposed),false);
});

test('resumed completed status preserves the plan but does not bypass final independent review',async()=>{
  const finished={text:'차이 확인',expected_outcome:'차이 확인',status:'completed'};let calls=0,reviews=0;
  const result=await runAgent({goal,messages:[{role:'user',content:goal}],tools,resumePlan:[finished],harness:true,signal:new AbortController().signal,
    complete:async()=>{assert(++calls<5);return calls===1?call('read_page'):{content:'확인된 차이'};},execute:async name=>{if(name==='read_page')return observed('재개 후 실제 관찰');assert.equal(name,'ask_user');return {requiresUserInput:true};},
    reviewGoal:async({currentPlan,phase})=>{reviews++;assert.equal(phase || 'final','final');assert.equal(currentPlan[0].status,undefined);return {status:'blocked',checks:[{requirement:'근거 확인',status:'unknown',evidence_ids:[]}],next_step:'비교할 두 종목을 알려주세요.'};}});
  assert.equal(reviews,1);assert(result.awaitingUser);assert.equal(result.content,'');
});


test('plan rejection feedback is bound to the exact host-audited proposal and cannot approve or be forged',()=>{
  const audit=planAudit({currentPlan:[good],proposedPlan:[bad],scopeCorrections:[]},false);
  const feedback=planScopeRejection(audit,[bad]);assert.equal(feedback[0].review_quote,bad.expected_outcome);
  feedback[0].quote='changed';assert.equal(planScopeRejection(audit,[bad])[0].quote,goal);
  assert.equal(planScopeRejection({...audit},[bad]),null);assert.equal(planScopeRejection(audit,[good]),null);
  assert(!planScopeApproved(audit,[bad]));
});

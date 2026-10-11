// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, fourth
// turn). The user asked to put the decided fee into the code. The answer only
// named the places to change. The review found the change missing and asked
// for a revision, but marked the request requirement supported: that holds the
// first request, which an earlier turn had answered. The only open checks were
// the planner's interpretation, and the host turns such a verdict into ready.
// The answer was handed over and nothing was changed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REVIEW_PROMPT,TURN_REQUIREMENT,resultReviewInput,reviewResult} from '../runtime/result-review.mjs';

const model={id:'fixture',contextLength:32000};
const FIRST='먼저 지금 배송 정책을 짧게 설명해 줘.',TURN='그럼 회의에서 결정한 대로 추가 요금을 코드에 반영해 줘.';
const task={request:FIRST,messages:[],questionHistory:[],criteria:[],workPlan:{intent:{goal:'추가 요금 반영',constraints:[],outcomes:['코드가 5,500원을 쓴다'],workflowIds:[],skillPaths:[]}}};
const receipts={computer:{actions:[]},setupActions:[],proposals:[],processes:[],reconciliation:null};

test('the message being answered is a requirement of its own',()=>{
  const {data}=resultReviewInput({task,evidence:[],receipts,candidate:'고칠 곳은 src/shipping.mjs입니다.',model,history:[TURN]});
  assert.deepEqual(data.requirements.map(item=>item.id),['request','intent:outcome:0','turn']);
  assert.deepEqual(data.requirements.at(-1),{id:'turn',text:TURN_REQUIREMENT});assert.equal(data.currentTurn,TURN);
  assert.equal(JSON.stringify(data.requirements).includes(TURN),false,'the text of the turn is given once, in currentTurn');
  assert.equal(data.requirements[0].text,FIRST,'the request keeps the first request');
  const alone=resultReviewInput({task,evidence:[],receipts,candidate:'설명했습니다.',model,history:[]}).data;
  assert.ok(!alone.requirements.some(item=>item.id==='turn'),'a first turn has no separate requirement');
  assert.match(REVIEW_PROMPT,/requirement turn/);
  assert.ok(REVIEW_PROMPT.length<3700,String(REVIEW_PROMPT.length));
});

test('an open turn keeps a revision a revision',async()=>{
  const verdict=(turnState)=>async messages=>{const data=JSON.parse(messages[1].content);return {content:JSON.stringify({status:'revise',nextStep:'배송 계산 코드를 5,500원으로 고친다.',checks:data.requirements.map(item=>({requirementId:item.id,state:item.id==='request'?'supported':item.id==='turn'?turnState:'unknown',evidenceIds:item.id==='request'||item.id==='turn'&&turnState==='supported'?['user']:[],detail:'확인'}))}),calls:[]};};
  const open=await reviewResult({task,evidence:[],receipts,candidate:'고칠 곳은 src/shipping.mjs입니다. 아직 수정하지 않았습니다.',model,history:[TURN],signal:new AbortController().signal,invoke:verdict('unknown')});
  assert.equal(open.status,'revise');assert.equal(open.normalized,undefined);
  const done=await reviewResult({task,evidence:[],receipts,candidate:'반영했습니다.',model,history:[TURN],signal:new AbortController().signal,invoke:verdict('supported')});
  assert.equal(done.status,'ready','with the turn supported only the interpretation is open');assert.equal(done.normalized,'interpretation_only');
});

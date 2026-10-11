// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1). The user
// pasted meeting notes and asked for the decisions in them. The model answered
// from the notes without a tool call, which is right: the notes were in the
// conversation. The review held the notes (currentTurn) but no evidence entry
// stood for them, and "supported" needs an evidence ID. Three reviews sent the
// same correct answer back, then the host replaced it with a question.
// gpt-5.6-luna had called tools in that turn, so the fault stayed hidden.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {REVIEW_PROMPT,resultReviewInput,reviewResult} from '../runtime/result-review.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const model={id:'fixture',contextLength:32000};
const NOTES='아래는 어제 회의록이야. 배송과 관련해 결정한 내용만 정리해 줘.\n\n## 4. 기본 배송비\n기본 배송비는 3,000원으로 유지한다.\n\n## 5. 제주 추가 요금\n제주와 도서 지역 추가 요금은 5,500원으로 올린다.';
const task={request:'금액은 항상 정수 원으로 다뤄 줘. 먼저 지금 배송 정책을 짧게 설명해 줘.',messages:[],questionHistory:[],criteria:[]};
const receipts={computer:{actions:[]},setupActions:[],proposals:[],processes:[],reconciliation:null};

test('what the user wrote is an evidence entry that a review can cite',()=>{
  const {data}=resultReviewInput({task,evidence:[],receipts,candidate:'기본 배송비는 3,000원으로 유지합니다.',model,history:[NOTES]});
  assert.deepEqual(data.evidence.map(entry=>entry.id),['host','user']);
  const said=data.evidence[1];
  assert.equal(said.tool,'user_messages');assert.equal(said.usable,true);assert.equal(said.truncated,false);
  assert.deepEqual(said.result.standsFor,['requirements.request','currentTurn','corrections','answeredQuestions']);
  assert.ok(!JSON.stringify(said).includes('5,500원'),'the text is given once, in currentTurn, not again in the entry');
  assert.ok(JSON.stringify(said).length<400,String(JSON.stringify(said).length));
  assert.equal(data.currentTurn,NOTES);assert.equal(data.omittedEvidence,0,'the entry is not a tool result and is not counted as one');
  const read={tool:'read_source',result:{path:'a.txt',content:'first'}};
  const withTool=resultReviewInput({task,evidence:[read],receipts,candidate:'확인했습니다.',model,history:[NOTES]}).data;
  assert.deepEqual(withTool.evidence.map(entry=>entry.id),['host','user','tool:0']);assert.equal(withTool.omittedEvidence,0);
});

test('the review is told what the entry proves and what it does not',()=>{
  assert.match(REVIEW_PROMPT,/evidence entry "user"/);
  assert.match(REVIEW_PROMPT,/never proves the state of files, tests or systems/);
  assert.match(REVIEW_PROMPT,/empty list/);
  // E1 (S26, 2026-09-30): the failed checks and their expected and actual values passed as the cause.
  assert.match(REVIEW_PROMPT,/A cause \(why a check fails\) needs a read showing it in code, configuration or data/);
  // User decision 2026-10-01 (E6: the review asked to run the wrong command the user named, then faulted its correction).
  assert.match(REVIEW_PROMPT,/A command the user names is a means: when it is wrong, the result of a corrected command the user approved answers the request; never ask to run a known-wrong command/);
  // Measured 3,019 characters before this change.
  assert.ok(REVIEW_PROMPT.length<3700,String(REVIEW_PROMPT.length));
});

test('a verdict that cites what the user wrote is accepted',async()=>{
  let asked=0;
  const review=await reviewResult({task,evidence:[],receipts,candidate:'기본 배송비는 3,000원 유지, 제주와 도서 추가 요금은 5,500원으로 인상입니다.',model,history:[NOTES],signal:new AbortController().signal,
    invoke:async messages=>{asked++;const data=JSON.parse(messages[1].content);return {content:JSON.stringify({status:'ready',nextStep:'',checks:data.requirements.map(item=>({requirementId:item.id,state:'supported',evidenceIds:['user'],detail:'회의록의 결정과 일치합니다.'}))}),calls:[]};}});
  assert.equal(asked,1,'no second attempt: the ID is known');assert.equal(review.status,'ready');assert.deepEqual(review.checks[0].evidenceIds,['user']);
});

test('an answer taken from a pasted text is delivered after one review',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0,answers=0;const seen=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[model]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      reviews++;const data=JSON.parse(messages[1].content);seen.push(data);
      // A careful reviewer: supported only with an entry to cite.
      const said=data.evidence.find(entry=>entry.id==='user'&&entry.usable);
      return {content:JSON.stringify({status:said?'ready':'revise',nextStep:said?'':'회의록을 근거로 연결해 다시 제출한다.',checks:data.requirements.map(item=>({requirementId:item.id,state:said?'supported':'unknown',evidenceIds:said?['user']:[],detail:said?'사용자가 준 글과 일치합니다.':'근거가 없습니다.'}))}),calls:[]};
    }
    answers++;return {content:answers===1?'지금 배송비는 3,000원입니다.':'기본 배송비는 3,000원 유지, 제주와 도서 추가 요금은 5,500원으로 인상입니다.',calls:[]};
  }};
  const created=await service.createTask({request:task.request});
  await service.startAgent({taskId:created.id});await service.agent.promise;
  await service.startAgent({taskId:created.id,answer:NOTES});await service.agent.promise;
  const done=service.task(created.id);
  assert.equal(done.state,'review',done.error);assert.equal(done.question??null,null,'no question replaces the answer');
  assert.equal(done.messages.at(-1).content,'기본 배송비는 3,000원 유지, 제주와 도서 추가 요금은 5,500원으로 인상입니다.');
  assert.equal(reviews,2,'one review for each turn');assert.equal(answers,2);
  assert.equal(seen[1].currentTurn,NOTES);assert.equal(done.resultReview.status,'ready');
});

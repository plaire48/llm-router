// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L3). The user
// asked for 5,000, patches were prepared, and the user corrected the amount to
// 6,000. The model answered what it would change and prepared nothing new.
// The patches for 5,000 still waited for approval. The review saw proposals
// that waited and handed the answer over; host receipts name a proposal by
// path and hash, so nothing told that it predated the correction. The user
// approved what was there and the files got 5,000.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const plan=()=>({summary:'Update observed text',requirements:[{id:'R1',text:'첫 줄을 바꾼다'}],targets:[{path:'app.txt',reason:'요청한 줄',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'첫 줄 확인'}],assumptions:[]});
const receiptsOf=messages=>{const text=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts')).content;return JSON.parse(text.slice(text.indexOf('{')));};

test('a proposal from before the latest user message is marked for the agent and for the review',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let round=0,hash,turn=1;const seen={agent:[],review:[]};
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      const data=JSON.parse(messages[1].content);seen.review.push({turn,host:data.evidence.find(entry=>entry.id==='host').result});
      return {content:JSON.stringify({status:'ready',nextStep:'',checks:data.requirements.map(item=>({requirementId:item.id,state:'pending',evidenceIds:['host'],detail:'승인 대기'}))}),calls:[]};
    }
    seen.agent.push({turn,receipts:receiptsOf(messages)});
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    if(turn===2)return {content:'2nd로 정정하겠습니다.',calls:[]};
    switch(round++){
      case 0:return call('read_source',{path:'app.txt'});
      case 1:hash=result.hash;return call('record_change_plan',plan());
      case 2:return call('propose_patch',{path:'app.txt',expectedHash:hash,edits:[{oldText:'first',newText:'1st'}],reason:'요청 반영'});
      default:return {content:'수정안을 준비했습니다.',calls:[]};
    }
  }};
  const task=await service.createTask({request:'첫 줄을 1st로 바꿔 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const first=seen.review.at(-1).host.proposals;
  assert.equal(first.length,1);assert.equal(first[0].state,'proposed');assert.equal(first[0].beforeLatestUserMessage,undefined,'prepared in the turn that is being answered');
  assert.equal(seen.review.at(-1).host.proposalNote,undefined);
  turn=2;await new Promise(resolve=>setTimeout(resolve,5));
  await service.startAgent({taskId:task.id,answer:'아니, 1st가 아니라 2nd로 해 줘.'});await service.agent.promise;
  const agent=seen.agent.findLast(item=>item.turn===2).receipts,review=seen.review.findLast(item=>item.turn===2).host;
  for(const receipts of [agent,review]){
    assert.equal(receipts.proposals[0].beforeLatestUserMessage,true);
    assert.match(receipts.proposalNote,/before the latest user message/);assert.match(receipts.proposalNote,/Propose again/);
  }
  assert.equal(service.state().proposals[0].state,'proposed','the host does not withdraw a proposal on its own');
});

test('the review is told that such a proposal is not the approval that a correction waits for',()=>{
  assert.match(REVIEW_PROMPT,/beforeLatestUserMessage/);
  assert.match(REVIEW_PROMPT,/corrections require corrected proposals/);
  // The limit of the review instruction is kept in tests/review-user-text.test.mjs.
});

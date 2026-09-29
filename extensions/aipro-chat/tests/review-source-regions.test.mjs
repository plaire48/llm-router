import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEvidence, goalReviewMessages, parseGoalReview} from '../goal-review.js';
import {contextTokens} from '../context-manager.js';

const card = '서울 날씨\n현재 24.6℃\n오늘 9.27 최저 17℃ 최고 28℃';
const snippet = '서울다누림 검색 요약\n오늘 2026-09-27 최저 18℃ 최고 28℃';
const raw = `머리글\n${card}\n${snippet}\n끝부분`;
function observation() {
  const a=raw.indexOf(card),b=raw.indexOf(snippet);
  return {url:'https://example.test/results',frames:[{frame:0,url:'https://example.test/results',text:raw,textFiltered:true,truncated:true,
    retrieval:{textBlocks:[{start:a,end:a+card.length,regionIndex:3},{start:b,end:b+snippet.length,regionIndex:8}],
      textRegions:[{index:3,role:'section',heading:'서울 날씨'},{index:8,role:'article',heading:'서울다누림 검색 요약'}],contextOmitted:true}}]};
}
test('E07 card and other search snippet remain separate beside their exact text in review input',()=>{
  const source=observation(),before=structuredClone(source),evidence=reviewEvidence(5,'read_page',{},source);
  const frame=evidence.result.frames[0];
  assert.equal(frame.text,undefined);assert.equal(frame.textSegments.map(s=>s.text).join(''),raw);
  assert.equal(frame.textSegments.find(s=>s.regionIndex===3).text,card);
  assert.equal(frame.textSegments.find(s=>s.regionIndex===8).text,snippet);
  assert(!frame.textSegments.find(s=>s.regionIndex===3).text.includes('18℃'));
  assert(frame.textSegments.filter(s=>s.regionIndex===null).some(s=>s.text.includes('끝부분')));
  assert(frame.retrieval.contextOmitted);assert(frame.truncated);assert(evidence.coverage.partial);
  assert.deepEqual(source,before);
  const review=goalReviewMessages({goal:'현재 카드의 표시값 확인',history:[],evidence:[evidence],answer:'현재 24.6℃',inputBudget:20000});
  const payload=JSON.parse(review.messages[1].content);
  assert.deepEqual(payload.evidence[0].result.frames[0].textSegments,frame.textSegments);
});
test('unverifiable offsets, overlaps and absent regions cannot manufacture a source association',()=>{
  for(const change of [f=>f.retrieval.textBlocks[0].end=raw.length+1,f=>f.retrieval.textBlocks[1].start=0,
    f=>f.retrieval.textBlocks[0].regionIndex=99,f=>f.retrieval.textRegions.push({...f.retrieval.textRegions[0]})]) {
    const source=observation();change(source.frames[0]);const frame=reviewEvidence(1,'read_page',{},source).result.frames[0];
    assert.equal(frame.text,raw);assert.equal(frame.textSegments,undefined);assert.equal(frame.sourceAssociationUnknown,true);
  }
});
test('region indices are local to each frame and nested action observations retain their receipts',()=>{
  const source=observation();source.frames.push({...structuredClone(source.frames[0]),frame:1,url:'https://other.test/'});
  const result=reviewEvidence(2,'verify_page',{checks:[]},{ok:true,verified:true,actionIssued:false,observation:source}).result;
  assert.equal(result.verified,true);assert.equal(result.actionIssued,false);
  assert.equal(result.observation.frames[0].frame,0);assert.equal(result.observation.frames[1].frame,1);
  assert.equal(result.observation.frames[0].textSegments.map(s=>s.text).join(''),raw);
  assert.equal(result.observation.frames[1].url,'https://other.test/');
});

test('large latest region observation, source excerpt and dispatch ledger fit together without losing the citeable DOM',()=>{
  const lines=Array.from({length:80},(_,index)=>`관찰 ${index} ${'본문 '.repeat(60)}`),text=lines.join('\n');
  let offset=0;
  const blocks=lines.slice(0,40).map((line,index)=>{const block={start:offset,end:offset+line.length,regionIndex:index};offset+=line.length+1;return block;});
  const snapshot={frames:[{frame:0,url:'https://example.test/search',text,truncated:true,
    controls:Array.from({length:90},(_,index)=>({id:index,name:`결과 ${index} ${'관찰한 검색 결과 설명 '.repeat(22)}`,destination:`https://example.test/${index}`})),
    retrieval:{method:'dom_order',textBlocks:blocks,textRegions:blocks.map(block=>({index:block.regionIndex,role:'text_block'})),contextOmitted:true}}]};
  const dom=reviewEvidence(1,'browser_snapshot',{},snapshot);
  const reference=reviewEvidence(2,'read_page',{}, {ok:true,dataKind:'page_content',url:'https://example.test/search',frame:0,
    content_hash:'a'.repeat(64),characters:6000,ranges:[{start:0,end:6000,markdown:'원문 '.repeat(2000)}],coverage:{partial:true}});
  assert(dom.usable&&reference.usable);assert(JSON.stringify(dom).length>40000);
  const request={goal:'현재 화면의 제목과 링크만 읽고 열람 범위를 알려줘. 제출하지 마.',history:[{role:'user',content:'현재 화면만 확인하고 제출하지 마.'},
    {role:'assistant',content:'이전 진행 설명 '.repeat(1000)}],
    evidence:[reviewEvidence(0,'list_tabs',{}, {tabs:[{title:'이전 탭 설명 '.repeat(1000)}]}),dom,reference],answer:'관찰한 검색 결과 제목과 링크. 현재 화면 범위만 읽었습니다.',inputBudget:100000,
    executionLedger:{dataKind:'host_tool_dispatch',taskStartObserved:true,onlyReadOnlyToolsInvoked:true,
      calls:Array.from({length:24},(_,index)=>({tool:'browser_snapshot',status:'observed',sequence:index,scope:'owned_tab_current_document'}))}};
  for(const options of [{phase:'final'},{phase:'plan_step',stepOutcomes:[{text:'검색 결과 확인',expected_outcome:'현재 화면 제목과 링크를 관찰한다'}]}]) {
    const review=goalReviewMessages({...request,...options}),payload=JSON.parse(review.messages[1].content);
    assert(payload.citeable_evidence_ids.includes(dom.id));
    assert(payload.citeable_evidence_ids.includes(reference.id));
    const retained=payload.evidence.find(item=>item.id===dom.id);
    assert.equal(retained.result.frames[0].textSegments.map(segment=>segment.text).join(''),text);
    assert.deepEqual(retained.result.frames[0].retrieval.textRegions,dom.result.frames[0].retrieval.textRegions);
    assert(retained.coverage.partial);
    assert.deepEqual(payload.evidence.find(item=>item.id===reference.id).result.ranges,reference.result.ranges);
    assert.deepEqual(payload.conversation,request.history.filter(message=>message.role==='user'));
    assert(payload.omitted,'Removing optional narration and inventory must retain the real omission flag inside the reserved envelope');
    assert(!payload.evidence.some(item=>item.id===0));
    assert.equal(payload.goal,request.goal);
    assert.equal(options.phase==='final'?payload.proposed_answer:payload.proposed_step_result,request.answer);
    assert(payload.evidence.some(item=>item.result?.dataKind==='host_tool_dispatch'&&item.result.calls.length===24));
    assert.equal(parseGoalReview({content:JSON.stringify({status:'complete',checks:[{requirement:'관찰한 제목과 링크',status:'met',evidence_ids:[dom.id]}],next_step:''})},review.evidence).status,'complete');
    assert(contextTokens(review.messages)<=request.inputBudget);
    const withoutDOM=goalReviewMessages({...request,...options,evidence:[reference]});
    assert.throws(()=>goalReviewMessages({...request,...options,inputBudget:contextTokens(withoutDOM.messages)+50}),/goal_review_failed/,'A real token shortage must not silently drop the latest DOM or its original source');
  }
});

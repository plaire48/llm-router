import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const tools = browserTools({}, BUILTIN_SKILLS.find(s=>s.id==='browser-agent'));
const plan = ['검색','결과','출처'].map(text=>({text,expected_outcome:text+' 확인',status:'completed'}));
const call = (name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const review = correctionTarget=>({status:'revise',...(correctionTarget?{correctionTarget}:{}),
 checks:[{requirement:'검색 결과와 출처',status:'met',evidence_ids:[1]},{requirement:'잘못 서술한 읽기 전용 위반 문장',status:'unmet',evidence_ids:[1]}],
 next_step:'검색은 요청된 절차입니다. 위반했다고 잘못 서술한 문장을 고치고 전체 답변을 다시 제출하세요.'});

async function run({classification='answer',stillWrong=false,attemptTool=false,cancel=false}={}) {
 let rounds=0,reviews=0,children=0,textOnlyCalls=0;
 const executed=[],controller=new AbortController();
 const result=await runAgent({goal:'검색창에서 검색하고 일반 결과 두 개와 출처를 알려줘.',resumePlan:plan,messages:[{role:'user',content:'검색창에서 검색하고 일반 결과 두 개와 출처를 알려줘.'}],tools,harness:true,signal:controller.signal,
  complete:async(wire,selected)=>{
   assert(++rounds<12,'No unlimited wording retry');
   if(rounds===1)return call('read_page');
   if(!selected.length){textOnlyCalls++;assert(wire.some(m=>typeof m.content==='string'&&m.content.includes('No tools, browser actions')));
    if(cancel){controller.abort();return {content:'취소된 답변'};}
    if(attemptTool)return call('click_element',{ref:'never-dispatched'});
    return {content:stillWrong?'검색은 위반입니다.':'요청하신 검색을 수행했습니다. 결과 A와 B 및 관찰한 출처입니다.'};
   }
   return {content:'결과 A와 B 및 출처입니다. 검색은 읽기 전용 위반입니다.'};
  },
  execute:async(name,args)=>{executed.push(name);if(name==='read_page')return {url:'https://example.test/search',text:'Observed requested search, result A and result B.'};
   assert.equal(name,'ask_user');assert.match(args.question,/현재 결과를 유지/);return {requiresUserInput:true};},
  reviewGoal:async({answer,phase})=>{
   assert.equal(phase,undefined);reviews++;
   if(reviews<3)return review();
   if(reviews===3||stillWrong||attemptTool||cancel)return review(classification);
   assert.match(answer,/요청하신 검색/);return {status:'complete',checks:[{requirement:'원래 요청 전체',status:'met',evidence_ids:[1]}],next_step:''};
  },
  completeAnalysis:async wire=>{children++;const brief=JSON.parse(wire[1].content);return {content:JSON.stringify({status:'partial',summary:'원래 요청에 맞게 답변을 교정하세요.',findings:[{text:'검색 결과는 관찰되어 있습니다.',evidence_ids:brief.evidence.map(e=>e.evidence_id)}],uncertainties:['현재 문장 교정 필요'],next_step:'요청을 위반했다고 잘못 서술한 부분을 교정하세요.'})};}
 });
 return {result,executed,reviews,children,textOnlyCalls};
}

test('E01 gets one tools-free answer correction after browser recovery is spent, then an independent final review',async()=>{
 const r=await run();assert.equal(r.reviews,4);assert.equal(r.children,1);assert.equal(r.textOnlyCalls,1);
 assert.deepEqual(r.executed,['read_page']);assert(!r.result.awaitingUser);assert.match(r.result.content,/결과 A와 B/);
});
test('a repeated wording failure still pauses without a second grant or false completion',async()=>{
 const r=await run({stillWrong:true});assert.equal(r.textOnlyCalls,1);assert.equal(r.reviews,4);assert(r.result.awaitingUser);
 assert.deepEqual(r.executed,['read_page','ask_user']);
});
test('unknown or external repair never receives a wording-only exception',async()=>{
 for(const classification of [undefined,'unknown','external']){const r=await run({classification:classification||'unknown'});assert.equal(r.textOnlyCalls,0);assert.equal(r.reviews,3);assert(r.result.awaitingUser);}
});
test('a model-proposed action during the wording-only pass is host-blocked without dispatch',async()=>{
 const r=await run({attemptTool:true});assert.equal(r.textOnlyCalls,1);assert(r.result.awaitingUser);assert.deepEqual(r.executed,['read_page','ask_user']);
});
test('cancellation during the wording-only pass suppresses the replacement answer',async()=>{
 await assert.rejects(run({cancel:true}),/cancelled/);
});

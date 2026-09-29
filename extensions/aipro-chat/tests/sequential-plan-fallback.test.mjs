import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

// E08 causal replay: first source inspection can pass while source attribution
// and final synthesis still lack evidence. This is not a live-model score.
const plan = [
  {text:'선수 표 확인',expected_outcome:'관찰한 표에서 종목과 소속 확인',status:'in_progress'},
  {text:'출처 시점 구분',expected_outcome:'현재와 과거 소속을 근거에 따라 구분',status:'pending'},
  {text:'결과 정리',expected_outcome:'출처와 확인 범위를 포함한 답변',status:'pending'},
];
const call = (name, args={}) => ({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const blocked = {status:'blocked',checks:[],next_step:'현재 근거로는 다음 결과를 확인하지 못했습니다.'};
function fixture(options={}) {
  const controller = new AbortController(), saves=[], events=[], reviews=[];
  let rounds=0;
  const run = () => runAgent({messages:[{role:'user',content:'선수의 종목과 소속, 출처 시점을 알려줘.'}],
    tools:browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')),harness:true,
    resumePlan:structuredClone(plan),signal:controller.signal,onStep:event=>events.push(event),
    complete:async()=>{assert(++rounds<12,'must not loop indefinitely');return rounds===1?{calls:[call('read_page')]}:{content:'표에서 확인한 임시 답변'};},
    execute:async(name,args)=>{
      if(name==='read_page')return {ok:true,text:'관찰한 선수 표. 출처 시점은 아직 확인하지 못함.'};
      if(name==='update_plan'){saves.push(structuredClone(args.steps));return {ok:true,plan:args.steps};}
      assert.equal(name,'ask_user');return {requiresUserInput:true};
    },
    reviewGoal:async payload=>{reviews.push(payload);return options.review(payload,saves,controller);},
    ...options.agent});
  return {run,saves,events,reviews,controller};
}

test('E08 first inspection persists 1/3 while later unknown synthesis waits without releasing a final answer',async()=>{
  const f=fixture({review:({phase,stepOutcomes},saves)=>{
    assert.equal(phase,'plan_step');assert.equal(stepOutcomes.length,1);
    if(!saves.length){assert.equal(stepOutcomes[0].text,plan[0].text);return {status:'complete'};}
    assert.equal(stepOutcomes[0].text,plan[1].text);return blocked;
  }});
  const result=await f.run();
  assert(result.awaitingUser);assert.equal(result.content,'');
  assert.equal(f.saves.length,1);
  assert.deepEqual(f.saves[0].map(s=>s.status),['completed','pending','pending']);
  assert.deepEqual(f.saves[0].map(s=>s.expected_outcome),plan.map(s=>s.expected_outcome));
  assert(f.events.some(e=>e.tool==='update_plan'&&e.status==='done'));
  assert(f.reviews.every(r=>r.phase==='plan_step'));
});

test('fallback selects the active step before an earlier pending step and preserves completed work',async()=>{
  const initial=[{...plan[0],status:'pending'},{...plan[1],status:'in_progress'},{...plan[2],status:'completed'}];
  const f=fixture({agent:{resumePlan:initial},review:({stepOutcomes},saves)=>{
    assert.equal(stepOutcomes[0].text,saves.length?plan[0].text:plan[1].text);
    return saves.length?blocked:{status:'complete'};
  }});
  await f.run();assert.deepEqual(f.saves[0].map(s=>s.status),['pending','completed','completed']);
});

test('all persisted stages still require final review and a rejected answer stays private',async()=>{
  const f=fixture({review:({phase},saves)=>{if(phase==='plan_step')return {status:'complete'};
    assert.equal(saves.length,3);assert(saves.at(-1).every(s=>s.status==='completed'));return blocked;}});
  const result=await f.run();assert(result.awaitingUser);assert.equal(result.content,'');
  assert.deepEqual(f.saves.map(p=>p.filter(s=>s.status==='completed').length),[1,2,3]);
  assert.equal(f.reviews.filter(r=>!r.phase).length,1);
});

test('cancellation during scoped review cannot persist the step or advance later work',async()=>{
  const f=fixture({review:(_,__,controller)=>{controller.abort();return {status:'complete'};}});
  await assert.rejects(f.run(),/cancelled/);assert.equal(f.saves.length,0);
});

test('a user correction arriving during review prevents stale completion persistence',async()=>{
  let ready=false,delivered=false;
  const f=fixture({agent:{takeInput:async()=>{if(!ready||delivered)return null;delivered=true;return {text:'현재 소속을 단정하지 말고 출처 날짜를 먼저 확인해줘.'};}},
    review:()=>{if(!ready){ready=true;return {status:'complete'};}return blocked;}});
  const result=await f.run();assert(result.awaitingUser);assert(delivered);assert.equal(f.saves.length,0);
});

test('rewording an unfinished plan without new evidence cannot renew the recovery worker',async()=>{
  let rounds=0,children=0;
  const f=fixture({agent:{
    complete:async()=>{
      assert(++rounds<=6,'rewording must not prolong the same failed review');
      if(rounds===1)return {calls:[call('read_page')]};
      if(rounds===4)return {calls:[call('update_plan',{steps:plan.map((s,i)=>i===0?{...s,text:'표 확인 표현만 변경'}:s)})]};
      return {content:'미완료 후보'};
    },
    completeAnalysis:async wire=>{
      children++;assert.equal(children,1,'no second worker without verified progress');
      const brief=JSON.parse(wire[1].content);
      return {content:JSON.stringify({status:'partial',summary:'조건 미확인',
        findings:[{text:'조건을 확인하지 못했습니다.',evidence_ids:brief.evidence.map(e=>e.evidence_id)}],
        uncertainties:['미확인 조건'],next_step:'새 근거를 확인하세요.'})};
    }},
    review:()=>({status:'revise',checks:[{requirement:'원문 조건',status:'unknown',evidence_ids:[]}],next_step:'누락된 조건을 확인하세요.'})});
  const result=await f.run();assert(result.awaitingUser);assert.equal(children,1);
  assert(f.saves.every(p=>p.every(s=>s.status!=='completed')));
});

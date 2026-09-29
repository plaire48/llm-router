import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools,BUILTIN_SKILLS} from '../skills.js';
const tools=browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent'),'QWEN3.8-27B-FP8-256K');
const goal='선수의 종목과 소속을 출처와 함께 알려줘';
const plan=[{text:'원문 확인',expected_outcome:'종목과 소속의 직접 근거 확인',status:'in_progress'}];
const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const revise={status:'revise',checks:[{requirement:'소속 시점',status:'unknown',evidence_ids:[]}],next_step:'소속 시점의 실제 원문 근거를 확인하세요.'};
async function run({wording=false,newSource=false,steer=false}={}) {
  let rounds=0,children=0,reads=0,questions=0,changed=false,sent=false,delivered=0,reviews=0;
  const executed=[];
  const result=await runAgent({messages:[{role:'user',content:goal}],taskGoal:goal,tools,modelId:'test',harness:true,resumePlan:plan,
    signal:new AbortController().signal,
    onStep:step=>{if(step.tool==='analysis_recovery'&&step.analysis?.delivered)delivered++;},
    takeInput:steer?async()=>{if(delivered===1&&!sent){sent=true;changed=true;return {text:'추가로 소속의 확인 연도도 함께 확인해 줘'};}return null;}:undefined,
    complete:async()=>{
      rounds++;
      if(rounds===1||newSource&&children===1&&reads===1)return call('read_page');
      // Bound the regression fixture: the old implementation launches eight
      // analysts before this explicit stop, with no new browser observations.
      if(rounds>11)return call('ask_user',{question:'테스트 종료'});
      return call('update_plan',{steps:[{...plan[0],status:'completed',...(wording?{text:`원문 확인 ${rounds}`,expected_outcome:`동일 근거 확인 ${rounds}`}:{})}],explanation:wording?`같은 완료 제안 ${rounds}`:'확인 완료'});
    },
    execute:async(name,args)=>{
      executed.push(name);
      if(name==='read_page')return {frames:[{frame:0,text:++reads===1?'선수 사브르':'선수 사브르 소속 대전 2026'}]};
      if(name==='ask_user'){questions++;return {requiresUserInput:true};}
      if(name==='update_plan')return {ok:true,plan:args.steps};
      assert.fail(name);
    },reviewGoal:async()=>({...revise,next_step:`${revise.next_step} ${changed?'추가 확인 연도도 유지하세요. ':''}검토 ${++reviews}`}),
    completeAnalysis:async wire=>{
      children++;const brief=JSON.parse(wire[1].content);
      return {content:JSON.stringify({status:'complete',summary:`소속 확인 조언 ${children}`,findings:[{text:'현재 원문에서 소속 시점을 추가 확인해야 합니다.',evidence_ids:brief.evidence.map(item=>item.evidence_id)}],uncertainties:[],next_step:'다른 소속 원문 근거를 확인하세요.'})};
    }});
  return {children,reads,questions,result,executed,changed,rounds};
}
test('E08 frozen page cannot launch eight new recovery workers from their own delivery receipts',async()=>{
  const result=await run();assert.equal(result.children,1);assert.equal(result.reads,1);
  assert.equal(result.questions,1);assert.equal(result.result.awaitingUser,true);
});
test('plan wording and explanation changes cannot evade the same missing-evidence repair boundary',async()=>{
  const result=await run({wording:true});assert.equal(result.children,1);assert.equal(result.reads,1);assert.equal(result.result.awaitingUser,true);
});
test('genuinely changed source evidence allows one further recovery before pausing again',async()=>{
  const result=await run({newSource:true});assert.equal(result.children,2);assert.equal(result.reads,2);assert.equal(result.result.awaitingUser,true);
});
test('a real user correction allows another recovery without discarding earlier source observations',async()=>{
  const result=await run({steer:true});assert.equal(result.changed,true);assert.equal(result.children,2,JSON.stringify(result));assert.equal(result.reads,1);assert.equal(result.result.awaitingUser,true);
});

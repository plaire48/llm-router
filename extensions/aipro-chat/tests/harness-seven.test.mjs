import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {normalizePlan, initialPlan} from '../task-plan.js';
import {reviewEvidence, goalReviewMessages, parseGoalReview} from '../goal-review.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {resumedVerification, taskReceipt} from '../context-state.js';

const tools=browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent'),'QWEN3.8-27B-FP8-256K');
const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const base=()=>({messages:[{role:'user',content:'요청한 내용을 작성하되 발송하지 마.'}],tools,signal:new AbortController().signal,harness:true});
const plan=[{text:'초안 작성',status:'in_progress',expected_outcome:'제목과 본문이 모두 작성되고 발송되지 않음'},{text:'결과 확인',status:'pending',expected_outcome:'요청한 내용과 서식이 유지됨'}];

test('observable criteria survive status-only plan updates and restart normalization without expanding UI labels',()=>{
  const changed=normalizePlan(plan.map(({text})=>({text,status:'pending'})),plan);
  assert.deepEqual(initialPlan(changed),plan);
  assert.equal(normalizePlan([{...plan[0],expected_outcome:' '}]),null);
  assert.equal(normalizePlan([{...plan[0],expected_outcome:'x'.repeat(241)}]),null);
  assert(!JSON.stringify(normalizePlan([{...plan[0],expected_outcome:'Bearer secret'}])).includes('Bearer secret'));
});

test('a passing unrelated check cannot advance an outcome-bearing plan and the model repairs only missing content',async()=>{
  let round=0, reviews=0;const executed=[],phases=[];
  const closing=[{...plan[0],status:'completed'},{...plan[1],status:'in_progress'}];
  await runAgent({...base(),resumePlan:plan,
    complete:async messages=>{
      round++;
      if(round===1)return call('fill_form',{fields:[{field_id:'title',value:'제목'}]});
      if(round===2||round===5)return call('verify_page',{checks:[{kind:'text_present',expected:round===2?'페이지 제목':'작성된 본문'}]});
      if(round===3||round===6)return call('update_plan',{steps:closing});
      if(round===4){assert.equal(JSON.parse(messages.at(-1).content).deferred,true);return call('fill_form',{fields:[{field_id:'body',value:'본문'}]});}
      return {content:'초안을 작성했습니다.'};
    },
    execute:async(name,args)=>{executed.push([name,args]);return name==='update_plan'?{ok:true,plan:args.steps}:{ok:true,verified:true,applied:1};},
    reviewGoal:async({phase='final',stepOutcomes})=>{
      phases.push(phase);
      if(phase!=='plan_step')return {status:phase==='final'?'complete':'revise',next_step:'진행 중'};
      assert.equal(stepOutcomes[0].expected_outcome,plan[reviews < 2 ? 0 : 1].expected_outcome);
      return ++reviews===1?{status:'revise',next_step:'제목만 확인됐습니다. 누락된 본문만 작성하고 검증하세요.'}:{status:'complete'};
    }});
  assert.equal(executed.filter(([name])=>name==='update_plan').length,2);
  assert.deepEqual(executed.filter(([name])=>name==='fill_form').map(([,args])=>args.fields[0].field_id),['title','body']);
  assert.equal(phases.filter(phase=>phase==='plan_step').length,3);
  assert.equal(phases.at(-1),'final');
});

test('step review keeps later work pending and uses fresh evidence against original restrictions',()=>{
  const evidence=[reviewEvidence(1,'verify_page',{}, {ok:true,verified:true})];
  const {messages}=goalReviewMessages({goal:'초안만 작성',history:[],evidence,answer:'',inputBudget:6000,phase:'plan_step',stepOutcomes:plan.slice(0,1)});
  assert.match(messages[0].content,/PLAN STEP completion gate/);
  assert.deepEqual(JSON.parse(messages[1].content).stepOutcomes,plan.slice(0,1).map(({text,expected_outcome})=>({text,expected_outcome})));
  assert.equal(plan[0].status,'in_progress');
  const partial=reviewEvidence(2,'read_page',{}, {frames:[{text:'관찰한 일부',textFiltered:true},{unavailable:true}]});
  assert.deepEqual(partial.coverage,{frames:2,unavailable:1,partial:true});
});

test('a step-review authentication failure stops without reframing it as missing user requirements',async()=>{
  let calls=0;
  await assert.rejects(runAgent({...base(),resumePlan:plan,
    complete:async()=>{assert.equal(++calls,1);return call('update_plan',{steps:plan.map((step,index)=>({...step,status:index?'in_progress':'completed'}))});},
    execute:async()=>assert.fail('No page action or plan update after authentication failure'),
    reviewGoal:async()=>{throw new Error('unauthorized');}}),/unauthorized/);
});

test('old screenshots stop being current model input or review proof after a view-changing operation',async()=>{
  for(const action of ['hover_element','fill_form']){
    let round=0;
    await runAgent({...base(),complete:async messages=>{
      if(++round===1)return call('capture_page');
      if(round===2){assert(messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url')));return action==='fill_form'?call(action,{fields:[{field_id:'body',value:'초안'}]}):call(action,{ref:'menu'});}
      assert(!messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url')));
      if(round===3&&action==='fill_form')return call('verify_page',{checks:[{kind:'text_present',expected:'초안'}]});
      return {content:'확인했습니다.'};
    },execute:async name=>name==='capture_page'?{image:{data:'YWJj',mimeType:'image/png'},observation:{text:'old page'}}:{ok:true,verified:true},
    reviewGoal:async({evidence})=>{assert.equal(evidence[0].usable,false);assert.equal(evidence[0].superseded,true);return {status:'complete'};}});
  }
});

test('dragging adds verification debt and uncertain completion remains pending on resume',()=>{
  let task=taskReceipt({steps:[],plan},'drag_element','start');
  task=taskReceipt(task,'drag_element','end',{ok:true,actionIssued:true,verified:false});
  assert.equal(task.verification.status,'pending');
  assert.deepEqual(resumedVerification(task),{status:'pending'});
  const evidence=[{...reviewEvidence(1,'capture_page',{}, {observation:{text:'old'}}),usable:false,superseded:true}];
  assert.throws(()=>parseGoalReview({content:JSON.stringify({status:'complete',checks:[{requirement:'이동됨',status:'met',evidence_ids:[1]}],next_step:''})},evidence),/goal_review_failed/);
});

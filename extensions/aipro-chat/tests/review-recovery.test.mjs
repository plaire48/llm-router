import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {reviewEnvelope,GOAL_REVIEW_TOOL,COMPLETION_REVIEW_TOOL,REVIEW_RECOVERY_TOOLS} from '../review-recovery.js';
import {parseGoalReview,reviewEvidence} from '../goal-review.js';
import {completeChat} from '../src/api.js';
import {browserTools,BUILTIN_SKILLS} from '../skills.js';
const skill=BUILTIN_SKILLS.find(s=>s.id==='browser-agent');
const tools=browserTools({},skill).filter(t=>t.function.name!=='update_plan');
const call=(name,args={})=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const done={content:'PROVISIONAL',calls:null};
const failure=reason=>Object.assign(new Error('goal_review_failed'),{reviewReason:reason});
const review=id=>({status:'complete',checks:[{requirement:'제목 확인',status:'met',evidence_ids:[id]}],next_step:''});
const options=()=>({messages:[{role:'user',content:'제목 확인. 저장/발송 금지.'}],tools,harness:true,signal:new AbortController().signal});

test('result tools are data envelopes, with original evidence and truncation checks intact',()=>{
  const evidence=[reviewEvidence(1,'read_page',{}, {text:'actual title'})];
  assert.equal(parseGoalReview(reviewEnvelope(call('report_goal_review',review(1))),evidence).status,'complete');
  assert.throws(()=>parseGoalReview(reviewEnvelope(call('report_goal_review',review(999))),evidence),/goal_review_failed/);
  assert.throws(()=>parseGoalReview(reviewEnvelope({...call('report_goal_review',review(1)),finishReason:'length'}),evidence),/goal_review_failed/);
  assert.throws(()=>reviewEnvelope(call('fill_form')),/goal_review_failed/);
  assert.throws(()=>reviewEnvelope({calls:[...call('report_goal_review').calls,...call('fill_form').calls]}),/goal_review_failed/);
  assert.throws(()=>reviewEnvelope(call('report_completion_intent')),/goal_review_failed/);
  assert.equal(JSON.parse(reviewEnvelope(call('report_completion_intent',{decision:'reply'}),COMPLETION_REVIEW_TOOL).content).decision,'reply');
});

test('a failed final reviewer gets fresh read-only evidence and cannot replay a proposed write',async()=>{
  let round=0,reviews=0;const executed=[],steps=[];
  const result=await runAgent({...options(),onStep:s=>steps.push(s),complete:async(_wire,selected)=>{
    const turn=round++;
    if(turn===0||turn===3)return call('read_page');
    if(turn===2){assert(selected.every(t=>REVIEW_RECOVERY_TOOLS.has(t.function.name)));return call('fill_form',{fields:[{field_id:'old',value:'DUPLICATE'}]});}
    return done;
  },execute:async name=>{executed.push(name);assert.equal(name,'read_page');return {text:`Title evidence ${executed.length}`};},
  reviewGoal:async({evidence})=>{if(++reviews===1)throw failure('json_invalid');assert.equal(evidence.at(-1).result.text,'Title evidence 2');return {status:'complete'};}});
  assert.equal(result,done);assert.equal(reviews,2);assert.deepEqual(executed,['read_page','read_page']);
  assert(!steps.some(s=>s.tool==='fill_form'&&s.status==='running'));
  assert(steps.some(s=>s.tool==='review_task'&&s.reason==='json_invalid'));
});

test('repeated reviewer failure pauses once in the durable question flow and hides the candidate',async()=>{
  let round=0,reviews=0,questions=0,reads=0;
  const result=await runAgent({...options(),complete:async()=>round++===0?call('read_page'):done,
    execute:async(name,args)=>{if(name==='ask_user'){questions++;assert.match(args.question,/보존/);return {requiresUserInput:true};}assert.equal(name,'read_page');reads++;return{text:'title'};},
    reviewGoal:async()=>{reviews++;throw failure('schema_invalid');}});
  assert(result.awaitingUser);assert.equal(result.content,'');assert.equal(reviews,2);assert.equal(questions,1);assert.equal(reads,1);
});

test('repeated forbidden recovery proposals pause without replaying writes or looping forever',async()=>{
  let round=0,reviews=0;const executed=[];
  const result=await runAgent({...options(),complete:async()=>{
    assert(round<6,'Recovery must stop asking the model after repeated blocked proposals');
    const turn=round++;
    if(turn===0)return call('read_page');
    return turn===1?done:call('fill_form',{fields:[{field_id:'old',value:'DUPLICATE'}]});
  },execute:async name=>{executed.push(name);return name==='ask_user'?{requiresUserInput:true}:{text:'title'};},
  reviewGoal:async()=>{reviews++;throw failure('json_invalid');}});
  assert(result.awaitingUser);assert.equal(result.content,'');assert.equal(reviews,1);
  assert.equal(round,5);assert.deepEqual(executed,['read_page','ask_user']);
});

test('review context overflow preserves requirements and asks for partitioning without blind rereads',async()=>{
  let round=0,reviews=0;const executed=[];
  const result=await runAgent({...options(),complete:async()=>round++===0?call('read_page'):done,
    execute:async(name,args)=>{executed.push(name);if(name==='ask_user'){assert.match(args.question,/요청 조건은 유지/);return {requiresUserInput:true};}return {text:'title'};},
    reviewGoal:async()=>{reviews++;throw failure('context_budget');}});
  assert(result.awaitingUser);assert.equal(reviews,1);assert.deepEqual(executed,['read_page','ask_user']);
});

test('authentication failure and explicit cancellation never become review retries or questions',async()=>{
  for(const cancel of [false,true]){
    const controller=new AbortController();let round=0,reviews=0,reads=0;
    await assert.rejects(runAgent({...options(),signal:controller.signal,complete:async()=>round++===0?call('read_page'):done,
      execute:async name=>{assert.equal(name,'read_page');reads++;return{text:'title'};},
      reviewGoal:async()=>{reviews++;if(cancel)controller.abort();throw cancel?failure('json_invalid'):new Error('unauthorized');}}),/cancelled|unauthorized/);
    assert.equal(reads,1);assert.equal(reviews,1);
  }
});

test('same-provider structured review repair never dispatches the result tool to the browser',async t=>{
  const old={fetch:globalThis.fetch,chrome:globalThis.chrome};t.after(()=>Object.assign(globalThis,old));
  let calls=0,reads=0;const saved=[];
  globalThis.chrome={storage:{session:{get:async()=>({credential:{provider:'aipro',receivedAt:1,token:'synthetic'}})}}};
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);calls++;assert.equal(body.model,'QWEN3.8-27B-FP8-256K');
    if(calls===4)assert.deepEqual(body.tools,[GOAL_REVIEW_TOOL]);
    const message=calls===1?{tool_calls:call('read_page').calls}:calls===4?{tool_calls:call('report_goal_review',review(1)).calls}:{content:calls===3?'not json':'확인했습니다.'};
    return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]});
  };
  const result=await completeChat({provider:'aipro',credentialReceivedAt:1,modelId:'QWEN3.8-27B-FP8-256K',messages:options().messages,tools,skill},new AbortController().signal,undefined,undefined,undefined,undefined,
    async name=>{assert.equal(name,'read_page');reads++;return{text:'actual title'};},undefined,undefined,state=>saved.push(state));
  assert.equal(result,'확인했습니다.');assert.equal(calls,4);assert.equal(reads,1);assert.equal(saved.at(-1).status,'complete');
});

test('ChatGPT Responses transport repairs review JSON with the same SSO model and no browser replay',async t=>{
  const {zstdDecompressSync}=await import('node:zlib');
  const {chatgptToken,responsesSSE}=await import('./fixtures/chatgpt.mjs');
  const old={fetch:globalThis.fetch,chrome:globalThis.chrome};t.after(()=>Object.assign(globalThis,old));
  let count=0,reads=0;
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true})},storage:{session:{get:async()=>({credential:{provider:'chatgpt',receivedAt:1,token:chatgptToken()}})}}};
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(typeof options.body==='string'?options.body:zstdDecompressSync(options.body).toString());count++;
    assert.equal(body.model,'gpt-5.6-sol');
    if(count===4)assert.deepEqual(body.tools.map(tool=>tool.name),['report_goal_review']);
    const response=count===1?{tool:{name:'read_page',arguments:{}}}:count===4?{tool:{name:'report_goal_review',arguments:review(1)}}:{text:count===3?'invalid review':'확인했습니다.'};
    return new Response(responsesSSE(response),{headers:{'content-type':'text/event-stream'}});
  };
  assert.equal(await completeChat({provider:'chatgpt',credentialReceivedAt:1,modelId:'gpt-5.6-sol',messages:options().messages,tools,skill},new AbortController().signal,undefined,undefined,undefined,undefined,
    async name=>{assert.equal(name,'read_page');reads++;return{text:'title'};}),'확인했습니다.');
  assert.equal(count,4);assert.equal(reads,1);
});

test('completion intent uses a separate structured schema without opening a page for conversation',async t=>{
  const old={fetch:globalThis.fetch,chrome:globalThis.chrome};t.after(()=>Object.assign(globalThis,old));
  let count=0;
  globalThis.chrome={storage:{session:{get:async()=>({credential:{provider:'aipro',receivedAt:1,token:'synthetic'}})}}};
  globalThis.fetch=async(_url,options)=>{
    count++;const body=JSON.parse(options.body);
    if(count===3)assert.deepEqual(body.tools,[COMPLETION_REVIEW_TOOL]);
    const message=count===3?{tool_calls:call('report_completion_intent',{decision:'reply',scope:'conversation',next_step:''}).calls}:{content:count===2?'invalid':'안녕하세요!'};
    return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]});
  };
  assert.equal(await completeChat({provider:'aipro',credentialReceivedAt:1,modelId:'model',messages:[{role:'user',content:'안녕'}],tools,skill},new AbortController().signal,undefined,undefined,undefined,undefined,
    async()=>assert.fail('No browser action or result tool may execute')),'안녕하세요!');
  assert.equal(count,3);
});

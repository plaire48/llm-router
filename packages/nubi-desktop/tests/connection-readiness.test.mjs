import test from 'node:test';
import assert from 'node:assert/strict';
import {protectMailDirectory} from '../runtime/mail-directory.mjs';
import {prepareWorkPlan,parseWorkPlan} from '../runtime/work-plan.mjs';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {modelTransport} from '../runtime/recovery.mjs';

test('company folder ACL uses process SID and never removes inheritance after a failed grant',async()=>{
 const calls=[];const execute=async(command,args)=>{calls.push([command,args]);return {stdout:'"CORP\\user","S-1-5-21-123-456-789-1001"'};};
 await protectMailDirectory('C:\\mail',{platform:'win32',execute});
 assert.equal(calls[1][1][2],'*S-1-5-21-123-456-789-1001:(OI)(CI)F');assert.equal(calls[2][1][1],'/inheritance:r');
 let count=0;await assert.rejects(protectMailDirectory('C:\\mail',{platform:'win32',execute:async(...args)=>{if(++count===2)throw Error('denied');return execute(...args);}}),/mail_storage_permission/);assert.equal(count,2);
});

for(const modelId of ['QWEN-fixture','SOL-fixture'])test(`AI Pro ${modelId}: planning uses a data-only tool, repairs the format, then restores actor defaults`,async()=>{
 const sent=[],progress=[];let planning=0;
 const plan={intent:{goal:'위키 확인',constraints:['수정 금지'],outcomes:['근거와 읽은 범위'],workflowIds:[],skillPaths:[]},steps:[{text:'위키 확인',expected_outcome:'원문과 근거 확인',status:'in_progress'}]};
 const token='e30.'+Buffer.from(JSON.stringify({sub:'fixture'})).toString('base64url')+'.signature';
 const providers=createProviders({startLogin:async()=>({result:Promise.resolve({token,models:[{id:modelId,contextLength:32000}]}),cancel(){}}),fetchImpl:async(_url,options)=>{
   const body=JSON.parse(options.body);sent.push(body);
   const isPlan=body.messages[0].content.startsWith("You are Nubi Desktop's work planner");
   const message=isPlan&&++planning===1?{content:'not a plan'}:isPlan?{content:JSON.stringify(plan)}:{content:'확인 완료'};
   return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]});
 }});
 try{
  await providers.login('aipro');await new Promise(r=>setImmediate(r));
  const signal=new AbortController().signal,invoke=modelTransport({providers},{signal});
  const result=await prepareWorkPlan({task:{request:'위키를 확인해줘. 수정 금지'},history:[],model:{contextLength:32000},signal,capabilities:{workflows:[],skills:[]},invoke:(wire,tools,options)=>invoke(wire,tools,signal,'planner',options),onProgress:event=>progress.push(event)});
  assert.equal(result.intent.constraints[0],'수정 금지');assert.equal(planning,2);
  assert.deepEqual(sent[0].tools.map(tool=>tool.function.name),['update_plan']);assert(sent[0].tools[0].function.parameters.required.includes('intent'));
  assert.equal(sent[0].tool_choice,'auto');assert.equal(sent[1].tool_choice,undefined);assert.equal(sent[1].tools,undefined);assert.deepEqual(sent[1].response_format,{type:'json_object'});assert(sent[1].max_tokens>=4096);
  assert.match(sent[1].messages[0].content,/plan_json_invalid/);assert(!JSON.stringify(sent[1]).includes('not a plan'));
  await invoke([{role:'user',content:'결과'}],[]);
  assert.equal(sent[2].tool_choice,undefined);assert.equal(sent[2].tools,undefined);
  assert.deepEqual(progress.map(event=>event.state),['running','error','running','done']);
 }finally{providers.dispose();}
});

test('mixed plan/action calls are rejected without execution and retain only fixed diagnostic codes',async()=>{
 const signal=new AbortController().signal;
 await assert.rejects(prepareWorkPlan({task:{request:'원문 보기'},history:[],model:{contextLength:32000},signal,capabilities:{workflows:[],skills:[]},invoke:async()=>({calls:[{function:{name:'update_plan',arguments:'{}'}},{function:{name:'run_command',arguments:'PRIVATE'}}]})}),error=>error.message==='work_plan_invalid'&&JSON.stringify(error.planningDiagnostic.reasons)===JSON.stringify(['plan_tool_calls','plan_tool_calls'])&&!JSON.stringify(error.planningDiagnostic).includes('PRIVATE'));
});

test('planner changes protocol after a tool-format rejection without bypassing intent validation',async()=>{
 const plan={intent:{goal:'결과 확인',constraints:['변경 금지'],outcomes:['출력과 결과 대조'],workflowIds:[],skillPaths:[]},steps:[{text:'결과 읽기',expected_outcome:'원문 확인',status:'in_progress'}]};
 const args={task:{request:'결과 확인. 변경 금지'},history:[],model:{contextLength:32000},capabilities:{workflows:[],skills:[]},signal:new AbortController().signal};
 for(const invalid of [false,true]){
  const calls=[];
  const invoke=async(messages,tools,options)=>{
   calls.push({messages,tools,options});
   if(calls.length===1)throw Object.assign(Error('request_format'),{status:422});
   assert.deepEqual(tools,[]);assert.deepEqual(options.responseFormat,{type:'json_object'});
   assert.match(messages[0].content,/JSON schema/);assert.match(messages[1].content,/변경 금지/);
   return {content:JSON.stringify(invalid?{...plan,intent:{...plan.intent,skillPaths:['unavailable/SKILL.md']}}:plan),calls:[]};
  };
  if(invalid)await assert.rejects(prepareWorkPlan({...args,invoke}),/work_plan_invalid/);
  else assert.equal((await prepareWorkPlan({...args,invoke})).intent.constraints[0],'변경 금지');
  assert.equal(calls.length,2);
 }
 let attempts=0;
 await assert.rejects(prepareWorkPlan({...args,invoke:async()=>{attempts++;throw Object.assign(Error('unauthorized'),{status:401});}}),/unauthorized/);
 assert.equal(attempts,1,'authentication is not a plan-format error');
});

test('AI Pro reasoning deltas keep an active stream alive without displaying private reasoning',async()=>{
 const providers=createProviders({startLogin:async()=>({result:Promise.resolve({token:'synthetic',models:[{id:'reasoning-fixture'}]}),cancel(){}}),fetchImpl:async()=>new Response(new ReadableStream({async start(controller){
   const send=value=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(value)+'\n\n'));
   for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,50));send({choices:[{index:0,delta:{reasoning_content:'PRIVATE'},finish_reason:null}]});}
   send({choices:[{index:0,delta:{content:'결과'},finish_reason:'stop'}]});controller.close();
 }}),{headers:{'content-type':'text/event-stream'}})});
 try{
  await providers.login('aipro');await new Promise(resolve=>setImmediate(resolve));
  const invoke=modelTransport({providers,recoveryOptions:{model:{idleMs:200,attemptMs:3000,retries:0}}},{signal:new AbortController().signal});
  const result=await invoke([{role:'user',content:'확인'}],[]);assert.equal(result.content,'결과');assert(!JSON.stringify(result).includes('PRIVATE'));
 }finally{providers.dispose();}
});
test('a single JSON fence is accepted as data while surrounding text, tools and invalid constraints remain refused',async()=>{
 assert.deepEqual(parseWorkPlan('```json\n{"steps":[]}\n```'),{steps:[]});
 assert.throws(()=>parseWorkPlan('explanation\n```json\n{}\n```'));
 const plan={intent:{goal:'위키 확인',constraints:[],outcomes:['출처와 결과'],workflowIds:[],skillPaths:[]},steps:[{text:'위키 읽기',expected_outcome:'관련 원문 확인',status:'in_progress'}]};
 const args={task:{request:'위키를 확인해줘'},history:[],model:{contextLength:32000},capabilities:{workflows:[],skills:[]},signal:new AbortController().signal};
 const result=await prepareWorkPlan({...args,invoke:async()=>({content:'```json\n'+JSON.stringify(plan)+'\n```',calls:[]})});assert.equal(result.intent.goal,'위키 확인');
 const pending={...plan,steps:plan.steps.map(step=>({...step,status:'pending'}))};
 const started=await prepareWorkPlan({...args,invoke:async()=>({calls:[{function:{name:'update_plan',arguments:JSON.stringify(pending)}}]})});assert.equal(started.steps[0].status,'in_progress');
 await assert.rejects(prepareWorkPlan({...args,invoke:async()=>({content:JSON.stringify({...plan,steps:plan.steps.map(step=>({...step,status:'completed'}))})})}),/work_plan_invalid/);
 await assert.rejects(prepareWorkPlan({...args,invoke:async()=>({content:JSON.stringify({...plan,intent:{...plan.intent,workflowIds:'invalid'}})})}),e=>e.message==='work_plan_invalid'&&e.planningDiagnostic.attempts===2);
});

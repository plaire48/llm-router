import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRunContext,contextBudget} from '../../../extensions/aipro-chat/context-manager.js';
import {reviewResult,resultReviewInput,reviewInputLimit} from '../runtime/result-review.mjs';
import {prepareWorkPlan} from '../runtime/work-plan.mjs';
import {commandProblem} from '../runtime/process-output.mjs';
import {taskReceiptRecords,TASK_RECEIPT_LIMIT} from '../runtime/task-receipts.mjs';

const model={name:'quality-diagnostic',contextLength:16000,maxInputTokens:14000};
const signal=()=>new AbortController().signal;
const summary={goal:'원래 요청 유지',constraints:['파일을 변경하지 않는다'],decisions:[],completed:[],pending:['실제 결과 확인'],references:[]};
const pair=(id,content)=>[{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name:'read_source',arguments:'{}'}}]},{role:'tool',tool_call_id:id,content}];
const context=()=>createRunContext({model,tools:[],signal:signal(),invoke:async()=>({content:JSON.stringify(summary),finishReason:'stop'})});

for(const force of [false,true])test(`latest unread batch survives trailing host state (force=${force})`,async()=>{
  const fresh='CURRENT SOURCE LINE\n'.repeat(1000),a=pair('latest',fresh),b=pair('second','second current result');
  const wire=[{role:'system',content:'instructions'},...pair('old','old text '.repeat(8000)),{...a[0],tool_calls:[...a[0].tool_calls,...b[0].tool_calls]},a[1],b[1],{role:'user',contextOnly:true,content:'Current host plan: inspect the returned result'}];
  const before=structuredClone(wire),packed=await context().prepare(wire,force);
  assert.equal(packed.find(m=>m.tool_call_id==='latest')?.content,fresh);
  assert.equal(packed.find(m=>m.tool_call_id==='second')?.content,b[1].content);
  for(const result of packed.filter(m=>m.role==='tool'))assert.ok(packed.some(m=>m.tool_calls?.some(call=>call.id===result.tool_call_id)));
  assert.equal(packed.at(-1).content,wire.at(-1).content);
  assert.deepEqual(wire,before,'compaction must not mutate the original transcript');
});

test('an oversized unread result goes to overflow recovery rather than silent summarization',async()=>{
  const wire=[{role:'system',content:'instructions'},...pair('large','source line '.repeat(12000)),{role:'user',contextOnly:true,content:'Current host plan'}];
  await assert.rejects(context().prepare(wire),/context_input_too_large/);
  assert.equal(wire[2].tool_call_id,'large');
});

const receipts=()=>({proposals:[],setupActions:[],processes:[],computer:{actions:[],omittedActions:0,unresolvedCount:0},reconciliation:null});
const pendingReview=(host,controller=new AbortController())=>reviewResult({task:{request:'파일 수정안을 준비해 줘',criteria:[],questionHistory:[]},evidence:[],receipts:host,candidate:'승인을 기다립니다.',model:{contextLength:272000},signal:controller.signal,invoke:async messages=>({content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'pending',evidenceIds:['host'],detail:'승인 대기'})),nextStep:''}),calls:[]})});

test('a claimed approval wait needs a real host operation',async()=>{
  const review=await pendingReview(receipts());
  assert.equal(review.status,'revise');assert.equal(review.normalized,'missing_host_boundary');
  assert.equal(review.checks[0].state,'unknown');assert.match(review.nextStep,/미확정 동작은 재실행하지/);
});

for(const [name,change] of [
  ['real approval',host=>host.proposals.push({id:'p',state:'proposed'})],
  ['running command',host=>host.processes.push({id:'p',state:'running'})],
  ['unknown outcome',host=>host.processes.push({id:'p',state:'failed',execution:'unknown'})],
  ['interrupted command',host=>host.processes.push({id:'p',state:'interrupted'})],
  ['omitted app operations',host=>host.computer.omittedActions=1],
  ['unresolved app operations',host=>host.computer.unresolvedCount=1],
  ['missing inventory',host=>delete host.processes],
  ['omitted task receipts',host=>host.inventory={complete:false,omitted:{proposals:1}}],
  ['reconciliation needed',host=>host.reconciliation={state:'attention'}]
])test(`approval correction does not infer permission from ${name}`,async()=>{
  const host=receipts();change(host);const review=await pendingReview(host);
  assert.equal(review.status,'ready');assert.equal(review.checks[0].state,'pending');
  assert.notEqual(review.normalized,'missing_host_boundary');
});

test('task receipts prioritize unresolved operations and declare omitted history',()=>{
  const values=Array.from({length:60},(_,i)=>({id:'other-'+i,taskId:'other',state:'proposed'}));
  values.push(...Array.from({length:30},(_,i)=>({id:'completed-'+i,taskId:'t',state:'completed'})),{id:'unknown',taskId:'t',state:'failed',execution:'unknown'});
  const result=taskReceiptRecords({list:()=>values},'t');
  assert.equal(result.processes.length,TASK_RECEIPT_LIMIT);
  assert.equal(result.processes[0].id,'unknown');
  assert.equal(result.inventory.complete,false);assert.equal(result.inventory.omitted.processes,11);
  assert.ok(result.proposals.every(item=>item.taskId==='t'));
});

test('larger review input keeps a whole multi-part document and exposes small-window omissions',()=>{
  const lines=Array.from({length:1000},(_,i)=>`${i+1} `+'value '.repeat(19));
  const read={tool:'read_source',result:{path:'long.md',content:lines.join('\n'),start:1,end:1000,lines:1000,truncated:false}};
  const args={task:{request:'문서 요약',criteria:[],questionHistory:[]},evidence:[read],receipts:receipts(),candidate:'근거를 정리했습니다.'};
  const large=resultReviewInput({...args,model:{contextLength:272000}}).data;
  assert.equal(large.omittedEvidence,0);
  assert.equal(large.evidence.filter(e=>e.tool==='read_source').map(e=>e.result.content).join('\n'),lines.join('\n'));
  assert.equal(reviewInputLimit(model),contextBudget(model).input);
  const small=resultReviewInput({...args,model}).data;
  assert.ok(small.omittedEvidence>0);assert.ok(small.evidence.filter(e=>e.tool==='read_source').length<large.evidence.filter(e=>e.tool==='read_source').length);
});

test('wrong-command recovery preserves the requested outcome, decisions and failed receipt',async()=>{
  const history=[{questionId:'q',text:'어떤 검사를 할까요?',answer:{text:'할인 검사만'}}];
  const task={request:'할인 검사 결과를 알려 줘',criteria:[{id:'no-edit',text:'코드를 변경하지 않는다'}],questionHistory:history};
  const recovery={script:'npm run test:discount',state:'failed',exitCode:1,commandProblem:{kind:'missing_script',detail:'test:discount'}};
  let input;
  await prepareWorkPlan({task,history:[],recovery,model:{contextLength:272000},signal:signal(),capabilities:{workflows:[],skills:[]},invoke:async messages=>{
    input=JSON.parse(messages[1].content);
    return {content:JSON.stringify({intent:{goal:'할인 검사 결과 확인',constraints:['코드를 변경하지 않는다'],outcomes:['실제 할인 검사 결과'],workflowIds:[],skillPaths:[]},steps:[{text:'수정 명령 준비',expected_outcome:'정확한 검사 명령의 승인 요청',status:'in_progress'}]}),calls:[]};
  }});
  assert.deepEqual(input.recovery,recovery);assert.deepEqual(input.answeredQuestions,history);assert.deepEqual(input.criteria,task.criteria);
  const review=resultReviewInput({task,evidence:[],receipts:{...receipts(),wrongCommand:{processId:'p',kind:'missing_script'}},candidate:'실패했습니다.',model:{contextLength:272000}}).data;
  assert.ok(review.requirements.some(r=>r.id==='host:command'));
  assert.equal(commandProblem({state:'failed',output:'npm error Missing script: "test:discount"'}).kind,'missing_script');
  for(const state of ['completed','interrupted','running'])assert.equal(commandProblem({state,output:'npm error Missing script: "test:discount"'}),null);
  assert.equal(commandProblem({state:'failed',output:'not ok 1 - 할인 금액\nexpected: 3000\nactual: 0'}),null);
});

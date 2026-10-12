import test from 'node:test';
import assert from 'node:assert/strict';
import {submitTaskMessage} from '../ui/submit-task-message.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
installAgent(ProjectService);
const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('state did not settle');};

test('Send during automatic command review queues once without re-running the shell',async t=>{
 const {service,root}=await fixture(t);let release,entered=false;
 const gate=new Promise(resolve=>{release=resolve;});t.after(release);
 service.providers={status:()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>{if(!entered){entered=true;await gate;}return {content:'실행 기록을 확인했습니다.',calls:[]};}};
 const task=await service.createTask({request:'명령 실행과 결과 확인'});
 service.store.set('task:'+task.id,{...task,state:'review'});
 await service.processes.start({cwd:root,taskId:task.id,profile:process.platform==='win32'?'powershell':'bash',script:'echo done',setupActionId:'approved',autoDiagnose:true});
 await wait(()=>entered);
 let refreshed=false;
 const args={taskId:task.id,text:'방금 결과를 간단히 설명해 주세요.',inputId:'followup-once',onState:()=>{refreshed=true;}};
 await submitTaskMessage(service.invoke.bind(service),args);
 await submitTaskMessage(service.invoke.bind(service),args);
 assert(refreshed);assert.equal(service.task(task.id).inbox.length,1);
 assert.equal(service.store.list('process:').length,1);
 release();await wait(()=>!service.agent.running&&service.task(task.id).inbox.length===0);
 assert.equal(service.task(task.id).messages.filter(row=>row.inputId==='followup-once').length,1);
 assert.equal(service.store.list('process:').length,1);
});

test('unconfirmed send is never replayed and a real question remains required',async()=>{
 let count=0;await assert.rejects(submitTaskMessage(async()=>{count++;throw Error('network');},{taskId:'t',text:'hello',inputId:'m'}),/network/);assert.equal(count,1);
 const calls=[];await assert.rejects(submitTaskMessage(async method=>{calls.push(method);if(method==='startAgent')throw Error('agent_busy');return {tasks:[{id:'t',state:'waiting_input',question:{id:'q'}}]};},{taskId:'t',text:'hello',inputId:'m'}),/question_pending/);
 assert.deepEqual(calls,['startAgent','state']);
});

test('completed command automatically reads its output and source, repairs the plan, then returns analysis without rerunning',async t=>{
 const {service,root}=await fixture(t,{scriptedPlanning:true});let actor=0,plans=0,sawOutput=false,sawSource=false;
 const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 service.providers={status:()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,tools)=>{
  if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){
   if(++plans===1)return {content:'not a valid plan',calls:[]};
   assert.deepEqual(tools,[]);
   return {content:JSON.stringify({intent:{goal:'실행 결과와 소스 확인',constraints:['명령 재실행 금지'],outcomes:['출력과 소스 대조'],workflowIds:[],skillPaths:[]},steps:[{text:'실행 기록 확인',expected_outcome:'실제 출력과 소스 확인',status:'in_progress'}]}),calls:[]};
  }
  if(++actor===1){const record=service.store.list('process:')[0];assert.equal(record.state,'completed');return call('read_process_output',{processId:record.id});}
  if(actor===2){assert.match(messages.findLast(m=>m.role==='tool').content,/REVIEW_ME/);sawOutput=true;return call('read_source',{path:'app.txt'});}
  if(actor===3){assert.match(messages.findLast(m=>m.role==='tool').content,/first/);sawSource=true;}
  return {content:'출력 REVIEW_ME와 app.txt의 first를 확인했습니다. 명령은 한 번만 실행됐습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'명령 실행 뒤 실제 출력과 app.txt를 대조해 주세요. 재실행 금지'});
 service.store.set('task:'+task.id,{...task,state:'review'});
 await service.processes.start({cwd:root,taskId:task.id,profile:process.platform==='win32'?'powershell':'bash',script:'echo REVIEW_ME',setupActionId:'approved',autoDiagnose:true});
 await wait(()=>sawSource&&!service.agent.running);
 assert(sawOutput);assert.equal(plans,2);assert.equal(service.task(task.id).state,'review');
 assert.equal(service.store.list('process:').length,1);assert.equal(service.store.list('process:')[0].recoveryState,'review');
 assert(service.store.list('operation:').some(row=>row.tool==='read_process_output'&&row.state==='completed'));
 assert(service.task(task.id).messages.some(row=>row.role==='assistant'&&row.content.includes('REVIEW_ME')));
});

test('resume after a failed analysis plan keeps the finished command as its analysis target',async t=>{
 const {service,root}=await fixture(t,{scriptedPlanning:true});let repaired=false,read=false;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){
   if(!repaired)return {content:'{}',calls:[]};
   assert.equal(JSON.parse(messages[1].content).recovery.script,'echo RESUME_ANALYSIS');
   return {content:JSON.stringify({intent:{goal:'실행 후 결과 분석',constraints:['재실행 금지'],outcomes:['출력과 소스 확인'],workflowIds:[],skillPaths:[]},steps:[{text:'결과 확인',expected_outcome:'현재 파일 확인',status:'in_progress'}]}),calls:[]};
  }
  if(!messages.some(message=>message.role==='tool'&&message.content.includes('\"path\":\"app.txt\"')))return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_source',arguments:'{"path":"app.txt"}'}}]};
  read=true;return {content:'같은 실행의 결과를 확인했습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'실행하고 결과 확인'});service.store.set('task:'+task.id,{...task,state:'review'});
 await service.processes.start({cwd:root,taskId:task.id,profile:process.platform==='win32'?'powershell':'bash',script:'echo RESUME_ANALYSIS',setupActionId:'approved',autoDiagnose:true});
 await wait(()=>service.task(task.id).state==='paused'&&!service.agent.running);
 const processId=service.store.list('process:')[0].id;
 assert.equal(service.task(task.id).recovery.processId,processId);assert.equal(read,false);
 repaired=true;await service.resumeAgent({taskId:task.id});await service.agent.promise;
 assert(read);assert.equal(service.task(task.id).state,'review');assert.equal(service.task(task.id).recovery.processId,processId);
 assert.equal(service.store.list('process:').length,1);
});

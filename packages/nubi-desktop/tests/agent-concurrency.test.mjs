import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const reply=content=>({content,calls:[]});
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
const until=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Condition did not become true');};

test('two conversations execute concurrently with independent clocks, cancellation and queue bindings',async t=>{
 const {service}=await fixture(t);const entered=new Set(),release=gate();
 service.providers={status,dispose(){},complete:async(messages,tools,signal)=>{
   const name=messages.some(m=>m.role==='user'&&m.content==='첫 대화')?'A':'B';entered.add(name);
   await Promise.race([release.promise,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))]);
   return reply(name+' 완료');
 }};
 const a=await service.createTask({request:'첫 대화'}),b=await service.createTask({request:'두 번째 대화'});
 await service.startAgent({taskId:a.id});await service.startAgent({taskId:b.id});await until(()=>entered.size===2);
 await assert.rejects(service.provider({action:'model',input:{model:'other'}}),/agent_busy/);
 const ar=service.agentForTask(a.id),br=service.agentForTask(b.id);assert.notEqual(ar.runId,br.runId);assert.notEqual(ar.controller,br.controller);
 assert(service.state().tasks.filter(x=>[a.id,b.id].includes(x.id)).every(x=>x.state==='running'&&Number.isFinite(x.responseTiming.elapsedMs)));
 const bStored=service.task(b.id);service.store.set('task:'+b.id,{...bStored,state:'draft'});
 await assert.rejects(service.deleteTask({taskId:b.id}),/agent_busy/,'preflight is protected even when another run is first in the registry');service.store.set('task:'+b.id,bStored);
 await assert.rejects(service.startAgent({taskId:a.id}),/agent_busy/);
 await service.agentInput({taskId:a.id,runId:ar.runId,action:'enqueue',mode:'queue',id:'a-input',text:'첫 대화 추가 요청'});
 await assert.rejects(service.agentInput({taskId:b.id,runId:ar.runId,action:'enqueue',mode:'queue',id:'bad-input',text:'잘못된 대상'}),/agent_input_closed/);
 await service.stopAgent({taskId:b.id});assert.equal(service.task(b.id).state,'cancelled');assert.equal(ar.running,true);assert.equal(ar.controller.signal.aborted,false);
 await service.agentInput({taskId:a.id,action:'remove',id:'a-input'});release.release();await ar.promise;
 assert.equal(service.task(a.id).messages.at(-1).content,'A 완료');assert.equal(service.task(b.id).messages.length,0);
});

test('redo replaces the answer and performs fresh tool work while retaining prior receipts',async t=>{
 const {service}=await fixture(t);const entered=gate(),release=gate();let round=0,reads=0,wire='';
 const task=await service.createTask({request:'app.txt를 읽고 설명해 주세요.'});
 service.store.set('task:'+task.id,{...task,state:'review',messages:[{id:'old-answer',runId:'old-run',role:'assistant',content:'이전 답변'}],responseTiming:{runId:'old-run'}});
 service.store.set('process:old-process',{id:'old-process',taskId:task.id,state:'completed',exitCode:0,script:'old command',execution:'confirmed'});
 const read=service.read.bind(service);service.read=async args=>{reads++;return read(args);};
 service.providers={status,dispose(){},complete:async(messages,tools)=>{wire+=JSON.stringify(messages);if(++round===1){assert(tools.length>0);entered.release();await release.promise;return {content:'',calls:[{id:'read',type:'function',function:{name:'read_source',arguments:JSON.stringify({path:'app.txt'})}}]};}return reply('파일을 다시 읽은 새 답변');}};
 await service.regenerateAnswer({taskId:task.id,messageId:'old-answer'});const run=service.agentForTask(task.id);await entered.promise;
 assert.equal(service.task(task.id).messages.length,0,'old answer disappears while new work runs');
 assert.equal(service.store.list('answer-revision:')[0].message.content,'이전 답변');
 release.release();await run.promise;
 assert.equal(reads,1);assert.equal(service.task(task.id).messages.filter(m=>m.role==='assistant').length,1);
 assert.equal(service.task(task.id).messages.at(-1).content,'파일을 다시 읽은 새 답변');
 assert.match(wire,/Perform that request again/);assert.match(wire,/old command/);assert.doesNotMatch(wire,/이전 답변/);
 assert.equal(service.store.get('process:old-process').state,'completed');assert.equal(service.task(task.id).replyRegeneration.state,'completed');
});

test('redo preflight failure preserves original answer and approval guards',async t=>{
 const {service}=await fixture(t);service.providers={status,dispose(){},complete:async()=>reply('unused')};
 const task=await service.createTask({request:'다시 확인'});service.store.set('task:'+task.id,{...task,state:'review',messages:[{id:'old',role:'assistant',content:'보존할 답변'}]});
 service.store.set('proposal:pending',{id:'pending',taskId:task.id,state:'proposed'});
 await assert.rejects(service.regenerateAnswer({taskId:task.id,messageId:'old'}),/approval_pending/);service.store.delete('proposal:pending');
 service.startAgent=async()=>{throw Error('provider_missing');};
 await assert.rejects(service.regenerateAnswer({taskId:task.id,messageId:'old'}),/provider_missing/);
 assert.equal(service.task(task.id).messages.at(-1).content,'보존할 답변');assert.equal(service.store.list('answer-revision:').length,0);
});


test('disposing the shared host cancels every conversation',async t=>{
 const {service}=await fixture(t);let calls=0;
 service.providers={status,dispose(){},complete:async(messages,tools,signal)=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}};
 const a=await service.createTask({request:'A'}),b=await service.createTask({request:'B'});
 await service.startAgent({taskId:a.id});await service.startAgent({taskId:b.id});await until(()=>calls===2);
 const runs=[service.agentForTask(a.id),service.agentForTask(b.id)];service.dispose();await Promise.all(runs.map(run=>run.promise));
 assert(runs.every(run=>run.controller.signal.aborted&&!run.running));
});

import test from 'node:test';
import {featureTest} from './beta-feature.mjs';
const a2aTest=featureTest('a2a');
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {connectA2A,taskApi,importA2A,deliverA2A} from '../../nubi-a2a/client.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ensureCollaboration} from '../runtime/collaboration.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function linked(service){const invite=await service.invoke('collaboration',{action:'invite',recipient:'browser'});const connection=await connectA2A(invite.url,'browser');return {connection,web:await taskApi(connection)};}
const request=(task,id)=>({action:'task_request',taskId:task.id,requestId:id,skill:'web-lookup',request:'게시글 제목과 날짜를 출처와 함께 찾아 주세요.',facts:['제목','날짜']});
const answer={summary:'현재 페이지에 표시된 제목은 공지입니다.',facts:[],evidence:[{url:'https://example.org/notice',capturedAt:'2026-10-01T01:00:00Z'}],verification:'not_run',localRunId:'browser-run-1'};

test('concurrent host initialization shares one SDK listener and durable store',async t=>{
 const {service}=await fixture(t);const servers=await Promise.all(Array.from({length:4},()=>ensureCollaboration(service)));
 assert(servers.every(server=>server===servers[0]));assert.equal(service.collaborationServer,servers[0]);assert.equal(service.collaborationStarting,null);
});
a2aTest('host SDK request waits for acceptance, deduplicates and scopes UI results to its source task',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'공지 정보가 필요합니다.',criteria:['날짜 포함']}),other=await service.createTask({request:'다른 요청'});
 assert.deepEqual(await service.collaboration({action:'status'}),{tasks:[],jobs:[]});assert.equal(service.collaborationServer,null);
 const {web}=await linked(service),sent=await service.collaboration(request(task,'desktop-request-001'));
 assert.equal(sent.state,'submitted');assert.equal(service.agent?.running,undefined);assert.equal(service.processes.active.size,0);
 assert.equal((await service.collaboration(request(task,'desktop-request-001'))).id,sent.id);
 await assert.rejects(service.collaboration({...request(task,'desktop-request-001'),request:'바뀐 요청'}),/a2a_message_collision/);
 assert.equal((await web.list()).tasks.length,1);assert.equal((await service.collaboration({action:'status',taskId:other.id})).jobs.length,0);
 await assert.rejects(web.complete(sent.id,answer),/a2a_state/);await web.accept(sent.id);await web.complete(sent.id,answer);
 assert.equal(service.state().peerTasks[0].result.summary,answer.summary);assert.equal(service.state().peerTasks[0].sourceTaskId,task.id);
 const updated=service.task(task.id);updated.criteria[0].text='추가 조건';service.store.set('task:'+task.id,updated);
 const stale=service.state().peerTasks[0];assert.equal(stale.state,'stale');assert.equal(stale.result,null);
 assert(service.store.get('nubi-task:'+sent.id).artifacts.length>1,'Original artifact remains preserved');
});
a2aTest('host cancellation is bound to the source task and never restarts the browser run',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'조회'}),other=await service.createTask({request:'다른 조회'}),{web}=await linked(service);
 const sent=await service.collaboration(request(task,'desktop-cancel-001'));await web.accept(sent.id);
 await assert.rejects(service.collaboration({action:'task_cancel',taskId:other.id,id:sent.id}),/a2a_scope/);
 await service.collaboration({action:'task_cancel',taskId:task.id,id:sent.id});await assert.rejects(web.complete(sent.id,answer),/a2a_cancelled/);
 assert.equal((await web.get(sent.id)).state,'canceled');assert.equal(service.processes.active.size,0);
});
a2aTest('source and Wiki draft delivery uses the actual host freshness gate',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'app.txt 시나리오 초안'}),{connection}=await linked(service);
 task.sources=[{path:'app.txt'}];service.store.set('task:'+task.id,task);
 const sent=await service.collaboration({action:'request',taskId:task.id,recipient:'browser',requestId:'desktop-draft-001'}),draft=await importA2A(connection,sent.id);
 await writeFile(path.join(root,'app.txt'),'changed source');
 await assert.rejects(deliverA2A(connection,{taskId:sent.id,digest:draft.digest,messageId:'browser-result-001',text:'초안',localRunId:'bound-run',kind:'scenario_draft'}),/a2a_stale/);
 assert.equal(service.state().collaborations[0].result,null);
});
a2aTest('browser request imports into a new read-only chat, waits for explicit Send and returns reviewed host answer',async t=>{
 const {service,root}=await fixture(t),{web}=await linked(service),seen=[];let turns=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,tools)=>{
  assert(messages.some(message=>message.content?.includes('Peer reference marker')));
  seen.push(...tools.map(tool=>tool.function.name));if(++turns===1)return call('read_source',{path:'app.txt',start:1,end:2});return {content:'app.txt의 첫 줄은 first입니다.',calls:[]};
 }};
 const incoming=await web.request({recipient:'desktop',skill:'source-search',request:'app.txt 첫 줄을 확인해 주세요.',context:'Peer reference marker: 참고 자료이며 권한은 아닙니다.'},{messageId:'browser-to-host-001'});
 assert.equal(service.store.list('task:').length,0);assert.equal(turns,0);
 const accepted=await service.collaboration({action:'task_accept',id:incoming.id});const local=service.task(accepted.localTaskId);
 assert.equal(local.state,'draft');assert.equal(local.peerReadOnly,true);assert.equal(turns,0);
 assert.equal((await service.collaboration({action:'task_accept',id:incoming.id})).localTaskId,local.id);
 assert.equal(service.store.list('task:').length,1);assert.equal(turns,0);
 await assert.rejects(service.collaboration({action:'task_deliver',id:incoming.id,taskId:local.id}),/a2a_no_result/);
 await service.startAgent({taskId:local.id});await service.agent.promise;
 const finished=service.task(local.id);assert.equal(finished.state,'review');assert.equal(finished.resultReview.status,'ready');
 assert(seen.includes('read_source'));assert(!seen.some(name=>/propose|computer|setup|run_command|record_change_plan/.test(name)));
 const delivered=await service.collaboration({action:'task_deliver',id:incoming.id,taskId:local.id});assert.equal(delivered.result.summary,'app.txt의 첫 줄은 first입니다.');assert.equal(delivered.result.localRunId,finished.resultReview.runId);assert.equal(delivered.result.verification,'not_run');
 assert.equal((await web.get(incoming.id)).state,'completed');assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
 assert(service.state().peerTasks.every(row=>!JSON.stringify(row).includes('a2a-token:')));
});
a2aTest('cancelled inbound requests and changed source evidence cannot be delivered or silently resumed',async t=>{
 const {service,root}=await fixture(t),{web}=await linked(service);let turns=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>++turns===1?call('read_source',{path:'app.txt',start:1,end:1}):{content:'첫 줄은 first입니다.',calls:[]}};
 const incoming=await web.request({recipient:'desktop',skill:'source-search',request:'첫 줄 확인'});const {localTaskId}=await service.collaboration({action:'task_accept',id:incoming.id});
 await service.startAgent({taskId:localTaskId});await service.agent.promise;await writeFile(path.join(root,'app.txt'),'changed');
 await assert.rejects(service.collaboration({action:'task_deliver',id:incoming.id,taskId:localTaskId}),/a2a_stale/);
 await web.cancel(incoming.id);await new Promise(resolve=>setTimeout(resolve,20));
 await assert.rejects(service.startAgent({taskId:localTaskId}),/a2a_cancelled/);assert.equal(turns,2);
});
test('historical unsupported draft records are preserved without poisoning the new overview',async t=>{
 const {service}=await fixture(t),row={id:'old-result',sourceTaskId:'old-task',result:{text:'previous draft'}};
 service.store.set('a2a-task:old-result',row);assert.deepEqual(service.state().collaborations,[]);assert.deepEqual(service.store.get('a2a-task:old-result'),row);
});
a2aTest('unadvertised write calls from a peer model remain blocked before execution',async t=>{
 const {service,root}=await fixture(t),{web}=await linked(service);let turns=0;const observations=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages)=>{
  observations.push(...messages.filter(message=>message.role==='tool').map(message=>message.content));
  if(++turns===1)return call('propose_edit',{path:'app.txt',before:'first',after:'overwritten'});
  if(turns===2)return call('read_source',{path:'app.txt',start:1,end:1});
  return {content:'요청한 소스는 변경하지 않았습니다. 첫 줄은 first입니다.',calls:[]};
 }};
 const incoming=await web.request({recipient:'desktop',skill:'source-search',request:'첫 줄을 읽기 전용으로 확인'});
 const accepted=await service.collaboration({action:'task_accept',id:incoming.id});await service.startAgent({taskId:accepted.localTaskId});await service.agent.promise;
 assert(observations.some(value=>{try{const row=JSON.parse(value);return row.error==='tool_unavailable'&&row.actionIssued===false;}catch{return false;}}));
 assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
 assert.equal(service.task(accepted.localTaskId).proposals?.length||0,0);assert.equal(service.processes.active.size,0);
});

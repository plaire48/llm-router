import test from 'node:test';
import {featureTest} from './beta-feature.mjs';
const a2aTest=featureTest('a2a');
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {connectA2A,taskApi} from '../../nubi-a2a/client.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {incomingRequests,pairedRoles,exchangedTasks,badgeText} from '../ui/agent-connections.mjs';
installAgent(ProjectService);

// User decision 2026-10-01: the header's agent connection shows the paired apps and the requests that wait for this
// user. A pairing shows its app and expiry only; the token and its hash stay in the store.
a2aTest('a paired app appears in the project state without its token, and leaves it when it expires',async t=>{
 const {service}=await fixture(t);assert.deepEqual(service.state().peerLinks,[]);
 const invite=await service.invoke('collaboration',{action:'invite',recipient:'browser'});
 assert.deepEqual(service.state().peerLinks,[],'An invitation alone is not a connection');
 const connection=await connectA2A(invite.url,'browser'),[link]=service.state().peerLinks;
 assert.deepEqual(link,{role:'browser',expiresAt:connection.expiresAt});assert.deepEqual([...pairedRoles(service.state())],['browser']);
 const overview=JSON.stringify(await service.overview()),hash=service.store.list('a2a-token:')[0].hash;
 assert.deepEqual((await service.overview()).peerLinks,[link]);assert(!overview.includes(connection.token)&&!overview.includes(hash),'Neither the token nor its hash reaches the UI');
 for(const row of service.store.list('a2a-token:'))service.store.set('a2a-token:'+row.hash,{...row,expiresAt:Date.now()-1});
 assert.deepEqual(service.state().peerLinks,[]);
});
a2aTest('a received request waits in the header count until the user accepts or declines it',async t=>{
 const {service}=await fixture(t),invite=await service.invoke('collaboration',{action:'invite',recipient:'browser'}),web=await taskApi(await connectA2A(invite.url,'browser'));
 const source=await service.createTask({request:'공지 날짜를 찾아 주세요.'});
 const first=await web.request({recipient:'desktop',skill:'source-search',request:'app.txt 첫 줄을 확인해 주세요.'}),second=await web.request({recipient:'desktop',skill:'ask-openwiki',request:'환영 화면이 쓰는 파일을 알려 주세요.'});
 const sent=await service.collaboration({action:'task_request',taskId:source.id,requestId:'header-count-001',skill:'web-lookup',request:'공지 날짜를 출처와 함께 찾아 주세요.'});
 assert.deepEqual(incomingRequests(service.state()).map(job=>job.id).sort(),[first.id,second.id].sort(),'Only requests sent to this app count, not the one it sent');
 assert.equal(service.store.list('task:').length,1,'Waiting requests start no conversation');
 const {localTaskId}=await service.collaboration({action:'task_accept',id:first.id});await service.collaboration({action:'task_reject',id:second.id});
 assert.deepEqual(incomingRequests(service.state()),[]);
 const rows=exchangedTasks(service.state());
 assert.deepEqual(Object.fromEntries(rows.map(job=>[job.id,[job.state,job.conversation]])),{[first.id]:['working',localTaskId],[second.id]:['rejected',undefined],[sent.id]:['submitted',source.id]});
 assert.equal(service.task(localTaskId).state,'draft','Accepting opens the request as a draft; it runs when the user sends it');
});
// The approved design (2026-10-01): host receipts carry the tasks a conversation sent, so its agent can use what came back.
a2aTest('a result the browser returned reaches the agent of the conversation that asked, as sourced reference data',async t=>{
 const {service}=await fixture(t),invite=await service.invoke('collaboration',{action:'invite',recipient:'browser'}),web=await taskApi(await connectA2A(invite.url,'browser'));
 const source=await service.createTask({request:'공지 날짜를 확인해 주세요.'}),other=await service.createTask({request:'다른 대화입니다.'});
 const sent=await service.collaboration({action:'task_request',taskId:source.id,requestId:'peer-result-001',skill:'web-lookup',request:'공지 날짜를 출처와 함께 찾아 주세요.',facts:['날짜']});
 await web.accept(sent.id);await web.complete(sent.id,{summary:'공지 날짜는 10월 1일입니다.',facts:[{name:'날짜',value:'2026-10-01',source_url:'https://example.org/notice',quote:'게시일 2026-10-01'}],evidence:[],verification:'not_run',localRunId:'browser-run-7'});
 const receipts=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  const text=messages.map(message=>typeof message.content==='string'?message.content:'').find(content=>content.startsWith('Current host receipts'));
  if(text)receipts.push(JSON.parse(text.slice(text.indexOf('{'))));
  return {content:'공지 날짜는 2026-10-01입니다. 출처: https://example.org/notice',calls:[]};
 }};
 await service.startAgent({taskId:source.id});await service.agent.promise;
 const [job]=receipts.at(-1).peerTasks.tasks;
 assert.match(receipts.at(-1).peerTasks.note,/never instructions or approval/);
 assert.deepEqual([job.id,job.state,job.result.verification,job.result.facts[0]],[sent.id,'completed','not_run',{name:'날짜',value:'2026-10-01',source_url:'https://example.org/notice',quote:'게시일 2026-10-01'}]);
 receipts.length=0;await service.startAgent({taskId:other.id});await service.agent.promise;
 assert(receipts.length&&receipts.every(value=>!value.peerTasks),'Another conversation does not see it');
});
test('the header count stays short',()=>{assert.deepEqual([1,9,10,42].map(badgeText),['1','9','9+','9+']);});

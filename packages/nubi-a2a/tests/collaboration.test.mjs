import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollaborationServer} from '../server.mjs';
import {connectA2A,a2aClient,listA2A,importA2A,deliverA2A} from '../client.mjs';
import {createReceiver} from '../receiver.mjs';
import {CONTRACT,invitation} from '../contract.mjs';
const packet=(recipient='browser')=>({contract:CONTRACT,sourceTaskId:'source-test',digest:'sha256:'+'a'.repeat(64),recipient,request:'고객 검색을 개선한다',criteria:[{id:'AC-1',text:'빈 검색 결과를 안내한다'}],sources:[],wiki:[],references:[]});
const records=()=>{const map=new Map();return {get:k=>map.get(k),set:(k,v)=>map.set(k,structuredClone(v)),list:p=>[...map].filter(([k])=>k.startsWith(p)).map(([,v])=>structuredClone(v))};};
async function setup(t,validateContext){const store=records(),server=await createCollaborationServer({records:store,validateContext});t.after(()=>server.close());return {server,store,connection:await connectA2A(server.invite('browser').url,'browser')};}
const result=t=>({taskId:t.id,digest:t.digest,messageId:'result-message-123',text:'AC-1: 검색 결과가 없으면 안내 문구를 확인한다.',localRunId:'local-run',kind:'scenario_draft'});
test('official SDK round trip preserves criteria and draft verification',async t=>{
 const {server,connection}=await setup(t),task=await server.submit(packet(),'request-message-123');assert.equal(task.state,6);
 assert.equal((await listA2A(connection)).tasks[0].id,task.id);
 assert.match((await importA2A(connection,task.id)).text,/AC-1/);
 const completed=await deliverA2A(connection,result(task));assert.equal(completed.state,3);assert.equal(completed.result.verification,'not_run');
 assert.deepEqual(await deliverA2A(connection,result(task)),completed);
 await assert.rejects(deliverA2A(connection,{...result(task),text:'다른 결과'}),/collision/);
});
test('single-use invitation, recipient isolation, and foreign cancellation',async t=>{
 const {server,connection}=await setup(t),invite=server.invite('office').url;
 assert.throws(()=>invitation(invite,'browser'),/invitation/);
 const office=await connectA2A(invite,'office');await assert.rejects(connectA2A(invite,'office'),/expired/);
 const browserTask=await server.submit(packet()),officeTask=await server.submit(packet('office'));
 assert.deepEqual((await listA2A(connection)).tasks.map(t=>t.id),[browserTask.id]);
 assert.deepEqual((await listA2A(office)).tasks.map(t=>t.id),[officeTask.id]);
 const client=await a2aClient(connection);await assert.rejects(client.getTask({id:officeTask.id}));await assert.rejects(client.cancelTask({id:officeTask.id}));
 assert.equal((await server.cancel(browserTask.id)).state,5);
});
test('stale source cannot complete a task',async t=>{
 const {server,connection}=await setup(t,async()=>false),task=await server.submit(packet());
 await assert.rejects(deliverA2A(connection,result(task)),/a2a_stale/);const current=(await listA2A(connection)).tasks[0];assert.equal(current.state,6);assert.equal(current.result,null);
});
test('duplicate request and restarted server reconcile persisted tasks',async t=>{
 const store=records(),server=await createCollaborationServer({records:store});
 const first=await server.submit(packet(),'duplicate-message');assert.equal((await server.submit(packet(),'duplicate-message')).id,first.id);
 await assert.rejects(server.submit({...packet(),request:'different'},'duplicate-message'),/collision/);await server.close();
 const next=await createCollaborationServer({records:store});t.after(()=>next.close());const connection=await connectA2A(next.invite('browser').url,'browser');
 assert.equal((await listA2A(connection)).tasks[0].id,first.id);assert.equal((await next.submit(packet(),'duplicate-message')).id,first.id);
});
test('auth, hostile origin and remote invitation are refused',async t=>{
 const {server}=await setup(t);
 assert.equal((await fetch(server.origin+'/.well-known/agent-card.json')).status,401);
 assert.equal((await fetch(server.origin+'/pair',{method:'POST',headers:{Origin:'https://hostile.invalid'},body:'{}'})).status,403);
 assert.throws(()=>invitation('https://remote.invalid/#nubi-a2a=x&agent=browser','browser'),/address/);
});
test('receiver binds actual host run, preserves drafts, and restores after worker suspension',async t=>{
 const {server}=await setup(t);let local={},draft='',busy=false,answer=null;
 const options={role:'browser',load:async()=>local,save:async value=>{local=structuredClone(value);},busy:async()=>busy,conversation:async()=>({id:'chat-1',provider:'aipro',draft}),result:async b=>answer?.id===b.runId?answer:null};
 let receiver=createReceiver(options);await receiver.dispatch({action:'connect',url:server.invite('browser').url});const task=await server.submit(packet());
 draft='사용자 초안';await assert.rejects(receiver.dispatch({action:'import',id:task.id}),/draft_exists/);draft='';
 const imported=await receiver.dispatch({action:'import',id:task.id});assert.match(imported.draft,/AC-1/);
 await assert.rejects(receiver.dispatch({action:'result',id:task.id}),/no_result/);
 await receiver.bindRun({text:'unrelated',runId:'wrong',conversationId:'chat-1',provider:'aipro'});assert.equal(local.binding.runId,undefined);
 await receiver.bindRun({text:imported.draft,runId:'right',conversationId:'chat-1',provider:'aipro'});
 receiver=createReceiver(options);answer={id:'right',text:'시나리오 초안',state:'done'};
 assert.equal((await receiver.dispatch({action:'status'})).active.canSend,true);
 await receiver.dispatch({action:'connect',url:server.invite('browser').url});assert.equal(local.binding.runId,'right','Re-pairing the same task preserves a completed host run');
 busy=true;await assert.rejects(receiver.dispatch({action:'result',id:task.id}),/busy/);busy=false;
 await receiver.dispatch({action:'result',id:task.id});assert.equal(local.binding,undefined);assert.equal((await receiver.dispatch()).tasks[0].result.localRunId,'right');
});

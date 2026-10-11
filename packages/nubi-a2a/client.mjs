import {ClientFactory,DefaultAgentCardResolver,JsonRpcTransportFactory} from '@a2a-js/sdk/client';
import {Message,TaskState,ListTasksRequest} from '@a2a-js/sdk';
import {CONTRACT,invitation,fail,taskSummary,draftFromTask,taskData} from './contract.mjs';
import {TASK_CONTRACT,TASK_PORTS,TASK_STATES,jobSummary} from './tasks.mjs';

const PATHS=['/.well-known/agent-card.json','/a2a','/tasks/.well-known/agent-card.json','/tasks/a2a'];
const base64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

// Authentication stays with the host. The model sees artifacts, never this client.
export async function connectA2A(value,role,fetchImpl=fetch){
  const invite=invitation(value,role);
  let response;try{response=await fetchImpl(invite.origin+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:invite.code,role}),redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)});}catch{fail('a2a_uncertain');}
  if(!response.ok)fail('a2a_expired');const paired=await response.json();
  if(!Number.isSafeInteger(paired.expiresAt)||paired.expiresAt<=Date.now()||!/^[A-Za-z0-9_-]{32,100}$/.test(paired.token||''))fail('a2a_expired');
  return {origin:invite.origin,token:paired.token,role,expiresAt:paired.expiresAt};
}
export async function a2aClient(connection,fetchImpl=fetch,base=''){
  if(!connection||!Number.isSafeInteger(connection.expiresAt)||connection.expiresAt<=Date.now())fail('a2a_expired');
  const authenticated=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url||String(input));
    if(url.origin!==connection.origin||!PATHS.includes(url.pathname)||url.search||url.hash)fail('a2a_address');
    let response;try{response=await fetchImpl(url.href,{...init,credentials:'omit',redirect:'error',headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:'Bearer '+connection.token},signal:AbortSignal.timeout(15000)});}catch{fail(init.method==='POST'?'a2a_uncertain':'a2a_unavailable');}
    if(response.status===401||response.status===403)fail('a2a_expired');
    if(Number(response.headers.get('content-length')||0)>2*1024*1024)fail('a2a_context_large');
    const reader=response.body?.getReader();if(!reader)return response;
    let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();fail('a2a_context_large');}chunks.push(value);}
    return new Response(new Blob(chunks),{status:response.status,headers:response.headers});
  };
  const factory=new ClientFactory({transports:[new JsonRpcTransportFactory({fetchImpl:authenticated})],cardResolver:new DefaultAgentCardResolver({fetchImpl:authenticated})});
  return factory.createFromUrl(connection.origin+base);
}
// nubi-task-v1 for either side. Pass a stored messageId when retrying a change:
// the hub then answers with its first result instead of applying it again.
export async function taskApi(connection,fetchImpl=fetch){
  const client=await a2aClient(connection,fetchImpl,'/tasks/').catch(known);
  const send=async(data,{taskId,contextId,messageId=crypto.randomUUID()}={},expected)=>{
    const task=jobSummary(await client.sendMessage({message:Message.fromJSON({messageId,taskId,contextId,role:'ROLE_USER',parts:[{data:{contract:TASK_CONTRACT,...data}}]}),configuration:{historyLength:0}}).catch(known));
    if(expected&&task.state!==expected)fail(task.state==='canceled'?'a2a_cancelled':'a2a_uncertain');
    return task;
  };
  return {
    request:(task,options)=>send({action:'task',task},options,'submitted'),
    accept:(taskId,options)=>send({action:'accept'},{...options,taskId},'working'),
    progress:(taskId,text,options)=>send({action:'progress',text},{...options,taskId},'working'),
    complete:(taskId,result,options)=>send({action:'complete',result},{...options,taskId},'completed'),
    fail:(taskId,reason,options)=>send({action:'fail',reason},{...options,taskId},'failed'),
    reject:(taskId,reason,options)=>send({action:'reject',reason},{...options,taskId},'rejected'),
    async cancel(taskId){return jobSummary(await client.cancelTask({id:taskId}).catch(known));},
    async get(taskId){return jobSummary(await client.getTask({id:taskId,historyLength:0}).catch(known));},
    async list({state,pageSize=25,pageToken}={}){
      const status=Object.values(TASK_STATES).includes(state)?'TASK_STATE_'+state.toUpperCase():undefined;
      const result=await client.listTasks(ListTasksRequest.fromJSON({pageSize,pageToken,status,includeArtifacts:true,historyLength:0})).catch(known);
      return {tasks:result.tasks.map(jobSummary),nextPageToken:result.nextPageToken||null};
    }
  };
}
function known(error){const code=String(error?.message||'').match(/\ba2a_[a-z_]+\b/)?.[0];throw code?new Error(code):error;}
// Finds the hub after a desktop restart moved it to another port. Only a hub that
// knows this connection's token hash can answer the port-bound proof.
export async function locateHub(connection,{ports=TASK_PORTS,fetchImpl=fetch}={}){
  if(!connection?.token||!connection.origin)fail('a2a_expired');
  const encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(connection.token)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  for(const origin of new Set([connection.origin,...ports.map(port=>'http://127.0.0.1:'+port)])){
    const nonce=base64url(crypto.getRandomValues(new Uint8Array(24))),port=new URL(origin).port;
    try{
      const response=await fetchImpl(origin+'/hello',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:connection.role,nonce}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(2000)});
      const answer=response.ok?await response.json():null;
      if(answer?.proof===base64url(await crypto.subtle.sign('HMAC',key,encoder.encode(`${nonce}:${port}`))))return {...connection,origin};
    }catch{/* Not this port. */}
  }
  fail('a2a_unavailable');
}
export async function listA2A(connection){const client=await a2aClient(connection);const result=await client.listTasks(ListTasksRequest.fromJSON({pageSize:25,includeArtifacts:true,historyLength:0}));return {tasks:result.tasks.map(taskSummary),hasMore:!!result.nextPageToken};}
export async function importA2A(connection,id){const client=await a2aClient(connection),task=await client.getTask({id,historyLength:0});if(task.status?.state!==TaskState.TASK_STATE_INPUT_REQUIRED)fail('a2a_no_result');return draftFromTask(task);}
export async function deliverA2A(connection,{taskId,digest,messageId,text,localRunId,kind}){
  if(typeof text!=='string'||!text.trim()||text.length>24000||!['scenario_draft','document_draft'].includes(kind))fail('a2a_no_result');
  const client=await a2aClient(connection);
  // A retry checks GetTask first; it never starts a browser or Office run again.
  const current=await client.getTask({id:taskId,historyLength:0});
  if(current.status?.state===TaskState.TASK_STATE_CANCELED)fail('a2a_cancelled');
  if(current.status?.state===TaskState.TASK_STATE_COMPLETED){const prior=taskData(current,'result');if(prior?.contextDigest!==digest||prior.localRunId!==localRunId||prior.kind!==kind||prior.text!==text)fail('a2a_message_collision');return taskSummary(current);}
  const result=await client.sendMessage({message:Message.fromJSON({messageId,taskId,role:'ROLE_USER',parts:[{data:{contract:CONTRACT,action:'result',digest,result:{kind,text,localRunId,verification:'not_run'}}}]}),configuration:{historyLength:0}});
  if(result.status?.state!==TaskState.TASK_STATE_COMPLETED){const code=result.status?.message?.parts?.find(p=>p.content?.$case==='text')?.content.value;fail(code==='a2a_stale'?code:'a2a_uncertain');}
  return taskSummary(result);
}
export async function disconnectA2A(connection){if(connection)await fetch(connection.origin+'/disconnect',{method:'POST',headers:{Authorization:'Bearer '+connection.token},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000)}).catch(()=>{});}

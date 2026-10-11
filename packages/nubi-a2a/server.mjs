import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {AgentCard,Task,Message,TaskState} from '@a2a-js/sdk';
import {DefaultRequestHandler,JsonRpcTransportHandler,ServerCallContext,InMemoryTaskStore,AgentEvent} from '@a2a-js/sdk/server';
import {a2aClient,taskApi} from './client.mjs';
import {CONTRACT,ROLE_NAMES,checkPacket,taskData,taskSummary,fail} from './contract.mjs';
import {TASK_SKILLS,jobSummary} from './tasks.mjs';
import {createTaskAgent} from './task-agent.mjs';

const now=()=>new Date().toISOString(),secret=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TOKEN='a2a-token:',tokenHash=token=>createHash('sha256').update(token).digest('hex');
const callContext=role=>new ServerCallContext({requestedVersion:'1.0',user:{isAuthenticated:true,userName:role}});
const contextArtifact=packet=>({artifactId:randomUUID(),name:'context',parts:[{data:packet}]});

// Use the SDK's task filtering/cursor semantics and mirror its state in the
// owning desktop store. Each recipient has a separate view, including counts.
function durableStore(records){
  const views=Object.fromEntries(['desktop',...Object.keys(ROLE_NAMES)].map(role=>[role,new InMemoryTaskStore(()=> 'local-project')]));
  const viewContext=callContext('local-project');
  const distribute=async task=>{await views.desktop.save(task,viewContext);const role=task.metadata?.recipient;if(ROLE_NAMES[role])await views[role].save(task,viewContext);};
  const ready=Promise.all(records.list('a2a-task:').map(row=>distribute(Task.fromJSON(row))));
  return {async save(task,context){await ready;const role=context.user?.userName,old=records.get('a2a-task:'+task.id);if(role!=='desktop'&&(!old||old.metadata?.recipient!==role||task.metadata?.recipient!==role||old.metadata?.sourceTaskId!==task.metadata?.sourceTaskId))fail('a2a_scope');records.set('a2a-task:'+task.id,Task.toJSON(task));await distribute(task);},async load(id,context){await ready;return views[context.user?.userName]?.load(id,viewContext);},async list(params,context){await ready;const view=views[context.user?.userName];if(!view)fail('a2a_scope');return view.list(params,viewContext);}};
}

// ports: preferred loopback ports tried in order before a random one.
// onTask: called after each nubi-task-v1 change with {event, task}.
export async function createCollaborationServer({records,validateContext=async()=>true,ports=[],onTask,tokenTtlMs=8*60*60*1000}){
  const store=durableStore(records),tokens=new Map(),invitations=new Map();let origin,card,taskAgent,closed=false;
  // Only token hashes are stored, so a paired app keeps working after a desktop restart.
  for(const row of records.list(TOKEN))if(/^[a-f0-9]{64}$/.test(row?.hash||'')&&ROLE_NAMES[row.role]&&row.expiresAt>Date.now())tokens.set(row.hash,{role:row.role,expiresAt:row.expiresAt});
  const revoke=key=>{tokens.delete(key);if(records.delete)records.delete(TOKEN+key);else records.set(TOKEN+key,{hash:key,role:'',expiresAt:0});};
  const executor={
    async execute(ctx,bus){
      const role=ctx.context.user?.userName,input=ctx.userMessage.parts.find(p=>p.content?.$case==='data')?.content.value;
      let task=ctx.task;
      if(input?.contract!==CONTRACT)throw new Error('a2a_context_invalid');
      if(input.action==='request'){
        if(role!=='desktop'||ctx.task)fail('a2a_scope');
        const packet=checkPacket(input.packet);
        task=Task.fromJSON({id:ctx.taskId,contextId:ctx.contextId,status:{state:'TASK_STATE_INPUT_REQUIRED',timestamp:now(),message:{messageId:randomUUID(),role:'ROLE_AGENT',parts:[{text:'수신 앱에서 요청을 검토한 뒤 결과를 보내 주세요.'}]}},metadata:{recipient:packet.recipient,sourceTaskId:packet.sourceTaskId,requestMessageId:ctx.userMessage.messageId},artifacts:[contextArtifact(packet)]});
      }else if(input.action==='result'){
        if(!task||role!==task.metadata?.recipient)fail('a2a_scope');
        const packet=checkPacket(taskData(task));
        const valid=input.digest===packet.digest&&await validateContext(packet);
        if(!valid){task={...task,status:{state:TaskState.TASK_STATE_INPUT_REQUIRED,timestamp:now(),message:Message.fromJSON({messageId:randomUUID(),role:'ROLE_AGENT',parts:[{text:'a2a_stale'}]})}};}
        else{
          const result=input.result,kind=role==='browser'?'scenario_draft':'document_draft';
          if(result?.kind!==kind||result.verification!=='not_run'||typeof result.text!=='string'||!result.text.trim()||result.text.length>24000||typeof result.localRunId!=='string'||result.localRunId.length>200)fail('a2a_context_invalid');
          const artifact={artifactId:ctx.userMessage.messageId,name:'result',parts:[{data:{contract:CONTRACT,kind,text:result.text,localRunId:result.localRunId,from:role,receivedAt:now(),verification:'not_run',contextDigest:packet.digest}}]};
          task=Task.fromJSON({...Task.toJSON(task),status:{state:'TASK_STATE_COMPLETED',timestamp:now()},artifacts:[...Task.toJSON(task).artifacts,artifact]});
        }
      }else fail('a2a_scope');
      bus.publish(AgentEvent.task(task));
      bus.publish(AgentEvent.statusUpdate({taskId:task.id,contextId:task.contextId,status:task.status}));
      bus.finished();
    },
    async cancelTask(id,bus){const task=await store.load(id,callContext('desktop'));if(!task)fail('a2a_scope');bus.publish(AgentEvent.statusUpdate({taskId:id,contextId:task.contextId,status:{state:TaskState.TASK_STATE_CANCELED,timestamp:now()}}));bus.finished();}
  };
  let handler,transport,serial=Promise.resolve();
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  async function body(req,limit=100000){let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)fail('a2a_context_large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  function authenticate(req){const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1],key=token&&tokenHash(token),entry=key&&tokens.get(key);if(!entry||entry.expiresAt<=Date.now())return null;return {...entry,key};}
  async function rpc(request,role){
    // The SDK does not promise idempotent SendMessage. Preserve our receipt
    // before dispatch and reconcile durable artifacts after an uncertain reply.
    if(request.method==='SendMessage'&&!/^[a-zA-Z0-9_-]{8,100}$/.test(request.params?.message?.messageId||''))return {jsonrpc:'2.0',id:request.id,error:{code:-32602,message:'a2a_context_invalid'}};
    const message=request.params?.message,key=request.method==='SendMessage'&&message?.messageId?'a2a-receipt:'+role+':'+message.messageId:null;
    const fingerprint=key?digest(request.params):null,previous=key?records.get(key):null;
    if(previous){
      if(previous.fingerprint!==fingerprint)return {jsonrpc:'2.0',id:request.id,error:{code:-32602,message:'a2a_message_collision'}};
      if(previous.response)return {...previous.response,id:request.id};
      const found=records.list('a2a-task:').find(t=>(role==='desktop'||t.metadata?.recipient===role)&&(t.metadata?.requestMessageId===message.messageId||t.artifacts?.some(a=>a.artifactId===message.messageId)));
      if(found)return {jsonrpc:'2.0',id:request.id,result:{task:found}};
      return {jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'a2a_uncertain'}};
    }
    if(key)records.set(key,{fingerprint});
    const response=await transport.handle(request,callContext(role));
    if(response?.[Symbol.asyncIterator])fail('a2a_scope');
    if(key)records.set(key,{fingerprint,response});return response;
  }
  const server=createServer(async(req,res)=>{
    try{
      const allowedHost=origin&&[new URL(origin).host,new URL(origin).host.replace('127.0.0.1','localhost')].includes(req.headers.host);
      const requestOrigin=req.headers.origin,allowedOrigin=!requestOrigin||requestOrigin===origin||/^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin);
      if(!allowedHost||!allowedOrigin)return json(res,403,{error:'a2a_scope'});
      if(requestOrigin){res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, A2A-Version, A2A-Extensions'}).end();return;}
      if(req.method==='POST'&&req.url==='/pair'){
        const input=await body(req,1000),invite=invitations.get(input.code);invitations.delete(input.code);
        if(!invite||invite.role!==input.role||invite.expiresAt<=Date.now())return json(res,401,{error:'a2a_expired'});
        const token=secret(),key=tokenHash(token),expiresAt=Date.now()+tokenTtlMs;
        for(const [old,entry] of tokens)if(entry.expiresAt<=Date.now()||entry.role===invite.role)revoke(old);
        tokens.set(key,{role:invite.role,expiresAt});records.set(TOKEN+key,{hash:key,role:invite.role,expiresAt});return json(res,200,{token,expiresAt});
      }
      // A paired app finds a moved hub by asking it to prove it knows the token.
      // The proof covers the answering port, so another local listener cannot relay it.
      if(req.method==='POST'&&req.url==='/hello'){
        const input=await body(req,1000),nonce=/^[A-Za-z0-9_-]{16,100}$/.test(input?.nonce||'')?input.nonce:null;
        const key=nonce&&ROLE_NAMES[input.role]&&[...tokens].find(([,entry])=>entry.role===input.role&&entry.expiresAt>Date.now())?.[0];
        if(!key)return json(res,404,{error:'a2a_expired'});
        return json(res,200,{proof:createHmac('sha256',Buffer.from(key,'hex')).update(`${nonce}:${server.address().port}`).digest('base64url')});
      }
      const auth=authenticate(req);if(!auth)return json(res,401,{error:'a2a_expired'});
      if(req.method==='POST'&&req.url==='/disconnect'){revoke(auth.key);return json(res,200,{disconnected:true});}
      if(req.method==='GET'&&req.url==='/.well-known/agent-card.json')return json(res,200,AgentCard.toJSON(card));
      if(req.method==='GET'&&req.url==='/tasks/.well-known/agent-card.json')return TASK_SKILLS[auth.role]?json(res,200,AgentCard.toJSON(taskAgent.card)):json(res,403,{error:'a2a_scope'});
      if(req.method!=='POST'||!['/a2a','/tasks/a2a'].includes(req.url))return json(res,404,{error:'a2a_scope'});
      let request;
      try {request=await body(req);} catch(error) {
        if(error instanceof SyntaxError)return json(res,200,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON payload'}});
        throw error;
      }
      const call=req.url==='/a2a'?rpc:taskAgent.rpc;
      const protocolError=(code,message)=>json(res,200,{jsonrpc:'2.0',id:request?.id??null,error:{code,message}});
      if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string')return protocolError(-32600,'Invalid request');
      if(req.headers['a2a-version']!=='1.0')return protocolError(-32009,'A2A version not supported');
      if(!['SendMessage','GetTask','ListTasks','CancelTask'].includes(request.method))return protocolError(-32601,'Method not found');
      if(request.params?.tenant)return protocolError(-32602,'a2a_scope');
      let response;
      if(['SendMessage','CancelTask'].includes(request.method)){
        const operation=serial.catch(()=>{}).then(()=>{if(closed)fail('a2a_expired');return call(request,auth.role);});serial=operation;response=await operation;
      }else response=await call(request,auth.role);
      return json(res,200,response);
    }catch(error){if(!res.headersSent)json(res,400,{error:/^a2a_[a-z_]+$/.test(error.message)?error.message:'a2a_request_invalid'});else res.end();}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  for(const port of [...ports,0]){
    try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});break;}
    catch(error){if(error.code!=='EADDRINUSE'||port===0)throw error;server.close();}
  }
  origin='http://127.0.0.1:'+server.address().port;
  taskAgent=createTaskAgent({records,origin,onTask});
  card=AgentCard.fromJSON({name:'Nubi local collaboration',description:'Exchange scoped project evidence and reviewed draft results with Nubi browser and Office. Completion means artifact delivery, not a passed application test.',version:'0.1.0',supportedInterfaces:[{url:origin+'/a2a',protocolBinding:'JSONRPC',protocolVersion:'1.0'}],capabilities:{streaming:false,pushNotifications:false},securitySchemes:{bearer:{httpAuthSecurityScheme:{scheme:'bearer'}}},securityRequirements:[{schemes:{bearer:{list:[]}}}],defaultInputModes:['application/json'],defaultOutputModes:['application/json'],skills:[{id:CONTRACT,name:'Nubi collaboration',description:'Transfer requirements, current source/Wiki excerpts, and scenario/document drafts. Uses recipient-specific local pairing.',tags:['source','wiki','browser','office'],examples:[],inputModes:['application/json'],outputModes:['application/json']}]});
  handler=new DefaultRequestHandler(card,store,executor,undefined,undefined,undefined,undefined,undefined,{keepBusAliveStates:[]});transport=new JsonRpcTransportHandler(handler);
  // The desktop's own in-process token is never stored.
  const token=secret(),expiresAt=Date.now()+365*24*60*60*1000;tokens.set(tokenHash(token),{role:'desktop',expiresAt});
  const desktop=await a2aClient({origin,token,expiresAt}),tasks=await taskApi({origin,token,role:'desktop',expiresAt});
  return {origin,port:server.address().port,tasks,
    invite(role){if(!ROLE_NAMES[role])fail('a2a_scope');for(const [key,item] of invitations)if(item.role===role||item.expiresAt<=Date.now())invitations.delete(key);const code=secret();invitations.set(code,{role,expiresAt:Date.now()+600000});return {url:origin+'/#nubi-a2a='+code+'&agent='+role,recipient:role,expiresAt:Date.now()+600000};},
    async submit(packet,messageId=randomUUID()){
      const result=await desktop.sendMessage({message:Message.fromJSON({messageId,contextId:packet.sourceTaskId,role:'ROLE_USER',parts:[{data:{contract:CONTRACT,action:'request',packet}}]}),configuration:{historyLength:0}});
      if(result.status?.state!==TaskState.TASK_STATE_INPUT_REQUIRED)fail('a2a_uncertain');return taskSummary(result);
    },
    async cancel(id){return taskSummary(await desktop.cancelTask({id}));},
    async close(){closed=true;tokens.clear();invitations.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await serial.catch(()=>{});}
  };
}

export const storedTaskSummary = row => taskSummary(Task.fromJSON(row));
export const storedJobSummary = row => jobSummary(Task.fromJSON(row));

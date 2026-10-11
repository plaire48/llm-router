import {randomUUID,createHash} from 'node:crypto';
import {AgentCard,Task,Message,TaskState} from '@a2a-js/sdk';
import {DefaultRequestHandler,JsonRpcTransportHandler,ServerCallContext,InMemoryTaskStore,AgentEvent} from '@a2a-js/sdk/server';
import {fail} from './contract.mjs';
import {TASK_CONTRACT,TASK_SKILLS,checkTask,checkTaskResult,jobSummary,text,contextId} from './tasks.mjs';

const KEY='nubi-task:',RECEIPT='nubi-task-receipt:';
const now=()=>new Date().toISOString(),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const callContext=role=>new ServerCallContext({requestedVersion:'1.0',user:{isAuthenticated:true,userName:role}});
const agentText=value=>({messageId:randomUUID(),role:'ROLE_AGENT',parts:[{text:value}]});
const rpcError=(request,message)=>({jsonrpc:'2.0',id:request.id,error:{code:-32602,message}});
// Only the recipient moves a task forward; the requester stops it with CancelTask.
const MOVES={accept:[TaskState.TASK_STATE_SUBMITTED,'TASK_STATE_WORKING'],reject:[TaskState.TASK_STATE_SUBMITTED,'TASK_STATE_REJECTED'],progress:[TaskState.TASK_STATE_WORKING,'TASK_STATE_WORKING'],complete:[TaskState.TASK_STATE_WORKING,'TASK_STATE_COMPLETED'],fail:[TaskState.TASK_STATE_WORKING,'TASK_STATE_FAILED']};
const EVENTS={task:'created',accept:'accepted',reject:'rejected',progress:'progress',complete:'completed',fail:'failed',cancel:'canceled'};
const NOTES={task:'받는 앱에서 사용자가 수락하면 작업을 시작합니다.',accept:'받는 앱에서 작업을 시작했습니다.',complete:'결과를 전달했습니다.'};

// Requester and recipient each get a view of their own tasks, including counts.
function taskStore(records){
  const views=Object.fromEntries(Object.keys(TASK_SKILLS).map(role=>[role,new InMemoryTaskStore(()=>'local-project')]));
  const viewContext=callContext('local-project');
  const distribute=async task=>{for(const role of new Set([task.metadata?.requester,task.metadata?.recipient]))if(views[role])await views[role].save(task,viewContext);};
  const ready=Promise.all(records.list(KEY).map(row=>distribute(Task.fromJSON(row))));
  return {
    async save(task,context){
      await ready;
      const role=context.user?.userName,old=records.get(KEY+task.id),meta=task.metadata||{},owner=old?.metadata||meta;
      if(![owner.requester,owner.recipient].includes(role)||!old&&meta.requester!==role||['contract','requester','recipient','skill'].some(key=>meta[key]!==owner[key]))fail('a2a_scope');
      records.set(KEY+task.id,Task.toJSON(task));await distribute(task);
    },
    async load(id,context){await ready;return views[context.user?.userName]?.load(id,viewContext);},
    async list(params,context){await ready;const view=views[context.user?.userName];if(!view)fail('a2a_scope');return view.list(params,viewContext);}
  };
}

// Messages are checked before the SDK sees them. An executor error would make the
// SDK store a FAILED task, so a malformed message must never reach the executor.
function precheck(input,message,role,records){
  if(input.action==='task'){if(message.taskId||!contextId(message.contextId))fail('a2a_task_invalid');checkTask(input.task,role);return null;}
  if(!MOVES[input.action])fail('a2a_scope');
  const row=typeof message.taskId==='string'?records.get(KEY+message.taskId):null;
  if(!row||row.metadata?.recipient!==role)fail('a2a_scope');
  const state=Task.fromJSON(row).status?.state;
  if(state===TaskState.TASK_STATE_CANCELED)fail('a2a_cancelled');
  if(state!==MOVES[input.action][0])fail('a2a_state');
  if(input.action==='complete')checkTaskResult(input.result);
  else if(input.action==='progress'&&!text(input.text,500)||['reject','fail'].includes(input.action)&&!text(input.reason,1000))fail('a2a_task_invalid');
  return row;
}

export function createTaskAgent({records,origin,onTask}){
  const store=taskStore(records);
  const executor={
    async execute(ctx,bus){
      const role=ctx.context.user?.userName,input=ctx.userMessage.parts.find(part=>part.content?.$case==='data')?.content.value;
      let task;
      if(input.action==='task'){
        const job=checkTask(input.task,role),created=now();
        task=Task.fromJSON({id:ctx.taskId,contextId:ctx.contextId,status:{state:'TASK_STATE_SUBMITTED',timestamp:created,message:agentText(NOTES.task)},metadata:{contract:TASK_CONTRACT,requester:role,recipient:job.recipient,skill:job.skill,requestMessageId:ctx.userMessage.messageId,createdAt:created},artifacts:[{artifactId:randomUUID(),name:'task',parts:[{data:job}]}]});
      }else{
        const current=Task.toJSON(ctx.task),note=input.action==='progress'?input.text:NOTES[input.action]||input.reason;
        const artifacts=input.action==='complete'?[...current.artifacts||[],{artifactId:ctx.userMessage.messageId,name:'result',parts:[{data:{contract:TASK_CONTRACT,...checkTaskResult(input.result),from:role,receivedAt:now()}}]}]:current.artifacts;
        task=Task.fromJSON({...current,status:{state:MOVES[input.action][1],timestamp:now(),message:agentText(note)},artifacts});
      }
      bus.publish(AgentEvent.task(task));
      bus.publish(AgentEvent.statusUpdate({taskId:task.id,contextId:task.contextId,status:task.status}));
      bus.finished();
    },
    async cancelTask(id,bus){const row=records.get(KEY+id);if(!row)fail('a2a_scope');bus.publish(AgentEvent.statusUpdate({taskId:id,contextId:row.contextId,status:{state:TaskState.TASK_STATE_CANCELED,timestamp:now(),message:Message.fromJSON(agentText('요청한 앱에서 취소했습니다.'))}}));bus.finished();}
  };
  const card=AgentCard.fromJSON({name:'Nubi task exchange',description:'Peer tasks between Nubi desktop and browser. A task starts only after the recipient user accepts it. Results carry facts with their source; completion means delivery, and verification says whether the recipient host checked them.',version:'0.2.0',supportedInterfaces:[{url:origin+'/tasks/a2a',protocolBinding:'JSONRPC',protocolVersion:'1.0'}],capabilities:{streaming:false,pushNotifications:false},securitySchemes:{bearer:{httpAuthSecurityScheme:{scheme:'bearer'}}},securityRequirements:[{schemes:{bearer:{list:[]}}}],defaultInputModes:['application/json'],defaultOutputModes:['application/json'],skills:Object.entries(TASK_SKILLS).flatMap(([role,skills])=>Object.entries(skills).map(([id,skill])=>({id:`${role}/${id}`,name:skill.name,description:skill.description,tags:[TASK_CONTRACT,role],examples:[],inputModes:['application/json'],outputModes:['application/json']})))});
  const transport=new JsonRpcTransportHandler(new DefaultRequestHandler(card,store,executor,undefined,undefined,undefined,undefined,undefined,{keepBusAliveStates:[]}));
  const notify=(action,response)=>{
    const json=response?.result?.task||(response?.result?.status?response.result:null);
    if(json&&onTask)Promise.resolve().then(()=>onTask({event:EVENTS[action],task:jobSummary(Task.fromJSON(json))})).catch(()=>{});
  };
  return {card,
    async rpc(request,role){
      if(!TASK_SKILLS[role])return rpcError(request,'a2a_scope');
      if(request.method==='CancelTask'){
        const row=typeof request.params?.id==='string'?records.get(KEY+request.params.id):null;
        if(!row||row.metadata?.requester!==role)return rpcError(request,'a2a_scope');
        const response=await transport.handle(request,callContext(role));
        if(response?.result)notify('cancel',response);return response;
      }
      if(request.method!=='SendMessage')return transport.handle(request,callContext(role));
      const message=request.params?.message;
      if(!/^[a-zA-Z0-9_-]{8,100}$/.test(message?.messageId||''))return rpcError(request,'a2a_task_invalid');
      let input;try{input=Message.fromJSON(message).parts.find(part=>part.content?.$case==='data')?.content.value;}catch{/* Checked below. */}
      if(input?.contract!==TASK_CONTRACT)return rpcError(request,'a2a_task_invalid');
      // Receipts make a retried message return its first answer instead of acting twice.
      const key=RECEIPT+role+':'+message.messageId,fingerprint=digest(request.params),previous=records.get(key);
      if(previous){
        if(previous.fingerprint!==fingerprint)return rpcError(request,'a2a_message_collision');
        if(previous.response)return {...previous.response,id:request.id};
        const found=records.list(KEY).find(row=>[row.metadata?.requester,row.metadata?.recipient].includes(role)&&(row.metadata?.requestMessageId===message.messageId||row.history?.some(item=>item.messageId===message.messageId)));
        return found?{jsonrpc:'2.0',id:request.id,result:{task:{...found,history:[]}}}:{jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'a2a_uncertain'}};
      }
      let row;try{row=precheck(input,message,role,records);}catch(error){return rpcError(request,/^a2a_[a-z_]+$/.test(error.message)?error.message:'a2a_task_invalid');}
      // Progress is advisory. A long task keeps its latest state without growing forever.
      if(input.action==='progress'&&(row.history||[]).length>=60)return {jsonrpc:'2.0',id:request.id,result:{task:{...row,history:[]}}};
      records.set(key,{fingerprint});
      const response=await transport.handle(request,callContext(role));
      records.set(key,{fingerprint,response});notify(input.action,response);return response;
    }
  };
}

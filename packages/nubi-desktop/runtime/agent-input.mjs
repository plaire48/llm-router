import {skillCatalog} from './agent-capabilities.mjs';
import {resolveAgentCommand} from './agent-commands.mjs';
import {randomUUID} from 'node:crypto';
import {validateMailReferences,mergeMailReferences,sameMailReferences} from './mail-evidence.mjs';
import {enqueueInput,nextInput,reorderInput,inputMatches} from '../../../extensions/aipro-chat/agent-inbox.js';

// Browser inbox semantics, scoped to a Desktop task and this worker's connection.
// Persist before admission. Neither queued text nor steering is approval.
export function inputBinding(service,taskId,runId){
  const status=service.providers?.status();
  service.inputSession ||= randomUUID();
  return {conversationId:taskId,provider:`${status?.provider||'model'}/${status?.model||''}`,credentialReceivedAt:`${service.inputSession}:${service.inputEpoch||0}`,...(runId?{runId}:{})};
}
export function inputOpen(service,task){return service.agent?.running&&service.agent.mode!=='regeneration'&&service.agent.taskId===task.id&&!service.agent.controller.signal.aborted&&task.state==='running'&&!task.question&&!task.peerWait&&!['pending','connected'].includes(task.computerConnectionRequest?.state)&&!service.unsettledOperations?.size;}
export function pendingAgentInput(service,taskId){
  const task=service.task(taskId);if(!inputOpen(service,task))return null;
  return nextInput(task.inbox,inputBinding(service,taskId,service.agent.inputChain),'steer');
}
export function takeAgentInput(service,task){
  const item=pendingAgentInput(service,task.id);if(!item)return null;
  const current=service.task(task.id);current.inbox=current.inbox.filter(row=>row.id!==item.id);
  // The actor owns history; admissions own the inbox. Persist both without
  // overwriting submissions that arrived while an earlier tool was running.
  if(!task.messages.some(row=>row.inputId===item.id))task.messages.push({id:randomUUID(),inputId:item.id,role:'user',content:item.text,mailReferences:item.mailReferences||[],...(Number.isFinite(item.createdAt)?{sentAt:new Date(item.createdAt).toISOString()}:{}),at:new Date().toISOString()});
  task.mailReferences=mergeMailReferences(task.mailReferences,item.mailReferences);
  current.messages=task.messages;current.mailReferences=task.mailReferences;service.store.set('task:'+task.id,current);return item;
}
export function canDrainInputs(service,task){
  return !service.disposed&&!service.agent?.running&&task.state==='review'&&task.resultReview?.status==='ready'&&!task.question&&!task.peerWait&&!['pending','connected'].includes(task.computerConnectionRequest?.state)&&!service.unsettledOperations?.size&&
    !['proposal:','setup-action:','command-repair:','computer-action:'].some(prefix=>service.store.list(prefix).some(row=>row.taskId===task.id&&row.state==='proposed'))&&
    !service.store.list('process:').some(row=>row.taskId===task.id&&['running','stopping','checking'].includes(row.state));
}
export async function drainAgentInputs(service,taskId,chain){
  const task=service.task(taskId);if(!canDrainInputs(service,task))return;
  const item=nextInput(task.inbox,inputBinding(service,taskId,chain));
  if(item)await service.startAgent({taskId,answer:item.text,queuedInputId:item.id});
}
export async function agentInput({taskId,action='enqueue',id,text,mode='queue',runId,overId,order,mailReferences=[]}={}){
  this.ready();const task=this.task(taskId),binding=inputBinding(this,taskId),inbox=task.inbox||[];
  if(action==='enqueue'){
    const spoken=task.messages?.find(row=>row.inputId===id);
    if(spoken){if(spoken.content!==text?.trim()||!sameMailReferences(spoken.mailReferences,mailReferences))throw Error('agent_input_changed');return task;}
    if(!inputOpen(this,task)||runId!==this.agent.runId)throw Error('agent_input_closed');
    if(typeof text==='string'&&text.trim().startsWith('/')){const catalog=await skillCatalog(this.root);const shortcut=resolveAgentCommand(text,catalog.skills);if(shortcut?.action)throw Error('agent_command_ui_only');}
    const references=await validateMailReferences(this,mailReferences);
    // Validate before admission, then recheck when a queued input starts.
    if(!inputOpen(this,task)||runId!==this.agent.runId)throw Error('agent_input_closed');
    Object.assign(task,this.task(taskId));
    const previous=task.inbox?.find(item=>item.id===id);
    if(previous&&!sameMailReferences(previous.mailReferences,references))throw Error('agent_input_changed');
    task.inbox=enqueueInput(task.inbox||[],{id,text,mode},{...binding,runId:this.agent.inputChain}).map(item=>item.id===id?{...item,mailReferences:references}:item);
  }else if(action==='steer'){
    if(!inputOpen(this,task)||runId!==this.agent.runId)throw Error('agent_input_closed');
    const item=inbox.find(row=>row.id===id);if(!item||!inputMatches(item,{...binding,runId:this.agent.inputChain}))throw Error('agent_input_changed');
    if(item.text.startsWith('/')){const catalog=await skillCatalog(this.root);const shortcut=resolveAgentCommand(item.text,catalog.skills);if(shortcut?.action)throw Error('agent_command_ui_only');if(!inputOpen(this,task)||runId!==this.agent.runId)throw Error('agent_input_closed');}
    task.inbox=inbox.map(row=>row.id===id?{...row,mode:'steer'}:row);mode='steer';
  }else if(action==='reorder')task.inbox=reorderInput(inbox,{id,overId,order},binding);
  else if(action==='remove'){
    const item=inbox.find(row=>row.id===id);if(!item)throw Error('agent_input_changed');task.inbox=inbox.filter(row=>row.id!==id);this.store.set('task:'+taskId,task);return {text:item.text,mailReferences:item.mailReferences||[]};
  }else if(action==='start'){
    if(this.agent?.running||task.question||task.peerWait||['pending','connected'].includes(task.computerConnectionRequest?.state))throw Error('agent_input_closed');
    const item=nextInput(inbox,binding);if(!item||item.id!==id)throw Error('agent_input_changed');return this.startAgent({taskId,answer:item.text,queuedInputId:id});
  }else throw Error('input_invalid');
  this.store.set('task:'+taskId,task);
  if(mode==='steer'&&['enqueue','steer'].includes(action))this.agent.actorInput?.abort('steer');
  return task;
}

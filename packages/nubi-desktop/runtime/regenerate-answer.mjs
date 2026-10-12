import {randomUUID} from 'node:crypto';
import {conversationMessages} from './conversation-context.mjs';

// Redo the latest request through the ordinary agent, including tools and review.
// Superseded answers are archived separately; operation receipts are never erased.
export async function regenerateAnswer({taskId,messageId}={}){
  this.ready();
  if (this.agent?.running || this.skillImportBusy || this.computerBusy || this.newFileBusy || this.setupBusy || this.reconciling) throw Error('agent_busy');
  if (this.unsettledOperations?.size) throw Error('tool_unsettled');
  const provider = this.providers?.status();
  if (!provider?.connected) throw Error('provider_missing');
  const task = this.task(taskId), source = task.messages?.at(-1);
  if (task.state !== 'review' || task.question || task.peerWait || ['pending','connected'].includes(task.computerConnectionRequest?.state) ||
      source?.role !== 'assistant' || !source.content || (messageId !== undefined && source.id !== messageId)) throw Error('answer_changed');
  const pending = ['proposal:','setup-action:','command-repair:','computer-action:'].some(prefix =>
    this.store.list(prefix).some(row => row.taskId === taskId && ['proposed','starting'].includes(row.state)));
  if (pending || this.store.list('process:').some(row => row.taskId === taskId && ['running','stopping','checking'].includes(row.state))) throw Error('approval_pending');


  const store=this.store,revisionId=randomUUID(),original=structuredClone(task);
  conversationMessages(task);
  store.set('answer-revision:'+revisionId,{taskId,at:new Date().toISOString(),message:source,activityHistory:task.activityHistory||[],workPlan:task.workPlan||null,resultReview:task.resultReview||null});
  const priorRun=source.runId||task.responseTiming?.runId;
  const next={...task,messages:task.messages.slice(0,-1),state:'ready',error:null,workPlan:null,resultReview:null,trace:[],sources:[],changePlan:null,checkpoint:null,responseTiming:null,recovery:null,
    activityHistory:(task.activityHistory||[]).filter(run=>run.runId!==priorRun),
    replyRegeneration:{state:'requested',revisionId,messageId:source.id},context:{...task.context,phase:'ready'}};
  store.set('task:'+taskId,next);
  try{
    const result=await this.startAgent({taskId,mailReferences:task.mailReferences||[]});
    try{store.event('answer_redo_started',{taskId,runId:result.runId,revisionId});}catch{}
    return result;
  }catch(error){
    // Failure before a new run starts restores the visible answer. Once tools
    // run, normal interruption/recovery owns the new task and its receipts.
    if(this.store===store&&!this.disposed&&!this.agent?.running){store.set('task:'+taskId,original);store.delete('answer-revision:'+revisionId);}
    throw error;
  }
}

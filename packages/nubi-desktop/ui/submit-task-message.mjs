// A command can start its automatic result review between the last UI snapshot
// and Send. Only a definite pre-admission rejection may switch to the inbox.
// Unknown transport failures are never retried, and questions keep their gate.
export async function submitTaskMessage(api,{taskId,text,mailReferences=[],inputId,onState=()=>{}}) {
  try {return await api('startAgent',{taskId,answer:text,mailReferences});}
  catch(error) {
    if(error.message!=='agent_busy')throw error;
    const state=await api('state',{taskId});onState(state);
    const task=state.tasks?.find(item=>item.id===taskId);
    if(task?.question)throw Error('question_pending');
    if(task?.state!=='running'||!task.checkpoint?.runId||task.replyRegeneration?.state==='running')throw error;
    return api('agentInput',{taskId,action:'enqueue',runId:task.checkpoint.runId,id:inputId,text,mode:'queue',mailReferences});
  }
}

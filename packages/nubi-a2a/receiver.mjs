import {connectA2A,a2aClient,listA2A,importA2A,deliverA2A,disconnectA2A} from './client.mjs';
import {fail,taskSummary} from './contract.mjs';

// Host-owned binding: only a run started from the imported request can report.
// Browser persists this in trusted session storage; Office keeps it in its worker.
export function createReceiver({role,load,save,busy,conversation,result}){
  let queue=Promise.resolve();
  const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  async function status(local){
    const current=local||await load();
    const binding=current.binding,reply=binding?.runId?await result(binding):null;
    return {connected:!!current.connection,active:binding?{taskId:binding.taskId,request:binding.request,canSend:reply?.state==='done'&&!!reply.text&&!reply.awaitingUser}:null,...(current.connection?await listA2A(current.connection):{tasks:[]})};
  }
  return {
    dispatch(input={}){return serial(async()=>{
      const current=await load(),action=input.action||'status';
      if(action==='status')return status(current);
      if(await busy())fail('a2a_busy');
      if(action==='connect'){
        const connection=await connectA2A(input.url,role);
        let binding;
        if(current.binding){try{const client=await a2aClient(connection),task=taskSummary(await client.getTask({id:current.binding.taskId,historyLength:0}));if(task.digest===current.binding.digest&&task.recipient===role)binding=current.binding;}catch{/* A different project cannot inherit a previous run binding. */}}
        await disconnectA2A(current.connection);await save({connection,binding});return status({connection,binding});
      }
      if(action==='disconnect'){await save({});await disconnectA2A(current.connection);return {connected:false,tasks:[]};}
      if(action==='detach'){await save({connection:current.connection});return status({connection:current.connection});}
      if(action==='import'){
        const chat=await conversation(input);
        if(chat.draft?.trim())fail('a2a_draft_exists');
        if(!chat.id||current.binding&&current.binding.taskId!==input.id)fail('a2a_busy');
        const draft=await importA2A(current.connection,input.id);
        if(draft.recipient!==role)fail('a2a_scope');
        const binding={...draft,conversationId:chat.id,provider:chat.provider,messageId:crypto.randomUUID()};
        await save({...current,binding});return {draft:draft.text,taskId:draft.taskId};
      }
      if(action==='result'){
        const binding=current.binding;
        if(!binding?.runId||binding.taskId!==input.id)fail('a2a_no_result');
        const reply=await result(binding);
        if(reply?.state!=='done'||!reply.text||reply.awaitingUser)fail('a2a_no_result');
        await deliverA2A(current.connection,{...binding,text:reply.text,localRunId:binding.runId,kind:role==='browser'?'scenario_draft':'document_draft'});
        await save({connection:current.connection});return status({connection:current.connection});
      }
      fail('a2a_scope');
    });},
    bindRun({text,runId,conversationId,provider,continuation=false}){return serial(async()=>{
      const current=await load(),binding=current.binding;
      if(!binding||binding.conversationId!==conversationId||binding.provider!==provider)return;
      // Follow-up answers remain in the same conversation after the first bound run.
      if(binding.runId&&!continuation)return;
      if(!binding.runId&&text!==binding.text)return;
      await save({...current,binding:{...binding,runId}});
    });}
  };
}

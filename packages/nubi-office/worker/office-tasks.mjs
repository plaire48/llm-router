import {peerTasks} from '../../nubi-a2a/peer-client.mjs';
import {fail} from '../../nubi-a2a/contract.mjs';

// Authentication and native host identity are fixed by the worker, never by a
// task or document. Acceptance imports a request; the existing UI executes it.
export function createOfficeTasks({host,connection,saveConnection,provider,currentRun,cancel}) {
  const role='office-'+host;
  let local={},binding=null,queue=Promise.resolve();
  const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  const client=peerTasks({load:async()=>local,save:async value=>{local=value;},connection:async()=>{
    const value=await connection();if(value?.role!==role)fail('a2a_expired');return value;
  },saveConnection});
  const prompt=job=>`${job.request}\n\n누비 Workspace에서 수락한 ${host} 문서 작업입니다. 기존 반영과 최종 저장 승인을 유지합니다.\n${job.facts?.length?'완료 조건\n'+job.facts.join('\n'):''}`.trim();
  function pin(){const session=provider();return {provider:session.provider,model:session.model};}
  function samePin(){const session=pin();return binding?.provider===session.provider&&binding?.model===session.model;}
  async function sync(){
    if(!binding)return;
    const job=await client.get(binding.id);
    if(['canceled','failed','rejected'].includes(job.state)){
      if(binding.runId===currentRun()?.id)cancel();
      binding={...binding,ended:true,state:job.state};return;
    }
    if(binding.ended||!binding.runId)return;
    const run=currentRun();if(run?.id!==binding.runId||!samePin())fail('a2a_no_result');
    if(run.state==='done'){
      if(!run.answer?.trim())fail('a2a_no_result');
      // Delivery is not a document-quality or saving assertion. Do not accept
      // caller text, tokens, file paths or model-provided completion receipts.
      const result={summary:run.answer,facts:[],evidence:[],verification:'not_run',localRunId:run.id};
      await client.complete(binding.id,result);
      binding={...binding,ended:true,state:'completed'};
    }else if(['failed','cancelled'].includes(run.state)){
      await client.fail(binding.id,run.state==='cancelled'?'Office 사용자가 중지했습니다. 이미 반영한 변경은 문서에 남을 수 있습니다.':'Office 실행을 완료하지 못했습니다. 현재 문서와 실행 기록을 확인해 주세요.');
      binding={...binding,ended:true,state:'failed'};
    }else{
      const note=run.state==='awaiting_user'||run.action?.name==='request_input'?'Office에서 답변을 기다립니다.':run.action?.name==='request_approval'?'Office에서 반영 또는 저장 승인을 기다립니다.':'Office에서 작업 중입니다.';
      if(binding.note!==note){await client.progress(binding.id,note);binding={...binding,note};}
    }
  }
  return {
    locked:()=>!!binding&&!binding.ended,
    async guardStart(input){
      if(!binding||binding.ended)return;
      if(!samePin()||input.conversationId!==binding.conversationId)fail('a2a_busy');
      const job=await client.get(binding.id);if(job.state!=='working')fail(job.state==='canceled'?'a2a_cancelled':'a2a_state');
      if(!binding.runId&&input.request!==binding.text)fail('a2a_scope');
      if(binding.runId&&currentRun()?.state!=='awaiting_user')fail('a2a_busy');
    },
    bindRun(input,run){if(binding&&!binding.ended&&input.conversationId===binding.conversationId&&samePin())binding={...binding,runId:run.id};},
    dispatch(input={}){return serial(async()=>{
      if(input.action==='task_status'){
        if((await connection())?.role!==role)return {jobs:[],active:null};
        await sync();const list=await client.list();return {jobs:list.tasks,active:binding?{id:binding.id,conversationId:binding.conversationId,state:binding.state,ended:!!binding.ended}:null};
      }
      if(input.action==='task_accept'){
        if(!provider().connected||!provider().model)fail('provider_missing');
        if(currentRun()?.state==='running'||currentRun()?.state==='awaiting_user')fail('a2a_busy');
        if(binding&&!binding.ended&&binding.id!==input.id)fail('a2a_busy');
        if(binding?.id===input.id&&binding.runId)fail('a2a_busy');
        if(typeof input.conversationId!=='string'||!/^[-\w]{16,100}$/.test(input.conversationId))fail('a2a_scope');
        const job=await client.get(input.id);
        if(job.recipient!==role||job.skill!=='office-document-task'||!['submitted','working'].includes(job.state))fail('a2a_scope');
        if(job.state==='working'&&binding?.id!==job.id)fail('a2a_state');
        if(job.state==='working'&&binding?.id===job.id&&binding.state==='working')return {draft:binding.text,taskId:job.id,conversationId:binding.conversationId};
        const text=prompt(job);
        if(binding?.id!==job.id)binding={id:job.id,conversationId:input.conversationId,text,...pin(),state:'accepting'};
        // The client preserves its message ID when the accept reply is lost.
        await client.accept(job.id);binding={...binding,state:'working'};
        return {draft:binding.text,taskId:job.id,conversationId:binding.conversationId};
      }
      if(input.action==='task_reject')return client.reject(input.id,'Office 사용자가 요청을 거절했습니다.');
      if(input.action==='task_abandon'){
        if(binding?.id!==input.id||binding.runId)fail('a2a_scope');
        await client.fail(binding.id,'Office 실행을 시작하지 못했습니다. 요청을 새로 확인해 주세요.');binding={...binding,ended:true,state:'failed'};return {stopped:true};
      }
      fail('a2a_scope');
    });},
    dispose(){binding=null;local={};}
  };
}

import type { AgentTransport, AgentStreamRequest } from '@genoffice/agent-core';

// GenOffice controls planning, execution, recovery and verification. Nubi owns
// authentication and provider-specific wire protocols, including ChatGPT OAuth.
export function nubiMessages(request: AgentStreamRequest): Record<string, unknown>[] {
  return [{role:'system',content:request.system}, ...request.messages.flatMap((m): Record<string,unknown>[] => {
    if(m.role==='tool')return m.results.map(r=>({role:'tool',tool_call_id:r.id,content:r.output}));
    if(m.role==='user')return [{role:'user',content:m.text}];
    return [{role:'assistant',content:m.text||null,...(m.reasoning?{reasoning_content:m.reasoning}:{}),
      ...(m.toolCalls?.length?{tool_calls:m.toolCalls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.input)}}))}:{})}];
  })];
}
export function nubiTransport(providers: {complete: (...args:any[])=>Promise<any>}): AgentTransport {
  return {stream(request,cb){
    const controller=new AbortController();let previous='';
    const messages=nubiMessages(request);
    const verifiedMutation=request.messages.some(m=>m.role==='tool'&&m.results.some(r=>{try{const receipt=JSON.parse(r.output);return receipt.status==='verified'&&receipt.mutated===true||receipt.verifiedReceipt?.status==='verified'&&receipt.verifiedReceipt?.mutated===true;}catch{return false;}}));
    const complete=()=>providers.complete(messages,request.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),controller.signal,
      (text:string)=>{if(text.startsWith(previous))previous=text;},
      (phase:string)=>{if(['thinking','responding','tool-input','requesting'].includes(phase))cb.onPhase?.({kind:phase as any});}
    );
    void complete().catch(async error=>{
      const repairable=['claude_response_invalid','claude_structured_output_failed','claude_turn_limit'];
      if(controller.signal.aborted||!(repairable.includes(error?.message)||verifiedMutation&&error?.message==='provider_response_failed'))throw error;
      previous='';
      if(!verifiedMutation){
        // Failed provider envelopes have emitted no executable host proposals.
        // Repair the response once; no document operation is replayed here.
        return providers.complete([...messages,{role:'user',content:'이전 모델 응답 형식 처리에 실패했고 이 응답의 도구는 실행되지 않았습니다. 제공된 도구 스키마를 따라 다음 응답 하나를 올바른 형식으로 반환하세요. 실행하지 않은 문서 작업을 완료했다고 말하지 마세요.'}],request.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),controller.signal);
      }
      // Only finalize text. A failed post-write response never replays native writes.
      return providers.complete([...messages,{role:'user',content:'이미 확인된 문서 변경은 유지됩니다. 후속 모델 응답 처리 오류가 발생했습니다. 실제 도구 결과에서 검증된 변경과 중단된 후속 작업만 짧게 알려 주세요. 전체 요청을 완료했다고 과장하지 마세요. 도구를 다시 호출하지 마세요.'}],[],controller.signal);
    }).then(result=>{
      if(controller.signal.aborted){cb.onDone();return;}
      // Publish text only after the provider envelope is accepted, so a repaired
      // response cannot leave an unverified completion fragment in the transcript.
      if(typeof result.content==='string')cb.onDelta(result.content);else if(previous)cb.onDelta(previous);
      // Only a successfully completed response can emit executable calls.
      for(const call of result.calls||[]){
        let input={},inputError;
        try{input=JSON.parse(call.function.arguments);if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}
        catch{inputError='invalid_json';}
        cb.onToolCall({id:call.id,name:call.function.name,input,inputError});
      }
      if(result.usage)cb.onUsage?.({inputTokens:result.usage.prompt_tokens??result.usage.input_tokens??result.usage.input,outputTokens:result.usage.completion_tokens??result.usage.output_tokens??result.usage.output});
      cb.onStopReason?.(result.finishReason==='length'?'max_tokens':result.finishReason||'stop');cb.onDone();
    },error=>{if(controller.signal.aborted)cb.onDone();else cb.onError(/^(claude_[a-z_]+|rate_limited)$/.test(error?.message)?error.message:'provider_response_failed');});
    return {cancel:()=>controller.abort()};
  }};
}

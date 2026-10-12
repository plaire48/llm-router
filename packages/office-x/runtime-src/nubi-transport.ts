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
    void providers.complete(nubiMessages(request),request.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),controller.signal,
      (text:string)=>{if(text.startsWith(previous)){cb.onDelta(text.slice(previous.length));previous=text;}},
      (phase:string)=>{if(['thinking','responding','tool-input','requesting'].includes(phase))cb.onPhase?.({kind:phase as any});}
    ).then(result=>{
      if(controller.signal.aborted){cb.onDone();return;}
      if(typeof result.content==='string'&&result.content.startsWith(previous))cb.onDelta(result.content.slice(previous.length));
      // Only a successfully completed response can emit executable calls.
      for(const call of result.calls||[]){
        let input={},inputError;
        try{input=JSON.parse(call.function.arguments);if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}
        catch{inputError='invalid_json';}
        cb.onToolCall({id:call.id,name:call.function.name,input,inputError});
      }
      if(result.usage)cb.onUsage?.({inputTokens:result.usage.prompt_tokens??result.usage.input_tokens??result.usage.input,outputTokens:result.usage.completion_tokens??result.usage.output_tokens??result.usage.output});
      cb.onStopReason?.(result.finishReason==='length'?'max_tokens':result.finishReason||'stop');cb.onDone();
    },()=>{if(controller.signal.aborted)cb.onDone();else cb.onError('모델 연결을 확인해 주세요. 완료되지 않은 도구 호출은 실행하지 않았습니다.');});
    return {cancel:()=>controller.abort()};
  }};
}

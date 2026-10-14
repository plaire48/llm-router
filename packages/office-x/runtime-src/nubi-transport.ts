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
// Some CLI proposals JSON-encode collection fields twice. Decode only where
// the advertised schema explicitly requires a collection. Literal cell/text
// strings and numeric strings stay unchanged; normal schema validation follows.
export function normalizeOfficeInput(value:any,schema:any,depth=0):any{
  if(depth>12||!schema||typeof schema!=='object')return value;
  if(typeof value==='string'&&value.length<=200000&&['array','object'].includes(schema.type)){
    try{const decoded=JSON.parse(value);if(schema.type==='array'?Array.isArray(decoded):decoded&&typeof decoded==='object'&&!Array.isArray(decoded))value=decoded;}catch{}
  }
  if(Array.isArray(value)&&schema.type==='array')return value.map(item=>normalizeOfficeInput(item,schema.items,depth+1));
  if(value&&typeof value==='object'&&!Array.isArray(value)&&schema.properties)return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalizeOfficeInput(item,schema.properties[key],depth+1)]));
  return value;
}
export function nubiTransport(providers: {complete: (...args:any[])=>Promise<any>}): AgentTransport {
  return {stream(request,cb){
    const controller=new AbortController();let previous='';let repairTools:typeof request.tools|undefined;
    const messages=nubiMessages(request);
    const verifiedMutation=request.messages.some(m=>m.role==='tool'&&m.results.some(r=>{try{const receipt=JSON.parse(r.output);return receipt.status==='verified'&&receipt.mutated===true||receipt.verifiedReceipt?.status==='verified'&&receipt.verifiedReceipt?.mutated===true;}catch{return false;}}));
    const complete=()=>providers.complete(messages,request.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),controller.signal,
      (text:string)=>{if(text.startsWith(previous))previous=text;},
      (phase:string)=>{if(['thinking','responding','tool-input','requesting'].includes(phase))cb.onPhase?.({kind:phase as any});}
    );
    void complete().catch(async error=>{
      const repairable=['claude_response_invalid','claude_structured_output_failed','claude_turn_limit','provider_response_failed','rate_limited'];
      if(controller.signal.aborted||!(repairable.includes(error?.message)||verifiedMutation&&error?.message==='provider_response_failed'))throw error;
      previous='';
      if(['provider_response_failed','rate_limited'].includes(error?.message)){await new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(Error('cancelled'));};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',cancel);resolve();},750);controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();});}
      if(!verifiedMutation){
        // Failed provider envelopes have emitted no executable host proposals.
        // Repair the response once; no document operation is replayed here.
        return providers.complete([...messages,{role:'user',content:'이전 모델 응답 형식 처리에 실패했고 이 응답의 도구는 실행되지 않았습니다. 제공된 도구 스키마를 따라 다음 응답 하나를 올바른 형식으로 반환하세요. 실행하지 않은 문서 작업을 완료했다고 말하지 마세요.'}],request.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),controller.signal);
      }
      // The failed envelope emitted no host calls. Resume with inspection only;
      // the next ordinary turn receives fresh observations and all native tools.
      repairTools=request.tools.filter(t=>/^(read_template|load_office_guide|inspect_office|inspect_office_members|read_selection|read_outline|read_range|read_cells|read_worksheets|read_sheet_context|read_surrounding)$/.test(t.name));
      return providers.complete([...messages,{role:'user',content:'후속 모델 응답 형식 처리에 실패했지만 이미 검증된 문서 변경은 유지됩니다. 사용자에게 문서를 확인하거나 다시 요청하라고 넘기지 마세요. 제공된 읽기 도구로 현재 문서 상태를 확인하세요. 다음 응답에서 관찰 결과에 따라 남은 작업과 저장을 이어가세요. 이전 생성·삽입·쓰기를 반복하지 마세요. 실제로 모든 작업이 검증되었다면 그 결과만 답하세요.'}],repairTools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),controller.signal);
    }).then(result=>{
      if(controller.signal.aborted){cb.onDone();return;}
      if(repairTools&&result.calls?.some((call:any)=>!repairTools!.some(t=>t.name===call.function?.name))){cb.onError('provider_response_failed');return;}
      // Publish text only after the provider envelope is accepted, so a repaired
      // response cannot leave an unverified completion fragment in the transcript.
      if(typeof result.content==='string')cb.onDelta(result.content);else if(previous)cb.onDelta(previous);
      // Only a successfully completed response can emit executable calls.
      for(const call of result.calls||[]){
        let input={},inputError;
        try{input=normalizeOfficeInput(JSON.parse(call.function.arguments),request.tools.find(t=>t.name===call.function.name)?.inputSchema);if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}
        catch{inputError='invalid_json';}
        cb.onToolCall({id:call.id,name:call.function.name,input,inputError});
      }
      if(result.usage)cb.onUsage?.({inputTokens:result.usage.prompt_tokens??result.usage.input_tokens??result.usage.input,outputTokens:result.usage.completion_tokens??result.usage.output_tokens??result.usage.output});
      cb.onStopReason?.(result.finishReason==='length'?'max_tokens':result.finishReason||'stop');cb.onDone();
    },error=>{if(controller.signal.aborted)cb.onDone();else cb.onError(/^(claude_[a-z_]+|rate_limited)$/.test(error?.message)?error.message:'provider_response_failed');});
    return {cancel:()=>controller.abort()};
  }};
}

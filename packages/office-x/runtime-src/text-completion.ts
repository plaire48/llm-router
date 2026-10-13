import type {AgentTransport,AgentMessage} from '@genoffice/agent-core';
// Text-only calls can summarize/report evidence, never invoke document tools.
export function textCompletion(transport:AgentTransport,system:string,messages:AgentMessage[],signal?:AbortSignal,timeoutMs=30000):Promise<string>{
 return new Promise((resolve,reject)=>{let text='',settled=false,reason='',control:{cancel():void}|undefined;
  const finish=(error?:string)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(error||reason==='max_tokens')reject(Error(error||'summary_truncated'));else resolve(text.trim());};
  const cancel=()=>{finish('cancelled');control?.cancel();};const timer=setTimeout(()=>{finish('summary_timeout');control?.cancel();},timeoutMs);
  if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});
  try{control=transport.stream({system,messages,tools:[]},{onDelta:t=>{text+=t;if(text.length>24000){finish('summary_too_large');control?.cancel();}},onToolCall:()=>{finish('unexpected_summary_tool');control?.cancel();},onStopReason:r=>reason=r,onError:e=>finish(e),onDone:()=>finish()});}catch{finish('summary_failed');}
 });
}

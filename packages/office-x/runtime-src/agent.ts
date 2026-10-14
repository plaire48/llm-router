import {AgentLoop,composeSkills,type AgentTransport,type AgentSkill,type AgentMessage,type AgentRunResult} from '@genoffice/agent-core';
import {officeSkill} from './office-skill';
import {textSkill} from './text-skill';
import {trackEdits,editReceipts} from './edit-receipts';
import {excelSkill,type NativeCall} from './excel-skill';
import {textCompletion} from './text-completion';
import {recoverOfficeMember} from './office-recovery';
export type Recovery={code:string;verifiedWrites:number;uncertainWrites:boolean;nextStep:string};
const harness=`Use the supplied Office and GenOffice rendering, conversion and recovery tools. Web search and image features are removed. Honor the selected document destination. Inspect the bound document, propose a valid native operation, execute only after approval, then independently read back the result. An error is evidence for a different method, not a reason to repeat identical invalid calls. For member/path/argument errors load_office_guide or inspect_office_members and use typed document helpers. For Count/geometry/type differences inspect actual results; do not guess a value or weaken validation. For snapshot/target errors reread the current document and use the new snapshot. After a partial or uncertain write, the native harness pauses for human confirmation. When it returns read_required with resumed=true, inspect current targets and propose only remaining changes with fresh approval. Earlier writes remain unverified; never replay them blindly. Report verified progress and remaining work separately. A final model reply never proves a document write or save. Keep Korean replies concise. Native approval and recovery cards already show pending decisions and backup availability; do not repeat those notices or raw error codes in chat prose.`;
export function startAgent(options:{transport:AgentTransport;request:string;context:Record<string,unknown>;native:NativeCall;history?:AgentMessage[];additionalSkills?:AgentSkill[];compactionBytes?:number;event:(type:string,data:unknown)=>void}):{cancel():void;result:Promise<AgentRunResult&{recovery?:Recovery}>;messages():AgentMessage[]}{
 let resolve!:(value:AgentRunResult&{recovery?:Recovery})=>void,reject!:(e:Error)=>void;
 const result=new Promise<AgentRunResult&{recovery?:Recovery}>((yes,no)=>{resolve=yes;reject=no;});
 const failures=new Map<string,number>(),ledger:any[]=[],controller=new AbortController();let abortReason='',settled=false,finalHistory:AgentMessage[]|undefined,latestHistory:AgentMessage[]=[];
 let requireNewModelPlan=false;
 const native=trackEdits(options.native);const repaired=new Set<string>();
 const rawSkill=composeSkills('office-x',harness,[(['word','powerpoint'].includes(String(options.context.app))?textSkill:excelSkill)(native,options.context),officeSkill(native,options.context),...(options.additionalSkills||[])]);
 // Feed actionable native diagnostics back to the original GenOffice loop.
 const skill:AgentSkill={...rawSkill,executeTool:async(call,signal)=>{if(requireNewModelPlan)return {summary:call.name,mutated:false,isError:false,output:JSON.stringify({status:'read_required',recovery:'Queued tool skipped after human review. Read the current document and plan remaining work in a new model turn; do not reuse queued writes.'})};const execution=await rawSkill.executeTool(call,signal);if(!execution.isError)return execution;
  let failure:any;try{failure=JSON.parse(execution.output);}catch{failure={error:execution.output.startsWith('native_result_unavailable')?'native_result_unavailable':execution.output};}
  if(!signal?.aborted&&!['rejected','cancelled'].includes(String(failure.status||editReceipts(native)?.failure?.status))&&failure.error!=='cancelled'&&(failure.status==='partial'||failure.writeResultUncertain===true||failure.error==='writes_stopped_for_this_run'||failure.error==='native_result_unavailable')){
   options.event('tool_executed',{name:call.name,...execution});
   ledger.push({tool:call.name,status:failure.status||'partial',error:failure.error,mutated:true,completedWrites:failure.completedWrites});
   options.event('recovery',{stage:'awaiting_user'});
   try{
    const resumed=await native('review_write_recovery',{},signal);
    if(resumed.resumed===true&&resumed.status==='read_required'){
     requireNewModelPlan=true;failures.clear();options.event('recovery',{stage:'resumed'});
     return {...execution,isError:false,mutated:false,output:JSON.stringify(resumed)};
    }
    if(resumed.status==='recovery_cancelled'){controller.abort();loop.cancel();return {...execution,isError:false,mutated:false,output:JSON.stringify(resumed)};}
   }catch{}
  }
  try{const detail=JSON.parse(execution.output);const key=JSON.stringify([call.name,call.input,detail.error,detail.failedMember]);if(repaired.size<3&&!repaired.has(key)){const reading=await recoverOfficeMember(native,String(options.context.app),detail,signal);if(reading){repaired.add(key);options.event('recovery',{stage:'adjusting',code:detail.error,method:'native_document_read'});return {...execution,isError:false,mutated:false,output:JSON.stringify(reading)};}}detail.recoveryGuidance=/snapshot|target/.test(detail.error)?'Read the bound document again; use only fresh snapshot and handles.':/writes_stopped|readback|partial/.test(detail.error)?'Use read-only inspection to determine actual state. Do not replay any write.':/member|argument|count/.test(detail.error)?'Inspect supported members or load_office_guide, then use a typed helper or a corrected path/arguments. Do not repeat the same rejected call.':'Choose a different supported tool and verify its result.';return {...execution,output:JSON.stringify(detail)};}catch{return execution;}}};
 // Keep the most recent actual request even if upstream rolls a failed turn out of its history.
 const observed:AgentTransport={stream(request,cb){requireNewModelPlan=false;latestHistory=structuredClone(request.messages);return options.transport.stream(request,cb);}};
 const recover=async(code:string)=>{
  if(settled)return;settled=true;
  if(controller.signal.aborted){resolve({text:'',cancelled:true,turnLimit:false});return;}
  const verified=ledger.filter(x=>x.status==='verified'&&x.mutated),uncertain=ledger.some(x=>x.mutated&&x.status!=='verified');
  const recovery:Recovery={code,verifiedWrites:verified.length,uncertainWrites:uncertain,nextStep:uncertain?'문서의 실제 값을 다시 읽어 변경 상태를 확인합니다.':'현재 문서를 다시 읽고 지원되는 도구로 남은 작업을 이어갑니다.'};
  options.event('recovery',{...recovery,stage:'reporting'});
  let text='';
  try{if(!/^(provider_response_failed|rate_limited|no_credential|claude_[a-z_]+)$/.test(code))text=await textCompletion(options.transport,'Return a short Korean recovery report. No tools or actions are available. Only tool receipts in the evidence prove document changes. Describe confirmed progress, unconfirmed or unfinished work and the next safe step. Do not say the entire task succeeded. Do not reveal credentials, raw private paths or internal exceptions.',[{role:'user',text:JSON.stringify({request:options.request,error:code,evidence:ledger.slice(-30),nextStep:recovery.nextStep})}],controller.signal,15000);}catch{}
  if(controller.signal.aborted){resolve({text:'',cancelled:true,turnLimit:false});return;}
  // Never let an unavailable provider hide the actual document state or freeze the input.
  const files=ledger.filter(x=>x.saved===true&&x.fileHashVerified);
  if(!text&&files.length)text=`Markdown 파일 저장 ${files.length}건은 확인됐습니다. `+(files.some(x=>x.qualityComplete===false)?'추출 결과에 확인할 내용이 있습니다. ':'')+'모델의 후속 응답을 완료하지 못했습니다. 저장된 파일은 유지됩니다.';
  if(!text)text=(verified.length?`확인된 문서 변경 ${verified.length}건은 유지됩니다. `:'문서 작성 완료는 확인되지 않았습니다. ')+(uncertain?'일부 변경 상태를 확인해야 합니다. ':'남은 작업이 있습니다. ')+recovery.nextStep;
  finalHistory=[...(latestHistory.length?latestHistory:[{role:'user' as const,text:options.request}]),{role:'assistant',text:'[복구 상태 - 완료를 의미하지 않음]\n'+text}];
  options.event('recovery',{...recovery,stage:'ready'});resolve({text,cancelled:false,turnLimit:true,recovery});
 };
 const loop=new AgentLoop({transport:observed,skill,maxTurns:100,maxHistory:120,compaction:{maxBytes:options.compactionBytes||128*1024,keepRecentBytes:48*1024},events:{
  onText:text=>options.event('text',text),onUsage:usage=>options.event('usage',usage),onToolStart:call=>options.event('tool',call.name),
  onToolExecuted:event=>{options.event('tool_executed',{name:event.call.name,...event.execution});let d:any;try{d=JSON.parse(event.execution.output);}catch{d={};}ledger.push({tool:event.call.name,status:d.status|| (event.execution.isError?'failed':'read'),error:d.error,member:d.failedMember,mutated:event.execution.mutated===true,completedWrites:d.completedWrites,saved:d.saved,fileHashVerified:d.saved===true&&/^[a-f0-9]{64}$/.test(d.sha256||''),qualityComplete:d.quality?.complete,checksPassed:Array.isArray(d.checks)&&d.checks.every((c:any)=>c.passed===true)});
   if(!event.execution.isError){if(event.execution.mutated)failures.clear();return;}const code=d.error;if(typeof code!=='string'||!(/^(office_[a-z_]+|native_execution_failed|writes_stopped_for_this_run)$/.test(code)))return;
   const key=[event.call.name,code,d.failedMember||'',JSON.stringify(event.call.input)].join(':');const count=(failures.get(key)||0)+1;failures.set(key,count);options.event('recovery',{stage:'adjusting',code,attempt:count});
   if(count>=3){abortReason='office_repeated_tool_failure';loop.cancel();}
  },
  onDone:value=>{if(abortReason){void recover(abortReason);return;}if(!settled){settled=true;resolve(value);}},onError:error=>{void recover(classifyAgentFailure(error));},
 }});
 if(options.history)loop.restore(options.history);loop.run(options.request);
 return {cancel:()=>{controller.abort();loop.cancel();},result,messages:()=>structuredClone(finalHistory||[...loop.messages])};
}
export function classifyAgentFailure(error:string):string{if(/Tool input was unusable/.test(error))return 'agent_tool_input_failed';if(/Every tool call failed/.test(error))return 'agent_tool_failed';if(/kept repeating the exact same turn/.test(error))return 'agent_no_progress';if(/verification/i.test(error)&&!/^[a-z_]+$/.test(error))return 'agent_response_unverified';return /^[a-z_]{1,80}$/.test(error)?error:'provider_response_failed';}

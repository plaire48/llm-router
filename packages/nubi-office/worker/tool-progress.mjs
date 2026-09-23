import {createHash} from 'node:crypto';
import stringify from 'fast-json-stable-stringify';

// Only observations and in-memory draft patches. Native mutations retain their
// existing approval/receipt/readback guards and are NEVER replayed here.
const observed = new Set(['run_script','read','find','edit','write','read_selection','verify_selection','excel_capabilities','list_worksheets','inspect_worksheet','read_worksheet_range','get_range_data','analyze_ranges','inspect_template','recall_context','read_document','search_document','analyze_document','read_document_draft','write_document_chunk']);
const digest = value => createHash('sha256').update(stringify(value) ?? 'null').digest('hex');
function signature(name,args) {
  let input=args;
  if(name==='write_document_chunk'&&typeof args?.chunk==='string') {
    try {input={...args,chunk:JSON.parse(args.chunk)};} catch { /* Executor validates malformed JSON. */ }
  }
  if(name==='run_script'&&typeof args?.input==='string') {
    try {input={...args,input:JSON.parse(args.input)};} catch { /* Script input validation owns errors. */ }
  }
  return digest([name,input]);
}
function repeated(history) {
  for(let width=1;width<=3;width++) {
    if(history.length<width*3)continue;
    const tail=history.slice(-width*3);
    if(tail.every((key,index)=>key===tail[index%width]))return true;
  }
  return false;
}

export function createToolProgressGuard({signal,getProgress,activity,metrics,onStall}) {
  let progress,history=[],warned=false,feedback=null;
  const stats=metrics.toolProgress={prevented:0,replans:0,pauses:0};
  const check=()=>{if(signal.aborted)throw new Error('cancelled');};
  function refresh() {
    const next=digest(getProgress());
    if(next!==progress){progress=next;history=[];warned=false;feedback=null;}
  }
  async function run(name,args,operation) {
    check();refresh();
    if(observed.has(name)) {
      history.push(signature(name,args));history=history.slice(-9);
      if(repeated(history)) {
        stats.prevented++;
        feedback={error:'tool_loop_detected',actionIssued:false,tool:name,
          instruction:'The same observation or draft patch is repeating without changed verified state. Use the previous receipt, choose a different justified next step, or ask for missing facts. Never replay accepted or uncertain mutations, waive checks, or claim success.'};
        if(!warned) {
          warned=true;stats.replans++;
          activity.note('같은 호출이 반복되어 다음 동작을 다시 계획합니다.','문서와 완료 단계가 바뀌지 않았습니다. 반복 도구는 실행하지 않았습니다.');
        } else {
          stats.pauses++;
          if(!onStall)throw new Error('recovery_no_progress');
          await onStall({code:'tool_loop_detected',cause:'다음 동작을 다시 계획한 뒤에도 같은 호출이 반복되고 있습니다.'});check();
          // Explicit continuation permits a fresh decision, not replay of the
          // blocked call. Keep accepted work and the same selected model/run.
          progress=digest(getProgress());history=[];warned=false;
          feedback={...feedback,instruction:'The user chose to continue this same run. This blocked tool was NOT executed. Replan unfinished work from verified state; do not repeat the prior loop or replay mutations.'};
        }
        return {...feedback};
      }
    }
    try {
      const result=await operation();check();refresh();
      // Errors stay with the existing error supervisor; never create a second
      // retry owner or hide its diagnostics behind a successful-call loop.
      if(result?.error){history=[];warned=false;feedback=null;}
      return result;
    } catch(error) {history=[];warned=false;feedback=null;throw error;}
  }
  return {run,feedback:()=>feedback?{...feedback}:null};
}

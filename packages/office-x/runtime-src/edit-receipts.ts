import type {NativeCall} from './excel-skill';
const edits=new Set(['execute_office_operations','write_cells','set_formula','merge_cells','format_cells','add_worksheet','rename_worksheet','create_document','replace_blocks','replace_text','save_document','import_slides','import_word_content','open_artifact','rollback_document']);
export interface EditReceipts {attempted:boolean;verified:boolean;generation?:number;failure?:Record<string,unknown>;}
const states=new WeakMap<NativeCall,EditReceipts>();
export function editReceipts(native:NativeCall){return states.get(native);}
const member=(v:unknown)=>typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_.]{0,99}$/.test(v)?v:undefined;
function failureDetail(result:Record<string,unknown>){
 const checks=Array.isArray(result.checks)?result.checks.filter(c=>c&&typeof c==='object'&&/^(?:[A-Za-z_][A-Za-z0-9_]*\.)*Count$/i.test(c.read?.member||'')&&Number.isSafeInteger(c.actual)&&c.actual>=0&&Number.isSafeInteger(c.expected)&&c.expected>=0).slice(0,10).map(c=>({read:{member:c.read.member},actual:c.actual,expected:c.expected,passed:c.passed===true})):[];
 return {error:member(result.error),failedMember:member(result.failedMember),nativeCode:typeof result.nativeCode==='string'&&/^0x[0-9a-f]{8}$/i.test(result.nativeCode)?result.nativeCode:undefined,status:member(result.status),completedWrites:Number.isSafeInteger(result.completedWrites)?result.completedWrites:undefined,mutated:result.mutated===true,writeResultUncertain:result.writeResultUncertain===true,checks};
}
export function trackEdits(native:NativeCall):NativeCall {
 if(states.has(native))return native;
 const state:EditReceipts={attempted:false,verified:false};
 const wrapped:NativeCall=async(name,input,signal)=>{
  try{
   let result=await native(name,input,signal);
   if(name==='review_write_recovery'&&result.resumed===true&&result.status==='read_required')state.generation=(state.generation||0)+1;
   // A blocked follow-up is a consequence, not a replacement for the original
   // failure. Keep sanitized diagnostics across all document skills in this run.
   if(result.error==='writes_stopped_for_this_run'&&state.failure)result={...result,previousFailure:state.failure,recovery:'No further writes were performed. The original document failure is in previousFailure. Inspect the current document read-only and report the actual verified/unverified content. Do not replay Add or earlier writes or claim completion. The native human-review gate can resume planning from fresh document evidence after the user answers.'};
   if(edits.has(name)&&result.status!=='redirected'){
    state.attempted=true;state.verified=result.status==='verified'&&!result.error&&result.ok!==false;
    if(state.verified)delete state.failure;
    else if(result.error!=='writes_stopped_for_this_run')state.failure=failureDetail(result);
   }
   return result;
  }
  catch(error){if(edits.has(name)){state.attempted=true;state.verified=false;state.failure={error:'native_result_unavailable',writeResultUncertain:true};}throw error;}
 };states.set(wrapped,state);return wrapped;
}

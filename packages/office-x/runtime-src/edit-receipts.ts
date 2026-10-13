import type {NativeCall} from './excel-skill';
const edits=new Set(['execute_office_operations','write_cells','set_formula','merge_cells','create_document','replace_blocks','replace_text','save_document','import_slides','import_word_content','open_artifact','rollback_document']);
export interface EditReceipts {attempted:boolean;verified:boolean;}
const states=new WeakMap<NativeCall,EditReceipts>();
export function editReceipts(native:NativeCall){return states.get(native);}
export function trackEdits(native:NativeCall):NativeCall {
 if(states.has(native))return native;
 const state:EditReceipts={attempted:false,verified:false};
 const wrapped:NativeCall=async(name,input,signal)=>{
  try{const result=await native(name,input,signal);if(edits.has(name)&&result.status!=='redirected'){state.attempted=true;state.verified=result.status==='verified'&&!result.error&&result.ok!==false;}return result;}
  catch(error){if(edits.has(name)){state.attempted=true;state.verified=false;}throw error;}
 };states.set(wrapped,state);return wrapped;
}

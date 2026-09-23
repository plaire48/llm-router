import {createHash} from 'node:crypto';
import {checkDocumentScript} from './script-runtime.mjs';

// Inspect the committed memory draft, never execute it or promote it to a
// verified Office result. Failed diagnostics must not undo a successful edit.
export async function diagnoseDraft(path,text,signal){
  const base={path,sha256:createHash('sha256').update(text).digest('hex'),executed:false,scope:'syntax_only'};
  if(signal?.aborted)throw new Error('cancelled');
  if(path.endsWith('.json')){
    try{JSON.parse(text);return{...base,status:'valid',engine:'JSON.parse'};}
    catch{return{...base,status:'invalid',engine:'JSON.parse',code:'json_syntax_error',detail:'Invalid JSON syntax. Read the current draft and fix the structure.'};}
  }
  if(!path.endsWith('.js'))return{...base,status:'unsupported',detail:'No syntax checker is connected for this format.'};
  try{
    const result=await checkDocumentScript({code:text,signal});
    if(!result.error)return{...base,status:'valid',engine:'quickjs-compile-only'};
    return{...base,status:result.error==='script_syntax_error'?'invalid':'unavailable',engine:'quickjs-compile-only',code:result.error,
      ...(result.detail?{detail:result.detail}:{}),...(result.line?{line:result.line}:{})};
  }catch(error){
    if(signal?.aborted||error.message==='cancelled')throw new Error('cancelled');
    return{...base,status:'unavailable',engine:'quickjs-compile-only',code:['script_code_invalid','script_timeout','script_runtime_failed'].includes(error.message)?error.message:'script_runtime_failed'};
  }
}

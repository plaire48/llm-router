import {newQuickJSWASMModuleFromVariant} from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import {SCRIPT_LIMITS} from './script-runtime.mjs';

// No host functions, module loader, filesystem, network, Office or auth handles
// are exposed to QuickJS. Each invocation owns and disposes its entire runtime.
export async function evaluateDocumentScript(code,inputJson,{module:providedModule,compileOnly=false}={}){
  const module=providedModule??await newQuickJSWASMModuleFromVariant(RELEASE_SYNC),runtime=module.newRuntime();
  runtime.setMemoryLimit(SCRIPT_LIMITS.memoryBytes);runtime.setMaxStackSize(SCRIPT_LIMITS.stackBytes);
  const deadline=Date.now()+SCRIPT_LIMITS.cpuMs;let timedOut=false,stage='setup',context;
  runtime.setInterruptHandler(()=>timedOut=Date.now()>deadline);
  const handles=[];
  const own=result=>{
    if(result.error){
      let description;try{description=context.dump(result.error);}finally{result.error.dispose();}
      const error=new Error('script_failed');error.description=description;throw error;
    }
    handles.push(result.value);return result.value;
  };
  try{
    context=runtime.newContext();
    if(compileOnly){
      stage='code';own(context.evalCode(code,'document-script.js',{type:'global',compileOnly:true}));
      return{compiled:true,executed:false};
    }
    // Capture serialization intrinsics before executing user code. Reject
    // promises, functions and non-finite numbers instead of silently losing data.
    const serialize=own(context.evalCode(`(()=>{const encode=JSON.stringify,finite=Number.isFinite,proto=Object.getPrototypeOf,plain=Object.prototype,array=Array.isArray,keys=Object.keys,create=Object.create,define=Object.defineProperty;
      return value=>{const pending=[];
      function copy(item,depth){const type=typeof item;
        if(depth>64||type==='undefined'||type==='function'||type==='symbol'||type==='bigint'||type==='number'&&!finite(item))throw new TypeError('Output must be finite JSON data with depth at most 64');
        if(item===null||type!=='object')return item;
        const list=array(item);if(!list&&proto(item)!==plain&&proto(item)!==null)throw new TypeError('Output must contain only JSON objects and arrays');
        const result=list?[]:create(null);
        if(list)define(result,'toJSON',{value:undefined});
        define(pending,pending.length,{value:{item,result,list,depth},writable:true,configurable:true});
        return result;
      }
      const root=copy(value,0);
      for(let next=0;next<pending.length;next++){
        const job=pending[next],names=job.list?null:keys(job.item),length=job.list?job.item.length:names.length;
        for(let i=0;i<length;i++){const key=job.list?i:names[i];define(job.result,key,{value:copy(job.item[key],job.depth+1),enumerable:true,writable:true,configurable:true});}
        define(pending,next,{value:undefined});
      }
      return encode(root);};})()`));
    const data=own(context.evalCode(`JSON.parse(${JSON.stringify(inputJson)})`));
    stage='code';own(context.evalCode(code,'document-script.js',{type:'global'}));
    const transform=context.getProp(context.global,'transform');handles.push(transform);
    if(context.typeof(transform)!=='function')return{error:'script_entry_missing'};
    stage='execute';const output=own(context.callFunction(transform,context.undefined,data));
    if(runtime.hasPendingJob())return{error:'script_async_unsupported'};
    stage='output';const encoded=own(context.callFunction(serialize,context.undefined,output));
    if(runtime.hasPendingJob())return{error:'script_async_unsupported'};
    if(context.typeof(encoded)!=='string')return{error:'script_output_invalid'};
    const json=context.getString(encoded);
    if(json.length>SCRIPT_LIMITS.outputChars)return{error:'script_output_limit'};
    return{json};
  }catch(error){
    if(timedOut)return{error:'script_timeout'};
    const info=error.description,errorName=['SyntaxError','ReferenceError','TypeError','RangeError','InternalError','Error'].includes(info?.name)?info.name:'Error';
    if(typeof info?.message==='string'&&/out of memory/i.test(info.message))return{error:'script_memory_limit'};
    const line=Number(/document-script\.js:(\d+)/.exec(info?.stack||'')?.[1]);
    return{...(Number.isSafeInteger(line)&&line>0?{line}:{}),error:stage==='output'?'script_output_invalid':stage==='setup'?'script_runtime_failed':errorName==='SyntaxError'?'script_syntax_error':'script_failed',errorName,
      detail:typeof info?.message==='string'?info.message.replace(/[\u0000-\u001f]/g,' ').slice(0,240):'Check the script and JSON input.'};
  }finally{
    for(const handle of handles.reverse())handle.dispose();context?.dispose();runtime.dispose();
  }
}

import {Worker} from 'node:worker_threads';

export const SCRIPT_LIMITS=Object.freeze({codeChars:32000,inputChars:48000,outputChars:24000,memoryBytes:16*1024*1024,stackBytes:256*1024,cpuMs:250,wallMs:3000});
const fail=code=>{throw new Error(code);};
export function scriptInput(value){
  let text;
  try{text=JSON.stringify(value,(_key,item)=>{
    if(['undefined','function','symbol','bigint'].includes(typeof item)||typeof item==='number'&&!Number.isFinite(item))fail('script_input_invalid');
    return item;
  });}catch{fail('script_input_invalid');}
  if(typeof text!=='string')fail('script_input_invalid');
  if(text.length>SCRIPT_LIMITS.inputChars)fail('script_input_limit');
  return text;
}

// The thread runs a separate WASM interpreter, not the model's code in Node.
// It receives only the selected script and JSON input, never the provider or env.
export function checkDocumentScript({code,signal}){
  return scriptWorker({code,signal,compileOnly:true});
}
export function runDocumentScript(options){return scriptWorker(options);}
async function scriptWorker({code,input,signal,compileOnly=false}){
  if(signal?.aborted)fail('cancelled');
  if(typeof code!=='string'||!code.trim()||code.length>SCRIPT_LIMITS.codeChars)fail('script_code_invalid');
  const inputJson=compileOnly?null:scriptInput(input);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./script-thread.mjs',import.meta.url),{workerData:{code,inputJson,compileOnly},env:{},execArgv:[],stdout:true,stderr:true,resourceLimits:{maxOldGenerationSizeMb:32,maxYoungGenerationSizeMb:8,stackSizeMb:2}});
    worker.stdout.resume();worker.stderr.resume();let settled=false;
    const finish=async(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      try{await worker.terminate();}catch{error=new Error('script_runtime_failed');}
      if(signal?.aborted)error=new Error('cancelled');
      if(error)reject(error);else resolve(result);
    };
    const abort=()=>{void finish(new Error('cancelled'));};
    const timer=setTimeout(()=>{void finish(new Error('script_timeout'));},SCRIPT_LIMITS.wallMs);
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',result=>{
      if(!result||typeof result!=='object')return void finish(new Error('script_runtime_failed'));
      if(result.error)return void finish(null,{error:result.error,...(result.errorName?{errorName:result.errorName}:{}),...(result.detail?{detail:result.detail}:{}),...(Number.isSafeInteger(result.line)&&result.line>0?{line:result.line}:{})});
      if(compileOnly)return void finish(result.compiled===true?null:new Error('script_runtime_failed'),{compiled:true,executed:false});
      try{
        if(typeof result.json!=='string'||result.json.length>SCRIPT_LIMITS.outputChars)fail('script_output_limit');
        const output=JSON.parse(result.json);
        void finish(null,{output,outputJson:result.json});
      }catch{void finish(new Error('script_output_invalid'));}
    });
    worker.once('error',()=>{void finish(new Error('script_runtime_failed'));});
    worker.once('exit',()=>{if(!settled)void finish(new Error('script_runtime_failed'));});
    if(signal?.aborted)abort();
  });
}

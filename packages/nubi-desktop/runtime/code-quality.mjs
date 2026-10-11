import {Worker} from 'node:worker_threads';
import {diffLines} from 'diff';
import {hash,readSource,fail} from './files.mjs';

const supported=file=>/\.(?:[cm]?[jt]sx?|jsonc?|ya?ml)$/i.test(file);
export function runCodeAnalysis(input,{signal,timeoutMs=5000}={}){
  return new Promise(resolve=>{
    if(signal?.aborted){resolve({error:'cancelled'});return;}
    let worker;try{worker=new Worker(new URL('./code-analysis-worker.mjs',import.meta.url),{workerData:input,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}});}catch{resolve({error:'analysis_unavailable'});return;}let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate().catch(()=>{});resolve(value);};
    const cancel=()=>finish({error:'cancelled'}),timer=setTimeout(()=>finish({error:'analysis_timeout'}),timeoutMs);
    signal?.addEventListener('abort',cancel,{once:true});worker.once('message',finish);worker.once('error',()=>finish({error:'analysis_unavailable'}));worker.once('exit',()=>finish({error:'analysis_unavailable'}));
  });
}
// Existing errors count as existing only on lines left unchanged by the edit.
function unchangedLines(before,after){
  const parts=diffLines(before,after,{timeout:100,maxEditLength:5000});if(!parts)return null;
  const lines=new Map();let oldLine=1,newLine=1;
  for(const part of parts){if(part.added)newLine+=part.count;else if(part.removed)oldLine+=part.count;else for(let i=0;i<part.count;i++)lines.set(newLine++,oldLine++);}
  return lines;
}
export async function checkCodeQuality(file,before,after,options={}){
  const base={beforeHash:hash(before),afterHash:hash(after),checkedAt:new Date().toISOString(),scope:'syntax_only',tests:'not_run',types:'not_checked'};
  if(!supported(file))return {...base,state:'unsupported',engine:null,diagnostics:[],errorCount:0};
  const result=await runCodeAnalysis({mode:'quality',path:file,before,after},options);
  if(result.error)return {...base,state:'unavailable',error:result.error,engine:null,diagnostics:[]};
  const lineMap=unchangedLines(before,after),existing=result.before.diagnostics;
  const diagnostics=result.after.diagnostics.map(d=>({...d,origin:lineMap&&existing.some(old=>old.code===d.code&&old.message===d.message&&old.column===d.column&&old.line===lineMap.get(d.line))?'existing':'introduced'}));
  const state=result.after.truncated?'incomplete':diagnostics.some(d=>d.origin==='introduced')?'blocked':result.after.errorCount?'existing_issues':'passed';
  return {...base,state,engine:result.after.engine,diagnostics,errorCount:result.after.errorCount,baselineErrorCount:result.before.errorCount,truncated:result.after.truncated};
}
export function requireCodeQuality(quality){
  if(['blocked','incomplete','unavailable'].includes(quality.state))throw Object.assign(new Error(quality.state==='unavailable'?'quality_unavailable':'proposal_invalid_syntax'),{quality});
}
export async function codeOutline({path,taskId,signal}){
  const file=await readSource(await this.target(taskId),path);
  if(!supported(path))return {path,hash:file.hash,supported:false,symbols:[],imports:[],instruction:'Structure is unavailable for this language. Use read_source; this is not edit authorization.'};
  const result=await runCodeAnalysis({mode:'outline',path,content:file.content},{signal});
  if(result.error)fail(result.error==='cancelled'?'cancelled':'quality_unavailable');
  return {...result,path,hash:file.hash,instruction:'Declaration locations and import strings only, not runtime call paths or resolved dependencies. Read the relevant ranges using read_source before planning or editing. An outline does not authorize edits.'};
}

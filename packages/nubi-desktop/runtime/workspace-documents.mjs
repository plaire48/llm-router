import {saveDocumentProgress} from './analysis-history.mjs';
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isUtf8} from 'node:buffer';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {scopedFile,relativeFile,hash,fail} from './files.mjs';

export const DOCUMENT_LIMITS={files:32,bytes:12_000_000,characters:4_000_000,totalCharacters:8_000_000};
// The research core accepts 300 documents; a Wiki question covers the whole Wiki.
export const WIKI_LIMITS={files:300};
export const DOCUMENT_GUIDANCE='Use analyze_documents for large workspace UTF-8 text: locate exact paths, give scoped questions, preserve citations, conflicts and unread ranges. OpenWiki-SDS partitions, reads with two workers, repairs gaps and synthesizes. read_document_analysis retrieves saved results without rerunning. Findings are advisory, not edit observations or live app state. Independent source/screenshot/review/recovery work uses delegate_analysis with scoped evidence; dependent actions stay sequential. Use fresh source/UIA and existing approvals for changes. Avoid workers for trivial tasks.';
export const DOCUMENT_TOOL={type:'function',function:{name:'analyze_documents',description:'Investigate large UTF-8 workspace text/Markdown documents with read-only workers. Costs about five model calls per 24,000 characters: use it for text over about 60,000 characters or when every part must be covered. For project Wiki questions use ask_openwiki. Select exact relative paths from source_search mode=path or the user. Reports unread ranges. Up to 32 files, 4 million characters/file, 8 million total. No PDF/DOCX/images/OCR. No edits, shell, app input or approval. Coverage applies to the selected files only.',parameters:{type:'object',properties:{paths:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:{type:'string',minLength:1,maxLength:1000}},question:{type:'string',minLength:1,maxLength:4000}},required:['paths','question'],additionalProperties:false}}};

async function safeTarget(root,rel){
  relativeFile(rel);
  const parts=rel.split('/');
  for(let i=1;i<=parts.length;i++)if((await lstat(path.join(root,...parts.slice(0,i)))).isSymbolicLink())fail('document_scope');
  return scopedFile(root,rel);
}

// Bounded descriptor reads avoid readFile allocating an unbounded growing file.
// Sources remain references; this never touches SourceObservations.
export async function documentSnapshot(root,paths,signal,{maxFiles=DOCUMENT_LIMITS.files,kind='folder'}={}){
  if(!Array.isArray(paths)||!paths.length||paths.length>maxFiles||new Set(paths).size!==paths.length)fail('document_arguments');
  root=await realpath(root);const documents=[];let total=0;
  for(const rel of paths){
    signal.throwIfAborted();
    const target=await safeTarget(root,rel);
    const file=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    try{
      const before=await file.stat();
      if(!before.isFile()||before.size>DOCUMENT_LIMITS.bytes)fail('document_limit');
      const blocks=[];let size=0;
      while(true){
        signal.throwIfAborted();
        const buffer=Buffer.allocUnsafe(Math.min(65536,DOCUMENT_LIMITS.bytes-size+1));
        const {bytesRead}=await file.read(buffer,0,buffer.length,null);
        if(!bytesRead)break;
        size+=bytesRead;if(size>DOCUMENT_LIMITS.bytes)fail('document_limit');
        blocks.push(buffer.subarray(0,bytesRead));
      }
      const after=await file.stat(),current=await lstat(await safeTarget(root,rel));
      if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||current.ino!==after.ino||current.dev!==after.dev)fail('document_changed');
      const bytes=Buffer.concat(blocks);
      if(/\.(?:pdf|docx?|pptx?|xlsx?|od[tpfs]|png|jpe?g|gif|webp|zip)$/i.test(rel)||bytes.subarray(0,5).toString()==='%PDF-'||bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))fail('document_format');
      if(bytes.includes(0)||!isUtf8(bytes))fail('document_encoding');
      const text=bytes.toString('utf8');total+=text.length;
      if(text.length>DOCUMENT_LIMITS.characters||total>DOCUMENT_LIMITS.totalCharacters)fail('document_limit');
      documents.push({id:'document:'+hash(rel).slice(7),title:path.posix.basename(rel),path:rel,text,kind,version:hash(bytes)});
    }finally{await file.close();}
  }
  return documents;
}

export function researchProgress(record,event){
  const {phase,completed,total,taskId,synthesisId,role,assignment,outcome,summary}=event;
  Object.assign(record,{phase,completed,total});
  const key=synthesisId!==undefined?`synthesis:${synthesisId}`:taskId;
  if(key!==undefined){
    const previous=record.workers.find(worker=>worker.taskId===key);
    const worker={...previous,taskId:key,phase,...(role?{role}:{}),...(assignment?{question:assignment.question,documentIds:assignment.documentIds,range:assignment.range}:{}),...(outcome?{outcome}:{}),...(summary?{summary:summary.slice(0,600)}:{})};
    if(previous)record.workers[record.workers.indexOf(previous)]=worker;else record.workers.push(worker);
  }
  return record;
}

export function documentAnalysisResult(record,evidenceId){
  if(!record?.result||!['complete','partial','blocked'].includes(record.state))fail('document_result_unavailable');
  if(evidenceId){
    const evidence=record.result.evidence.find(item=>item.id===evidenceId);
    if(!evidence)fail('document_evidence_missing');
    return {id:record.id,evidence,advisory:true,dataKind:'document_reference',historical:true,instruction:'Saved snapshot evidence, not a fresh source observation or edit permission.'};
  }
  return {...record.result,id:record.id,sources:record.sources,advisory:true,dataKind:'document_reference',historical:true,
    evidence:record.result.evidence.map(item=>({...item,excerpt:item.excerpt.slice(0,1200),preview:item.excerpt.length>1200})),
    instruction:'Analysis of selected snapshot files only. Read coverage is not factual accuracy or whole-workspace coverage. Preserve missing ranges and uncertainty. Use read_document_analysis with this id and evidenceId for original saved excerpts. No source edit observations, app input, approval or business completion occurred. Re-read current source before edits and fresh UIA before app actions.'};
}

export function interruptDocumentResearch(store){
  const interrupt=record=>({...record,state:'interrupted',phase:'finished',error:'document_interrupted',workers:(record.workers||[]).map(worker=>worker.outcome?worker:{...worker,phase:'interrupted'})});
  for(const record of store.list('document-analysis:').filter(item=>item.state==='running'))store.set('document-analysis:'+record.id,interrupt(record));
  for(const task of store.list('task:').filter(item=>item.documentAnalysis?.state==='running'))store.set('task:'+task.id,{...task,documentAnalysis:interrupt(task.documentAnalysis)});
}

// The project Wiki as the shared ask_openwiki protocol expects it: the host
// supplies documents, the OpenWiki agent of the shared runtime does the research.
export async function wikiSnapshot({root,pages,projectId,signal}){
  if(!Array.isArray(pages)||!pages.length)fail('document_wiki_missing');
  const documents=await documentSnapshot(root,pages.slice(0,WIKI_LIMITS.files),signal,{maxFiles:WIKI_LIMITS.files,kind:'wiki'});
  return {wikiId:'external:'+projectId,documents,sourceComplete:pages.length<=WIKI_LIMITS.files};
}

export async function analyzeWorkspaceDocuments({root,args,signal,modelId,complete,taskId,runId,onRecord,store},engine){
  if(typeof args.question!=='string'||!args.question.trim()||args.question.length>4000)fail('document_arguments');
  const id=randomUUID(),record={id,taskId,runId,question:args.question,state:'running',phase:'loading',completed:0,total:0,workers:[],sources:[]};
  const persist=()=>{store?.set('document-analysis:'+id,record);if(store)saveDocumentProgress(store,record);onRecord?.(record);};
  const authentication=new AbortController(),researchSignal=AbortSignal.any([signal,authentication.signal]);
  persist();
  try{
    const documents=await documentSnapshot(root,args.paths,researchSignal);
    record.sources=documents.map(doc=>({id:doc.id,path:doc.path,hash:doc.version,characters:doc.text.length}));persist();
    engine||=await import('../generated/openwiki.mjs');
    const guardedComplete=async(...parameters)=>{
      researchSignal.throwIfAborted();
      try{return await complete(...parameters);}catch(error){if(engine.isWikiAuthenticationError(error))authentication.abort(error);throw error;}
    };
    const model=new engine.NubiOpenWikiModel({complete:guardedComplete,signal:researchSignal,modelId,taskId:id});
    const result=await engine.runWikiQuestion({question:args.question,documents,sourceComplete:true},{signal:researchSignal,modelId,model,search:engine.createWikiQuestionSearch(),onProgress:event=>{researchSignal.throwIfAborted();researchProgress(record,event);persist();}});
    researchSignal.throwIfAborted();record.phase='validating';persist();
    const current=await documentSnapshot(root,args.paths,researchSignal);
    if(current.some((doc,index)=>doc.version!==documents[index].version))fail('document_changed');
    record.state=result.status;record.phase='finished';record.coverage=result.coverage;record.result=result;
    persist();
    return documentAnalysisResult(record);
  }catch(error){
    record.state=signal.aborted?'cancelled':'failed';record.phase='finished';
    record.error=signal.aborted?'cancelled':error.message.startsWith('document_')?error.message:'document_analysis_failed';
    record.workers=record.workers.map(worker=>['finished','synthesis_finished'].includes(worker.phase)?worker:{...worker,phase:record.state});persist();
    throw signal.aborted?error:authentication.signal.reason||error;
  }
}

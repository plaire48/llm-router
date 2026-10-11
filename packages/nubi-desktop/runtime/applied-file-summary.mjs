import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {readSource,hash,fail} from './files.mjs';
import {summarizeDiff} from './source-edits.mjs';

// Read-back receipts, never unapproved proposals or unrelated Git changes.
// A broken receipt chain counts only its latest contiguous sequence.
export async function appliedFileSummary(service,{taskId}={}){
  service.ready();service.task(taskId);
  const root=await service.target(taskId),groups=new Map();
  const receipts=service.store.list('proposal:').filter(row=>row.taskId===taskId&&row.state==='applied').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  for(const receipt of receipts){if(!groups.has(receipt.path))groups.set(receipt.path,[]);groups.get(receipt.path).push(receipt);}
  const files=[];
  for(const [rel,rows] of [...groups].slice(0,100)){
    try{
      const current=await readSource(root,rel),latest=rows[0];
      if(current.hash!==latest.afterHash){files.push({path:rel,hash:current.hash,state:'changed',stats:{state:'unavailable'}});continue;}
      let first=latest,index=0;
      while(first.expectedHash!=='absent'){
        const prior=rows.findIndex((row,i)=>i>index&&row.afterHash===first.expectedHash);
        if(prior<0)break;
        index=prior;first=rows[prior];
      }
      const snapshot=path.resolve(first.before),parent=path.resolve(service.store.directory,'proposals');
      if(!snapshot.startsWith(parent+path.sep)||await realpath(snapshot)!==snapshot)fail('path_scope');
      const info=await lstat(snapshot);if(!info.isFile()||info.size>1024*1024)fail('file_too_large');
      const before=await readFile(snapshot,'utf8');
      if(first.expectedHash==='absent'?before!=='':hash(before)!==first.expectedHash)fail('source_stale');
      files.push({path:rel,hash:current.hash,state:'verified',partial:index<rows.length-1,stats:summarizeDiff(before,current.content)});
    }catch{files.push({path:rel,state:'unavailable',stats:{state:'unavailable'}});}
  }
  const complete=files.every(row=>row.state==='verified'&&!row.partial&&row.stats.state==='counted')&&groups.size===files.length;
  return {files,total:groups.size,truncated:groups.size>files.length,totals:complete?files.reduce((sum,row)=>({added:sum.added+row.stats.added,removed:sum.removed+row.stats.removed}),{added:0,removed:0}):null};
}

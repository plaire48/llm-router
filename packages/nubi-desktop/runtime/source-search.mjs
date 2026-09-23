import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat} from 'node:fs/promises';
import {listFiles,relativeFile,scopedFile,readSource,fail} from './files.mjs';
const exec=promisify(execFile);

export async function searchSource({query,kind='all',mode='content',within,taskId,signal}){
  this.ready();
  if(typeof query!=='string'||!query.trim()||query.length>500||!['all','wiki'].includes(kind)||!['content','path'].includes(mode))fail('input_invalid');
  query=query.trim();if(within)relativeFile(within);
  const root=await this.target(taskId),listed=await listFiles(root,{within}),files=listed.paths.filter(p=>(kind!=='wiki'||/^(openwiki|docs|openspec)\//.test(p))&&(!within||p===within||p.startsWith(within+'/')));
  if(mode==='path'){
    const matches=files.filter(p=>p.toLowerCase().includes(query.toLowerCase()));
    return {results:matches.slice(0,100).map(path=>({path,kind:'path'})),scanned:files.length,skipped:0,total:files.length,truncated:listed.truncated||matches.length>100,engine:'git-paths',instruction:'Path candidates only. Read current source before planning or editing.'};
  }
  let rgPath;try{({rgPath}=await import('@vscode/ripgrep'));}catch{fail('search_unavailable');}
  const results=[],deadline=Date.now()+10000;let scanned=0,skipped=0,limited=false;
  for(let offset=0;offset<files.length;offset+=128){
    if(signal?.aborted)throw new Error('cancelled');
    if(Date.now()>=deadline||results.length>=40){limited=true;break;}
    const batch=files.slice(offset,offset+128),safe=[];
    // Explicit rg file arguments can follow links. Validate before any search.
    for(let at=0;at<batch.length;at+=16){
      const checks=await Promise.all(batch.slice(at,at+16).map(async rel=>{try{const target=await scopedFile(root,rel),stat=await lstat(target);return stat.isFile()&&stat.size<=1024*1024?rel:null;}catch{return null;}}));
      safe.push(...checks.filter(Boolean));skipped+=checks.filter(v=>!v).length;
    }
    scanned+=batch.length;
    if(!safe.length)continue;
    if(signal?.aborted)throw new Error('cancelled');
    if(Date.now()>=deadline){limited=true;break;}
    let stdout;
    try{({stdout}=await exec(rgPath,['--json','--fixed-strings','--ignore-case','--no-config','--no-ignore','--hidden','--threads','1','--max-count','40','--max-filesize','1M','-e',query,'--',...safe],{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024,timeout:Math.max(1,deadline-Date.now()),signal,windowsHide:true}));}
    catch(error){if(signal?.aborted)throw new Error('cancelled');if(error.code===1)stdout=error.stdout;else if(error.code==='ENOENT')fail('search_unavailable');else{stdout=error.stdout||'';limited=true;}}
    const candidates=new Set(safe),cache=new Map();
    for(const line of stdout.split('\n')){
      if(results.length>=40){limited=true;break;}
      let record;try{record=JSON.parse(line);}catch{continue;}
      if(record.type!=='match')continue;
      const data=record.data,rel=data.path?.text?.replaceAll('\\','/');
      if(!candidates.has(rel))continue;
      try{
        if(!cache.has(rel))cache.set(rel,await readSource(root,rel));
        const file=cache.get(rel),actual=file.content.split('\n')[data.line_number-1];
        // Reread disk for truthful hashes and reject results invalidated in flight.
        if(typeof actual!=='string'||!actual.toLowerCase().includes(query.toLowerCase())){limited=true;continue;}
        results.push({path:rel,line:data.line_number,excerpt:actual.slice(0,500),hash:file.hash,kind:rel.startsWith('openwiki/')?'wiki':'source',freshness:'unverified'});
      }catch{limited=true;}
    }
    if(limited)break;
  }
  return {results,scanned,skipped,total:files.length,truncated:listed.truncated||limited||scanned<files.length||skipped>0,engine:'ripgrep',instruction:'Static search candidates with current file hashes, not executed behavior or edit authorization. If truncated, narrow within to a directory or use a more specific query. mode=path finds filenames before reading them.'};
}

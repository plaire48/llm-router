import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat} from 'node:fs/promises';
import {listFiles,relativeFile,scopedFile,readSource,fail} from './files.mjs';
import {READ_LINES} from './read-room.mjs';
const exec=promisify(execFile);
const MAX_EXCERPTS_PER_FILE=3,MAX_EXCERPTS=40;
// Characters of one search excerpt (500 before the user decision of 2026-09-30 on large windows).
export const SEARCH_EXCERPT=1500;

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
  // Excerpts are capped per file so a few files cannot crowd out the rest;
  // `matched` still counts every file, which keeps the breadth visible.
  // When one file holds every match, the search is a search within it and shows its matches up to the whole limit.
  const results=[],matched=new Map(),found=[],deadline=Date.now()+10000;let scanned=0,skipped=0,limited=false,omittedExcerpts=0;
  for(let offset=0;offset<files.length;offset+=128){
    if(signal?.aborted)throw new Error('cancelled');
    if(Date.now()>=deadline||matched.size>=200){limited=true;break;}
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
    const candidates=new Set(safe);
    for(const line of stdout.split('\n')){
      let record;try{record=JSON.parse(line);}catch{continue;}
      if(record.type!=='match')continue;
      const data=record.data,rel=data.path?.text?.replaceAll('\\','/');
      if(!candidates.has(rel))continue;
      const file=matched.get(rel)||{path:rel,matches:0,shown:0};matched.set(rel,file);file.matches++;
      if(file.matches<=MAX_EXCERPTS)found.push({rel,line:data.line_number});
    }
  }
  const perFile=matched.size===1?MAX_EXCERPTS:MAX_EXCERPTS_PER_FILE,cache=new Map();
  for(const {rel,line} of found){
    if(signal?.aborted)throw new Error('cancelled');
    const entry=matched.get(rel);
    if(entry.shown>=perFile||results.length>=MAX_EXCERPTS)continue;
    try{
      if(!cache.has(rel))cache.set(rel,await readSource(root,rel));
      const file=cache.get(rel),actual=file.content.split('\n')[line-1];
      // Reread disk for truthful hashes and reject results invalidated in flight.
      if(typeof actual!=='string'||!actual.toLowerCase().includes(query.toLowerCase())){limited=true;continue;}
      results.push({path:rel,line,excerpt:actual.slice(0,SEARCH_EXCERPT),hash:file.hash,kind:rel.startsWith('openwiki/')?'wiki':'source',freshness:'unverified'});entry.shown++;
    }catch{limited=true;}
  }
  omittedExcerpts=[...matched.values()].reduce((sum,file)=>sum+file.matches-file.shown,0);
  // A search within one file that a single read holds (D1, S28, 2026-10-01): the model read ranges around English
  // matches and missed the Korean line beside them. Such a file is read whole, matches or not.
  let readWhole;
  if(within&&files.length===1&&files[0]===within){
    try{const file=cache.get(within)||await readSource(root,within),lines=file.content.split('\n').length;
      if(lines<=READ_LINES)readWhole={path:within,lines,instruction:`${within} has ${lines} lines, which one read_source holds: read it whole (no start or end) for its facts. A search misses text written differently, such as in another language.`};}
    catch{}
  }
  return {results,files:[...matched.values()].sort((a,b)=>a.path<b.path?-1:1),...(readWhole?{readWhole}:{}),omittedExcerpts,scanned,skipped,total:files.length,truncated:listed.truncated||limited||scanned<files.length||skipped>0||omittedExcerpts>0,engine:'ripgrep',instruction:'Static search candidates with current file hashes, not executed behavior or edit authorization. files lists every file with a match and its count. When several files match, at most 3 excerpts per file are shown: compare the listed files, then read one or search within it to see all of its matches. If truncated, narrow within to a directory or use a more specific query. mode=path finds filenames before reading them.'};
}

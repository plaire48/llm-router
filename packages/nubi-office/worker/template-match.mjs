import MiniSearch from 'minisearch';
import {getChoseong} from 'es-hangul';

// Finds registered templates from "/name" commands and from plain sentences.
// It only narrows the choice: opening a copy still goes through the native
// host and every write still needs the user's approval. Catalog names and
// summaries are user-written data, never instructions.
const LIMIT=4;
const compact=text=>String(text??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const consonantsOnly=text=>/^[ㄱ-ㅎ]+$/.test(text);
const usable=(entries,host='excel')=>(Array.isArray(entries)?entries:[]).filter(entry=>entry&&typeof entry==='object'&&/^[a-f0-9-]{36}$/.test(entry.id??'')&&entry.host===host&&typeof entry.name==='string'&&entry.name.trim()&&entry.available!==false);
const brief=(entry,score)=>({id:entry.id,name:entry.name,summary:String(entry.summary??'').slice(0,200),score});

// "/출장신청서 부산 2박 3일" → the template name and the rest of the request.
export function parseTemplateCommand(request){
  const text=String(request??'').trim();
  if(!text.startsWith('/'))return null;
  const quoted=/^\/"([^"]{1,100})"\s*([\s\S]*)$/.exec(text),plain=/^\/(\S{0,100})\s*([\s\S]*)$/.exec(text);
  const [,name,rest]=quoted||plain;
  return{name:name.trim(),rest:rest.trim()};
}
// A command is resolved by name only: exact, then prefix, then contained, then
// initial consonants. One match at the best level is used; several are offered.
export function matchCommand(name,entries,{host='excel'}={}){
  const list=usable(entries,host),wanted=compact(name);
  if(!wanted){const candidates=list.slice(0,LIMIT).map(entry=>brief(entry,0));return{decision:candidates.length?'choose':'none',candidates};}
  const levels=[[],[],[],[]];
  for(const entry of list){
    const title=compact(entry.name);
    if(title===wanted)levels[0].push(entry);
    else if(title.startsWith(wanted))levels[1].push(entry);
    else if(title.includes(wanted))levels[2].push(entry);
    else if(consonantsOnly(wanted)&&compact(getChoseong(entry.name)).startsWith(wanted))levels[3].push(entry);
  }
  const level=levels.findIndex(found=>found.length),found=level<0?[]:levels[level];
  return{decision:!found.length?'none':found.length===1?'use':'choose',candidates:found.slice(0,LIMIT).map(entry=>brief(entry,4-level))};
}
// Suggestions for the composer while "/name" is still being typed. null means
// the draft is not a command in progress. Choosing one only writes its command.
export function suggestCommands(draft,entries,{host='excel',limit=6}={}){
  if(typeof draft!=='string'||!/^\/\S{0,100}$/u.test(draft))return null;
  const wanted=compact(draft.slice(1)),levels=[[],[],[],[]];
  for(const entry of usable(entries,host)){
    const title=compact(entry.name);if(!title)continue;
    if(!wanted||title===wanted)levels[0].push(entry);
    else if(title.startsWith(wanted))levels[1].push(entry);
    else if(title.includes(wanted))levels[2].push(entry);
    else if(consonantsOnly(wanted)&&compact(getChoseong(entry.name)).startsWith(wanted))levels[3].push(entry);
  }
  return levels.flat().slice(0,limit).map(entry=>({id:entry.id,name:entry.name,summary:String(entry.summary??'').slice(0,200),command:'/'+entry.name.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu,'')+' '}));
}
// Korean has no spaces inside compounds and carries particles, so words are
// indexed together with their two-character pieces.
const pieces=text=>{
  const words=String(text??'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(' ').filter(Boolean),out=[];
  for(const word of words){out.push(word);for(let index=0;index<word.length-1;index++)out.push(word.slice(index,index+2));}
  return out;
};
// Pieces shared by most template requests say nothing about WHICH template.
const COMMON=new Set(['작성','해줘','만들','들어','어줘','써줘','양식','문서','새로','하나','주세','세요','해주','입력','채워','워줘']);
export function searchTemplates(request,entries,{host='excel',limit=LIMIT}={}){
  const list=usable(entries,host);if(!list.length)return[];
  const index=new MiniSearch({idField:'id',fields:['name','summary'],storeFields:['name'],tokenize:pieces,searchOptions:{tokenize:text=>pieces(text).filter(piece=>!COMMON.has(piece)),boost:{name:3},combineWith:'OR'}});
  index.addAll(list.map(entry=>({id:entry.id,name:entry.name,summary:String(entry.summary??'').slice(0,3000)})));
  const found=index.search(String(request??'').slice(0,2000));if(!found.length)return[];
  const best=found[0].score,byId=new Map(list.map(entry=>[entry.id,entry]));
  // Keep only results that share a real part of the NAME and are close to the best one.
  return found.filter(item=>item.score>=best*0.25&&Object.values(item.match).some(fields=>fields.includes('name'))).slice(0,limit).map(item=>brief(byId.get(item.id),Math.round(item.score*10)/10));
}

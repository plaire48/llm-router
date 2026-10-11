// What survives when the context of a running executor is renewed or cleared.
// Everything here is built by the host from tool results: no model writes or
// rewrites a fact. The practices followed are public:
// - Anthropic, "Effective context engineering for AI agents": tool result
//   clearing is the lightest form of compaction; notes persist outside the context.
// - OpenAI Codex CLI, compact/summary_prefix.md: the next model is told to build
//   on the work already done and to avoid duplicating it.
// - OpenCode, session/compaction.ts: recent tool output is protected, older
//   output is replaced by a placeholder.
// A model-written summary is deliberately not used for the running loop: cell
// values must reach the next request exactly as the host read them.
import {estimateTokens} from './context-budget.mjs';

export const CLEARED='Older result cleared to save context. kept holds what the host retained of it. Call the tool again only when the full detail is needed.';
const GRIDS=new Set(['values','formulas','errors','displayTexts','formats','properties','numberFormats','preview','cells','fields','observation','snapshot','details','items','trace','activity','plan','planProgress','checks','sources','metadata','comparison','profile','record','entry','preservation','instruction','note','fingerprint','scopeId','documentId','sheetId','sourceScopeId','workbook','date1904','readOnly','protected','kind','calculatedBy','content']);
const short=(value,limit)=>typeof value==='string'&&value.length>limit?value.slice(0,limit-1)+'…':value;
const scalar=value=>value===null||['string','number','boolean'].includes(typeof value);
const READS=new Set(['read_selection','verify_selection','inspect_template']);

// The part of a tool result that stays: identifiers, host-calculated numbers, outcome and error.
export function digest(tool,result){
  if(!result||typeof result!=='object'||Array.isArray(result))return scalar(result)?{value:short(result,200)}:{};
  const kept={};
  for(const [key,value] of Object.entries(result)){
    if(GRIDS.has(key))continue;
    if(scalar(value)){if(value!==null&&value!=='')kept[key]=short(value,key==='issue'?400:200);}
  }
  if(Array.isArray(result.totals)&&result.totals.every(item=>item&&typeof item==='object'))kept.totals=result.totals.slice(0,12).map(({column,header,range,numbers,sum,min,max})=>({column,...(header===undefined?{}:{header:short(header,40)}),range,numbers,sum,min,max}));
  if(tool==='calculate_ranges'&&Array.isArray(result.results))kept.results=result.results.slice(0,12).map(({worksheet,address,operation,value})=>({worksheet,address,operation,value}));
  if(Array.isArray(result.added))kept.added=result.added.slice(0,4);
  // Sheet names and ids are needed to read a sheet that was not read yet.
  if(tool==='list_worksheets'&&Array.isArray(result.items))kept.sheets=result.items.slice(0,40).map(({sheetId,name})=>({sheetId,name:short(name,40)}));
  if(typeof result.summary==='string')kept.summary=short(result.summary,400);
  if(READS.has(tool)&&!kept.error){for(const key of Object.keys(kept))if(!['worksheet','address','verified','total','nextOffset'].includes(key))delete kept[key];kept.restore=tool;}
  if(tool==='get_range_data'&&!kept.error)kept.restore='get_range_data';
  const text=JSON.stringify(kept);
  return text.length<=(kept.sheets?3200:1600)?kept:Object.fromEntries(Object.entries(kept).filter(([key])=>['error','issue','snapshotId','worksheet','address','applied','verified','restore'].includes(key)));
}
export function brief(args){
  let text;try{text=JSON.stringify(args??{});}catch{text='{}';}
  return text.length<=160?text:text.slice(0,159)+'…';
}
// A numbered record of the calls of this run. The newest entries are kept within the limits.
export function createProgressLog({limit=120,maxCharacters=30000}={}){
  let step=0,dropped=0;const list=[];
  return{
    add(tool,args,result){
      list.push({step:++step,tool,input:brief(args),result:digest(tool,result)});
      while(list.length>limit||list.length>1&&JSON.stringify(list).length>maxCharacters){list.shift();dropped++;}
    },
    entries:()=>structuredClone(list),omitted:()=>dropped,size:()=>step
  };
}
// The tail of a request as whole exchanges: one assistant message with its tool calls and every result of those calls.
function exchanges(wire){
  const found=[];
  for(let index=0;index<wire.length;index++){
    const message=wire[index];if(message?.role!=='assistant'||!message.tool_calls?.length)continue;
    const ids=new Set(message.tool_calls.map(call=>call.id)),results=[];let next=index+1;
    while(next<wire.length&&wire[next]?.role==='tool'&&ids.has(wire[next].tool_call_id)){results.push(wire[next]);next++;}
    if(results.length===ids.size)found.push([message,...results]);
    index=next-1;
  }
  return found;
}
export function recentExchanges(wire,{exchanges:count=8,maxCharacters=200000}={}){
  const kept=exchanges(Array.isArray(wire)?wire:[]).slice(-count);
  while(kept.length&&JSON.stringify(kept.flat()).length>maxCharacters)kept.shift();
  return structuredClone(kept.flat());
}
// The renewed state carries the current cells once. A carried result that holds the very same cells (same fingerprint)
// points to them instead of repeating them. Nothing is lost: the cells are in the same request.
export function sameCellsOnce(messages,latest){
  const fingerprint=latest?.fingerprint;if(typeof fingerprint!=='string'||!fingerprint)return messages;
  const same=value=>value&&typeof value==='object'&&!Array.isArray(value)&&value.fingerprint===fingerprint&&Array.isArray(value.values);
  return messages.map(message=>{
    if(message?.role!=='tool'||typeof message.content!=='string')return message;
    let value;try{value=JSON.parse(message.content);}catch{return message;}
    if(!value||typeof value!=='object'||Array.isArray(value))return message;
    if(same(value))return{...message,content:JSON.stringify({sameAs:'observation',worksheet:value.worksheet,address:value.address,fingerprint})};
    let changed=false;const next={...value};
    for(const key of Object.keys(next))if(same(next[key])){next[key]={sameAs:'observation',fingerprint};changed=true;}
    return changed?{...message,content:JSON.stringify(next)}:message;
  });
}
// Replaces tool results older than the last `keep` by their digest. Calls, arguments and order stay as they were.
// The last calls of this run as whole exchanges, built from what the host executed and returned.
export function createExchangeLog({keep=8,maxCharacters=200000}={}){
  let sequence=0;const list=[];
  return{
    add(tool,args,result){
      const id=`kept-${++sequence}`;let content;try{content=JSON.stringify(result??null);}catch{content='null';}
      list.push([{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name:tool,arguments:JSON.stringify(args??{})}}]},{role:'tool',tool_call_id:id,content}]);
      while(list.length>keep)list.shift();
    },
    recent({exchanges=keep,maxTokens=Infinity}={}){const kept=list.slice(-exchanges);while(kept.length&&(JSON.stringify(kept.flat()).length>maxCharacters||estimateTokens(JSON.stringify(kept.flat()))>maxTokens))kept.shift();return structuredClone(kept.flat());}
  };
}
export function clearOldResults(wire,{keep=8,minCharacters=600}={}){
  const names=new Map();for(const message of wire)for(const call of message?.tool_calls||[])names.set(call.id,call.function?.name);
  const results=wire.map((message,index)=>message?.role==='tool'?index:-1).filter(index=>index>=0),protectedFrom=results.length>keep?results[results.length-keep]:-1;
  return wire.map((message,index)=>{
    if(message?.role!=='tool'||index>=protectedFrom&&protectedFrom>=0||results.length<=keep)return message;
    if(typeof message.content!=='string'||message.content.length<minCharacters)return message;
    let value;try{value=JSON.parse(message.content);}catch{return message;}
    if(value?.cleared===true&&value.note===CLEARED)return message;
    const tool=names.get(message.tool_call_id)||'';
    return{...message,content:JSON.stringify({cleared:true,tool,note:CLEARED,kept:digest(tool,value)})};
  });
}

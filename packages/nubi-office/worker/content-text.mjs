import {createHash} from 'node:crypto';
import {contentFieldIncomplete,contentTextIncomplete} from './content-integrity.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const CONTENT_TEXT_LIMIT=2000000;
export const readDocumentTextTool={type:'function',function:{name:'read_document_text',description:'Read exact UTF-16 chunks of an observed Word/PPT item text or notes. Follow nextOffset; previews are not complete text. Read-only, no expansion of native edit scope. Results bind source and chunk hashes.',parameters:{type:'object',additionalProperties:false,required:['itemId','field','offset'],properties:{itemId:{type:'string',minLength:1,maxLength:100},field:{type:'string',enum:['text','notes']},offset:{type:'integer',minimum:0},maxChars:{type:'integer',minimum:1,maximum:8000}}}}};
// Run-local evidence only. The raw native pages remain the write guard.
export function createContentText({pages,call,signal,limit=CONTENT_TEXT_LIMIT}){
  const records=new Map();let retained=0;
  const check=()=>{if(signal?.aborted)throw new Error('cancelled');};
  function source(itemId,field){
    const found=[...pages.values()].flatMap(page=>page.items.filter(item=>item.id===itemId).map(item=>({page,item})));
    // The reason goes with the refusal. Measured 2026-09-30 (gpt-5.6-luna): a skill file path passed as itemId was
    // refused as source_not_read alone, and the actor did not learn which tool reads files.
    if(found.length!==1)throw Object.assign(new Error('source_not_read'),{issue:`${String(itemId).slice(0,100)} is not an item of the document pages read so far. Use an item id from read_document (p-12, s-256/h-3) after reading its page; files such as skills/... are read with read.`});
    if(!['text','notes'].includes(field)||typeof found[0].item[field]!=='string')throw Object.assign(new Error('source_not_read'),{issue:`${itemId} has no ${String(field).slice(0,20)} text: use field text for paragraphs and shapes, notes for slides.`});
    const {page,item}=found[0],incomplete=contentFieldIncomplete(item,field),length=item[field+'Length']??item[field].length;
    if(incomplete&&(!item[field+'Hash']||!Number.isSafeInteger(item[field+'Length'])))throw new Error('evidence_incomplete');
    const digest=item[field+'Hash']??hash(item[field]);
    return {page,item,length,digest,key:JSON.stringify([page.host,page.scopeId,page.documentId,page.fingerprint,itemId,field,length,digest])};
  }
  async function read({itemId,field,offset,maxChars=4000}){
    check();if(typeof itemId!=='string'||itemId.length>100||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>8000)throw new Error('tool_arguments_invalid');
    const {page,item,length,digest,key}=source(itemId,field);
    if(offset>length)throw new Error('tool_arguments_invalid');
    if(length>limit)throw new Error('evidence_limit');
    const cache=records.get(key),cached=cache?.chunks.get(offset);
    const wanted=Math.min(maxChars,length-offset);
    const covering=[...(cache?.chunks.values()??[])].find(c=>c.offset<=offset&&c.offset+c.text.length>=offset+wanted);
    if(covering){const text=covering.text.slice(offset-covering.offset,offset-covering.offset+wanted),end=offset+text.length;return{...structuredClone(covering),offset,text,chunkHash:hash(text),nextOffset:end<length?end:null};}
    const value=await call('office_read_text',{scopeId:page.scopeId,expectedFingerprint:page.fingerprint,itemId,field,offset,maxChars});
    check();if(source(itemId,field).key!==key)throw new Error('source_changed');
    if(value?.error)throw new Error(value.error);
    if(['host','scopeId','documentId','fingerprint'].some(k=>value?.[k]!==page[k]))throw new Error('source_changed');
    const end=Math.min(length,offset+maxChars);
    if(value.itemId!==itemId||value.field!==field||value.offset!==offset||value.textLength!==length||value.textHash!==digest||value.readOnly!==true||typeof value.text!=='string'||value.text.length!==end-offset||value.chunkHash!==hash(value.text)||value.nextOffset!==(end<length?end:null))throw new Error('observation_invalid');
    if(offset<item[field].length&&value.text.slice(0,Math.min(end,item[field].length)-offset)!==item[field].slice(offset,Math.min(end,item[field].length)))throw new Error('source_changed');
    for(const chunk of cache?.chunks.values()??[]){const a=Math.max(offset,chunk.offset),b=Math.min(end,chunk.offset+chunk.text.length);if(a<b&&value.text.slice(a-offset,b-offset)!==chunk.text.slice(a-chunk.offset,b-chunk.offset))throw new Error('source_changed');}
    const cost=value.text.length-(cached?.text.length??0);
    if(retained+cost>limit)throw new Error('evidence_limit');
    const record=cache??{chunks:new Map(),length,digest};record.chunks.set(offset,structuredClone(value));records.set(key,record);retained+=cost;
    return structuredClone(value);
  }
  function full(bound){
    const record=records.get(bound.key);if(!record)return null;
    let text='';
    for(const chunk of [...record.chunks.values()].sort((a,b)=>a.offset-b.offset)){
      if(chunk.offset>text.length)return null;
      text+=chunk.text.slice(Math.max(0,text.length-chunk.offset));
    }
    if(text.length!==bound.length)return null;
    if(hash(text)!==bound.digest)throw new Error('observation_invalid');
    return text;
  }
  function project(){
    const projected=new Map();
    for(const [offset,page] of pages){
      const copy=structuredClone(page);
      for(const item of copy.items){
        for(const field of ['text','notes'])if(contentFieldIncomplete(item,field)){
          if(!item[field+'Hash']||!Number.isSafeInteger(item[field+'Length']))continue;
          const text=full(source(item.id,field));
          if(text!==null){item[field]=text;item[field+'Length']=text.length;if(field==='notes')item.notesTruncated=false;else item.truncated=false;}
        }
        if(item.notesTruncated===false&&!(Number.isInteger(item.textLength)&&item.textLength>item.text?.length))item.truncated=false;
      }
      projected.set(offset,copy);
    }
    return projected;
  }
  async function hydrate({complete=true}={}){
    check();const pending=[];let total=0;
    for(const page of pages.values())for(const item of page.items)for(const field of ['text','notes'])if(contentFieldIncomplete(item,field)){
      if(!complete&&(!item[field+'Hash']||!Number.isSafeInteger(item[field+'Length'])))continue;
      const bound=source(item.id,field);total+=bound.length;if(total>limit)throw new Error('evidence_limit');pending.push({itemId:item.id,field,bound});
    }
    for(const {itemId,field,bound} of pending){
      if(full(bound)!==null)continue;
      for(let offset=0;offset<bound.length;offset+=8000)await read({itemId,field,offset,maxChars:8000});
    }
    const result=project();if(complete&&[...result.values()].some(page=>page.items.some(contentTextIncomplete)))throw new Error('evidence_incomplete');return result;
  }
  function select({itemId,field,offset,length}){
    check();if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>8000)throw new Error('tool_arguments_invalid');
    const bound=source(itemId,field),end=offset+length;
    if(end>bound.length)throw new Error('tool_arguments_invalid');
    const chunks=[{offset:0,text:bound.item[field]},...(records.get(bound.key)?.chunks.values()??[])].sort((a,b)=>a.offset-b.offset);
    let text='',cursor=offset;
    for(const chunk of chunks){if(chunk.offset>cursor)break;const next=Math.min(end,chunk.offset+chunk.text.length);if(next>cursor){text+=chunk.text.slice(cursor-chunk.offset,next-chunk.offset);cursor=next;}if(cursor===end)break;}
    if(cursor!==end)throw new Error('source_not_read');
    return{host:bound.page.host,scopeId:bound.page.scopeId,documentId:bound.page.documentId,fingerprint:bound.page.fingerprint,itemId,field,offset,text,textLength:bound.length,textHash:bound.digest,chunkHash:hash(text),readOnly:true};
  }
  function progress(){return [...records].map(([key,value])=>{const spans=[];for(const c of [...value.chunks.values()].sort((a,b)=>a.offset-b.offset)){const last=spans.at(-1),end=c.offset+c.text.length;if(last&&c.offset<=last[1])last[1]=Math.max(last[1],end);else if(c.text.length)spans.push([c.offset,end]);}return[key,spans];});}
  return {read,hydrate,project,select,progress,clear(){records.clear();retained=0;}};
}

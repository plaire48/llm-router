import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const invalid=()=>{throw new Error('tool_arguments_invalid');};
export const textRangesProperty={type:'array',minItems:1,maxItems:4,items:{type:'object',additionalProperties:false,required:['itemId','field','offset','length'],properties:{itemId:{type:'string',minLength:1,maxLength:100},field:{type:'string',enum:['text','notes']},offset:{type:'integer',minimum:0,maximum:2000000},length:{type:'integer',minimum:1,maximum:8000}}}};
export function normalizeTextRanges(task){
  if(task.textRanges===undefined)return {};
  if(!Array.isArray(task.textRanges)||!task.textRanges.length||task.textRanges.length>4||!Array.isArray(task.itemIds))invalid();
  let total=0;
  const ranges=task.textRanges.map(r=>{
    if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['itemId','field','offset','length'].includes(k))||!task.itemIds.includes(r.itemId)||!['text','notes'].includes(r.field)||!Number.isSafeInteger(r.offset)||r.offset<0||r.offset>2000000||!Number.isSafeInteger(r.length)||r.length<1||r.length>8000||r.offset+r.length>2000000)invalid();
    total+=r.length;return{itemId:r.itemId,field:r.field,offset:r.offset,length:r.length};
  }).sort((a,b)=>a.itemId.localeCompare(b.itemId)||a.field.localeCompare(b.field)||a.offset-b.offset);
  if(total>24000||task.itemIds.some(id=>!ranges.some(r=>r.itemId===id)))invalid();
  for(let i=1;i<ranges.length;i++){const a=ranges[i-1],b=ranges[i];if(a.itemId===b.itemId&&a.field===b.field&&a.offset+a.length>b.offset)invalid();}
  return {textRanges:ranges};
}
export function rangeSources(task,byId,getTextRange){
  const {textRanges}=normalizeTextRanges(task);
  if(!textRanges)return null;
  if(typeof getTextRange!=='function')throw new Error('source_not_read');
  return textRanges.map(range=>{
    const source=byId.get(range.itemId);if(!source)throw new Error('source_not_read');
    const value=getTextRange(range),{itemId,field,offset,length}=range;
    if(typeof source.item[field]!=='string')throw new Error('source_not_read');
    if(!value||value.readOnly!==true||value.textHash!==(source.item[field+'Hash']??hash(source.item[field]))||value.textLength!==(source.item[field+'Length']??source.item[field].length)||['scopeId','documentId','fingerprint'].some(k=>value[k]!==source[k])||value.itemId!==itemId||value.field!==field||value.offset!==offset||typeof value.text!=='string'||value.text.length!==length||value.chunkHash!==hash(value.text)||! /^[a-f0-9]{64}$/.test(value.textHash)||!Number.isSafeInteger(value.textLength)||value.textLength<offset+length)throw new Error('observation_invalid');
    const provenance={itemId,field,start:offset,end:offset+length,textLength:value.textLength,textHash:value.textHash};
    return {...source,item:{id:'range-'+hash(JSON.stringify([source.scopeId,source.fingerprint,provenance])).slice(0,40),kind:'text_range',editable:false,[field]:value.text},provenance};
  });
}

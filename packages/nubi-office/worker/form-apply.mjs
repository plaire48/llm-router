// Writing a checked fill sheet into the form copy (S1 design, part 3): the wanted text of every slot and section is
// compared with the copy, and the first difference in document order becomes the next part operation. The same sheet
// applied again finds no difference and writes nothing; a repaired section is rewritten in place. The form's paragraphs
// are found through the ledger (form-ledger.mjs): a section's text goes only into its guide paragraphs and the
// paragraphs this run added to it, never into the form's own text around them.
import {isHeading,markOf} from './word-form-map.mjs';
import {renderValue} from './form-values.mjs';
import {guideSpans} from './guide-text.mjs';
import {locate,region,record} from './form-ledger.mjs';

const blank=text=>!String(text??'').trim();
const once=(text,part)=>!!part&&text.indexOf(part)>=0&&text.indexOf(part)===text.lastIndexOf(part);
// Word takes no control character in a paragraph (ContentPort.cs String): a line break of a value is a space there.
const line=text=>String(text??'').replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').trim();
// A section of the form as the map read it (the items the map was made from): its heading, by ID, and the paragraphs up
// to the next heading.
export function sectionBody(items,section){
  const at=items.findIndex(item=>item.id===section.heading);if(at<0)return null;
  const next=items.findIndex((item,k)=>k>at&&isHeading(item));
  return{heading:items[at],body:items.slice(at+1,next<0?undefined:next).filter(item=>item.kind==='paragraph')};
}
// Text into a paragraph: whole when Word can write it whole (one run), else in place after the form's mark, so the
// mark keeps its run (a mark and a guide in two formats: review of plan 2, 2026-10-01).
function rewrite(item,text,mark){
  if(item.editable)return{operation:{type:'replace_text',targetId:item.id,text}};
  const rest=mark&&item.text.startsWith(mark)?item.text.slice(mark.length):item.text,next=mark&&text.startsWith(mark)?text.slice(mark.length):text;
  if(item.writable&&rest&&once(item.text,rest))return{operation:{type:'replace_guide',targetId:item.id,guide:rest,text:next}};
  return{blocked:`Word가 "${item.text.slice(0,40)}" 문단을 바꿀 수 없습니다.`};
}
// Word keeps the last paragraph mark last, and a paragraph between two tables (removing it would join them).
const last=(items,item)=>items.at(-1)?.id===item.id;
const removable=(items,item)=>{const k=items.findIndex(other=>other.id===item.id);return item.writable&&!last(items,item)&&!(items[k-1]?.kind==='cell'&&items[k+1]?.kind==='cell');};
function sectionOperation(items,map,ledger,entry){
  const section=map.sections.find(s=>s.id===entry.section);if(!section)return null;
  const heading=locate(ledger,items,section.heading);if(!heading)return null;
  const parts=region(ledger,items,section),wanted=entry.paragraphs.map(p=>line(p.text)).filter(Boolean),owner={section:section.id};
  const markFor=origin=>markOf(ledger.original.get(origin??section.sample)?.text??'');
  const want=(origin,text)=>{const mark=markFor(origin);return mark&&!text.startsWith(mark.trim())?mark+text:text;};
  for(let k=0;k<Math.min(parts.length,wanted.length);k++){
    const {item,origin}=parts[k],text=want(origin,wanted[k]);
    if(item.text!==text)return{...rewrite(item,text,markFor(origin)),owner};
  }
  if(parts.length>wanted.length){
    const extra=parts.slice(wanted.length),gone=extra.findLast(({item})=>removable(items,item));
    if(gone)return{operation:{type:'remove_paragraph',targetId:gone.item.id},owner};
    // The last paragraph of the document stays: it is emptied instead (its mark may stay).
    const rest=({item,origin})=>{const mark=markFor(origin);return mark&&item.text.startsWith(mark)?item.text.slice(mark.length):item.text;};
    const left=extra.find(part=>!blank(rest(part)));
    return left?{...rewrite(left.item,'',markFor(left.origin)),owner}:null;
  }
  if(wanted.length>parts.length){
    const sample=section.sample&&locate(ledger,items,section.sample);
    if(!sample)return{blocked:`"${section.title}"에 본문 견본 문단이 없습니다.`};
    if(sample.editable===false)return{blocked:`"${section.title}"의 견본 문단은 서식이 둘 이상이라 문단을 더 넣을 수 없습니다.`};
    let anchor=parts.at(-1)?.item??heading,texts=wanted.slice(parts.length);
    if(last(items,anchor)){
      // The paragraphs go before the last one, which takes the last text next.
      const before=items[items.findIndex(item=>item.id===anchor.id)-1];
      if(!parts.length||before?.kind!=='paragraph'||!before.writable)return{blocked:`"${section.title}"의 마지막 문단 앞에 문단을 넣을 수 없습니다.`};
      anchor=before;texts=wanted.slice(parts.length-1,wanted.length-1);
    }
    return{operation:{type:'insert_paragraphs',after:anchor.id,like:sample.id,paragraphs:texts.map(text=>({text:want(undefined,text)}))},owner};
  }
  return null;
}
// The next write: {operation, owner} (owner: the slot or section it writes), {blocked: reason} when Word cannot write
// what is wanted, or null when the copy holds the sheet.
export function nextOperation(snapshot,map,sheet,ledger){
  const items=snapshot.items,slots=new Map(map.slots.map(slot=>[slot.id,slot]));
  for(const cell of sheet.cells??[]){
    const slot=slots.get(cell.slot),current=slot&&locate(ledger,items,slot.target);if(!current)continue;
    const value=renderValue(slot,cell.value),owner={slot:slot.id};
    if(slot.kind==='guide'){
      const text=line((slot.wrap?.[0]??'')+value+(slot.wrap?.[1]??'')),was=ledger.written[slot.id];
      if(current.text.includes(slot.guide))return{operation:{type:'replace_guide',targetId:current.id,guide:slot.guide,text},owner};
      if(was!==undefined&&was!==text&&once(current.text,was))return{operation:{type:'replace_guide',targetId:current.id,guide:was,text},owner};
      continue;
    }
    if(slot.kind==='field'){if(current.text!==line(value))return{operation:{type:'fill_field',targetId:current.id,text:line(value)},owner};continue;}
    if(current.text===value)continue;
    if(current.editable!==false)return{operation:{type:'fill_cell',targetId:current.id,text:value},owner};
    // A cell of runs in two formats ("담당:" in bold, then the guide): each guide is replaced in place.
    const guide=(slot.guides??[]).find(text=>once(current.text,text));
    if(current.writable&&guide)return{operation:{type:'replace_guide',targetId:current.id,guide,text:line(renderValue({...slot,guides:[guide],current:undefined,inner:undefined},cell.value))},owner};
    return{blocked:`Word가 "${slot.label||slot.target}" 칸을 바꿀 수 없습니다.`};
  }
  for(const entry of sheet.rows??[]){
    const slot=slots.get(entry.slot);if(!slot)continue;
    const t=+slot.target.slice(1),cells=items.filter(item=>item.kind==='cell'&&item.table===t),rows=Math.max(...cells.map(cell=>cell.row)),owner={slot:slot.id};
    const wanted=entry.rows.filter(row=>row.some(text=>!blank(text)));
    if(rows-1<wanted.length)return{operation:{type:'add_rows',targetId:slot.target,count:wanted.length-(rows-1)},owner};
    for(const [r,row] of wanted.entries())for(const [c,text] of row.entries()){
      const cell=cells.find(item=>item.row===r+2&&item.column===c+1);if(cell&&cell.text!==text.trim())return{operation:{type:'fill_cell',targetId:cell.id,text:text.trim()},owner};
    }
    // Template rows the sheet does not use keep no guide text (review of plan 2: "20XX. XX. XX. / (내용 기재)" was left).
    const left=cells.find(cell=>cell.row>wanted.length+1&&guideSpans(cell.text).length);
    if(left)return{operation:{type:'fill_cell',targetId:left.id,text:''},owner};
  }
  for(const entry of sheet.sections??[]){const next=sectionOperation(items,map,ledger,entry);if(next)return next;}
  return null;
}
// Office refusals of a part (ContentPort.cs, content-engine.mjs): the write did not happen and repeating it does not help.
const REFUSALS=new Set(['unsupported_target','invalid_plan','out_of_scope','unsupported_operation','document_not_writable']);
// Applies operations until the copy holds the sheet. A check that is not met stops with the receipt: the harness
// repairs or asks, it never writes the same thing again. An operation that comes back after it was applied, a write
// Word refuses and one it cannot make stop too, with the operations written so far.
export async function applyFill({map,sheet,read,apply,ledger,limit=300}){
  const operations=[],seen=new Set();
  for(let n=0;n<limit;n++){
    const snapshot=await read(),next=nextOperation(snapshot,map,sheet,ledger);
    if(!next)return{done:true,operations};
    if(next.blocked)return{done:false,operations,failed:{blocked:next.blocked}};
    const key=JSON.stringify(next.operation);if(seen.has(key))return{done:false,operations,failed:{repeated:next.operation}};seen.add(key);
    let receipt;
    try{receipt=await apply(next.operation);}
    catch(error){if(!REFUSALS.has(error?.message))throw error;return{done:false,operations,failed:{operation:next.operation,refused:error.message}};}
    operations.push({operation:next.operation,checks:receipt?.checks??[]});
    // The write happened: the ledger follows it before its checks are judged.
    record(ledger,snapshot.items,next.operation,receipt,next.owner?.section);
    if(next.owner?.slot&&next.operation.type==='replace_guide'&&map.slots.find(slot=>slot.id===next.owner.slot)?.kind==='guide')ledger.written[next.owner.slot]=next.operation.text;
    if(!Array.isArray(receipt?.checks)||!receipt.checks.length||receipt.checks.some(check=>check.status!=='met'))return{done:false,operations,failed:{operation:next.operation,checks:receipt?.checks??[]}};
  }
  return{done:false,operations,failed:{limit}};
}

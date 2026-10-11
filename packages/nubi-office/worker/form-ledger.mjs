// The paragraphs of a form copy, followed through the run's own writes (S1 design, part 3). Measured 2026-10-01 (review
// of plan 2): a paragraph ID (p-N) counts every paragraph of the document, those in table cells included, so the
// paragraphs a section added, or a table row, moved the IDs the map holds; a filled date line then failed its check,
// and a section found by its title rewrote another section of the same title. Outside tables, a paragraph's place
// among the other paragraphs changes only when this run adds or removes a paragraph, and the receipt says which. The
// ledger keeps one entry per paragraph outside tables: the form's own (origin: its ID when the map was made) and those
// this run added (owner: the section). A paragraph of the form the run does not write keeps its text: a read that does
// not match the ledger stops the writes instead of writing to the wrong place.
const paragraphsOf=items=>items.filter(item=>item.kind==='paragraph');
const stop=issue=>{throw Object.assign(new Error('content_verification_failed'),{issue});};
// written: the text this run put in place of a guide slot's guide, to find it again when the slot is written again.
export function createLedger(items,map){
  const paragraphs=paragraphsOf(items),mutable=new Set([...map.sections.flatMap(section=>section.guideParagraphs??[]),...map.slots.filter(slot=>slot.kind==='guide').map(slot=>slot.target)]);
  return{entries:paragraphs.map(p=>({origin:p.id})),original:new Map(paragraphs.map(p=>[p.id,p])),mutable,written:{}};
}
function aligned(ledger,items){
  const now=paragraphsOf(items);
  if(now.length!==ledger.entries.length)stop(`양식 사본의 표 밖 문단이 ${now.length}개입니다. 이 실행이 쓴 결과로는 ${ledger.entries.length}개여야 하므로 쓰기를 멈춥니다.`);
  ledger.entries.forEach((entry,k)=>{
    const was=entry.origin&&!ledger.mutable.has(entry.origin)&&ledger.original.get(entry.origin);
    if(was&&was.text!==now[k].text)stop(`양식의 고정 문단 "${was.text.slice(0,40)}"이 있어야 할 자리에 "${now[k].text.slice(0,40)}"이 있습니다. 쓰기를 멈춥니다.`);
  });
  return now;
}
// The current item of a form paragraph (its ID when the map was made); a cell or field ID does not move.
export function locate(ledger,items,id){
  if(!/^p-\d+$/.test(id??''))return items.find(item=>item.id===id);
  const now=aligned(ledger,items),k=ledger.entries.findIndex(entry=>entry.origin===id);
  return k<0?undefined:now[k];
}
// The paragraphs a section's text is written in, in document order: the map's guide paragraphs and those this run added
// to the section. Nothing else of the form is rewritten or removed.
export function region(ledger,items,section){
  const now=aligned(ledger,items),guides=new Set(section.guideParagraphs??[]);
  return ledger.entries.flatMap((entry,k)=>guides.has(entry.origin)||entry.owner&&entry.owner===section.id?[{item:now[k],origin:entry.origin}]:[]);
}
// After a verified write: the paragraphs it added (after their anchor, owned by the section) or the one it removed.
// before: the items the operation was made from.
export function record(ledger,before,operation,receipt,owner){
  if(!['insert_paragraphs','remove_paragraph'].includes(operation.type))return;
  const now=aligned(ledger,before),at=id=>now.findIndex(item=>item.id===id);
  if(operation.type==='insert_paragraphs'){
    const k=at(operation.after),count=Array.isArray(receipt?.inserted)?receipt.inserted.length:operation.paragraphs.length;
    if(k<0)stop(`넣은 문단의 기준 문단(${operation.after})을 찾지 못했습니다.`);
    ledger.entries.splice(k+1,0,...Array.from({length:count},()=>({owner})));
  }else{
    const k=at(operation.targetId);if(k<0)stop(`지운 문단(${operation.targetId})을 찾지 못했습니다.`);
    ledger.entries.splice(k,1);
  }
}

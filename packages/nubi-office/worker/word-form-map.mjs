// The template map of a Word form (S1 design, part 2): what is filled where and in what format, read from the items
// the host reports (cells, paragraphs, content controls). Code builds it and the model never writes it: the plan, the
// fill sheet and the checks work from it. It is derived from position and guide text only, so a cell whose label is
// not certain goes to unsure instead of being guessed.
import {createHash} from 'node:crypto';
import {guideSpans,isGuideText,valueSpans} from './guide-text.mjs';

// A heading has an outline level, or is a short numbered line ("1. 개요", "Ⅱ. 현황") in a form without heading styles.
const NUMBERED=/^\s*(?:\d{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])\s*\.\s*\S/u;
const NOTE=/^\s*※|작성\s*요령|작성\s*시/;
const DATE_GUIDE=/20XX|0000[-.]\s*00|^X{2}\.\s*X{2}\.?$/;
const blank=text=>!String(text??'').trim();
const clip=(text,max=120)=>String(text??'').trim().slice(0,max);
export const isHeading=item=>item?.kind==='paragraph'&&(item.outlineLevel>=1&&item.outlineLevel<=9||!item.listString&&item.text.length<=40&&NUMBERED.test(item.text)&&!isGuideText(item.text));
export const isNote=item=>item?.kind==='paragraph'&&!isHeading(item)&&NOTE.test(item.text);
// A cell to fill is empty or holds guide text; a cell with other text is a label or fixed text.
const isValueCell=cell=>blank(cell.text)||guideSpans(cell.text).length>0;
// Text that is only guide text: without its guide spans, no letter or digit is left ("(추진 배경을 기재)"). A paragraph
// like that is where a section's text goes; one with a label ("시행일자: 20XX. XX. XX.") is a slot for one value, though
// most of its characters are guide text.
export function wholeGuide(text){
  const spans=valueSpans(text);if(!spans.length)return false;
  let rest=String(text);for(const span of [...spans].reverse())rest=rest.slice(0,span.start)+rest.slice(span.end);
  return!/[\p{L}\p{N}]/u.test(rest);
}
// The mark a guide paragraph keeps before its guide ("○ (추진 배경을 기재)" → "○ "): the form's own bullet.
export function markOf(text){
  const spans=valueSpans(text);if(!spans.length)return'';
  const before=String(text).slice(0,spans[0].start);return before.trim()&&!/[\p{L}\p{N}]/u.test(before)?before:'';
}
export function valueType(label,text){
  const spans=valueSpans(text);
  if(spans.some(span=>span.kind==='period')||/기간/.test(label))return'period';
  if(spans.some(span=>span.kind==='date'||DATE_GUIDE.test(span.text))||/일자|날짜|일시/.test(label))return'date';
  if(spans.some(span=>/^0{1,3}(?:,0{3})+$/.test(span.text))||/금액|예산|비용|단가|합계/.test(label))return'amount';
  return'text';
}
// The label a cell holds before its guide, written as a label ("담당: ○○○ (인)"): kept with the cell's text.
function innerLabel(text){
  if(blank(text)||wholeGuide(text))return'';
  const spans=valueSpans(text),label=spans.length?/^\s*([^:：]{1,20}?)\s*[:：]\s*$/.exec(String(text).slice(0,spans[0].start)):null;
  return label?clip(label[1],40):'';
}
// The label of each body column: a header cell over several columns (a merged cell: span in the simulated host, its
// width in Word, which reports span 1) labels each of them, numbered. The columns are counted in the last body row.
function columnLabels(head,last){
  const count=last?.length??head.length;
  let labels=head.flatMap(cell=>Array.from({length:Math.max(1,cell.span||1)},()=>clip(cell.text,60)));
  if(labels.length!==count&&head.every(cell=>cell.width>0)&&last?.every(cell=>cell.width>0)){
    const edges=[];let x=0;for(const cell of head){edges.push([x,x+cell.width,clip(cell.text,60)]);x+=cell.width;}
    let y=0;labels=last.map(cell=>{const middle=y+cell.width/2;y+=cell.width;return(edges.find(([a,b])=>middle>=a&&middle<b)??edges.at(-1))[2];});
  }
  labels=[...labels,...Array.from({length:Math.max(0,count-labels.length)},()=>labels.at(-1)??'')].slice(0,count);
  const total=new Map(),seen=new Map();for(const label of labels)total.set(label,(total.get(label)??0)+1);
  return labels.map(label=>total.get(label)>1?`${label} ${seen.set(label,(seen.get(label)??0)+1).get(label)}`:label);
}
// A header row over rows that are all empty is a table of rows. Elsewhere a value cell is labelled by the nearest label
// cell to its left (its row) and above it (its column), and by a label inside it. A label two cells share takes the
// other label too ("매출 2025년"), then the row ("품목 (2행)"). Measured 2026-10-01 (review of plan 2): both cells of
// a 매출 row were "매출", and cells under a filled row had no label.
function tableSlots(cells,unsure){
  const rows=[];for(const cell of cells)(rows[cell.row-1]??=[]).push(cell);
  for(const row of rows)row?.sort((a,b)=>a.column-b.column);
  const [head,...body]=rows;
  if(head&&body.length&&head.every(cell=>!isValueCell(cell))&&body.every(row=>row.every(cell=>blank(cell.text)||wholeGuide(cell.text)))){
    const header=columnLabels(head,body.at(-1));
    return[{kind:'rows',target:'t'+head[0].table,label:head.map(cell=>clip(cell.text,30)).join(', '),header,columns:header.length,emptyRows:body.length,required:false}];
  }
  const found=[];
  rows.forEach((row,r)=>row?.forEach((cell,c)=>{
    if(!isValueCell(cell))return;
    const left=row.slice(0,c).reverse().find(other=>!isValueCell(other));
    let above;for(let k=r-1;k>=0&&!above;k--)above=rows[k]?.find(other=>other.column===cell.column&&!isValueCell(other));
    found.push({cell,r,row:left?clip(left.text,40):'',column:above?clip(above.text,40):'',inner:innerLabel(cell.text),by:left??above});
  }));
  const name=entry=>[entry.row||entry.column,entry.inner].filter(Boolean).join(' '),count=labels=>{const n=new Map();for(const label of labels)n.set(label,(n.get(label)??0)+1);return n;};
  let labels=found.map(name),shared=count(labels);
  labels=labels.map((label,i)=>shared.get(label)>1&&found[i].row&&found[i].column?[found[i].row,found[i].column,found[i].inner].filter(Boolean).join(' '):label);
  shared=count(labels);labels=labels.map((label,i)=>label&&shared.get(label)>1?`${label} (${found[i].r+1}행)`:label);
  return found.map(({cell,by,inner},i)=>{
    if(!labels[i])unsure.push({target:cell.id,reason:'라벨을 찾지 못한 칸'});
    const spans=valueSpans(cell.text),period=spans.find(span=>span.parts);
    return{kind:'cell',target:cell.id,label:labels[i],...(by?{labelTarget:by.id}:{}),current:clip(cell.text,200),...(spans.length?{guides:spans.map(span=>span.text)}:{}),...(period?{parts:period.parts}:{}),...(inner?{inner}:{}),
      valueType:valueType(labels[i],cell.text),required:!!labels[i]};
  });
}
export function wordFormMap(snapshot){
  const items=snapshot.items??[],slots=[],sections=[],notes=[],unsure=[],tables=new Map(),placed=new Set();let section=null;
  for(const item of items)if(item.kind==='cell')(tables.get(item.table)??tables.set(item.table,[]).get(item.table)).push(item);
  const add=slot=>{slots.push({id:'s'+(slots.length+1),...slot});};
  for(const item of items){
    if(item.kind==='field'){add({kind:'field',target:item.id,label:clip(item.title||item.tag||item.text,60),valueType:'text',required:true});continue;}
    if(item.kind==='cell'){
      if(placed.has(item.table))continue;placed.add(item.table);section?.tables.push(item.table);
      for(const slot of tableSlots(tables.get(item.table),unsure))add(slot.kind==='rows'&&section?{...slot,label:section.title,section:section.id}:slot);
      continue;
    }
    if(item.kind!=='paragraph')continue;
    if(isHeading(item)){section={id:'sec-'+(sections.length+1),title:clip(item.text,80),heading:item.id,level:item.outlineLevel>=1&&item.outlineLevel<=9?item.outlineLevel:1,body:[],tables:[]};sections.push(section);continue;}
    if(isNote(item)){notes.push({id:'n'+(notes.length+1),target:item.id,text:clip(item.text,200),action:'keep',...(section?{section:section.id}:{})});continue;}
    const spans=valueSpans(item.text);
    // A guide inside a sentence ("시행일자: 20XX. XX. XX.") is a slot labelled by the text before it. Word replaces a guide
    // that appears once in its paragraph: a guide the paragraph repeats ("성명: ○○○  직위: ○○○") is replaced with the
    // label before it (wrap keeps that label).
    if(spans.length&&!wholeGuide(item.text)){
      spans.forEach((span,k)=>{
        const from=k?spans[k-1].end:0,before=item.text.slice(from,span.start),once=text=>item.text.indexOf(text)===item.text.lastIndexOf(text);
        const label=clip(before.replace(/^[\s,，]+|[\s:：]+$/g,''),60)||clip(item.text.slice(0,span.start).replace(/[\s:：]+$/,''),60);
        const guide=once(span.text)?span.text:item.text.slice(from,span.end);
        if(!once(guide)){unsure.push({target:item.id,reason:'같은 안내 문구가 겹친 문단'});return;}
        add({kind:'guide',target:item.id,label,guide,...(guide===span.text?{}:{wrap:[before,'']}),guides:[span.text],...(span.parts?{parts:span.parts}:{}),valueType:valueType(label,span.text),required:true});
      });
      continue;
    }
    section?.body.push(item);
  }
  const finished=sections.map(({body,tables:inside,...rest})=>{
    const text=body.filter(p=>!blank(p.text)),guides=text.filter(p=>wholeGuide(p.text)),blanks=body.filter(p=>blank(p.text));
    // Text goes where the form asks for it: guide paragraphs, or a heading followed only by empty paragraphs.
    const needsText=guides.length>0||!text.length&&!inside.length&&blanks.length>0;
    const sample=guides[0]??text[0]??blanks[0],list=body.find(p=>p.listString),mark=guides[0]?markOf(guides[0].text):'';
    if(needsText&&!sample)unsure.push({section:rest.id,reason:'본문 견본이 없는 목차'});
    // Word copies a sample paragraph as one run (the format of its first run): a guide paragraph of two formats (a mark
    // and a coloured guide) cannot be copied without changing its format, so the section has room for its guide
    // paragraphs only.
    const room=needsText&&guides.length&&guides[0].editable===false?guides.length:0;
    return{...rest,needsText,...(sample?{sample:sample.id,style:sample.style}:{}),...(mark?{mark}:{}),...(room?{room}:{}),...(list?{listSample:list.id,listString:list.listString}:{}),
      guide:guides.map(p=>clip(p.text,120)).join(' / '),guideParagraphs:guides.map(p=>p.id),...(inside.length?{tables:inside}:{})};
  });
  return{kind:'template_map',version:1,host:'word',source:{scopeId:snapshot.scopeId,fingerprint:snapshot.fingerprint,name:snapshot.name},slots,sections:finished,notes,
    styles:[...new Set(finished.filter(s=>s.needsText&&s.style).map(s=>s.style))],unsure};
}
// "칸 6개, 표 행 1개, 안내 문구 1개, 목차 3개, 작성 요령 1개": the plan card and the activity log.
export function mapSummary(map){
  const count=kind=>map.slots.filter(slot=>slot.kind===kind).length,parts=[];
  if(count('cell')+count('field'))parts.push(`칸 ${count('cell')+count('field')}개`);
  if(count('rows'))parts.push(`표 행 ${count('rows')}개`);
  if(count('guide'))parts.push(`안내 문구 ${count('guide')}개`);
  const written=map.sections.filter(section=>section.needsText).length;if(written)parts.push(`목차 ${written}개`);
  if(map.notes.length)parts.push(`작성 요령 ${map.notes.length}개`);
  return parts.join(', ')||'채울 곳 없음';
}
// The structure of the form, not its values: a registered form is the same form when its key is the same.
export function mapStructureKey(map){
  return createHash('sha256').update(JSON.stringify([map.slots.map(slot=>[slot.kind,slot.target,slot.label]),map.sections.map(section=>[section.title,section.needsText,section.style??null]),map.notes.map(note=>note.text)])).digest('hex');
}
// What the model needs to fill the form: slot and section IDs with labels, guide text and the kind of value. Cell
// targets stay with code (research 2026-10-01: do not make the model fill arguments the harness already knows).
export function mapForModel(map){
  return{
    slots:map.slots.map(slot=>({slot:slot.id,kind:slot.kind,label:slot.label,valueType:slot.valueType??'text',
      ...(slot.kind==='rows'?{header:slot.header,emptyRows:slot.emptyRows}:{current:slot.current??slot.guide??'',guides:slot.guides??(slot.guide?[slot.guide]:[])}),...(slot.required?{}:{optional:true})})),
    sections:map.sections.filter(section=>section.needsText).map(section=>({section:section.id,title:section.title,asks:section.guide,list:!!section.listString}))
  };
}
// What registration keeps of the map in the template's usage notes (at most 32,000 characters with the rest): enough to
// tell the same form from a changed one when it is used, and the decisions made at registration (notes kept).
export function registeredFormMap(map){
  return{summary:mapSummary(map),key:mapStructureKey(map),slots:map.slots.map(slot=>[slot.kind,slot.label]),sections:map.sections.map(section=>section.title),notes:map.notes.map(note=>({text:note.text,action:note.action}))};
}
// A form registered before maps were kept, or notes that are not JSON, compare as the same form.
export function compareRegistered(usageNotes,map){
  let registered;try{registered=JSON.parse(usageNotes)?.formMap;}catch{return{same:true};}
  if(!registered?.key)return{same:true};
  return{same:registered.key===mapStructureKey(map),registered};
}

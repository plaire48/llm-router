// Code checks of a filled form against its template map (S1 design, part 4): structure, format and evidence, each with
// the slot or section it is about, so that only what failed is written again. Only new problems count: text the form
// already had (its own numbers, its fixed sentences) is not the run's. The form's paragraphs are found through the
// ledger (form-ledger.mjs), as they were written.
import {guideSpans} from './guide-text.mjs';
import {markOf} from './word-form-map.mjs';
import {sectionBody} from './form-apply.mjs';
import {locate,region} from './form-ledger.mjs';
import {renderValue,numbersIn} from './form-values.mjs';

// A number or list letter typed over Word's own list number ("1. 1. 개요"). Not a date ("10. 5. 착수"), and only the 14
// letters Korean lists use (review of plan 2, 2026-10-01: [가-하] spans 11,000 syllables).
const DOUBLED=/^\s*(?:\d{1,2}[.)](?!\s*\d)|[가나다라마바사아자차카타파하][.)])\s/u;
const line=text=>String(text??'').replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').trim();
// sources: the texts values may come from (fill-sheet.mjs userSources); only the user's count as evidence.
export function formChecks({map,original,filled,sheet,sources,ledger}){
  const checks=[],was=new Map(original.map(item=>[item.id,item])),slots=new Map(map.slots.map(slot=>[slot.id,slot])),at=id=>locate(ledger,filled,id);
  const add=(criterion,met,detail,about={})=>checks.push({criterion,met,...(met||!detail?{}:{detail}),...about});
  const written=section=>region(ledger,filled,section).filter(({item,origin})=>{const mark=markOf(ledger.original.get(origin??section.sample)?.text??'');return(mark&&item.text.startsWith(mark)?item.text.slice(mark.length):item.text).trim();}).map(part=>part.item);
  // Structure: every required slot holds a value, every section its text, the outline and the tables as the form has them.
  for(const slot of map.slots.filter(s=>s.required)){
    const current=at(slot.target),text=current?.text??'',met=!!current&&(slot.kind==='guide'?!text.includes(slot.guide):!!text.trim()&&!guideSpans(text).length);
    add('칸 채움',met,`${slot.label||slot.target}: ${text.trim()||'비어 있음'}`,{slot:slot.id});
  }
  for(const section of map.sections.filter(s=>s.needsText)){
    const body=written(section),met=body.length>0&&!body.some(p=>guideSpans(p.text).length);
    add('목차 본문',met,`${section.title}: ${body.length?'안내 문구가 남음':'본문 없음'}`,{section:section.id});
  }
  const headings=map.sections.map(section=>at(section.heading)),order=headings.map(item=>filled.indexOf(item));
  add('목차 순서',map.sections.every((section,i)=>headings[i]?.text===was.get(section.heading)?.text&&(i===0||order[i]>order[i-1])),headings.map(item=>item?.text??'없음').join(' / '));
  const key=item=>`${item.table}/${item.row}/${item.column}`,before=new Set(original.filter(i=>i.kind==='cell').map(key)),after=filled.filter(i=>i.kind==='cell');
  const rowsTables=new Set(map.slots.filter(slot=>slot.kind==='rows').map(slot=>+slot.target.slice(1)));
  add('표 모양',[...before].every(k=>after.some(i=>key(i)===k))&&after.every(i=>before.has(key(i))||rowsTables.has(i.table)),'');
  // A table of rows the sheet filled keeps no guide text in its rows (template rows it did not use are emptied).
  for(const entry of sheet.rows??[]){
    const slot=slots.get(entry.slot);if(slot?.kind!=='rows')continue;
    const left=after.filter(cell=>cell.table===+slot.target.slice(1)&&cell.row>1&&guideSpans(cell.text).length);
    add('표 안내 문구',!left.length,`${slot.label}: ${left.map(cell=>cell.text).slice(0,3).join(', ')}`,{slot:slot.id});
  }
  // Format: written cells keep their format; section text takes the section's style; no number typed over a list number.
  for(const slot of map.slots.filter(s=>s.kind==='cell'))add('칸 서식',was.get(slot.target)?.formatFingerprint===at(slot.target)?.formatFingerprint,slot.label,{slot:slot.id});
  for(const section of map.sections.filter(s=>s.needsText)){
    const body=written(section),wrong=body.find(p=>p.style!==section.style),doubled=body.find(p=>p.listString&&DOUBLED.test(p.text));
    add('본문 서식',!wrong&&!doubled,wrong?`${section.title}: ${wrong.style}`:`${section.title}: 번호가 겹침`,{section:section.id});
  }
  // Evidence: written values are the sheet's values (checked against their quotes before writing); the numbers of a
  // section are the user's, or the form's own.
  for(const cell of sheet.cells??[]){
    const slot=slots.get(cell.slot);if(!slot)continue;
    const value=renderValue(slot,cell.value),current=at(slot.target)?.text??'';
    const met=slot.kind==='guide'?current.includes(line((slot.wrap?.[0]??'')+value+(slot.wrap?.[1]??''))):slot.kind==='field'?current===line(value):current===value;
    add('값 근거',met,`${slot.label}: ${current}`,{slot:cell.slot});
  }
  const given=numbersIn([...sources.values()].filter(source=>source.role==='user').map(source=>source.text).join('\n'));
  for(const section of map.sections.filter(s=>s.needsText)){
    const own=numbersIn((sectionBody(original,section)?.body??[]).map(p=>p.text).join('\n'));
    const invented=[...numbersIn(written(section).map(p=>p.text).join('\n'))].filter(number=>!given.has(number)&&!own.has(number));
    add('본문 숫자',!invented.length,`${section.title}: ${invented.join(', ')}`,{section:section.id});
  }
  const failed={slots:[...new Set(checks.filter(c=>!c.met&&c.slot).map(c=>c.slot))],sections:[...new Set(checks.filter(c=>!c.met&&c.section).map(c=>c.section))]};
  return{checks,failed,summary:summary(checks)};
}
// "칸 12/12, 목차 4/4, 남은 안내 문구 0, 서식 유지, 근거 확인": the result card of the design (part 4).
function summary(checks){
  const of=name=>checks.filter(c=>c.criterion===name),met=name=>of(name).filter(c=>c.met).length;
  const guides=of('칸 채움').filter(c=>!c.met).length+of('목차 본문').filter(c=>!c.met&&/안내/.test(c.detail??'')).length+of('표 안내 문구').filter(c=>!c.met).length;
  const format=['칸 서식','본문 서식','표 모양','목차 순서'].every(name=>of(name).every(c=>c.met)),evidence=['값 근거','본문 숫자'].every(name=>of(name).every(c=>c.met));
  return`칸 ${met('칸 채움')}/${of('칸 채움').length}, 목차 ${met('목차 본문')}/${of('목차 본문').length}, 남은 안내 문구 ${guides}, 서식 ${format?'유지':'확인 필요'}, 근거 ${evidence?'확인':'확인 필요'}`;
}

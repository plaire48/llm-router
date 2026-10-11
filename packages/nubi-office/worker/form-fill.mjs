// The form-filling run of a Word template copy (S1 design, parts 3 and 4): the map decides the steps; the model writes
// a fill sheet (the cells at once, each section on its own) that code checks; the user approves the whole sheet on one
// card; the host writes it part by part; code checks the result against the map, a checklist review judges what code
// cannot, and what failed is written again, at most twice, before the user is asked.
import {mapForModel,mapSummary} from './word-form-map.mjs';
import {CELL_SHEET,SECTION_SHEET,responseFormat,userSources,parseCellSheet,parseSectionSheet} from './fill-sheet.mjs';
import {renderValue} from './form-values.mjs';
import {applyFill} from './form-apply.mjs';
import {formChecks} from './form-checks.mjs';
import {createLedger,locate,region} from './form-ledger.mjs';
import {CHECKLIST,checklistItems,parseChecklist,reviewSourceExcerpts} from './form-review.mjs';

const CELLS_FORMAT=responseFormat('form_cells',CELL_SHEET),SECTION_FORMAT=responseFormat('form_section',SECTION_SHEET),REVIEW_FORMAT=responseFormat('form_review',CHECKLIST);
const SOURCE_LABEL=id=>id==='request'?'요청':id.startsWith('answer-')?`답변 ${id.slice(7)}`:id.startsWith('history-')?`대화 ${id.slice(8)}`:id;
const CELLS_PROMPT='NUBI_WORD_FORM_CELLS. Fill the slots of this company form from the user\'s words only. Each slot has a label, its current text (empty, or guide text such as ○○○ or 20XX. XX. XX.) and the kind of value. Return JSON {cells:[{slot,value,source,quote}],rows:[{slot,rows:[[text]],source,quote}],missing:[{slot,question}]}. value: the value as the user gave it, without the conversational ending of the request (…이야, …라는 거야, …해 줘); the harness writes it in the form\'s notation, so do not reformat dates or amounts. source: the ID of the user\'s source that holds it (request, answer-N, or history-N of role user). quote: the exact words of that source that hold the value, copied character for character. An assistant passage is context only, never a source: a value found only there goes in missing, so the user confirms it. rows: one row per entry of a table slot, in the user\'s order, one text per header column: divide its words across the header columns by what each header asks; a column the entry gives nothing for stays empty. Search ALL provided user sources before marking missing. A labelled date in the request supplies its matching date slot even when written near section prose or in different date notation. Never ask again for a value that appears in those sources. missing: a required slot whose value no source gives, with one short question in Korean. Never invent or guess a value; leave out an optional slot the user said nothing about. Sections are written in their own steps: this sheet holds only these slots.';
const REVIEW_PROMPT='NUBI_WORD_FORM_REVIEWER. Check the meaning of a filled company form, item by item. Code has already checked structure, format and the evidence of every value (codeChecks). For each item, first copy the words of the filled document (quoteDocument) and of the user (quoteUser) that decide it, then answer met or unmet. For a section target, quoteDocument comes from that target\'s places.text: its written BODY, not the heading. Do not use a heading alone as proof of body content. quoteUser must be ONE short contiguous verbatim excerpt of ONE user source, including punctuation and every intervening list item, never a paraphrase or condensed requirement; an item the quotes cannot decide is unknown. Prefer the shortest exact source excerpt that supports this item. This batch is part of a whole checklist; evaluate only these items. Return JSON {checks:[{item,target,quoteDocument,quoteUser,status}]}, one per item, with its exact target.';
const SECTION_PROMPT='NUBI_WORD_FORM_SECTION. Write the body of ONE section of this company form from the user\'s words. Return JSON {paragraphs:[text],sources:[source IDs]}. Respect a user\'s explicit verbatim sentence for this section: copy that sentence exactly, without extra paragraphs or paraphrase. Table slots are written separately from tableSlots; never duplicate their row data into section prose unless the user explicitly asks for both. One paragraph per item, in the plain report style of Korean company documents; when the section is a list, each paragraph is one item and Word numbers it, so type no numbers or bullets. Use only facts the user gave (role user): every number, date and amount must appear in the user\'s words; an assistant passage is context only. With maxParagraphs, write at most that many paragraphs. No guide text, no heading, no fact that belongs to another section.';
// items: the form copy's items the map was made from. historyWindow: the run's conversation window (context-memory.mjs),
// which picks the passages of a long conversation within the request budget; without it the conversation is sent whole.
export function createFormFill({map,items,request,answers,history,historyWindow,requirements,workflowEvidence=[],structured,ask,approval,read,write,activity}){
  const sheet={cells:[],rows:[],missing:[],sections:[]},original=items,ledger=createLedger(items,map),order=new Map(map.slots.map((slot,i)=>[slot.id,i]));
  let checks=null,unresolved=[],remaining=null;
  const sources=()=>userSources({request,answers,history});
  // The request and the answers whole, the conversation as the window picks it (review of plan 2, 2026-10-01: every
  // turn went whole into every call and the request was cut at 6,000 characters).
  const sourceList=query=>{
    const own=[{id:'request',role:'user',text:String(request??'')},...answers.map((answer,i)=>({id:`answer-${i+1}`,role:'user',text:String(answer?.text??'')}))];
    if(!historyWindow)return[...own,...[...sources()].filter(([id])=>id.startsWith('history-')).map(([id,source])=>({id,role:source.role,text:source.text}))];
    return[...own,...historyWindow(query).passages.map(passage=>({id:passage.sourceId,role:passage.role,...(passage.offset?{offset:passage.offset}:{}),text:passage.text}))];
  };
  const byOrder=entries=>entries.sort((a,b)=>(order.get(a.slot)??0)-(order.get(b.slot)??0));
  // initial: why a repair writes again (the checks or the review). It goes where a refused answer's feedback goes:
  // structured() gives an empty feedback to the first call.
  // only: on a repair, the slots written again; the others keep their values, so the card shows every change
  // (review of plan 2, 2026-10-01: the whole regenerated sheet was written under a card of the failed slots).
  async function cells(initial='',only=null){
    const query=[request,...map.slots.map(slot=>slot.label)].join(' ');
    for(let asked=0;;asked++){
      const value=await structured(feedback=>[{role:'system',content:CELLS_PROMPT},
        {role:'user',content:JSON.stringify({form:{slots:mapForModel(map).slots},requirements,sources:sourceList(query),...(feedback||initial?{feedback:feedback||initial}:{})})}],
        response=>parseCellSheet(response,map,sources()),{responseFormat:CELLS_FORMAT});
      if(only){
        const kept=entry=>!only.includes(entry.slot),fresh=entry=>only.includes(entry.slot);
        Object.assign(sheet,{cells:byOrder([...sheet.cells.filter(kept),...value.cells.filter(fresh)]),rows:byOrder([...sheet.rows.filter(kept),...value.rows.filter(fresh)]),missing:value.missing.filter(fresh)});
      }else Object.assign(sheet,{cells:byOrder(value.cells),rows:byOrder(value.rows),missing:value.missing});
      // A value only the user knows is asked, then the sheet is written again with the answer (at most twice).
      if(!sheet.missing.length||asked>=2)return;
      for(const entry of sheet.missing)await ask({question:entry.question,choices:[],input_mode:'text'});
    }
  }
  async function section(id,initial=''){
    const target=map.sections.find(s=>s.id===id);
    const value=await structured(feedback=>[{role:'system',content:SECTION_PROMPT},
      {role:'user',content:JSON.stringify({section:{id:target.id,title:target.title,asks:target.guide,list:!!target.listString,...(target.room?{maxParagraphs:target.room}:{})},tableSlots:map.slots.filter(slot=>slot.kind==='rows').map(slot=>({id:slot.id,label:slot.label,header:slot.header})),requirements,sources:sourceList([request,target.title,target.guide].join(' ')),...(feedback||initial?{feedback:feedback||initial}:{})})}],
      response=>parseSectionSheet(response,target,sources()),{responseFormat:SECTION_FORMAT});
    sheet.sections=[...sheet.sections.filter(s=>s.section!==id),value];
  }
  // The whole sheet, or after a repair only the parts written again (changed: {slots,sections}).
  function card(changed=null){
    const slot=id=>map.slots.find(s=>s.id===id),keep=(kind,id)=>!changed||changed[kind].includes(id);
    return{cells:sheet.cells.filter(c=>keep('slots',c.slot)).map(c=>({label:slot(c.slot)?.label||c.slot,value:renderValue(slot(c.slot),c.value),source:SOURCE_LABEL(c.source)})),
      rows:sheet.rows.filter(r=>keep('slots',r.slot)).map(r=>({label:slot(r.slot)?.label||r.slot,header:slot(r.slot)?.header??[],rows:r.rows})),
      sections:sheet.sections.filter(s=>keep('sections',s.section)).map(s=>({title:map.sections.find(x=>x.id===s.section)?.title??s.section,paragraphs:s.paragraphs.map(p=>p.text)}))};
  }
  async function review(filled){
    const items=checklistItems(map,requirements,checks.checks);
    if(!items.length)return{checks:[],failed:{slots:[],sections:[]},unresolved:[]};
    const documentText=filled.map(item=>(item.kind==='cell'?'| ':'')+item.text).join('\n').slice(0,20000);
    const places=[...map.sections.filter(s=>s.needsText).map(s=>({target:s.id,text:region(ledger,filled,s).map(part=>part.item.text).join('\n')})),...map.slots.map(slot=>({target:slot.id,text:locate(ledger,filled,slot.target)?.text??''}))];
    // Keep every original item, but ask for bounded batches so the model does
    // not lose IDs or rewrite a long quote while producing a large checklist.
    // No item is dropped and unknowns remain unresolved in the final review.
    const results=[];
    for(let start=0;start<items.length;start+=4){
      const batch=items.slice(start,start+4),batchPlaces=places.filter(p=>batch.some(i=>i.target===p.target));
      const reviewSources=sourceList([request,...requirements].join(' ')),sourceExcerpts=reviewSourceExcerpts(reviewSources);
      results.push(await structured(feedback=>[{role:'system',content:REVIEW_PROMPT+' Prefer a sourceExcerpts ID to recopying user text: set quoteUser:"" and sourceExcerpt to the exact ID of the passage that decides the item. The harness resolves it to that literal current user passage. You may select the whole request excerpt when an item covers several separated facts. Never join separated passages. Keep item and target as given. workflowEvidence is supplied by the harness, separate from document text. A pure copy/save workflow requirement may quote its actual evidence.text as quoteDocument. verified_copy proves connection to the verified copy; save_after_review proves only the pending save contract, never that a file is already saved. For such a future save requirement evaluate that contract; final saving is enforced separately after this review. Never use workflow evidence to prove section content.'},
        {role:'user',content:JSON.stringify({items:batch,places:batchPlaces,codeChecks:checks.summary,document:documentText,workflowEvidence,sources:reviewSources,sourceExcerpts,...(feedback?{feedback}:{})})}],
        response=>parseChecklist(response,{items:batch,documentText,sources:sources(),places,workflowEvidence,sourceExcerpts}),{responseFormat:REVIEW_FORMAT}));
    }
    return{checks:results.flatMap(r=>r.checks),failed:{slots:[...new Set(results.flatMap(r=>r.failed.slots))],sections:[...new Set(results.flatMap(r=>r.failed.sections))]},unresolved:results.flatMap(r=>r.unresolved)};
  }
  const describe=id=>map.slots.find(s=>s.id===id)?.label||map.sections.find(s=>s.id===id)?.title||id;
  // A write that stopped says how far it got (S1 design, part 3), in the activity log and in the run's error.
  function stopped({operations,failed}){
    const what=operation=>operation?`${operation.type} ${operation.targetId??operation.after??''}`.trim():'';
    const reason=failed.blocked??(failed.refused?`Word가 ${what(failed.operation)} 쓰기를 거부했습니다(${failed.refused})`:failed.checks?`${what(failed.operation)}의 검사(${failed.checks.filter(c=>c.status!=='met').map(c=>c.requirement).join(', ')||'검사 없음'})가 맞지 않았습니다`:failed.repeated?'같은 쓰기가 되풀이되었습니다':'쓰기가 너무 많습니다');
    const issue=`양식 쓰기가 멈췄습니다. ${operations.length}개 부분을 썼고, ${reason}. 원본 양식은 바뀌지 않았습니다.`;
    activity.note(issue,'양식 쓰기');
    return Object.assign(new Error('content_verification_failed'),{issue});
  }
  async function applyAndCheck(){
    let changed=null;
    for(let round=0;;round++){
      await approval({kind:'form_fill',title:round?'다시 쓴 내용을 확인해 주세요':'양식에 채울 내용을 확인해 주세요',summary:round?'검사에서 맞지 않은 곳만 다시 썼습니다.':mapSummary(map),target:map.source.name,
        verification:'승인하면 양식 사본의 칸과 목차에 차례로 쓰고, Office가 쓸 때마다 서식과 다른 칸을 검사합니다. 원본 양식은 바뀌지 않습니다.',fill:card(changed)});
      const result=await applyFill({map,sheet,read,apply:write,ledger});
      if(!result.done)throw stopped(result);
      const filled=(await read()).items;
      checks=formChecks({map,original,filled,sheet,sources:sources(),ledger});
      const verdict=await review(filled),slots=[...new Set([...checks.failed.slots,...verdict.failed.slots])],sections=[...new Set([...checks.failed.sections,...verdict.failed.sections])];
      unresolved=verdict.unresolved??[];
      activity.note(checks.summary,'양식 검사');
      if(!slots.length&&!sections.length){remaining=null;return;}
      const what=[...slots,...sections].map(describe).join(', ');
      // Two repairs, then the user says what is wrong, and one more repair with that answer. What still fails after it
      // is not passed over: the log says it, and the final review sees it (review of plan 2, 2026-10-01).
      if(round===2)await ask({question:`다음 곳이 요청과 맞는지 확인하지 못했습니다: ${what}. 고칠 내용을 알려 주시면 그곳만 다시 씁니다.`,choices:[],input_mode:'long_text'});
      else if(round>2){remaining={slots,sections,what};activity.note(`양식 검사에서 확인이 필요한 곳이 남았습니다: ${what}`,'확인 필요');return;}
      const reasons=[...checks.checks.filter(c=>!c.met).map(c=>c.detail),...verdict.checks.filter(c=>c.status==='unmet').map(c=>c.item)].filter(Boolean).join('; ');
      if(slots.length)await cells(`These slots failed the checks; write them again: ${slots.join(', ')}. ${reasons}`.slice(0,1500),slots);
      for(const id of sections)await section(id,`This section failed the checks; write it again. ${reasons}`.slice(0,1500));
      changed={slots,sections};
    }
  }
  return{
    steps:()=>[...(map.slots.length?[{kind:'form_cells',title:'칸 채우기'}]:[]),...map.sections.filter(s=>s.needsText).map(s=>({kind:'form_section',section:s.id,title:`본문 작성: ${s.title}`})),{kind:'form_apply',title:'양식에 반영하고 검사'}],
    async run(step){if(step.kind==='form_cells')return cells();if(step.kind==='form_section')return section(step.section);if(step.kind==='form_apply')return applyAndCheck();throw new Error('unsupported_operation');},
    state:()=>({sheet,checks,unresolved,remaining})
  };
}

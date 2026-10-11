// The checklist review of a filled form (S1 design, part 4): a yes/no item for what code cannot judge, the meaning of
// each written section and the plan's requirements that no code check covers. The reviewer quotes the document and the
// user before each answer, and an objection whose quotes are not in the document or the user's words is not trusted:
// it becomes unknown (research 2026-10-01: quote-first review; TICK checklists).
import Type from 'typebox';
import {Value} from 'typebox/value';
import {modelJson} from './model-json.mjs';
import {createHash} from 'node:crypto';

export const CHECKLIST=Type.Object({checks:Type.Array(Type.Object({item:Type.String({maxLength:400}),target:Type.String({maxLength:40}),quoteDocument:Type.String({maxLength:800}),quoteUser:Type.String({maxLength:800}),sourceExcerpt:Type.Optional(Type.String({pattern:'^u[a-f0-9]{16}$'})),status:Type.Union([Type.Literal('met'),Type.Literal('unmet'),Type.Literal('unknown')])},{additionalProperties:false}),{maxItems:40})},{additionalProperties:false});
const refuse=issue=>{throw Object.assign(new Error('document_schema_invalid'),{issue});};
const plain=text=>String(text??'').normalize('NFC').replace(/\s+/g,'');
// A review of several labels may cite several lines with the value cells
// between them omitted. Validate EVERY excerpt; never validate their join as
// if it were one contiguous source passage, and never accept a fabricated line.
const excerpts=text=>String(text??'').split(/\r?\n/).map(plain).filter(Boolean);
// A model can point to a literal passage rather than recopy a long list and
// omit intervening words. IDs bind the source and exact passage; the parser
// independently checks it against the current user's source again.
export function reviewSourceExcerpts(sources){
  const out=[],seen=new Set();
  for(const source of sources.filter(s=>s.role==='user')){
    const pieces=[...(source.text.length<=800?[source.text]:[]),...source.text.split(/\r?\n|(?<=[.!?。])\s+/u).filter(Boolean).map(t=>t.slice(0,800))];
    for(const text of pieces){const id='u'+createHash('sha256').update(source.id+'\n'+text).digest('hex').slice(0,16);if(!text||seen.has(id))continue;seen.add(id);out.push({id,source:source.id,text});if(out.length>=128)return out;}
  }
  return out;
}
export function checklistItems(map,requirements,checks){
  const judged=new Set(checks.filter(c=>c.slot).map(c=>c.slot));
  const sectionItems=map.sections.filter(s=>s.needsText).map(s=>({item:`"${s.title}"가 요청이 그 목차에 원한 내용을 담았는가`,target:s.id}));
  // A requirement about the header values is judged by code (every slot is checked); the others are asked.
  const requirementItems=requirements.map((text,i)=>({item:`요구사항 "${text}"를 지켰는가`,target:`requirement-${i+1}`})).filter((_,i)=>!/칸|머리\s*표|값/.test(requirements[i])||!judged.size);
  return[...sectionItems,...requirementItems];
}
// places: the written text of each section and slot ({target, text}). An unmet requirement is repaired where the
// document words it quotes are; one whose quote is in no written place stays unresolved, for the user and the final
// review (review of plan 2, 2026-10-01: unmet requirements were dropped). Only the user's words are the user's: an
// objection quoting the assistant as the user is not trusted.
export function parseChecklist(response,{items,documentText,sources,places=[],workflowEvidence=[],sourceExcerpts=[]}){
  const value=modelJson(response?.content,'document_schema_invalid');
  for(const c of Array.isArray(value?.checks)?value.checks:[]){
    if(c?.target===undefined){const exact=items.filter(i=>i.item===c.item);if(exact.length===1)c.target=exact[0].target;}
  }
  let parsed;try{parsed=Value.Parse(CHECKLIST,Value.Convert(CHECKLIST,value));}catch{refuse(`Return {checks:[{item,target,quoteDocument,quoteUser,status}]}: ${[...Value.Errors(CHECKLIST,value)].slice(0,3).map(e=>`${e.instancePath||'/'} ${e.message}`).join('; ')}.`);}
  const targets=new Set(items.map(i=>i.target)),answered=new Set(parsed.checks.map(c=>c.target));
  const extra=parsed.checks.filter(c=>!targets.has(c.target)),open=items.filter(i=>!answered.has(i.target));
  if(extra.length||open.length||parsed.checks.length!==answered.size)refuse(`Answer each item once by its target: ${items.map(i=>i.target).join(', ')}.`);
  const users=[...sources.values()].filter(s=>s.role==='user'),doc=plain(documentText);
  const checks=parsed.checks.map(c=>{
    if(c.sourceExcerpt){
      const excerpt=sourceExcerpts.find(e=>e.id===c.sourceExcerpt),source=excerpt&&sources.get(excerpt.source);
      if(!excerpt||source?.role!=='user'||!source.text.includes(excerpt.text)||c.quoteUser&&c.quoteUser!==excerpt.text)refuse('sourceExcerpt must name an exact passage in the current user sources, with quoteUser empty or exactly that passage.');
      c={...c,quoteUser:excerpt.text};
    }
    const quotes=excerpts(c.quoteDocument),workflow=workflowEvidence.filter(e=>['verified_copy','save_after_review'].includes(e.kind)).map(e=>plain(e.text));
    const criterion=items.find(i=>i.target===c.target)?.item??'',workflowOnly=c.target.startsWith('requirement-')&&/저장|사본|원본|save|copy/i.test(criterion)&&!/본문|입력|문구|금액|수량|body|content|amount/i.test(criterion);
    const documentReal=quotes.length>0&&quotes.every(quote=>doc.includes(quote)||workflowOnly&&workflow.includes(quote)),userReal=plain(c.quoteUser)&&users.some(s=>plain(s.text).includes(plain(c.quoteUser))),real=documentReal&&(!plain(c.quoteUser)||userReal);
    if(c.status==='met'&&!documentReal)refuse(`quoteDocument for ${c.target} contains an empty or nonexistent excerpt. Copy exact document excerpts, one per line. Never invent words; return unknown if undecidable.`);
    if(c.status==='met'&&!userReal)refuse(`quoteUser for ${c.target} is NOT verbatim in any user source. Copy one CONTIGUOUS excerpt exactly, including the full list and punctuation; never paraphrase or join separated words. Available user source excerpts: ${JSON.stringify(users.slice(0,3).map(s=>String(s.text).slice(0,800)))}. Return unknown if undecidable.`);
    const place=places.find(p=>p.target===c.target);
    if(c.status==='met'&&place&&!quotes.every(quote=>plain(place.text).includes(quote)))refuse(`Quote the written content of ${c.target}, not another section or slot.`);
    return c.status==='unmet'&&!real?{...c,status:'unknown',downgraded:true}:c;
  });
  const unmet=checks.filter(c=>c.status==='unmet'),failed=new Set(unmet.filter(c=>!c.target.startsWith('requirement-')).map(c=>c.target)),unresolved=checks.filter(c=>c.status==='unknown');
  for(const check of unmet.filter(c=>c.target.startsWith('requirement-'))){
    const where=places.filter(place=>excerpts(check.quoteDocument).some(quote=>plain(place.text).includes(quote))).map(place=>place.target);
    if(where.length)for(const target of where)failed.add(target);else unresolved.push(check);
  }
  return{checks,failed:{slots:[...failed].filter(t=>/^s\d+$/.test(t)),sections:[...failed].filter(t=>t.startsWith('sec-'))},unresolved};
}

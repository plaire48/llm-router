// The fill sheet (S1 design, part 3): the model writes only this, and code checks it before Office sees anything.
// Each value names where the user gave it (request, answer-N or history-N) and quotes those words; a value that is not
// in its quote, a quote that is not in its source, a required slot left out, or a number the user never gave is
// refused with the reason, so that the next answer corrects it.
import Type from 'typebox';
import {Value} from 'typebox/value';
import {modelJson} from './model-json.mjs';
import {guideSpans} from './guide-text.mjs';
import {quoteHolds,numbersIn,parseDate,parsePeriod} from './form-values.mjs';

const Source=Type.String({maxLength:40});
export const CELL_SHEET=Type.Object({
  cells:Type.Array(Type.Object({slot:Type.String({maxLength:20}),value:Type.String({maxLength:1000}),source:Source,quote:Type.String({maxLength:600})},{additionalProperties:false}),{maxItems:120}),
  rows:Type.Array(Type.Object({slot:Type.String({maxLength:20}),rows:Type.Array(Type.Array(Type.String({maxLength:500}),{maxItems:12}),{maxItems:60}),source:Source,quote:Type.String({maxLength:3000})},{additionalProperties:false}),{maxItems:20}),
  missing:Type.Array(Type.Object({slot:Type.String({maxLength:20}),question:Type.String({maxLength:300})},{additionalProperties:false}),{maxItems:20})
},{additionalProperties:false});
export const SECTION_SHEET=Type.Object({paragraphs:Type.Array(Type.String({maxLength:1500}),{maxItems:40}),sources:Type.Array(Source,{maxItems:10})},{additionalProperties:false});
const LIMITS=new Set(['maxLength','minLength','maxItems','minItems']);
// The schema an AI Pro (vLLM) server enforces with response_format: the same shape without the length and count limits,
// which guided decoding does not take everywhere; the limits are checked after parsing.
export function responseFormat(name,schema){
  const strip=value=>Array.isArray(value)?value.map(strip):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!LIMITS.has(key)).map(([key,item])=>[key,strip(item)])):value;
  return{type:'json_schema',json_schema:{name,strict:true,schema:strip(JSON.parse(JSON.stringify(schema)))}};
}
const refuse=issue=>{throw Object.assign(new Error('document_schema_invalid'),{issue});};
// hint: a shape the model is known to confuse, told in its own words before the schema's errors.
// A number where text is asked (1100000 for a value) is read as text first: without response_format the model may write
// one (TypeBox 1.3 Value.Parse does not convert unless told to).
function parse(schema,response,hint=()=>null){
  const value=modelJson(response?.content,'document_schema_invalid'),issue=hint(value);if(issue)refuse(issue);
  try{return Value.Parse(schema,Value.Convert(schema,value));}
  catch{refuse(`Return the JSON object exactly as asked: ${[...Value.Errors(schema,value)].slice(0,4).map(error=>`${error.instancePath||'/'} ${error.message}`).join('; ')}.`);}
}
// The texts a value may come from: the request, the user's answers and the conversation (history-N as the history
// context numbers its sources).
export function userSources({request,answers=[],history=[]}){
  const sources=new Map([['request',{role:'user',text:String(request??'')}]]);
  answers.forEach((answer,i)=>sources.set(`answer-${i+1}`,{role:'user',text:String(answer?.text??'')}));
  history.filter(message=>['user','assistant'].includes(message?.role)&&typeof message.content==='string').forEach((message,i)=>sources.set(`history-${i+1}`,{role:message.role,text:message.content}));
  return sources;
}
const plain=text=>String(text??'').normalize('NFC').replace(/\s+/g,' ').trim();
// Only the user's words are evidence for a value or a number: the request, the answers and the user's turns. The
// assistant's turns are context (a short answer needs its question) but not a source: a value found only there is asked.
// Measured 2026-10-01 (review of plan 2): an estimate the assistant gave ("약 2,500만 원 예상") passed as the user's.
const userText=sources=>[...sources.values()].filter(source=>source.role==='user').map(source=>source.text).join('\n');
// The years a date without one may take: those the user wrote, and this year. A date the user wrote without a year is
// written with the year of the first full date the user gave, else the first year named, else this year.
export function userYears(sources,today=new Date()){
  const text=userText(sources),full=/(\d{4})\s*(?:년|[-./])\s*\d{1,2}\s*(?:월|[-./])\s*\d{1,2}/.exec(text),named=[...text.matchAll(/(?<!\d)((?:19|20)\d{2})\s*년/g)].map(match=>+match[1]);
  const now=today.getFullYear(),year=full?+full[1]:named[0]??now;
  return{year,years:[...new Set([...named,...[...text.matchAll(/(?<!\d)((?:19|20)\d{2})(?=\s*[-./]\s*\d)/g)].map(match=>+match[1]),now])]};
}
const two=n=>String(n);
const spelled=({y,m,d})=>`${y}년 ${two(m)}월 ${two(d)}일`;
function withYear(type,value,year){
  if(type==='date'&&!parseDate(value)){const date=parseDate(value,{year});return date?spelled(date):value;}
  if(type==='period'&&!parsePeriod(value)){const period=parsePeriod(value,{year});return period?`${spelled(period.start)} ~ ${spelled(period.end)}`:value;}
  return value;
}
// Measured 2026-10-01 (gpt-5.6-luna): rows of a table slot put in cells, and sections named in missing, three times in a
// row. Rows in cells are refused with where they go; a section in missing is dropped: sections have their own steps.
const rowsInCells=map=>value=>{const entry=Array.isArray(value?.cells)?value.cells.find(cell=>cell&&typeof cell==='object'&&'rows' in cell):null;
  return entry?`${entry.slot} is a table slot: put it in rows as {slot, rows:[[text per column]], source, quote}, not in cells.`:null;};
export function parseCellSheet(response,map,sources,{today=new Date()}={}){
  const sheet=parse(CELL_SHEET,response,rowsInCells(map)),bySlot=new Map(map.slots.map(slot=>[slot.id,slot])),problems=[],seen=new Set(),{year,years}=userYears(sources,today);
  sheet.missing=sheet.missing.filter(entry=>!/^sec-\d+$/.test(entry.slot));
  const quoted=(source,quote)=>sources.get(source)?.role==='user'&&plain(quote).length>0&&plain(sources.get(source).text).includes(plain(quote));
  const assistant=source=>sources.get(source)?.role==='assistant';
  for(const cell of sheet.cells){
    const slot=bySlot.get(cell.slot);
    if(!slot||!['cell','guide','field'].includes(slot.kind)){problems.push(`${cell.slot} is not a cell, guide or field slot of the map`);continue;}
    if(seen.has(cell.slot))problems.push(`${cell.slot} is filled twice`);seen.add(cell.slot);
    if(!plain(cell.value))problems.push(`${cell.slot} has no value: put a slot without a value in missing`);
    else if(guideSpans(cell.value).length)problems.push(`${cell.slot} value is guide text, not the user's value`);
    else if(assistant(cell.source))problems.push(`${cell.slot} quote is the assistant's (${cell.source}): only the user's words are a source; ask the user in missing`);
    else if(!quoted(cell.source,cell.quote))problems.push(`${cell.slot} quote is not in ${cell.source}: copy the user's words exactly`);
    else if(!quoteHolds(slot,cell.value,cell.quote,{years}))problems.push(`${cell.slot} value "${cell.value}" is not in its quote`);
  }
  for(const entry of sheet.rows){
    const slot=bySlot.get(entry.slot);
    if(slot?.kind!=='rows'){problems.push(`${entry.slot} is not a rows slot`);continue;}
    if(seen.has(entry.slot))problems.push(`${entry.slot} is filled twice`);seen.add(entry.slot);
    if(entry.rows.some(row=>row.length!==slot.columns)){problems.push(`${entry.slot} rows have ${slot.columns} texts each (${slot.header.join(', ')})`);continue;}
    if(assistant(entry.source)){problems.push(`${entry.slot} quote is the assistant's (${entry.source}): only the user's words are a source`);continue;}
    if(!quoted(entry.source,entry.quote)){problems.push(`${entry.slot} quote is not in ${entry.source}`);continue;}
    const outside=entry.rows.flat().filter(text=>plain(text)&&!quoteHolds({valueType:'text'},text,entry.quote)&&!quoteHolds({valueType:'date'},text,entry.quote,{years}));
    if(outside.length)problems.push(`${entry.slot} values not in its quote: ${outside.slice(0,3).join(', ')}`);
  }
  for(const entry of sheet.missing){
    if(!bySlot.has(entry.slot))problems.push(`missing names ${entry.slot}, not a slot`);
    else if(seen.has(entry.slot))problems.push(`${entry.slot} is both filled and missing`);
    else if(!plain(entry.question))problems.push(`${entry.slot} needs a question`);
    seen.add(entry.slot);
  }
  const open=map.slots.filter(slot=>slot.required&&['cell','guide','field'].includes(slot.kind)&&!seen.has(slot.id));
  if(open.length)problems.push(`required slots without a value or a question: ${open.map(slot=>`${slot.id} (${slot.label||slot.target})`).join(', ')}`);
  if(problems.length)refuse(problems.slice(0,8).join('; ')+'.');
  for(const cell of sheet.cells)cell.value=withYear(bySlot.get(cell.slot).valueType,cell.value,year);
  return sheet;
}
// One section's text: paragraphs in the form's style. A number, list letter or bullet the model typed at the start is
// dropped (Word numbers a list paragraph) and marks the paragraph as a list item. Measured 2026-10-01 (review of plan
// 2): [가-하] spans 11,000 syllables ("주) 2025년 기준" lost 주) and "10. 5. 착수" lost its month. A mark is one of the 14
// letters Korean lists use, a number not followed by another number, or a bullet, each followed by a space (or ")").
const MARK=/^\s*(?:\d{1,2}[.)](?!\s*\d)\s*|[가나다라마바사아자차카타파하][.)]\s+|[①-⑳]\s*|[-•*▪◦○]\s+)/u;
export function parseSectionSheet(response,section,sources){
  const sheet=parse(SECTION_SHEET,response),problems=[];
  // A line break is a new paragraph: Word takes no control character in one (ContentPort.cs String).
  const lines=sheet.paragraphs.flatMap(text=>text.split(/\r?\n/)).map(text=>text.replace(/[\u0000-\u001f\u007f-\u009f]+/g,' '));
  const paragraphs=lines.map(text=>({text:text.replace(MARK,'').trim(),list:MARK.test(text)})).filter(paragraph=>paragraph.text);
  if(!paragraphs.length)problems.push('paragraphs holds the section text, one paragraph per item');
  if(section.room&&paragraphs.length>section.room)problems.push(`write at most ${section.room} paragraph${section.room>1?'s':''}: the form has room for ${section.room} here; put related items in one paragraph`);
  const given=numbersIn(userText(sources));
  const invented=[...new Set(paragraphs.flatMap(paragraph=>[...numbersIn(paragraph.text)]))].filter(number=>!given.has(number));
  if(invented.length)problems.push(`these numbers are not in the user's words: ${invented.slice(0,6).join(', ')}. Use only numbers the user gave`);
  if(paragraphs.some(paragraph=>guideSpans(paragraph.text).length))problems.push('the text holds guide marks such as ○○○ or (내용 기재): write the user\'s facts instead');
  if(problems.length)refuse(problems.join('; ')+'.');
  return{section:section.id,paragraphs};
}

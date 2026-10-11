import {validateContentOperation} from './content-operation-validation.mjs';
import {guideSpans,isGuideText} from './guide-text.mjs';
import {modelJson} from './model-json.mjs';
import {validateContentText} from './content-integrity.mjs';
const fail=()=>{throw new Error('document_schema_invalid');};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,n=4000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const keys=(v,list)=>object(v)&&Object.keys(v).every(k=>list.includes(k));
// A refused plan says which rule it broke, as a refused verdict does (below).
const planRefused=issue=>{throw Object.assign(new Error('document_schema_invalid'),{issue});};
export function contentTask(response) {
  if(response?.calls?.length||response?.finishReason==='length')fail();
  const v=modelJson(response?.content,'document_schema_invalid');
  if(!keys(v,['intent','title','summary','requirements','steps','save','question']))planRefused('Return only intent, title, summary, requirements, steps, save and question.');
  if(!['create','edit','template','register','analyze','clarify','unsupported'].includes(v.intent))planRefused('intent is create, edit, template, register, analyze, clarify or unsupported.');
  if(!text(v.title,100)||!text(v.summary,500))planRefused('title (at most 100 characters) and summary (at most 500) are required text.');
  if(['clarify','unsupported'].includes(v.intent)) {if(v.intent==='clarify'&&!v.question)planRefused('clarify needs a question.');return v;}
  if(!Array.isArray(v.requirements)||!v.requirements.length||v.requirements.length>16||v.requirements.some(r=>!text(r,400)))planRefused('requirements is a list of 1 to 16 texts of at most 400 characters.');
  if(typeof v.save!=='boolean')planRefused('save is true or false.');
  if(!Array.isArray(v.steps)||v.steps.length<3||v.steps.length>10)planRefused('steps is a list of 3 to 10 steps.');
  if(v.steps.some(s=>!keys(s,['id','title','kind'])||!/^[a-z0-9_-]{1,40}$/.test(s.id)||!text(s.title,100)||!['inspect','write','analyze','verify'].includes(s.kind)))planRefused('Each step is {id (lowercase letters, digits, - or _), title, kind: inspect|write|analyze|verify}.');
  if(new Set(v.steps.map(s=>s.id)).size!==v.steps.length)planRefused('Step ids are unique.');
  if(v.steps[0].kind!=='inspect'||v.steps.at(-1).kind!=='verify')planRefused('The first step is inspect and the last is verify.');
  if(['analyze','register'].includes(v.intent)&&(v.save||v.steps.some(s=>s.kind==='write')))planRefused(`${v.intent} does not write or save: save false, no write steps.`);
  if(['create','template'].includes(v.intent)&&!v.save)planRefused(`${v.intent} saves: save true.`);
  if(['create','edit','template'].includes(v.intent)&&!v.steps.some(s=>s.kind==='write'))planRefused(`${v.intent} needs at least one write step.`);
  return v;
}
// char.IsControl, as the hosts test text.
const CONTROL=/[\u0000-\u001f\u007f-\u009f]/;
// Word refuses a part where the document itself would break (native WordContentTables.cs, and the simulated host
// alike): the actor learns the rule instead of a bare unsupported_target.
const WORD_RULES={
  fill_cell:'Word refused the cell: it has fields, content controls, pictures, a nested table or more than one paragraph.',
  replace_guide:'Word refused: the guide must appear exactly once in the target, as plain text.',
  insert_paragraphs:'Word refused: after may not be the last paragraph of the document, and like must be a paragraph of plain text (no fields, content controls, bookmarks, pictures or breaks).',
  remove_paragraph:'Word refused: the last paragraph stays, and so does a paragraph between two tables (removing it would join them). Clear its text with replace_text instead.',
  add_rows:'Word refused: rows are added only under a last row without vertically merged cells.'
};
export function partRefusal(operation,cause){
  if(cause?.message==='unsupported_target'&&typeof cause.issue!=='string'&&Object.hasOwn(WORD_RULES,operation?.type))cause.issue=WORD_RULES[operation.type];
  return cause;
}
// Where the Word form parts may write (S1 design, part 1). A refusal says what the part takes.
function formPart(op,snapshot){
  const target=id=>snapshot.items.find(i=>i.id===id),refuse=issue=>{throw Object.assign(new Error('unsupported_target'),{issue});};
  if(op.type==='fill_cell'){
    const cell=target(op.targetId);
    if(cell?.kind!=='cell'||!cell.editable)refuse('fill_cell writes a table cell item (t{n}/r{n}/c{n}) of this document that can be written.');
  }
  if(op.type==='replace_guide'){
    const item=target(op.targetId),spans=guideSpans(item?.text).map(span=>span.text);
    // A cell of guide text only is written whole (measured 2026-10-01: 20XX. XX. XX. ~ XX. XX. sent as one span).
    const whole=item?.kind==='cell'&&item.editable&&isGuideText(item.text)?' This cell holds only guide text: write the whole cell with fill_cell.':'';
    if(!['paragraph','cell'].includes(item?.kind)||!item.writable||!spans.includes(op.guide))refuse(`guide is one guide span of that paragraph or cell, exactly as written: ${JSON.stringify(spans)}.${whole}`);
  }
  // With every item read (in document order), the neighbours of a paragraph and the last paragraph are known; with
  // pages unread, Word decides and partRefusal says why.
  const whole=snapshot.items.length===snapshot.total,position=id=>snapshot.items.findIndex(i=>i.id===id);
  if(op.type==='insert_paragraphs'){
    const anchor=target(op.after),samples=[op.like,...op.paragraphs.map(p=>p.like).filter(Boolean)];
    if(anchor?.kind!=='paragraph'||!anchor.writable||samples.some(id=>target(id)?.kind!=='paragraph'))refuse('after is a paragraph that can be written; like names observed paragraphs.');
    if(samples.some(id=>{const sample=target(id);return sample.fields||sample.controls||CONTROL.test(sample.text??'');}))refuse('like names a paragraph of plain text: Word copies the sample with its paragraph mark, so it has no fields, content controls or breaks.');
    if(whole&&position(op.after)===snapshot.items.length-1)refuse('after may not be the last paragraph of the document: Word keeps its last paragraph mark last. Insert after the paragraph before it, or write into the last paragraph.');
  }
  if(op.type==='remove_paragraph'){
    const item=target(op.targetId),at=position(op.targetId);
    if(item?.kind!=='paragraph'||!item.writable||!/^\s*※|작성\s*요령|작성\s*시/.test(item.text))refuse('remove_paragraph removes only a writing note of the form (※, 작성 요령).');
    if(whole&&snapshot.items[at-1]?.kind==='cell'&&snapshot.items[at+1]?.kind==='cell')refuse('This note is between two tables: removing it would join them into one table. Keep it, or clear its text with replace_text.');
  }
  if(op.type==='add_rows'){
    const t=+op.targetId.slice(1),cells=snapshot.items.filter(i=>i.kind==='cell'&&i.table===t),last=Math.max(0,...cells.map(c=>c.row));
    if(!cells.length||!cells.filter(c=>c.row===last).every(c=>c.writable))refuse('add_rows extends a table of this document whose last row can be written.');
  }
}
export function contentOperation(host, input, snapshot) {
  const op=validateContentOperation(host,input);
  if(host==='word')formPart(op,snapshot);
  if(['append_paragraph','append_table','add_slide'].includes(op.type)&&!snapshot.created)throw new Error('out_of_scope');
  if(op.type==='replace_table_cell'){
    const target=snapshot.items.find(i=>i.id===op.targetId);
    if(host!=='powerpoint'||target?.kind!=='cell'||target.editable!==true||typeof target.tableId!=='string'||!Number.isInteger(target.row)||!Number.isInteger(target.column))throw new Error('unsupported_target');
  }else if(['replace_text_fragment','replace_notes_fragment'].includes(op.type)){
    const notes=op.type==='replace_notes_fragment',target=snapshot.items.find(i=>i.id===op.targetId),current=target?.[notes?'notes':'text']??'',at=current.indexOf(op.findText);
    if(notes?host!=='powerpoint'||target?.kind!=='slide'||target.notesFragmentEditable!==true:target?.kind!==(host==='word'?'paragraph':'shape')||target.fragmentEditable!==true)throw new Error('unsupported_target');
    if(at<0||current.indexOf(op.findText,at+1)>=0||current.length-op.findText.length+op.text.length>4000)throw Object.assign(new Error('invalid_plan'),{issue:'findText must occur exactly once in the observed target; replacement stays inline and within 4000 characters.'});
    if(host==='word'&&!target.textRuns?.some(run=>at>=run.start&&at+op.findText.length<=run.start+run.length))throw Object.assign(new Error('unsupported_target'),{issue:'Use the smallest changed literal inside one observed textRuns format. Never replace a whole mixed-format paragraph or cross its emphasis boundary.'});
  } else if(op.type==='replace_text'||op.type==='fill_field') {
    const target=snapshot.items.find(i=>i.id===op.targetId);
    if(!target?.editable)throw new Error('unsupported_target');
    if(op.type==='fill_field'&&(target.kind!=='field'||target.controlType!==1||target.mapped!==false||target.locked!==false||target.temporary!==false||target.nested!==false))throw new Error('unsupported_target');
    if(op.type==='replace_text'&&target.kind==='cell')throw Object.assign(new Error('unsupported_target'),{issue:'replace_text writes a whole paragraph (p-N). A table cell is written with fill_cell, or one guide span in it with replace_guide.'});
    if(op.type==='replace_text'&&target.kind!==(host==='word'?'paragraph':'shape'))throw new Error('unsupported_target');
  } else if(['add_slide','set_slide_content'].includes(op.type)) {
    if(op.type==='set_slide_content'&&(!snapshot.created||!snapshot.items.some(i=>i.id===op.targetId&&i.kind==='slide'&&i.editable===true)))throw new Error('out_of_scope');
  } else if(op.type==='duplicate_slide') {
    if(!snapshot.items.some(i=>i.id===op.targetId&&i.kind==='slide'&&i.editable))throw new Error('out_of_scope');
  }
  return structuredClone(op);
}
export function contentObservation(value, host, scopeId, documentId) {
  if(!object(value)||value.host!==host||value.scopeId!==scopeId||documentId&&value.documentId!==documentId||!text(value.documentId,100)||!text(value.fingerprint,100)||!Array.isArray(value.items)||value.items.length>40||value.items.some(i=>!text(i.id,100))||!Number.isInteger(value.total)||value.total<value.items.length||!Number.isInteger(value.offset)||value.offset<0||typeof value.created!=='boolean'||(value.nextOffset!==null&&(!Number.isInteger(value.nextOffset)||value.nextOffset!==value.offset+value.items.length||value.nextOffset>=value.total)))throw new Error('observation_invalid');
  if(value.offset%40||value.offset+value.items.length>value.total||new Set(value.items.map(i=>i.id)).size!==value.items.length||value.nextOffset===null&&value.offset+value.items.length!==value.total||value.nextOffset!==null&&value.items.length!==40)throw new Error('observation_invalid');
  for(const item of value.items)validateContentText(item);
  return value;
}
// A refused verdict says what to correct: the repair of a review otherwise repeats it. Measured 2026-09-30
// (gpt-5.6-sol): a final review left one of seven requirements out three times, each refusal saying only
// goal_review_failed, and the finished document waited for a person.
const refuse=issue=>{throw Object.assign(new Error('goal_review_failed'),{issue});};
function verdictShape(response,maxChecks){
  if(response?.calls?.length)refuse('Return the verdict as JSON text, not a tool call.');
  if(response?.finishReason==='length')refuse('The verdict was cut off: return a shorter JSON object.');
  const v=modelJson(response?.content,'goal_review_failed');
  if(!keys(v,['status','checks','feedback']))refuse('Return only {status, checks, feedback}.');
  if(!['complete','revise','blocked'].includes(v.status))refuse('status is complete, revise or blocked.');
  if(typeof v.feedback!=='string'||v.feedback.length>1800)refuse('feedback is a string of at most 1,800 characters.');
  if(!Array.isArray(v.checks)||!v.checks.length||v.checks.length>maxChecks)refuse(`checks is a list of 1 to ${maxChecks} checks.`);
  return v;
}
// A check that carries a description besides its fields is read without it: the fields decide. Measured 2026-09-30
// (gpt-5.6-luna): a step review added "specific" to each check, was refused three times for it, and the run stopped
// before the table was written.
const extraFields=(c,fields)=>c&&typeof c==='object'&&!Array.isArray(c)&&fields.every(field=>Object.hasOwn(c,field))&&Object.keys(c).length>fields.length&&Object.keys(c).every(key=>fields.includes(key)||typeof c[key]==='string'&&c[key].length<=1000)?Object.fromEntries(fields.map(field=>[field,c[field]])):c;
const verdictEnd=v=>{
  if(v.status==='complete'&&v.checks.some(c=>c.status!=='met'))refuse('complete needs every check met; with an unmet or unknown check use revise and say what to fix in feedback.');
  if(v.status!=='complete'&&!v.feedback.trim())refuse(`${v.status} needs feedback saying what to fix or ask.`);
};
// Requirements counted from 1 are read as meant when the checks are exactly 1 to n. Measured 2026-09-30
// (gpt-5.6-sol): four final reviews numbered the requirements from 1 and each was sent back once.
// Met checks of requirements that do not exist are dropped when every requirement is checked once. Measured the same
// day (gpt-5.6-luna): a final review of five requirements added two more, and the finished edit waited for a person.
function fromOne(v,n){
  const indexes=v.checks.map(c=>c?.requirement);
  if(indexes.length===n&&indexes.every(Number.isInteger)&&new Set(indexes).size===n&&indexes.every(i=>i>=1&&i<=n))for(const c of v.checks)c.requirement--;
  const inside=v.checks.filter(c=>Number.isInteger(c?.requirement)&&c.requirement>=0&&c.requirement<n);
  if(inside.length<v.checks.length&&inside.length===n&&new Set(inside.map(c=>c.requirement)).size===n&&v.checks.every(c=>inside.includes(c)||c?.status==='met'))v.checks=inside;
  return v;
}
export function contentReview(response, task, evidence, step) {
  const n=task.requirements.length,v=fromOne(verdictShape(response,24),n),seen=new Set();v.checks=v.checks.map(c=>extraFields(c,['requirement','status','evidence']));
  v.checks.forEach((c,i)=>{
    if(!keys(c,['requirement','status','evidence']))refuse(`checks[${i}] has only requirement, status and evidence.`);
    if(!Number.isInteger(c.requirement)||c.requirement<0||c.requirement>=n)refuse(`checks[${i}].requirement is a requirement index from 0 to ${n-1}.`);
    if(seen.has(c.requirement))refuse(`Requirement ${c.requirement} is checked twice: one check per requirement.`);
    if(!['met','unmet','unknown'].includes(c.status))refuse(`checks[${i}].status is met, unmet or unknown.`);
    if(!Array.isArray(c.evidence))refuse(`checks[${i}].evidence is a list of evidence IDs.`);
    if(c.status==='met'&&(!c.evidence.length||c.evidence.some(id=>!evidence.some(e=>e.id===id))))refuse(`checks[${i}] is met, so its evidence lists IDs from Evidence.`);
    seen.add(c.requirement);
  });
  const missing=task.requirements.map((_,i)=>i).filter(i=>!seen.has(i));
  if(!step&&missing.length)refuse(`Check every requirement exactly once. Missing: ${missing.map(i=>`${i} (${String(task.requirements[i]).slice(0,80)})`).join(', ')}.`);
  verdictEnd(v);
  return v;
}

// Preparation/proposal outcomes are not completion of the whole deliverable.
// Separate schemas prevent a planner's broad requirement from trapping an
// inspection step in "report not finished" retries.
// A step that only reads (inspect, analyze) is held back by an unmet check only: what it cannot show yet (content that a
// later step writes, preservation after writes) is judged by the later steps and the final review. Measured 2026-09-30
// (gpt-5.6-luna): an inspect step that found the target and its values was reviewed "다른 슬라이드 미수정: unknown" before
// any write, sent back, and the run stopped for a person.
export function contentStepReview(response,evidence,{readOnly=false}={}){
  const v=verdictShape(response,12);v.checks=v.checks.map(c=>extraFields(c,['criterion','status','evidence']));
  v.checks.forEach((c,i)=>{
    if(!keys(c,['criterion','status','evidence']))refuse(`checks[${i}] has only criterion, status and evidence.`);
    if(!text(c.criterion,300))refuse(`checks[${i}].criterion is a short text of at most 300 characters.`);
    if(!['met','unmet','unknown'].includes(c.status))refuse(`checks[${i}].status is met, unmet or unknown.`);
    if(!Array.isArray(c.evidence)||c.evidence.some(id=>!evidence.some(e=>e.id===id)))refuse(`checks[${i}].evidence lists IDs from Evidence only.`);
    if(c.status==='met'&&!c.evidence.length)refuse(`checks[${i}] is met, so it cites at least one evidence ID.`);
  });
  if(readOnly&&v.status!=='blocked'&&v.checks.some(c=>c.status==='met')&&!v.checks.some(c=>c.status==='unmet')){const later=v.checks.filter(c=>c.status==='unknown').map(c=>c.criterion);return{...v,status:'complete',scope:'step',...(later.length?{later}:{})};}
  verdictEnd(v);
  return {...v,scope:'step'};
}
// The evidence a reviewer cites, read as it meant it: "2" for evidence 2, a conversation passage (history-3:1800) for
// its message (history-3). Any other citation is refused with the IDs that exist. Measured 2026-09-30
// (gpt-5.6-luna): numbers written as text, and tool names, failed every review of four runs three times over, each
// repair saying only goal_review_failed.
// metOnly: the final review checks the evidence of met checks only (contentReview).
export function reviewCitations(response,evidence,{metOnly=false}={}){
  if(response?.calls?.length||typeof response?.content!=='string')return response;
  let value;try{value=modelJson(response.content,'goal_review_failed');}catch{return response;}
  if(!Array.isArray(value?.checks))return response;
  const ids=new Set(evidence.map(e=>e.id)),bad=new Set();let uncited=false;
  const cited=id=>{
    if(typeof id==='string'&&/^\d+$/.test(id.trim())&&ids.has(Number(id)))return Number(id);
    const source=typeof id==='string'&&/^(history-\d+):\d+$/.exec(id)?.[1];return source&&ids.has(source)?source:id;
  };
  for(const check of value.checks){
    if(!Array.isArray(check?.evidence))continue;
    check.evidence=[...new Set(check.evidence.map(cited))];
    if(!metOnly||check.status==='met')for(const id of check.evidence)if(!ids.has(id))bad.add(String(id).slice(0,80));
    if(check.status==='met'&&!check.evidence.length)uncited=true;
  }
  if(bad.size||uncited){
    const numbers=[...ids].filter(Number.isInteger).sort((a,b)=>a-b),history=[...ids].filter(id=>/^history-\d+$/.test(id)),other=[...ids].filter(id=>typeof id==='string'&&!history.includes(id));
    const listed=[...(numbers.length?[numbers.length>2&&numbers.at(-1)-numbers[0]===numbers.length-1?`${numbers[0]}-${numbers.at(-1)}`:numbers.join(', ')]:[]),...other,...(history.length?[history.length>3?`${history[0]} to ${history.at(-1)} (${history.length} conversation messages)`:history.join(', ')]:[])];
    throw Object.assign(new Error('goal_review_failed'),{issue:`${bad.size?`Not evidence IDs: ${[...bad].slice(0,4).join(', ')}. `:''}${uncited?'A met check cites at least one evidence ID; without one it is unknown. ':''}Cite only IDs listed in Evidence: ${listed.join(', ')}. A tool, step or file name is not an evidence ID.`});
  }
  return{...response,content:JSON.stringify(value)};
}

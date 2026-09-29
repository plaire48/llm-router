// Explains one finished case from its saved records: the call sequence, why a
// review was refused, and which tool calls failed. Reads files only.
//   node eval/analyze.mjs verification/eval-live/<run>/<case>-t1
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const REVIEW='Nubi Desktop independent result review';
const systemOf=entry=>String(entry.request.messages.find(message=>message.role==='system')?.content||'');
const parse=text=>{try{return JSON.parse(text);}catch{return null;}};

// Names the first rule of runtime/result-review.mjs that a reply breaks.
export function reviewRefusal(entry){
  const data=parse(entry.request.messages[1]?.content),reply=parse(entry.response?.content);
  if(!data||!reply)return 'not_json';
  if(!Array.isArray(reply.checks))return 'schema';
  const expected=data.requirements.map(item=>item.id),ids=reply.checks.map(check=>check.requirementId);
  if(new Set(ids).size!==ids.length||ids.length!==expected.length||expected.some(id=>!ids.includes(id)))return 'requirement_ids';
  const known=new Map(data.evidence.map(item=>[item.id,item.usable]));
  const unknown=[...new Set(reply.checks.flatMap(check=>check.evidenceIds||[]).filter(id=>!known.has(id)))];
  if(unknown.length)return 'unknown_evidence:'+unknown.join(',');
  if(reply.checks.some(check=>check.state==='supported'&&!(check.evidenceIds||[]).length))return 'supported_without_evidence';
  if(reply.checks.some(check=>check.state==='supported'&&check.evidenceIds.some(id=>!known.get(id))))return 'supported_by_unusable_evidence';
  if(reply.checks.some(check=>String(check.detail||'').length>300||!check.detail))return 'detail_length';
  if(String(reply.nextStep||'').length>600)return 'next_step_length';
  if(reply.status==='revise'&&!String(reply.nextStep||'').trim())return 'revise_without_next_step';
  return null;
}

export async function analyzeCase(directory){
  const result=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8')),metrics=JSON.parse(await readFile(path.join(directory,'metrics.json'),'utf8'));
  const transcript=(await readFile(path.join(directory,'transcript.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const reviews=transcript.filter(entry=>systemOf(entry).startsWith(REVIEW)).map(entry=>({sequence:entry.sequence,status:parse(entry.response?.content)?.status??null,refusal:reviewRefusal(entry)}));
  const tools=metrics.events.filter(event=>event.kind==='metric_tool');
  const failedTools={};for(const event of tools.filter(item=>item.error))failedTools[event.tool+':'+event.error]=(failedTools[event.tool+':'+event.error]||0)+1;
  const actor=metrics.events.filter(event=>event.kind==='metric_model'&&event.purpose==='actor');
  return {id:result.id,outcome:result.outcome,error:result.error||null,state:result.state,asked:result.asked,modelCalls:result.modelCalls,elapsedMs:result.elapsedMs,
    toolSequence:tools.filter(event=>event.scope==='leader').map(event=>event.tool+(event.error?'!':'')),failedTools,reviews,
    actorTokens:{first:actor[0]?.estimatedTokens??null,peak:Math.max(0,...actor.map(event=>event.estimatedTokens))},compactions:metrics.summary?.compactions??0,
    failedChecks:(result.checks||[]).filter(check=>!check.passed).map(check=>check.name),answer:result.answer};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const directory of process.argv.slice(2)){
    const {answer,...facts}=await analyzeCase(directory);
    console.log(JSON.stringify(facts));console.log('  답변: '+(answer||'(없음)').replace(/\s+/g,' ').slice(0,400));
  }
}

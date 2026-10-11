// Wiki evidence kept for the later runs of a task (user decision 2026-09-30).
//
// An approval ends a run and the next one starts without the Wiki evidence of
// the first. Measured 2026-09-29 with gpt-5.6-sol (case A13): the model asked the
// OpenWiki agent the same rule again for every approved action, five times and
// 34 delegated calls. Evidence observed in an earlier run of the same task is
// offered again while its page, Claims and sources are unchanged. It is checked
// before a run offers it and again when an action or a plan uses it.
import {validateWikiEvidence} from './wiki-evidence.mjs';

// The excerpt is kept as received up to 4,000 characters (200 before the user decision of 2026-09-30 on large windows).
// A small window shows only ID and place (B15).
const KEPT=12,EXCERPT=4000,key=taskId=>'wiki-carry:'+taskId;

// A citation of a whole page starts with its front matter, which says nothing about the rule (case A14).
const excerptOf=text=>String(text||'').replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n?/,'').replace(/\s+/g,' ').trim().slice(0,EXCERPT);

// rows: Wiki query results or grounded OpenWiki citations of this run.
export function keepWikiEvidence(store,taskId,rows){
  const kept=new Map((store.get(key(taskId))?.rows||[]).map(row=>[row.evidenceId,row]));
  for(const row of rows||[]){
    if(typeof row?.evidenceId!=='string'||!row.provenance)continue;
    kept.delete(row.evidenceId);
    kept.set(row.evidenceId,{evidenceId:row.evidenceId,path:row.path,hash:row.hash,start:row.provenance.start,end:row.provenance.end,freshness:row.freshness,claimsHash:row.claimsHash,sourceReferences:row.sourceReferences,excerpt:excerptOf(row.excerpt)});
  }
  store.set(key(taskId),{rows:[...kept.values()].slice(-KEPT)});
}

// The kept rows whose page is still as it was observed.
export async function carriedWikiEvidence(service,taskId){
  const current=[];
  for(const row of service.store.get(key(taskId))?.rows||[]){
    try{await validateWikiEvidence(service,taskId,[row]);current.push(row);}catch{/* A changed page is not offered. */}
  }
  return current;
}

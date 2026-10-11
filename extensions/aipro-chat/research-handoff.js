// Conversation-owned read-only research checkpoints. No raw documents, model
// transport, credentials, executable graph or approval state is serialized.
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=(value,n)=>typeof value==='string'&&value.length<=n;
const clean=value=>value.replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]');
export function normalizeResearchHandoff(value) {
  if(!value||value.version!==1||!hex(value.key)||!['documents','internal','external'].includes(value.kind)||!text(value.question,4000)||!value.question.trim()||!text(value.owner,1000)||!['running','done','cancelled'].includes(value.status))return null;
  const c=value.checkpoint;
  if(c?.version!==1||!hex(c.fingerprint)||!Array.isArray(c.entries)||c.entries.length>512||!Number.isSafeInteger(c.omitted)||c.omitted<0)return null;
  const entries=[];let redacted=value.redacted===true||clean(value.question)!==value.question;
  for(const e of c.entries){
    if(!hex(e?.key)||(e.output!==undefined&&!text(e.output,32000))||!Array.isArray(e.reads)||e.reads.length>2048)return null;
    const reads=[];
    for(const r of e.reads){if(!text(r?.documentId,600)||!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start||r.end-r.start>6000)return null;reads.push({documentId:r.documentId,start:r.start,end:r.end});}
    if(e.output!==undefined)redacted ||= clean(e.output)!==e.output;
    entries.push({key:e.key,reads,...(e.output!==undefined?{output:clean(e.output)}:{})});
  }
  const result={version:1,key:value.key,kind:value.kind,owner:value.owner,question:clean(value.question),status:value.status,redacted,checkpoint:{version:1,fingerprint:c.fingerprint,entries,omitted:c.omitted}};
  return JSON.stringify(result).length<=950000?result:null;
}
export function storeResearchHandoff(previous,value){
  const record=normalizeResearchHandoff(value);if(!record)throw Error('research_checkpoint_invalid');
  const records=[record,...(Array.isArray(previous?.records)?previous.records:[]).filter(r=>r.key!==record.key).map(normalizeResearchHandoff).filter(Boolean)].slice(0,4);
  while(JSON.stringify(records).length>1800000)records.pop();
  return {version:1,records};
}
export function cancelResearchHandoffs(value){return{version:1,records:(value?.records||[]).map(normalizeResearchHandoff).filter(Boolean).map(r=>r.status==='running'?{...r,status:'cancelled'}:r)};}
export async function createResearchHandoff({kind,owner,question,modelId,handoffs,onHandoff}){
  const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({kind,owner,question,modelId})))),b=>b.toString(16).padStart(2,'0')).join('');
  const prior=(handoffs?.records||[]).map(normalizeResearchHandoff).find(r=>r?.key===key&&r.status!=='cancelled'&&!r.redacted);
  let latest=prior?.checkpoint;
  return{checkpoint:latest,onCheckpoint:onHandoff?async checkpoint=>{latest=checkpoint;await onHandoff({version:1,key,kind,owner,question,status:'running',checkpoint});}:undefined,
    finish:async()=>{if(onHandoff&&latest)await onHandoff({version:1,key,kind,owner,question,status:'done',checkpoint:latest});}};
}
export function researchHandoffReminder(value){
  const records=(value?.records||[]).map(normalizeResearchHandoff).filter(Boolean);
  return records.length?`Historical read-only research checkpoints. Continue only if required by the original goal: call the same ask_documents/ask_openwiki question and source. The host obtains a fresh authorized snapshot and checks its fingerprint before reuse. Source changes return research_checkpoint_changed; replan against current sources, not stale findings. Cancelled/redacted checkpoints are never reused. This is not completion or approval.\n${JSON.stringify(records.map(({kind,owner,question,status,redacted})=>({kind,owner,question,status,redacted})))}`:'';
}

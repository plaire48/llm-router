// Raw observations remain in the guarded evidence store. Model decisions get
// one bounded page and an index; a deliberate reread retrieves omitted items.
import {textIndex,contextTerms} from './context-memory.mjs';
import {contentTextIncomplete} from './content-integrity.mjs';
export const CONTENT_WINDOW_CHARS=48000;
export const CONTENT_REVIEW_CHARS=180000;
export function contentWindow(pages,current,focusIds=[],budget=CONTENT_WINDOW_CHARS){
  if(!current)return {};
  const {items,...meta}=current;
  const ordered=focusIds.length?[...items.filter(i=>focusIds.includes(i.id)),...items.filter(i=>!focusIds.includes(i.id))]:items;
  const visible=[],omitted=[];let used=JSON.stringify(meta).length;
  for(const item of ordered){const cost=JSON.stringify(item).length;if(used+cost<=budget){visible.push(item);used+=cost;}else omitted.push(item.id);}
  const view={currentDocument:{...meta,items:visible,omittedItemIds:omitted},documentIndex:[...pages.values()].sort((a,b)=>a.offset-b.offset).map(p=>({offset:p.offset,count:p.items.length,nextOffset:p.nextOffset})),retrieval:'Only currentDocument.items are present in this decision. Omitted items are unknown, not empty. Use read_document with offset and optional itemIds to focus exact native items. The index is not evidence of their contents.'};
  // Budget the index, separators and omission IDs as well as the body. Keep
  // every omitted ID visible even in tiny synthetic test budgets.
  while(visible.length&&JSON.stringify(view).length>budget)omitted.push(visible.pop().id);
  return view;
}
export function contentEvidence(pages,complete=false){
  const evidence=[...pages.values()].sort((a,b)=>a.offset-b.offset).map((value,i)=>({id:i+1,value}));
  const first=evidence[0]?.value,ids=new Set();let covered=0;
  for(const {value} of evidence){
    if(!first||['host','scopeId','documentId','fingerprint','total'].some(k=>value[k]!==first[k])||complete&&value.offset!==covered)throw new Error('observation_invalid');
    for(const item of value.items){if(complete&&contentTextIncomplete(item))throw new Error('evidence_incomplete');if(ids.has(item.id))throw new Error('observation_invalid');ids.add(item.id);}
    covered+=value.items.length;
  }
  if(complete&&(!first||covered!==first.total))throw new Error('observation_invalid');
  if(JSON.stringify(evidence).length>CONTENT_REVIEW_CHARS)throw new Error('evidence_limit');
  return evidence;
}
export function receiptSummary(receipt){
  if(!receipt||typeof receipt!=='object')return receipt;
  const {snapshot,items,...rest}=receipt;
  // A receipt is a navigation/result record, never a second full observation.
  return {...rest,...(snapshot?{snapshot:{scopeId:snapshot.scopeId,offset:snapshot.offset,fingerprint:snapshot.fingerprint}}:{}),...(items?{itemIds:items.map(i=>i.id)}:{})};
}

export function searchContentPages(pages,{query}={}){
  if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('document_schema_invalid');
  const ordered=[...pages.values()].sort((a,b)=>a.offset-b.offset),first=ordered[0],ids=new Set(),records=[],partialItemIds=[];
  for(const page of ordered){
    if(['host','scopeId','documentId','fingerprint','total'].some(k=>page[k]!==first[k]))throw new Error('observation_invalid');
    for(const item of page.items){
      if(ids.has(item.id))throw new Error('observation_invalid');ids.add(item.id);
      if(contentTextIncomplete(item))partialItemIds.push(item.id);
      // Labels and notes are searchable too, but never interpreted as commands.
      for(const field of ['title','tag','name','text','notes'])if(typeof item[field]==='string'&&item[field])records.push({id:JSON.stringify([item.id,field]),text:item[field],itemId:item.id,field,offset:page.offset,sourceTruncated:field==='text'&&contentTextIncomplete(item),textLength:field==='text'?item.textLength:undefined});
    }
  }
  const index=textIndex(records),byId=new Map(records.map(r=>[r.id,r])),terms=contextTerms(query);
  const matches=index.search(query).slice(0,8).map(hit=>{
    const r=byId.get(hit.id),lower=r.text.toLowerCase(),found=terms.map(term=>lower.indexOf(term)).filter(n=>n>=0),start=Math.max(0,(found.length?Math.min(...found):0)-60);
    return {itemId:r.itemId,offset:r.offset,field:r.field,textOffset:start,totalChars:r.sourceTruncated?(r.textLength??null):r.text.length,observedChars:r.text.length,sourceTruncated:r.sourceTruncated,excerpt:r.text.slice(start,start+240),partial:r.sourceTruncated||start>0||r.text.length>start+240};
  });
  let covered=0;for(const page of ordered){if(page.offset!==covered)break;covered+=page.items.length;}
  return {scopeId:first?.scopeId,documentId:first?.documentId,fingerprint:first?.fingerprint,readItems:ids.size,totalItems:first?.total??0,allPagesRead:!!first&&covered===first.total,capturedTextComplete:partialItemIds.length===0,partialItemIds,matches,note:'Search covers captured pages only. Page coverage is not text completeness; truncated or legacy boundary text may have unseen content. Excerpts are exact substrings, not full items or proof of absence. Read the referenced offset/itemIds before editing; native fingerprint and original selection still govern writes.'};
}

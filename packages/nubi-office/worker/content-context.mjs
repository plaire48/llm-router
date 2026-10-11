// Raw observations remain in the guarded evidence store. Model decisions get
// one bounded page and an index; a deliberate reread retrieves omitted items.
import {createHash} from 'node:crypto';
import {textIndex,contextTerms} from './context-memory.mjs';
import {contentTextIncomplete,contentFieldIncomplete} from './content-integrity.mjs';
import {requestBudget,estimateTokens} from './context-budget.mjs';
export const CONTENT_WINDOW_CHARS=48000;
export const CONTENT_REVIEW_CHARS=180000;
// The document window of one decision: a quarter of the model's request budget, at least the former 48,000
// characters. Counted in characters because the window is mostly Korean text, one estimated token a character.
export function contentWindowChars(model){return Math.max(CONTENT_WINDOW_CHARS,Math.min(200000,Math.floor((requestBudget(model)?.limitTokens??0)*0.25)));}
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
  // Other read pages fill the rest of the budget, nearest to the current page first, whole pages only. A decision
  // then sees the heading of its article on the previous page and what follows, not one page of 40 items.
  if(!omitted.length){
    const nearby=[],others=[...pages.values()].filter(page=>page.offset!==current.offset).sort((a,b)=>Math.abs(a.offset-current.offset)-Math.abs(b.offset-current.offset)||a.offset-b.offset);
    for(const page of others){
      const next=[...nearby,{offset:page.offset,items:page.items}];
      if(JSON.stringify({...view,nearbyPages:next}).length>budget)break;
      nearby.push(next.at(-1));
    }
    if(nearby.length){view.nearbyPages=nearby.sort((a,b)=>a.offset-b.offset);view.retrieval='currentDocument.items and the items of nearbyPages are present in this decision; other pages are not. Omitted items are unknown, not empty. Use read_document with offset and optional itemIds to focus exact native items. The index is not evidence of their contents.';}
  }
  return view;
}
function observedEvidence(pages,complete=false){
  const evidence=[...pages.values()].sort((a,b)=>a.offset-b.offset).map((value,i)=>({id:i+1,value}));
  const first=evidence[0]?.value,ids=new Set();let covered=0;
  for(const {value} of evidence){
    if(!first||['host','scopeId','documentId','fingerprint','total'].some(k=>value[k]!==first[k])||complete&&value.offset!==covered)throw new Error('observation_invalid');
    for(const item of value.items){if(complete&&contentTextIncomplete(item))throw new Error('evidence_incomplete');if(ids.has(item.id))throw new Error('observation_invalid');ids.add(item.id);}
    covered+=value.items.length;
  }
  if(complete&&(!first||covered!==first.total))throw new Error('observation_invalid');
  return evidence;
}
// maxTokens: the room a review request leaves for its evidence. Without it the former 180,000 characters apply.
export function contentEvidence(pages,complete=false,{maxTokens}={}){
  const evidence=observedEvidence(pages,complete),text=JSON.stringify(evidence);
  if(maxTokens===undefined?text.length>CONTENT_REVIEW_CHARS:estimateTokens(text)>maxTokens||text.length>3000000)throw new Error('evidence_limit');
  return evidence;
}
// Partitions of a review too large for one request: as large as the model allows, at most 180,000 characters.
export function contentPartitionChars(model){return Math.max(CONTENT_WINDOW_CHARS,Math.min(CONTENT_REVIEW_CHARS,Math.floor((requestBudget(model)?.limitTokens??0)*0.5)));}
// Deterministic minimum-delivery checks supplement the semantic reviewer.
// A created container, labels and presenter notes are not visible authored body.
export function createdContentFindings(pages,verifiedWrites){
  const evidence=observedEvidence(pages,true);
  if(!Number.isSafeInteger(verifiedWrites)||verifiedWrites<0)throw new Error('observation_invalid');
  const items=evidence.flatMap(e=>e.value.items);
  const visibleTextItems=items.filter(item=>item.showingPlaceholder!==true&&typeof item.text==='string'&&item.text.replace(/[\s\u0000-\u001f\u007f\u200b-\u200f\u2060\ufeff]/gu,'').length>0).length;
  const checks=[
    {code:'authored_write',requirement:'새 문서 내용 반영',status:verifiedWrites>0?'met':'unmet'},
    {code:'visible_body',requirement:'문서 본문 확인',status:visibleTextItems>0?'met':'unmet'}
  ];
  return {kind:'document_delivery',status:checks.every(c=>c.status==='met')?'met':'unmet',checks,facts:{verifiedWrites,nativeItems:items.length,visibleTextItems},instruction:'Minimum delivery evidence only. A pass does not prove request completeness, factual accuracy, formatting or saving. Labels, placeholder prompts and speaker notes do not substitute for visible document content.'};
}
// Validate native page coverage before constructing review-only projections.
// Large hydrated text fields use separate, exact fragments; original native
// observations and editable target IDs are never changed by this projection.
export function contentReviewBatches(pages,complete=false,budget=CONTENT_WINDOW_CHARS){
  if(!Number.isSafeInteger(budget)||budget<1024||budget>CONTENT_REVIEW_CHARS)throw new Error('invalid_request');
  const evidence=observedEvidence(pages,complete),batches=[];let batch=[];
  const digest=text=>createHash('sha256').update(text).digest('hex');
  const append=entry=>{
    if(JSON.stringify([entry]).length>budget)throw new Error('evidence_limit');
    if(batch.length&&JSON.stringify([...batch,entry]).length>budget){batches.push(batch);batch=[];}
    if(batches.length>=64)throw new Error('evidence_limit');
    batch.push(entry);
  };
  for(const {id,value} of evidence){
    const {items,...meta}=value;
    const entry=item=>({pageId:id,value:{...meta,items:[structuredClone(item)]},partialPage:true});
    for(const item of value.items){
      const intact=entry(item);
      const hasLongText=['text','notes'].some(field=>typeof item[field]==='string'&&item[field].length>8000);
      if(!hasLongText&&JSON.stringify([intact]).length<=budget){append(intact);continue;}
      const fields=['text','notes'].filter(field=>typeof item[field]==='string'&&item[field].length);
      if(!fields.length)throw new Error('evidence_limit');
      const metadata=structuredClone(item),descriptors=[];
      for(const field of fields){
        const fullHash=digest(item[field]);
        if(item[field+'Hash']!==undefined&&item[field+'Hash']!==fullHash)throw new Error('observation_invalid');
        descriptors.push({field,length:item[field].length,fullHash});delete metadata[field];
      }
      metadata.editable=false;metadata.fragmentedFields=descriptors;
      append(entry(metadata));
      for(const {field,length,fullHash} of descriptors){
        let start=0;
        while(start<length){
          let size=Math.min(8000,length-start),fragment,wrapped;
          do{
            const end=start+size;
            fragment={id:'fragment-'+digest(JSON.stringify([meta.scopeId,meta.documentId,meta.fingerprint,item.id,field,start,fullHash])).slice(0,40),kind:'text_fragment',sourceItemId:item.id,sourceField:field,start,end,sourceLength:length,fullHash,editable:false,[field]:item[field].slice(start,end)};
            wrapped=entry(fragment);
            if(JSON.stringify([wrapped]).length<=budget)break;
            size=Math.floor(size/2);
          }while(size>0);
          if(!size)throw new Error('evidence_limit');
          append(wrapped);start+=size;
        }
      }
    }
  }
  if(batch.length)batches.push(batch);
  if(!batches.length||batches.length>64)throw new Error('evidence_limit');
  return batches.map((items,i)=>({id:i+1,items}));
}

export function receiptSummary(receipt){
  if(!receipt||typeof receipt!=='object')return receipt;
  if(receipt.kind==='document_structure')return structuredClone(receipt);
  const {snapshot,items,...rest}=receipt;
  // A receipt is a navigation/result record, never a second full observation.
  return {...rest,...(snapshot?{snapshot:{scopeId:snapshot.scopeId,offset:snapshot.offset,fingerprint:snapshot.fingerprint}}:{}),...(items?{itemIds:items.map(i=>i.id)}:{})};
}

export function searchContentPages(pages,{query,field='all',cursor=0,viewId}={}){
  const fields=['title','tag','name','text','notes'];
  if(typeof query!=='string'||!query.trim()||query.length>200||!['all',...fields].includes(field)||!Number.isSafeInteger(cursor)||cursor<0||cursor>10000||cursor>0&&!/^[a-f0-9]{64}$/.test(viewId??''))throw new Error('document_schema_invalid');
  const ordered=[...pages.values()].sort((a,b)=>a.offset-b.offset),first=ordered[0],ids=new Set(),records=[],partialItemIds=[];
  for(const page of ordered){
    if(['host','scopeId','documentId','fingerprint','total'].some(k=>page[k]!==first[k]))throw new Error('observation_invalid');
    for(const item of page.items){
      if(ids.has(item.id))throw new Error('observation_invalid');ids.add(item.id);
      if(contentTextIncomplete(item))partialItemIds.push(item.id);
      // Labels and notes are searchable too, but never interpreted as commands.
      for(const key of field==='all'?fields:[field])if(typeof item[key]==='string'&&item[key])records.push({id:JSON.stringify([item.id,key]),text:item[key],itemId:item.id,field:key,offset:page.offset,sourceTruncated:['text','notes'].includes(key)&&contentFieldIncomplete(item,key),textLength:item[key+'Length']});
    }
  }
  if(ids.size>2000||records.length>10000)throw new Error('evidence_limit');
  // Bind continuation to the exact captured source, query and field. A source
  // mutation or an added page must not silently shift ranked search results.
  const current=createHash('sha256').update(JSON.stringify([ordered,query,field])).digest('hex');
  // As in inspectDocumentStructure: only a continuation needs its own viewId.
  if(viewId!==undefined&&viewId!==current&&cursor>0)throw Object.assign(new Error('tool_arguments_invalid'),{issue:'viewId belongs to an earlier search: the query, the field or the read pages changed. Search again without cursor and viewId.'});
  const index=textIndex(records),byId=new Map(records.map(r=>[r.id,r])),terms=contextTerms(query);
  const hits=index.search(query);
  if(cursor>hits.length)throw new Error('document_schema_invalid');
  const matches=hits.slice(cursor,cursor+8).map(hit=>{
    const r=byId.get(hit.id),lower=r.text.toLowerCase(),found=terms.map(term=>lower.indexOf(term)).filter(n=>n>=0),start=Math.max(0,(found.length?Math.min(...found):0)-60);
    return {itemId:r.itemId,offset:r.offset,field:r.field,textOffset:start,totalChars:r.sourceTruncated?(r.textLength??null):r.text.length,observedChars:r.text.length,sourceTruncated:r.sourceTruncated,excerpt:r.text.slice(start,start+240),partial:r.sourceTruncated||start>0||r.text.length>start+240};
  });
  let covered=0;for(const page of ordered){if(page.offset!==covered)break;covered+=page.items.length;}
  const result={kind:'document_search',viewId:current,query,field,cursor,nextCursor:null,totalMatches:hits.length,matchUnit:'item_field',scopeId:first?.scopeId,documentId:first?.documentId,fingerprint:first?.fingerprint,readItems:ids.size,totalItems:first?.total??0,allPagesRead:!!first&&covered===first.total,capturedTextComplete:partialItemIds.length===0,partialItemCount:partialItemIds.length,partialItemIds:partialItemIds.slice(0,40),partialItemIdsOmitted:Math.max(0,partialItemIds.length-40),matches,note:'Ranked term search over captured pages only, not exact phrase or every occurrence. totalMatches counts matching item fields, not occurrences. Continue using nextCursor with the same query, field and viewId. Page coverage is not text completeness; truncated or legacy boundary text may be unseen. Excerpts are exact substrings, not full items or proof of absence. Read offset/itemIds and read_document_text for exact evidence before edits; native fingerprint and original selection govern writes.'};
  // Include serialized escaping and coverage metadata in the response budget.
  const advance=()=>{result.nextCursor=cursor+result.matches.length<hits.length?cursor+result.matches.length:null;};
  advance();
  while(result.matches.length&&JSON.stringify(result).length>12000){result.matches.pop();advance();}
  if(cursor<hits.length&&!result.matches.length||JSON.stringify(result).length>12000)throw new Error('evidence_limit');
  return result;
}

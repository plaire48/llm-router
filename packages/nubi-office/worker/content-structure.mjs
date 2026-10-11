import {createHash} from 'node:crypto';
import {contentTextIncomplete,contentFieldIncomplete} from './content-integrity.mjs';
import {contentObservation} from './content-schema.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const inspectDocumentStructureTool={type:'function',function:{name:'inspect_document_structure',description:'Get a compact map of the whole Word/PPT document: headings, fields, slides, editable targets and observed issues. The host reads every page first. Truncated text remains unknown. Use returned pageOffset/itemId with read_document and read_document_text before editing. Cursor pages require the same viewId; this structure map is navigation, not full content or approval.',parameters:{type:'object',additionalProperties:false,properties:{filter:{type:'string',enum:['landmarks','all','editable','issues']},cursor:{type:'integer',minimum:0,maximum:2000},viewId:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}};
const clip=(value,size=120)=>typeof value==='string'?value.slice(0,size):undefined;
// A slide is known by its title: the text of its title placeholder (제목 1, Title 1), else of its first text shape.
// Measured 2026-09-30: the map named all 36 slides of a deck by their layout, 제목 및 내용.
function slideTitles(ordered){
  const titles=new Map();
  for(const page of ordered)for(const item of page.items)if(item.kind==='shape'&&item.slideId&&typeof item.text==='string'&&item.text.trim()){
    const placeholder=/^(?:title|제목)/i.test(item.name??''),known=titles.get(item.slideId);
    if(!known||placeholder&&!known.placeholder)titles.set(item.slideId,{placeholder,text:item.text.replace(/\s+/g,' ').trim()});
  }
  return titles;
}
const isHeading=item=>item.kind==='paragraph'&&Number.isInteger(item.outlineLevel)&&item.outlineLevel>=1&&item.outlineLevel<=9;
const landmarkLabel=(item,titles)=>isHeading(item)?item.text:item.kind==='field'?item.title||item.tag:item.kind==='slide'?titles.get(item.id)?.text||item.name||item.layout:item.kind==='shape'?item.name:undefined;
export function inspectDocumentStructure(pages,{filter='landmarks',cursor=0,viewId}={}){
  if(!['landmarks','all','editable','issues'].includes(filter)||!Number.isSafeInteger(cursor)||cursor<0||cursor>2000||cursor>0&&!/^[a-f0-9]{64}$/.test(viewId??''))throw new Error('tool_arguments_invalid');
  const ordered=[...pages.values()].sort((a,b)=>a.offset-b.offset),first=ordered[0];
  if(!first)throw new Error('source_not_read');
  const ids=new Set(),offsets=new Set(),items=[],counts={paragraphs:0,fields:0,slides:0,shapes:0,editable:0,tableParagraphs:0,textIncomplete:0,overflow:0},titles=slideTitles(ordered);
  for(const page of ordered){
    contentObservation(page,first.host,first.scopeId,first.documentId);
    if(page.fingerprint!==first.fingerprint||page.total!==first.total||offsets.has(page.offset)||page.total>2000)throw new Error('observation_invalid');offsets.add(page.offset);
    for(const item of page.items){
      if(ids.has(item.id))throw new Error('observation_invalid');ids.add(item.id);
      const heading=isHeading(item),label=landmarkLabel(item,titles);
      const incomplete=contentTextIncomplete(item),issues=[...(incomplete?['text_incomplete']:[]),...(item.overflow===true?['text_overflow']:[])];
      const node={itemId:item.id,pageOffset:page.offset,kind:item.kind??'unknown',...(heading?{headingLevel:item.outlineLevel}:{}),...(label?{label:clip(label),labelTruncated:label.length>120}:{}),...(item.slideId?{slideId:clip(item.slideId,100)}:{}),...(Number.isInteger(item.index)?{slideIndex:item.index}:{}),editable:item.editable===true,...(Object.hasOwn(item,'fragmentEditable')?{fragmentEditable:item.fragmentEditable===true}:{}),issues};
      if(['text','notes'].some(field=>typeof item[field]==='string'))node.textFields=Object.fromEntries(['text','notes'].filter(field=>typeof item[field]==='string').map(field=>[field,{observedChars:item[field].length,totalChars:item[field+'Length']??(contentFieldIncomplete(item,field)?null:item[field].length)}]));
      if(item.kind==='cell'&&item.tableId){Object.assign(node,{tableId:item.tableId,row:item.row,column:item.column,label:clip(item.text),labelTruncated:(item.text??'').length>120});}
      if(Object.hasOwn(counts,item.kind+'s'))counts[item.kind+'s']++;
      if(item.editable===true)counts.editable++;if(item.inTable===true)counts.tableParagraphs++;if(incomplete)counts.textIncomplete++;if(item.overflow===true)counts.overflow++;
      if(filter==='all'||filter==='landmarks'&&(heading||['field','slide'].includes(item.kind))||filter==='editable'&&(item.editable===true||item.fragmentEditable===true)||filter==='issues'&&issues.length)items.push(node);
    }
  }
  const current=hash([first.host,first.scopeId,first.documentId,first.fingerprint,ordered,filter]);
  // A stale viewId is a navigation mistake, not a document change. Measured 2026-09-30 (gpt-5.6-sol): a viewId passed
  // again after more pages were read, or to another tool, ended the whole run as source_changed. A first page needs none.
  if(viewId!==undefined&&viewId!==current&&cursor>0)throw Object.assign(new Error('tool_arguments_invalid'),{issue:'viewId belongs to an earlier map: pages were read or the document changed since. Call inspect_document_structure again without cursor and viewId.'});
  if(cursor>items.length)throw new Error('tool_arguments_invalid');
  const missingPageOffsets=[];for(let offset=0;offset<first.total;offset+=40)if(!offsets.has(offset))missingPageOffsets.push(offset);
  const rows=items.slice(cursor,cursor+40),result={kind:'document_structure',viewId:current,host:first.host,scopeId:first.scopeId,documentId:first.documentId,fingerprint:first.fingerprint,filter,cursor,nextCursor:cursor+rows.length<items.length?cursor+rows.length:null,matchedItems:items.length,counts,coverage:{observedItems:ids.size,totalItems:first.total,allItemsRead:ids.size===first.total&&missingPageOffsets.length===0,capturedTextComplete:counts.textIncomplete===0,missingPageOffsets},items:rows,instruction:'Observed structure only. Counts are for captured native items, not document pages or unique tables. Missing pages and incomplete text are unknown. Labels are excerpts, not full content. Use pageOffset/itemId to read exact evidence; editable flags never authorize an edit.'};
  // Budget serialized escaping, labels, identifiers and coverage metadata too.
  while(result.items.length&&JSON.stringify(result).length>14000)result.items.pop();
  if(items.length>cursor&&!result.items.length||JSON.stringify(result).length>14000)throw new Error('evidence_limit');
  result.nextCursor=cursor+result.items.length<items.length?cursor+result.items.length:null;
  return result;
}
// The headings, fields and slide titles of the whole document within maxChars, for planning and navigation. Only when
// every page of the current state has been read: a partial outline would read as the whole document. Measured
// 2026-09-30 (gpt-5.6-luna): shown the first of ten pages, the planner asked the user where the clause to edit was.
export function documentOutline(pages,maxChars){
  const ordered=[...pages.values()].sort((a,b)=>a.offset-b.offset),first=ordered[0];let covered=0;
  if(!first)return null;
  for(const page of ordered){if(page.offset!==covered||page.fingerprint!==first.fingerprint||page.total!==first.total)return null;covered+=page.items.length;}
  if(covered!==first.total)return null;
  const titles=slideTitles(ordered),landmarks=[];
  for(const page of ordered)for(const item of page.items)if(isHeading(item)||['field','slide'].includes(item.kind)){
    const label=landmarkLabel(item,titles);
    landmarks.push({itemId:item.id,pageOffset:page.offset,...(isHeading(item)?{level:item.outlineLevel}:{}),...(item.kind==='slide'?{slide:item.index}:{}),...(item.kind==='field'?{kind:'field'}:{}),...(label?{label:clip(label,100)}:{})});
  }
  const outline={kind:'document_outline',totalItems:first.total,landmarks:[],omittedLandmarks:0,note:'Headings, input fields and slide titles of the whole document, as the host read it. Labels are excerpts: read the page at pageOffset before relying on or editing its content.'};
  for(const node of landmarks){outline.landmarks.push(node);if(JSON.stringify(outline).length>maxChars){outline.landmarks.pop();break;}}
  outline.omittedLandmarks=landmarks.length-outline.landmarks.length;
  return outline.landmarks.length?outline:null;
}

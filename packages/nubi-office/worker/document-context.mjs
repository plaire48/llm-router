import {region,inside} from './office-range.mjs';
import {createHash} from 'node:crypto';
const layoutFields=['formats','merges','columnWidths','rowHeights','borders','page'];
const version=source=>createHash('sha256').update(JSON.stringify(source)).digest('hex');
export const DRAFT_WINDOW_CHARS=24000;

export function draftWindow(source,focus=[],budget=DRAFT_WINDOW_CHARS){
  if(!source)return null;
  if(!Number.isSafeInteger(budget)||budget<2000||budget>DRAFT_WINDOW_CHARS)throw new Error('input_context_limit');
  if(JSON.stringify(source).length<=budget)return structuredClone(source);
  const result={name:source.name,address:source.address,cells:[],draftView:{viewId:version(source),complete:false,totalCells:source.cells.length,omittedCellAddresses:source.cells.map(c=>c.address),omittedLayoutFields:layoutFields.filter(k=>Object.hasOwn(source,k)),instruction:'Bounded draft view, not a replacement sheet. Omitted cells/layout are retained, not blank. Use read_document_draft for exact cells or part:formats|merges|columnWidths|rowHeights|borders|page. Patch with write_document_chunk, then commit_document_sheet. Do not submit this partial view as write_document_sheet.'}};
  if(JSON.stringify(result).length>budget)throw new Error('input_context_limit');
  // Prefer recently touched cells; every visible cell is exact and omitted
  // addresses remain retrievable. Raw draft and commit input are never trimmed.
  const selected=new Set(),ordered=[...source.cells.filter(c=>focus.includes(c.address)),...source.cells.filter(c=>!focus.includes(c.address))];
  for(const cell of ordered){
    result.cells.push(structuredClone(cell));selected.add(cell.address);
    result.draftView.omittedCellAddresses=source.cells.filter(c=>!selected.has(c.address)).map(c=>c.address);
    if(JSON.stringify(result).length>budget){result.cells.pop();selected.delete(cell.address);result.draftView.omittedCellAddresses=source.cells.filter(c=>!selected.has(c.address)).map(c=>c.address);}
  }
  for(const key of [...result.draftView.omittedLayoutFields]){
    result[key]=structuredClone(source[key]);result.draftView.omittedLayoutFields=result.draftView.omittedLayoutFields.filter(k=>k!==key);
    if(JSON.stringify(result).length>budget){delete result[key];result.draftView.omittedLayoutFields.push(key);}
  }
  return result;
}

// This is an index, not evidence of workbook calculation. Read exact draft
// cells on demand; the final reviewer still receives the actual Excel result.
export function draftIndex(specs,currentName){
  return specs.filter(s=>s&&s.name!==currentName).map(s=>({name:s.name,address:s.address,cellCount:s.cells.length,formulaCount:s.cells.filter(c=>c.formula).length,preview:s.cells.slice(0,4).map(c=>({...c,...(typeof c.value==='string'?{value:c.value.slice(0,120)}:{})})),instruction:'Preview text may be truncated. Use read_document_draft for exact cells before referencing data.'}));
}
export function readDraft({sheet,address,part='cells',cursor=0,viewId},specs,current){
  const source=current?.name===sheet?current:specs.find(s=>s?.name===sheet);
  const fail=issue=>{throw Object.assign(new Error('document_reference_invalid'),{issue});};
  if(!source?.address)fail('This sheet has no available draft yet. Read an accepted sheet or author the planned sheet first.');
  const currentVersion=version(source);
  if(viewId!==undefined&&viewId!==currentVersion)fail('The draft changed. Read its current view before continuing.');
  if(part!=='cells'){
    if(!layoutFields.includes(part)||address!==undefined||!Number.isSafeInteger(cursor)||cursor<0||cursor>1000||cursor>0&&!viewId)fail('Choose a layout part and follow its nextCursor with the same viewId. Omit address for layout reads.');
    const present=Object.hasOwn(source,part),values=part==='page'?(present?[source.page]:[]):source[part]??[];
    if(!Array.isArray(values)||cursor>values.length)fail('Invalid layout cursor or draft layout.');
    const items=structuredClone(values.slice(cursor,cursor+8));
    const result={sheet:source.name,part,viewId:currentVersion,present,cursor,nextCursor:cursor+items.length<values.length?cursor+items.length:null,totalItems:values.length,items,complete:cursor===0&&items.length===values.length,source:'in-memory draft, not Excel calculation',instruction:'Exact layout entries. Missing parts are unauthored, not inferred defaults. Follow nextCursor using this viewId. Chunk layout fields replace the WHOLE field; retain all earlier entries when changing a field.'};
    if(JSON.stringify(result).length>16000)fail('This layout page exceeds the response limit. Repair oversized draft metadata before continuing.');
    return result;
  }
  if(cursor!==0||typeof address!=='string')fail('Cell reads require an A1 address; use smaller ranges instead of cursor.');
  const area=region(address),bounds=region(source.address);
  if(area.rows*area.cols>100||!inside(bounds,area))fail('Read at most 100 cells inside the draft address. Reduce the requested range.');
  const cells=source.cells.filter(c=>inside(area,region(c.address)));
  const result={sheet:source.name,address,viewId:currentVersion,cells,complete:true,source:'in-memory draft, not Excel calculation',instruction:'These are exact authored cells in this requested range only. Omitted positions in this range have no authored cell. Formula results are not calculated here.'};
  if(JSON.stringify(result).length>16000)fail('This draft range is too large for one response. Read a smaller range.');
  return structuredClone(result);
}

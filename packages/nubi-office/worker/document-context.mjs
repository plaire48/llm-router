import {region,inside} from './office-range.mjs';

// This is an index, not evidence of workbook calculation. Read exact draft
// cells on demand; the final reviewer still receives the actual Excel result.
export function draftIndex(specs,currentName){
  return specs.filter(s=>s&&s.name!==currentName).map(s=>({name:s.name,address:s.address,cellCount:s.cells.length,formulaCount:s.cells.filter(c=>c.formula).length,preview:s.cells.slice(0,4).map(c=>({...c,...(typeof c.value==='string'?{value:c.value.slice(0,120)}:{})})),instruction:'Preview text may be truncated. Use read_document_draft for exact cells before referencing data.'}));
}
export function readDraft({sheet,address},specs,current){
  const source=current?.name===sheet?current:specs.find(s=>s?.name===sheet);
  const fail=issue=>{throw Object.assign(new Error('document_reference_invalid'),{issue});};
  if(!source?.address)fail('This sheet has no available draft yet. Read an accepted sheet or author the planned sheet first.');
  const area=region(address),bounds=region(source.address);
  if(area.rows*area.cols>100||!inside(bounds,area))fail('Read at most 100 cells inside the draft address. Reduce the requested range.');
  const cells=source.cells.filter(c=>inside(area,region(c.address)));
  const result={sheet:source.name,address,cells,complete:true,source:'in-memory draft, not Excel calculation',instruction:'These are exact authored cells. Omitted positions have no authored cell. Formula results are not calculated here.'};
  if(JSON.stringify(result).length>16000)fail('This draft range is too large for one response. Read a smaller range.');
  return structuredClone(result);
}

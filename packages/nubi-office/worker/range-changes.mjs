// What changed in the bound range since the first read of this run, compared by the host cell by cell.
// A review has to judge requirements such as "leave the other cells as they are". With only the cells after the
// edit a careful model answers "unknown", and a careless one answers "met" without evidence. Both states are
// already in the hands of the host, so the comparison is made here and given to the review as evidence.
// Method reference, no code copied: the read-back and change preview of tmustier/pi-for-excel.
import {region,inside} from './office-range.mjs';
import {FORMAT_FIELDS} from './cell-format.mjs';

const PROPERTIES=['mergedAddress','validation','locked','arrayFormula','hiddenRow','hiddenColumn','rowHeight','columnWidth','borders'];
const cellName=(row,column)=>{let name='';for(let c=column;c;c=Math.floor((c-1)/26))name=String.fromCharCode(65+(c-1)%26)+name;return name+row;};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const blank=value=>value===null||value===undefined||value==='';
const same=(a,b)=>blank(a)&&blank(b)||typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=Math.max(1,Math.abs(a))*1e-10||JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const short=value=>typeof value==='string'&&value.length>120?value.slice(0,119)+'…':value&&typeof value==='object'?JSON.stringify(value).slice(0,120):value??null;

// written: the addresses this run wrote. Returns null when the two snapshots are not the same range.
export function rangeChanges(before,after,{written=[],limit=40}={}){
  if(!before||!after||before.address!==after.address||before.worksheet!==after.worksheet||!Array.isArray(before.values)||!Array.isArray(after.values))return null;
  let outer,targets;try{outer=region(after.address);targets=written.map(address=>region(address));}catch{return null;}
  const full=grid=>Array.isArray(grid)&&grid.length===outer.rows&&grid.every(row=>Array.isArray(row)&&row.length===outer.cols);
  const sources=[['value',before.values,after.values],['formula',before.formulas,after.formulas],...FORMAT_FIELDS.map(field=>[field,before.formats?.[field],after.formats?.[field]]),...PROPERTIES.map(field=>[field,before.properties?.[field],after.properties?.[field]])];
  const compared=[],notCompared=[],changed=[],cells=new Set();let unexpected=0,total=0;
  for(const [field,a,b] of sources){if(full(a)&&full(b))compared.push(field);else if(a!==undefined||b!==undefined||field==='value'||field==='formula')notCompared.push(field);}
  for(let r=0;r<outer.rows;r++)for(let c=0;c<outer.cols;c++){
    const row=outer.r+r,column=outer.c+c,address=cellName(row,column),wrote=targets.some(target=>inside(target,{r:row,c:column,rows:1,cols:1}));
    for(const [field,a,b] of sources){
      if(!compared.includes(field)||same(a[r][c],b[r][c]))continue;
      // The result of a formula that was not touched is a calculation of the workbook, not an edit.
      const formula=after.formulas?.[r]?.[c],calculated=field==='value'&&!wrote&&typeof formula==='string'&&formula&&formula===before.formulas?.[r]?.[c];
      const by=wrote?'edit':calculated?'calculation':'unexpected';
      total++;cells.add(address);if(by==='unexpected')unexpected++;
      if(changed.length<limit)changed.push({address,field,before:short(a[r][c]),after:short(b[r][c]),by,...(calculated?{formula:short(formula)}:{})});
    }
  }
  const count=outer.rows*outer.cols;
  return{comparedBy:'host',baseline:'the cells read before the first write of this run',target:`${after.worksheet}!${after.address}`,cells:count,changedCells:cells.size,unchangedCells:count-cells.size,unexpected,
    changed,...(total>changed.length?{omitted:total-changed.length}:{}),compared,...(notCompared.length?{notCompared}:{}),
    note:`Every cell of the range was compared in the fields listed under compared. A cell or field that is not listed under changed is unchanged. by edit: written by this run; by calculation: the result of a formula that was not touched; by unexpected: changed by neither.${unexpected?' There are unexpected changes: they need an explanation.':''}${notCompared.length?' Fields under notCompared could not be read and are unknown.':''}`};
}

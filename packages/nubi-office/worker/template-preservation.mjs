import {region} from './office-range.mjs';
import {FORMAT_FIELDS,FIELD_LABELS} from './cell-format.mjs';

const groups=[
  ['formulas','수식',[['formulas','수식']]],
  ['formats','글꼴, 색, 정렬, 표시 형식',FORMAT_FIELDS.map(k=>['formats.'+k,FIELD_LABELS[k]])],
  ['merges','병합',[['properties.mergedAddress','병합']]],
  ['borders','테두리',[['properties.borders','테두리']]],
  ['dimensions','행, 열 크기와 숨김',[['properties.rowHeight','행 높이'],['properties.columnWidth','열 너비'],['properties.hiddenRow','행 숨김'],['properties.hiddenColumn','열 숨김']]],
  ['validation','입력 제한, 잠금',[['properties.validation','입력 제한'],['properties.locked','잠금'],['properties.arrayFormula','배열 수식']]],
  ['values','고정 내용',[['values','값']]]
];
const grid=(s,key)=>key.split('.').reduce((v,k)=>v?.[k],s);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const address=(r,c)=>{let s='';for(;c;c=Math.floor((c-1)/26))s=String.fromCharCode(65+(c-1)%26)+s;return s+r;};
const preview=v=>{const str=typeof v==='string'?v:JSON.stringify(v);return str?.length>180?str.slice(0,180)+'…':str??'확인 불가';};
function known(key,value){
  if(value===undefined)return false;
  if(['values','formulas','properties.mergedAddress','formats.fillColor'].includes(key))return true;
  if(key==='properties.validation')return value===null||typeof value==='object'&&value.status!=='unreadable';
  return value!==null;
}

// Deterministic evidence, never an LLM rating or a whole-workbook guarantee.
// No file access: both observations must come from the authorized Excel host.
export function templatePreservation(before,after,{stage='readback',inputAddresses=[]}={}){
  if(!before||!after||before.worksheet!==after.worksheet||before.address!==after.address)throw new Error('template_comparison_invalid');
  const area=region(before.address),inputs=new Set(inputAddresses),differences=[],checks=[];
  let differenceCount=0,expectedValueChanges=0;
  const full=g=>Array.isArray(g)&&g.length===area.rows&&g.every(row=>Array.isArray(row)&&row.length===area.cols&&row.every(v=>v!==undefined));
  for(const [id,label,fields] of groups){
    let count=0,missing=false;
    for(const [key,field] of fields){
      const a=grid(before,key),b=grid(after,key);if(!full(a)||!full(b)){missing=true;continue;}
      for(let r=0;r<area.rows;r++)for(let c=0;c<area.cols;c++){
        if(!known(key,a[r][c])||!known(key,b[r][c])){missing=true;continue;}
        if(same(a[r][c],b[r][c]))continue;
        const cell=address(area.r+r,area.c+c);
        if(key==='values'&&(inputs.has(cell)||before.formulas?.[r]?.[c]&&before.formulas[r][c]===after.formulas?.[r]?.[c])){expectedValueChanges++;continue;}
        count++;differenceCount++;if(differences.length<20)differences.push({address:cell,field,before:preview(a[r][c]),after:preview(b[r][c])});
      }
    }
    checks.push({id,label,status:count?'changed':missing?'unverified':'preserved',differenceCount:count,...(missing?{note:'일부 속성을 읽지 못함'}:{})});
  }
  for(const [id,label] of [['date1904','날짜 체계'],['protected','시트 보호']]){
    const known=typeof before[id]==='boolean'&&typeof after[id]==='boolean';const changed=known&&before[id]!==after[id];
    checks.push({id,label,status:changed?'changed':known?'preserved':'unverified'});if(changed){differenceCount++;if(differences.length<20)differences.push({address:before.address,field:label,before:String(before[id]),after:String(after[id])});}
  }
  for(const [id,label] of [['objects','그림, 차트, 도형'],['conditional','조건부 서식, 기타 셀 효과'],['print','인쇄 결과, 페이지 전체 모양'],['other_ranges','선택 범위 밖의 내용과 양식'],['nasca','NASCA 암호화 상태']])checks.push({id,label,status:'unverified'});
  return{schemaVersion:1,stage,target:before.worksheet+'!'+before.address,status:differenceCount?'differences':'partial',checks,differences,differenceCount,expectedValueChanges,
    note:stage==='before_input'?'현재 범위에서 비교할 수 있는 항목입니다. 입력 후 다시 확인합니다.':'읽은 속성의 비교 결과입니다. 전체 문서가 동일하다는 뜻은 아닙니다.'};
}

export const TEMPLATE_PRESERVATION_GUIDANCE='Report template fidelity from deterministic preservation evidence: preserved, changed, or unverified. Unknown is never a pass. An XML metadata round trip is not an OOXML package or visual comparison. Acknowledge reported differences with the user; do not auto-repair layout. Formula corruption, wrong values and uncertain writes remain failures and cannot be waived by a cosmetic warning. Never claim identical whole-workbook rendering or verified NASCA encryption.';

import {officeQuestion} from './interaction.mjs';
import {region,inside} from './office-range.mjs';
import {FORMAT_FIELDS,normalizeTypedValue} from './cell-format.mjs';
import {modelJson} from './model-json.mjs';
import {inspectFormula} from './formula-preflight.mjs';
export const DOCUMENT_LIMITS={sheets:8,cellsPerSheet:1000,sourceChars:120000};
const fail=(issue='Match the sheet/task schema exactly; check required fields, cell bounds, types and merge overlaps.')=>{throw Object.assign(new Error('document_schema_invalid'),{issue});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const keys=(o,names)=>{if(!object(o)||Object.keys(o).some(k=>!names.includes(k)))fail();};
export function readJson(result){if(result?.calls?.length||result?.finishReason==='length'||!text(result?.content,64000))fail('Return a complete JSON object, not a tool call or truncated response.');return modelJson(result.content,'document_schema_invalid');}
export function parseDocumentTask(result){
  const t=readJson(result);keys(t,['intent','title','summary','requirements','questions','sheets']);
  if(!['create','clarify','unsupported'].includes(t.intent)||!text(t.title,80)||!text(t.summary,500)||!Array.isArray(t.requirements)||!t.requirements.length||t.requirements.length>16||!Array.isArray(t.questions)||t.questions.length>3||t.questions.some(q=>{try{return !text(officeQuestion(q).text,300);}catch{return true;}})||!Array.isArray(t.sheets)||t.sheets.length>8)fail();
  const ids=new Set();for(const r of t.requirements){keys(r,['id','text']);if(typeof r.id!=='string'||!/^[a-z0-9_-]{1,40}$/i.test(r.id)||ids.has(r.id)||!text(r.text,500))fail('requirements: use unique string IDs such as R1, and nonempty text. Reuse each exact ID in sheets[].requirementIds.');ids.add(r.id);}
  if(t.intent!=='create'){if(t.sheets.length||t.intent==='clarify'&&!t.questions.length)fail();return t;}
  if(!t.sheets.length||t.questions.length)fail();const names=new Set(),covered=new Set();
  for(const s of t.sheets){keys(s,['name','purpose','requirementIds']);if(!text(s.name,31)||/[\\/*?:\[\]]/.test(s.name)||s.name.startsWith("'")||s.name.endsWith("'")||names.has(s.name.toLowerCase())||!text(s.purpose,600)||!Array.isArray(s.requirementIds)||!s.requirementIds.length||s.requirementIds.some(id=>!ids.has(id)))fail();names.add(s.name.toLowerCase());s.requirementIds.forEach(id=>covered.add(id));}
  if(covered.size!==ids.size)fail('Every requirements[].id must appear in at least one sheets[].requirementIds.');return t;
}
export function validateFormula(formula,names){
  inspectFormula(formula,{sheets:names,strict:true});return formula;
}
function style(s){keys(s,FORMAT_FIELDS);if(!Object.keys(s).length)fail();for(const [k,v]of Object.entries(s)){
  if(['bold','italic','wrapText'].includes(k)&&typeof v!=='boolean')fail();
  if(k.endsWith('Color')&&!(k==='fillColor'&&v===null)&&!/^#[a-f0-9]{6}$/i.test(v))fail();
  if(k==='fontSize'&&(!Number.isFinite(v)||v<1||v>409||v*2%1))fail();
  if(['fontName','numberFormat'].includes(k)&&(!text(v,k==='fontName'?100:120)||/[\x00-\x1f]/.test(v)))fail();
  if(k==='horizontalAlignment'&&!['general','left','center','right','fill','justify','centerAcrossSelection','distributed'].includes(v))fail();
  if(k==='verticalAlignment'&&!['top','center','bottom','justify','distributed'].includes(v))fail();
  if(k.endsWith('Color')&&v!==null)s[k]=v.toUpperCase();
}return s;}
export function normalizeSheet(input,planned,names){
  const s=structuredClone(input);keys(s,['name','address','cells','formats','merges','columnWidths','rowHeights','borders','page']);
  if(s.name!==planned.name)fail();const area=region(s.address);if(area.r!==1||area.c!==1||area.rows*area.cols>1000)fail();
  const bounded=a=>{const r=region(a);if(!inside(area,r))fail();return r;};
  if(!Array.isArray(s.cells)||!s.cells.length||s.cells.length>1000)fail();const addresses=new Set();
  for(const c of s.cells){keys(c,['address','value','valueType','formula','numberFormat']);if(!text(c.address,20))fail();c.address=c.address.replaceAll('$','').toUpperCase();const r=bounded(c.address);if(r.rows*r.cols!==1||c.address.includes(':')||addresses.has(c.address))fail();addresses.add(c.address);if(Object.hasOwn(c,'formula')){if(Object.hasOwn(c,'value')||c.valueType)fail();try{validateFormula(c.formula,names);}catch(error){error.issue=`${s.name}!${c.address}: ${error.issue||error.message}`;throw error;}}else{if(!Object.hasOwn(c,'value'))fail();c.value=normalizeTypedValue(c.value,c.valueType??(typeof c.value==='number'?'number':typeof c.value==='boolean'?'boolean':'text'));if(typeof c.value==='string'&&c.value.length>5000)fail();if(c.value==='')c.value=null;c.numberFormat??=({text:'@',date:'yyyy-mm-dd',percent:'0.00%'}[c.valueType]);}if(c.numberFormat!==undefined)style({numberFormat:c.numberFormat});delete c.valueType;}
  s.formats??=[];if(!Array.isArray(s.formats)||s.formats.length>80)fail();for(const f of s.formats){keys(f,['address','style']);bounded(f.address);style(f.style);}
  s.merges??=[];if(!Array.isArray(s.merges)||s.merges.length>40)fail();const merged=new Set();for(const a of s.merges){const r=bounded(a);if(r.rows*r.cols<2)fail();for(let y=r.r;y<r.r+r.rows;y++)for(let x=r.c;x<r.c+r.cols;x++){const k=`${y}:${x}`;if(merged.has(k))fail();merged.add(k);for(const c of s.cells){const p=region(c.address);if(p.r===y&&p.c===x&&(y!==r.r||x!==r.c))fail();}}}
  s.columnWidths??=[];s.rowHeights??=[];for(const [items,max,limit]of [[s.columnWidths,area.cols,100],[s.rowHeights,area.rows,409]]){if(!Array.isArray(items)||items.length>max)fail();const seen=new Set();for(const entry of items){keys(entry,['index','size']);if(!Number.isInteger(entry.index)||entry.index<1||entry.index>max||seen.has(entry.index)||!Number.isFinite(entry.size)||entry.size<5||entry.size>limit)fail();seen.add(entry.index);}}
  s.borders??=[];if(!Array.isArray(s.borders)||s.borders.length>40)fail();for(const b of s.borders){keys(b,['address','color']);bounded(b.address);if(!/^#[a-f0-9]{6}$/i.test(b.color))fail();b.color=b.color.toUpperCase();}
  s.page??={orientation:'portrait'};keys(s.page,['orientation']);if(!['portrait','landscape'].includes(s.page.orientation))fail();
  if(JSON.stringify(s).length>60000)fail();return s;
}
export function verifyDocument(task,specs,snapshot,{calculated=true}={}){
  const checks=[];const push=(requirement,met,detail='')=>checks.push({requirement,status:met?'met':'unmet',detail});
  push('Excel 계산 완료',!calculated||snapshot?.calculated===true);
  push('계획한 시트 구성',JSON.stringify(snapshot?.sheets?.map(s=>s.name))===JSON.stringify(task.sheets.map(s=>s.name)));
  for(const spec of specs){const actual=snapshot?.sheets?.find(s=>s.name===spec.name);if(!actual){push(spec.name+' 시트 존재',false);continue;}
    const cells=new Map(actual.cells?.map(c=>[c.address,c])||[]);
    for(const c of spec.cells){const a=cells.get(c.address);let met=!!a;if(c.formula)met=met&&canonicalFormula(a.formula||'')===canonicalFormula(c.formula)&&(!calculated||a.error===false&&a.value!==null&&a.value!==undefined);else met=met&&JSON.stringify(a.value)===JSON.stringify(c.value)&&!a.formula;push(`${spec.name}!${c.address}`,met,c.formula?'수식과 계산 결과':'값');}
    push(spec.name+' 서식, 병합, 행열 크기, 인쇄 설정',actual.layoutVerified===true,JSON.stringify(actual.layoutIssues||[]));
    if(calculated)push(spec.name+' 계산 오류 없음',actual.cells.every(c=>c.error===false));
  }
  return{verified:checks.every(c=>c.status==='met'),checks};
}

export const canonicalNumberFormat=value=>value.replace(/"([^\x00-\x7f"]+)"/g,'$1');

export const canonicalFormula=value=>value.split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:part.replace(/'([\p{L}_][\p{L}\p{N}_]*)'!/gu,'$1!').toUpperCase()).join('');

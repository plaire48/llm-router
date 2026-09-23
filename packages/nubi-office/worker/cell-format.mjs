import {region,inside} from './office-range.mjs';
export const FORMAT_FIELDS=['bold','italic','fillColor','numberFormat','fontName','fontSize','fontColor','horizontalAlignment','verticalAlignment','wrapText'];
export const VALUE_TYPES=['text','number','percent','date','boolean'];
export const FIELD_LABELS={value:'값',formula:'수식',bold:'굵게',italic:'기울임',fillColor:'배경색',numberFormat:'표시 형식',fontName:'글꼴',fontSize:'글자 크기',fontColor:'글자색',horizontalAlignment:'가로 정렬',verticalAlignment:'세로 정렬',wrapText:'자동 줄바꿈'};
function numeric(value){
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER)return value;
  if(typeof value!=='string'||!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim()))throw new Error('invalid_typed_value');
  const n=Number(value.trim().replaceAll(',',''));if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw new Error('invalid_typed_value');return n;
}
export function normalizeTypedValue(value,type,date1904=false){
  if(!VALUE_TYPES.includes(type))throw new Error('invalid_typed_value');
  if(value===null)return null;
  if(type==='text'){if(typeof value!=='string')throw new Error('invalid_typed_value');return value;}
  if(type==='boolean'){if(typeof value!=='boolean')throw new Error('invalid_typed_value');return value;}
  if(type==='number')return numeric(value);
  if(type==='percent'){
    // Numeric input is already a fraction; strings must state the percent unit.
    if(typeof value==='number')return numeric(value);
    if(typeof value!=='string'||!value.trim().endsWith('%'))throw new Error('ambiguous_percent');
    return numeric(value.trim().slice(0,-1))/100;
  }
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('invalid_typed_value');
  const [year,month,day]=value.split('-').map(Number),time=Date.UTC(year,month-1,day),date=new Date(time);
  if(year<(date1904?1904:1900)||year>9999||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new Error('invalid_typed_value');
  return date1904 ? (time-Date.UTC(1904,0,1))/86400000 : (time-Date.UTC(1899,11,31))/86400000+(time>=Date.UTC(1900,2,1)?1:0);
}
export function normalizePlan(plan,before){
  if(!plan||!Array.isArray(plan.operations)||plan.operations.length>30||Object.keys(plan).some(key=>!['operations','answer'].includes(key)))throw new Error('invalid_plan');
  const outer=region(before.address),operations=[];
  for(const op of plan.operations){
    if(!op||typeof op!=='object')throw new Error('invalid_plan');
    const area=region(op.address);if(!inside(outer,area))throw new Error('out_of_scope');
    if(op.type==='copy_format'){
      if(Object.keys(op).some(key=>!['type','address','sourceAddress','fields'].includes(key)))throw new Error('invalid_plan');
      const source=region(op.sourceAddress),fields=op.fields??FORMAT_FIELDS;
      if(!inside(outer,source))throw new Error('out_of_scope');
      if(source.rows!==1||source.cols!==1||!Array.isArray(fields)||!fields.length||fields.some(field=>!FORMAT_FIELDS.includes(field))||new Set(fields).size!==fields.length)throw new Error('invalid_format');
      const format={type:'format_range',address:op.address};
      for(const field of fields){const value=before.formats?.[field]?.[source.r-outer.r]?.[source.c-outer.c];if(value===undefined||value===null&&field!=='fillColor')throw new Error('format_unavailable');format[field]=value;}
      operations.push(format);
    }else if(op.type==='set_typed_values'){
      if(Object.keys(op).some(key=>!['type','address','values','valueType','numberFormat'].includes(key)))throw new Error('invalid_plan');
      if(!Array.isArray(op.values)||op.values.length!==area.rows||op.values.some(row=>!Array.isArray(row)||row.length!==area.cols))throw new Error('invalid_grid');
      const values=op.values.map(row=>row.map(value=>normalizeTypedValue(value,op.valueType,before.date1904)));
      operations.push({type:'set_values',address:op.address,values});
      const numberFormat=op.numberFormat??({text:'@',percent:'0.00%',date:'yyyy-mm-dd'}[op.valueType]);
      if(numberFormat!==undefined)operations.push({type:'format_range',address:op.address,numberFormat});
    }else operations.push({...op});
  }
  if(operations.length>30)throw new Error('invalid_plan');
  return {...plan,operations};
}

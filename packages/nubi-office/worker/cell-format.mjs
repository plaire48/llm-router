import {inspectFormula} from './formula-preflight.mjs';
import {isValidFormat,isDateFormat,isPercentFormat,isTextFormat} from 'numfmt';
import {region,inside,localAddress} from './office-range.mjs';
export const FORMAT_FIELDS=['bold','italic','fillColor','numberFormat','fontName','fontSize','fontColor','horizontalAlignment','verticalAlignment','wrapText'];
export const VALUE_TYPES=['text','number','percent','date','boolean'];
export const FIELD_LABELS={value:'값',formula:'수식',bold:'굵게',italic:'기울임',fillColor:'배경색',numberFormat:'표시 형식',fontName:'글꼴',fontSize:'글자 크기',fontColor:'글자색',horizontalAlignment:'가로 정렬',verticalAlignment:'세로 정렬',wrapText:'자동 줄바꿈'};
// A refused value says which form is accepted: the bare code made a live model try a serial number and a timestamp.
const refuseValue=(code,issue)=>{throw Object.assign(new Error(code),{issue});};
const NUMBER_FORM='A number is a JSON number such as 1500000 or 0.5, or digits with thousands separators such as "1,500,000". A unit or currency sign (원, 개, %) is not part of the number: the number format of the cell shows it.';
const DATE_FORM='A date is written as text yyyy-mm-dd, for example "2026-10-01". The host converts it to the date number of this workbook: do not send a serial number, a time or another date notation.';
const PERCENT_FORM='A percent is written with its sign, for example "10%", or as a fraction number such as 0.1. A text without % is ambiguous.';
function numeric(value,form=NUMBER_FORM){
  if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER)return value;
  if(typeof value!=='string'||!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim()))refuseValue('invalid_typed_value',form);
  const n=Number(value.trim().replaceAll(',',''));if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)refuseValue('invalid_typed_value',form);return n;
}
export function normalizeTypedValue(value,type,date1904=false){
  if(!VALUE_TYPES.includes(type))refuseValue('invalid_typed_value',`valueType must be one of ${VALUE_TYPES.join(', ')}.`);
  if(value===null)return null;
  if(type==='text'){if(typeof value!=='string')refuseValue('invalid_typed_value','A text value is a JSON string in quotes, for example "00123". Write a code with leading zeros as text.');return value;}
  if(type==='boolean'){if(typeof value!=='boolean')refuseValue('invalid_typed_value','A boolean value is true or false, without quotes.');return value;}
  if(type==='number')return numeric(value);
  if(type==='percent'){
    // Numeric input is already a fraction; strings must state the percent unit.
    if(typeof value==='number')return numeric(value,PERCENT_FORM);
    if(typeof value!=='string'||!value.trim().endsWith('%'))refuseValue('ambiguous_percent',PERCENT_FORM);
    return numeric(value.trim().slice(0,-1),PERCENT_FORM)/100;
  }
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))refuseValue('invalid_typed_value',DATE_FORM);
  const [year,month,day]=value.split('-').map(Number),time=Date.UTC(year,month-1,day),date=new Date(time),first=date1904?1904:1900;
  if(year<first||year>9999)refuseValue('invalid_typed_value',`${value} is outside the dates of this workbook, which begin in ${first} and end in 9999.`);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)refuseValue('invalid_typed_value',`${value} is not a day of the calendar. `+DATE_FORM);
  return date1904 ? (time-Date.UTC(1904,0,1))/86400000 : (time-Date.UTC(1899,11,31))/86400000+(time>=Date.UTC(1900,2,1)?1:0);
}
const OPERATIONS=['set_values','set_formulas','set_typed_values','format_range','copy_format','set_request_table'];
// A string Excel would read as a number, a percent, a date, a time or a boolean if it were typed into a General cell.
export function numericLooking(value){
  const text=String(value).trim();
  return !text||/^[+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(text)||/^\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,4})?$/.test(text)||/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)||/^(?:true|false)$/i.test(text)||/^\d{4}년\s*\d{1,2}월(?:\s*\d{1,2}일)?$/.test(text);
}
export const PLAN_EXAMPLE='{"operations":[{"type":"set_values","address":"A2","values":[[4]]},{"type":"format_range","address":"A2","bold":true}]}';
// A live model read the tool text "set_values {address,values}" as a wrapper
// key and sent {"set_values":{...}}. That shape is unambiguous, so accept it.
function flatOperation(item,index){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('invalid_plan');
  const keys=Object.keys(item),body=item[keys[0]];
  const op=keys.length===1&&OPERATIONS.includes(keys[0])&&body&&typeof body==='object'&&!Array.isArray(body)&&body.type===undefined?{type:keys[0],...body}:item;
  if(!OPERATIONS.includes(op.type))throw Object.assign(new Error('unsupported_operation'),{issue:`operations[${index}].type must be one of ${OPERATIONS.join(', ')}. Write every operation as one flat object, for example ${PLAN_EXAMPLE}`});
  return op;
}
// A number format is parsed with numfmt before it is written. Excel refuses a broken format with a COM error.
export function formatIssue(numberFormat){
  if(typeof numberFormat!=='string'||!numberFormat.trim()||numberFormat.length>120||/[\x00-\x1f\x7f]/.test(numberFormat))return'must be a format text of 1-120 characters';
  let valid=false;try{valid=isValidFormat(numberFormat);}catch{valid=false;}
  return valid?null:'is not a number format Excel can read';
}
// date, percent, text or number, read from the parsed format: unit text inside quotes ("일", "mm") is not a date.
export function formatKind(numberFormat){
  if(formatIssue(numberFormat))return'unknown';
  try{return isTextFormat(numberFormat)?'text':isDateFormat(numberFormat)?'date':isPercentFormat(numberFormat)?'percent':'number';}catch{return'unknown';}
}
const FORMAT_EXAMPLES='#,##0   0.0%   yyyy-mm-dd   #,##0"원"   @ (text)   General';
const cellName=(row,column)=>{let name='';for(let c=column;c;c=Math.floor((c-1)/26))name=String.fromCharCode(65+(c-1)%26)+name;return name+row;};
// set_request_table writes rows of a table the host found in the request (request-table.mjs): every cell comes from the
// user's text and is typed by its column. fromRow and toRow (1-based) choose rows, for example to leave out a header.
// It becomes one set_values and the number formats its columns need, as set_typed_values would add them.
function requestTableOperations(op,index,area,before,tables){
  const at=`operations[${index}]`,fault=(code,issue)=>{throw Object.assign(new Error(code),{issue:`${at}: ${issue}`.slice(0,600)});};
  if(Object.keys(op).some(key=>!['type','address','table','valueTypes','fromRow','toRow'].includes(key)))fault('invalid_plan','set_request_table takes address, table, valueTypes and optionally fromRow and toRow.');
  const table=tables.find(item=>item.table===op.table);
  if(!table)fault('invalid_plan',tables.length?`table must be the number of a table in requestTables, 1 to ${tables.length}.`:'this request holds no table the host can read. Write the values with set_values.');
  const from=op.fromRow??1,to=op.toRow??table.rows;
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>table.rows||from>to)fault('invalid_plan',`fromRow and toRow must choose rows 1 to ${table.rows} of table ${table.table}.`);
  if(to-from+1!==area.rows||table.columns!==area.cols)fault('invalid_grid',`rows ${from} to ${to} of table ${table.table} are ${to-from+1} row(s) by ${table.columns} column(s), and ${op.address} is ${area.rows} by ${area.cols}. For these rows starting at ${cellName(area.r,area.c)} the address is ${cellName(area.r,area.c)}:${cellName(area.r+to-from,area.c+table.columns-1)}.`);
  if(!Array.isArray(op.valueTypes)||op.valueTypes.length!==table.columns||op.valueTypes.some(type=>!VALUE_TYPES.includes(type)))fault('invalid_typed_value',`valueTypes must give one of ${VALUE_TYPES.join(', ')} for each of the ${table.columns} columns, in order.`);
  const values=table.cells.slice(from-1,to).map((row,r)=>row.map((field,c)=>{
    if(field==='')return null;
    const type=op.valueTypes[c],given=type==='boolean'&&/^(?:true|false)$/i.test(field)?field.toLowerCase()==='true':field;
    try{return normalizeTypedValue(given,type,before.date1904);}
    catch(error){throw Object.assign(error,{issue:`${at}: row ${from+r} of table ${table.table}, column ${c+1} (${cellName(area.r+r,area.c+c)}) "${field.slice(0,60)}" is not ${type}. ${error.issue||''} Choose another valueType for this column, or write these cells with set_values.`.slice(0,600)});}
  }));
  const operations=[{type:'set_values',address:op.address,values}],outer=region(before.address),current=before.formats?.numberFormat;
  for(let c=0;c<area.cols;c++){
    const type=op.valueTypes[c],column=values.map(row=>row[c]);
    const numberFormat=type==='text'?(column.some(value=>typeof value==='string'&&numericLooking(value))?'@':undefined):{percent:'0.00%',date:'yyyy-mm-dd'}[type];
    const same=Array.isArray(current)&&column.every((_,r)=>current[area.r-outer.r+r]?.[area.c-outer.c+c]===numberFormat);
    if(numberFormat!==undefined&&!same)operations.push({type:'format_range',address:`${cellName(area.r,area.c+c)}:${cellName(area.r+area.rows-1,area.c+c)}`,numberFormat});
  }
  return operations;
}
export function normalizePlan(plan,before,{tables=[]}={}){
  if(!plan||!Array.isArray(plan.operations)||plan.operations.length>30||Object.keys(plan).some(key=>!['operations','answer'].includes(key)))throw new Error('invalid_plan');
  const outer=region(before.address),operations=[];
  // Drop the bound sheet's own name from an address and say which operation is wrong.
  const local=(op,key,index)=>{try{const address=localAddress(op[key],before.worksheet);region(address);return address;}catch(error){const issue=op[key]===undefined?`operations[${index}].${key} is missing. It must be an A1 cell or range inside ${before.address}, for example ${PLAN_EXAMPLE}`:`operations[${index}].${key} must be an A1 cell or range inside ${before.address}, without a sheet name.`;throw Object.assign(error,{issue:(typeof error.issue==='string'?issue+' '+error.issue:issue).slice(0,600)});}};
  for(const [index,raw] of plan.operations.entries()){
    const item=flatOperation(raw,index),op={...item,address:local(item,'address',index)},area=region(op.address);
    if(op.type==='set_request_table'){
      if(!inside(outer,area))throw Object.assign(new Error('out_of_scope'),{issue:`operations[${index}].address must be inside the selected range ${before.address}.`});
      const expanded=requestTableOperations(op,index,area,before,tables);
      expanded[0].values.forEach((row,r)=>row.forEach((value,c)=>{if(typeof value==='string'&&/^\s*[=+@]/.test(value))throw Object.assign(new Error('invalid_value'),{issue:`operations[${index}]: row ${r+1} of the written rows (${cellName(area.r+r,area.c+c)}): a text cannot begin with =, + or @, because Excel could read it as a formula. Write these cells with set_values without the leading sign.`});}));
      operations.push(...expanded);continue;
    }
    if(['set_values','set_typed_values'].includes(op.type)&&Array.isArray(op.values))op.values.forEach((row,r)=>Array.isArray(row)&&row.forEach((value,c)=>{
      // The host writes such text only as a formula would be written; it refuses it. Say which cell and how to write it.
      if(typeof value==='string'&&/^\s*[=+@]/.test(value))throw Object.assign(new Error('invalid_value'),{issue:`operations[${index}].values[${r}][${c}] (${cellName(area.r+r,area.c+c)}): a text cannot begin with =, + or @, because Excel could read it as a formula. Write a phone number without the leading + (82-10-...), and write a formula with set_formulas.`});
    }));
    if(['format_range','set_typed_values'].includes(op.type)&&Object.hasOwn(op,'numberFormat')&&!(op.type==='set_typed_values'&&op.numberFormat===undefined)){
      const issue=formatIssue(op.numberFormat);
      if(issue)throw Object.assign(new Error('invalid_format'),{issue:`operations[${index}].numberFormat ${issue}. Write the format as Excel stores it, for example: ${FORMAT_EXAMPLES}. To keep the format a cell already has, leave numberFormat out.`});
    }
    if(!inside(outer,area))throw Object.assign(new Error('out_of_scope'),{issue:`operations[${index}].address must be inside the selected range ${before.address}.`});
    if(op.type==='copy_format'){
      if(Object.keys(op).some(key=>!['type','address','sourceAddress','fields'].includes(key)))throw new Error('invalid_plan');
      const source=region(local(item,'sourceAddress',index)),fields=op.fields??FORMAT_FIELDS;
      if(!inside(outer,source))throw Object.assign(new Error('out_of_scope'),{issue:`operations[${index}].sourceAddress must be inside the selected range ${before.address}.`});
      if(source.rows!==1||source.cols!==1||!Array.isArray(fields)||!fields.length||fields.some(field=>!FORMAT_FIELDS.includes(field))||new Set(fields).size!==fields.length)throw new Error('invalid_format');
      const format={type:'format_range',address:op.address};
      for(const field of fields){const value=before.formats?.[field]?.[source.r-outer.r]?.[source.c-outer.c];if(value===undefined||value===null&&field!=='fillColor')throw new Error('format_unavailable');format[field]=value;}
      operations.push(format);
    }else if(op.type==='set_typed_values'){
      if(Object.keys(op).some(key=>!['type','address','values','valueType','numberFormat'].includes(key)))throw new Error('invalid_plan');
      if(!Array.isArray(op.values)||op.values.length!==area.rows||op.values.some(row=>!Array.isArray(row)||row.length!==area.cols))throw new Error('invalid_grid');
      const values=op.values.map((row,r)=>row.map((value,c)=>{
        try{return normalizeTypedValue(value,op.valueType,before.date1904);}
        catch(error){throw Object.assign(error,{issue:`operations[${index}].values[${r}][${c}] (${cellName(area.r+r,area.c+c)}): ${error.issue||'the value does not fit valueType '+op.valueType+'.'}`.slice(0,600)});}
      }));
      operations.push({type:'set_values',address:op.address,values});
      // The host writes a string as text whatever the format. The text format only keeps a later entry from turning
      // into a number or a date, so it is added only when a value looks like one (leading zeros, digits, dates).
      const plainText=op.valueType==='text'&&op.numberFormat===undefined&&values.flat().every(value=>typeof value==='string'&&!numericLooking(value));
      const numberFormat=op.numberFormat??(plainText?undefined:{text:'@',percent:'0.00%',date:'yyyy-mm-dd'}[op.valueType]);
      // Skip a format the cells already have: a no-op write only adds a change the plan did not list.
      const current=before.formats?.numberFormat,same=Array.isArray(current)&&Array.from({length:area.rows},(_,r)=>Array.from({length:area.cols},(_,c)=>current[area.r-outer.r+r]?.[area.c-outer.c+c])).flat().every(value=>value===numberFormat);
      if(numberFormat!==undefined&&!same)operations.push({type:'format_range',address:op.address,numberFormat});
    }else if(op.type==='set_formulas'){
      // The same checks as for a new workbook, before Excel sees the formula. Without them a syntax error failed the
      // COM call and ended the run.
      if(!Array.isArray(op.formulas)||op.formulas.length!==area.rows||op.formulas.some(row=>!Array.isArray(row)||row.length!==area.cols))throw Object.assign(new Error('invalid_grid'),{issue:`operations[${index}].formulas must be a matrix of ${area.rows} row(s) by ${area.cols} column(s) matching ${op.address}.`});
      op.formulas.forEach((row,r)=>row.forEach((formula,c)=>{
        if(formula===null||formula===undefined||formula==='')return;
        const target=cellName(area.r+r,area.c+c),at=`operations[${index}].formulas[${r}][${c}] (${target})`;
        let inspected;try{inspected=inspectFormula(formula,{worksheet:before.worksheet});}
        catch(error){throw Object.assign(new Error('unsupported_formula'),{issue:`${at}: ${error.issue||'The formula could not be read. Check its syntax for Excel 2016.'}`.slice(0,600)});}
        const own=inspected.references.find(ref=>ref.range&&(!ref.sheet||ref.sheet.toLowerCase()===String(before.worksheet).toLowerCase())&&ref.r<=area.r+r&&area.r+r<=ref.er&&ref.c<=area.c+c&&area.c+c<=ref.ec);
        if(own)throw Object.assign(new Error('unsupported_formula'),{issue:`${at}: the formula refers to its own cell ${target} through ${own.range}, which is a circular reference. Refer only to other cells, for example end the range one cell before ${target}.`});
      }));
      operations.push({...op});
    }else operations.push({...op});
  }
  if(operations.length>30)throw new Error('invalid_plan');
  return {...plan,operations};
}

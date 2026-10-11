// What a refused write did to the cells, read from the snapshot the host took before it undid the change.
// The host refuses a write that leaves an error value or breaks the input rule of a cell. The model needs to know
// which cell, which formula and which error in order to correct it. Everything here is read from the two snapshots:
// nothing is calculated and nothing is guessed.
// Method references, no code copied: the recalculation report of Anthropic's xlsx skill (errors by type with their
// cells), the read-back of tmustier/pi-for-excel, the structured errors of sbroenne/mcp-server-excel.
import {region,inside} from './office-range.mjs';

const cellName=(row,column)=>{let name='';for(let c=column;c;c=Math.floor((c-1)/26))name=String.fromCharCode(65+(c-1)%26)+name;return name+row;};
const short=(value,limit)=>{const text=String(value??'');return text.length>limit?text.slice(0,limit-1)+'…':text;};
// What usually corrects each error value of Excel.
const HINTS={
  '#DIV/0!':'the divisor is 0 or empty: test the divisor with IF, or wrap the division in IFERROR',
  '#NAME?':'Excel 2016 does not know a name or function in the formula: check the spelling and use functions of Excel 2016',
  '#REF!':'the formula refers to a cell or sheet that does not exist: refer to cells that were read',
  '#VALUE!':'an operand has the wrong type, for example text where a number is needed: refer to the cells that hold numbers',
  '#N/A':'a lookup found no match: check the lookup value and range, or wrap the lookup in IFERROR or IFNA',
  '#NUM!':'a number is outside what the function accepts: check the arguments',
  '#NULL!':'two ranges are joined by a space instead of a comma or colon: write the range with a colon'
};
const COMPARE={1:'between',2:'not between',3:'equal to',4:'not equal to',5:'greater than',6:'less than',7:'greater than or equal to',8:'less than or equal to'};
const KINDS={1:'a whole number',2:'a number',4:'a date',5:'a time',6:'text with a length'};
// An input rule of Excel (data validation) in words.
export function describeRule(rule){
  if(!rule||typeof rule!=='object')return'';
  if(rule.type===3){
    const separator=typeof rule.listSeparator==='string'&&rule.listSeparator.length===1?rule.listSeparator:',',source=String(rule.formula1??'');
    return source.startsWith('=')?`one of the values of the list ${short(source,80)}`:`one of: ${source.split(separator).map(item=>item.trim()).filter(Boolean).slice(0,20).map(item=>short(item,40)).join(', ')}`;
  }
  if(rule.type===7)return`a value that satisfies the custom rule ${short(rule.formula1,120)}`;
  const kind=KINDS[rule.type],compare=COMPARE[rule.operator];if(!kind||!compare)return'';
  const serial=rule.type===4||rule.type===5?' (Excel date number)':'';
  return[1,2].includes(rule.operator)?`${kind} ${compare} ${short(rule.formula1,40)} and ${short(rule.formula2,40)}${serial}`:`${kind} ${compare} ${short(rule.formula1,40)}${serial}`;
}
// before: the cells before the write. after: the cells the host read after the write, before undoing it.
// Returns null when the snapshots show no new error value and no broken input rule.
export function diagnoseWrite(before,after,plan,{limit=12}={}){
  if(!before||!after||before.address!==after.address||!Array.isArray(after.errors)||!Array.isArray(plan?.operations))return null;
  let outer,targets;try{outer=region(after.address);targets=plan.operations.map(operation=>region(operation.address));}catch{return null;}
  const written=(row,column)=>targets.some(target=>inside(target,{r:row,c:column,rows:1,cols:1}));
  const errors=[],invalid=[];
  for(let r=0;r<outer.rows;r++)for(let c=0;c<outer.cols;c++){
    const row=outer.r+r,column=outer.c+c,address=cellName(row,column);
    if(after.errors[r]?.[c]===true&&before.errors?.[r]?.[c]!==true)errors.push({address,shows:short(after.displayTexts?.[r]?.[c]||'an error value',20),formula:after.formulas?.[r]?.[c]??null,written:written(row,column)});
    if(written(row,column)&&after.properties?.validationValid?.[r]?.[c]===false)invalid.push({address,value:after.values?.[r]?.[c]??null,accepts:describeRule(after.properties.validation?.[r]?.[c])});
  }
  if(!errors.length&&!invalid.length)return null;
  const where=plan.operations.map(operation=>operation.address).slice(0,6).join(', ');
  if(errors.length){
    const cells=errors.slice(0,limit),more=errors.length-cells.length,kinds=[...new Set(cells.map(cell=>cell.shows))];
    const lines=cells.map(cell=>cell.written?`${cell.address} ${short(cell.formula??'',120)} shows ${cell.shows}`:`${cell.address}, an existing formula ${short(cell.formula??'',120)}, shows ${cell.shows} after the write to ${where}`);
    const issue=`The change was undone because it left error values: ${lines.join('; ')}${more>0?`; and ${more} more`:''}. ${kinds.filter(kind=>HINTS[kind]).map(kind=>`${kind}: ${HINTS[kind]}`).join('. ')}${kinds.some(kind=>HINTS[kind])?'. ':''}Correct the formula or the value and write again. If an input that the formula needs is missing, ask the user for it.`;
    return{cause:'formula_result_error',cells,total:errors.length,issue:short(issue,1200)};
  }
  const cells=invalid.slice(0,limit),more=invalid.length-cells.length;
  const issue=`The change was undone because a value breaks the input rule of its cell: ${cells.map(cell=>`${cell.address} accepts ${cell.accepts||'only values of its input rule'}, not ${short(JSON.stringify(cell.value),60)}`).join('; ')}${more>0?`; and ${more} more`:''}. Write a value that the rule accepts. If the user's value does not fit the rule, ask the user which accepted value to use; the rule of the form is not changed.`;
  return{cause:'validation_failed',cells,total:invalid.length,issue:short(issue,1200)};
}

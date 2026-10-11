import {region,inside} from './office-range.mjs';

// Arithmetic over captured cells is done here, never by a model. In a live
// measurement a sub-agent added eight numbers and was 500,000 off; the final
// review accepted the answer. Only real numbers count: text that looks like a
// number, booleans, blanks and error cells are skipped and reported.
export const OPERATIONS=['sum','average','min','max','count_numbers','count_nonblank'];
const fail=code=>{throw new Error(code);};
const name=(row,column)=>{let text='';for(let c=column;c;c=Math.floor((c-1)/26))text=String.fromCharCode(65+(c-1)%26)+text;return text+row;};
const letters=column=>name(0,column).slice(0,-1);
// Removes binary rounding noise (0.1+0.2) without changing a value that Excel would show.
const tidy=value=>Number.isInteger(value)?value:Number(value.toPrecision(15));
function collect(snapshot,area){
  const outer=region(snapshot.address),numbers=[],cells=[],skipped={text:0,blank:0,error:0};let nonblank=0;
  for(let r=0;r<area.rows;r++)for(let c=0;c<area.cols;c++){
    const row=area.r-outer.r+r,column=area.c-outer.c+c,value=snapshot.values?.[row]?.[column];
    if(snapshot.errors?.[row]?.[column]===true){skipped.error++;nonblank++;continue;}
    if(value===null||value===undefined||value===''){skipped.blank++;continue;}
    nonblank++;
    if(typeof value==='number'&&Number.isFinite(value)){numbers.push(value);cells.push({value,row:area.r+r,column:area.c+c});}else skipped.text++;
  }
  return{numbers,cells,skipped,nonblank};
}
// Where a minimum or maximum is: its cells (the first 5, so that a tie shows) and the snapshot row of the first one.
// The item behind a figure is then read from the cells, not counted out of a long list: a live sub-agent named an item
// 12 rows away from the maximum it reported, and the review accepted it (gpt-5.6-luna, 2026-09-30, 220 rows).
function located(snapshot,cells,value){
  const outer=region(snapshot.address),at=cells.filter(cell=>cell.value===value),row=at[0].row;
  return{cells:at.slice(0,5).map(cell=>name(cell.row,cell.column)),...(at.length>5?{more:at.length-5}:{}),
    ...(outer.cols<=30?{row:{address:`${name(row,outer.c)}:${name(row,outer.c+outer.cols-1)}`,values:(snapshot.values?.[row-outer.r]||[]).map(value=>typeof value==='string'?value.slice(0,160):value??null)}}:{})};
}
const exact=numbers=>numbers.every(value=>Math.abs(value)<Number.MAX_SAFE_INTEGER)&&Math.abs(numbers.reduce((sum,value)=>sum+value,0))<Number.MAX_SAFE_INTEGER;

// Totals of every column that holds numbers. A text in the first row is taken as the header.
export function columnTotals(snapshot,{limit=26}={}){
  const outer=region(snapshot.address),totals=[];
  for(let c=0;c<outer.cols&&totals.length<limit;c++){
    const header=typeof snapshot.values?.[0]?.[c]==='string'&&snapshot.values[0][c].trim()&&outer.rows>1?snapshot.values[0][c].trim().slice(0,80):undefined;
    const first=header===undefined?0:1,area={r:outer.r+first,c:outer.c+c,rows:outer.rows-first,cols:1},{numbers,cells,skipped}=collect(snapshot,area);
    if(!numbers.length)continue;
    const min=Math.min(...numbers),max=Math.max(...numbers);
    totals.push({column:letters(outer.c+c),...(header===undefined?{}:{header}),range:`${name(area.r,area.c)}:${name(area.r+area.rows-1,area.c)}`,numbers:numbers.length,sum:tidy(numbers.reduce((sum,value)=>sum+value,0)),min,minAt:located(snapshot,cells,min),max,maxAt:located(snapshot,cells,max),skipped,...(exact(numbers)?{}:{approximate:true})});
  }
  return totals;
}
export function calculate(snapshot,address,operation){
  if(!OPERATIONS.includes(operation))fail('tool_arguments_invalid');
  const outer=region(snapshot.address),area=region(address);if(!inside(outer,area))fail('context_range_limit');
  const {numbers,cells,skipped,nonblank}=collect(snapshot,area),sum=numbers.reduce((total,value)=>total+value,0);
  const value=operation==='count_numbers'?numbers.length:operation==='count_nonblank'?nonblank:!numbers.length?null:operation==='sum'?tidy(sum):operation==='average'?tidy(sum/numbers.length):operation==='min'?Math.min(...numbers):Math.max(...numbers);
  return{...(snapshot.worksheet?{worksheet:snapshot.worksheet}:{}),address,operation,value,...(['min','max'].includes(operation)&&numbers.length?{at:located(snapshot,cells,value)}:{}),numbers:numbers.length,skipped,...(exact(numbers)?{}:{approximate:true})};
}

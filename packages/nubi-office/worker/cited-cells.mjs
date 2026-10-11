import {region,inside} from './office-range.mjs';

// The cells an answer names and what they hold, taken by the host from cells it has read, so that the review compares
// a statement with its cells instead of trusting it. Measured 2026-09-30 (gpt-5.6-luna): an answer gave 동부 A18 as
// 스캐너 1차 with 4,004,000원 after a read of A18 had returned 프린터 2차 and 224,000, and the review accepted it.
// A single cell only; a range names no value. A cell counts when one read holds it on the worksheet the line names,
// or when every read that holds it is on one worksheet. Anything else is left out rather than guessed.
const REFERENCE=/(?<![A-Za-z0-9_$.:-])\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?![A-Za-z0-9_:(])/g;
const LIMIT=40;
const column=letters=>[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
function stated(line,value,displayText){
  if(value===null||value===undefined||value==='')return false;
  if(typeof displayText==='string'&&displayText.trim()&&line.includes(displayText.trim()))return true;
  if(typeof value==='string')return line.includes(value.trim());
  if(typeof value==='number'){
    const plain=line.replace(/(\d)[,\s](?=\d{3}(?!\d))/g,'$1'),text=String(value);
    return new RegExp('(?<![\\d.])'+text.replace(/[.+-]/g,'\\$&')+'(?!\\d|\\.\\d)').test(plain);
  }
  return typeof value==='boolean'&&new RegExp(String(value),'i').test(line);
}
// sources: [{worksheet,address,values,displayTexts?}]
export function citedCells(answer,sources){
  const areas=(sources||[]).flatMap(source=>{try{return typeof source?.worksheet==='string'&&Array.isArray(source.values)?[{...source,area:region(source.address)}]:[];}catch{return[];}});
  if(!areas.length||typeof answer!=='string')return[];
  const cited=[],seen=new Set();
  for(const [index,line] of answer.split('\n').entries()){
    if(cited.length>=LIMIT)break;
    const named=[...new Set(areas.map(source=>source.worksheet))].filter(name=>line.includes(name));
    for(const match of line.matchAll(REFERENCE)){
      const cell={r:Number(match[2]),c:column(match[1]),rows:1,cols:1},holding=areas.filter(source=>inside(source.area,cell));
      const sheets=[...new Set(holding.map(source=>source.worksheet))],onNamed=sheets.filter(name=>named.includes(name));
      const worksheet=onNamed.length===1?onNamed[0]:sheets.length===1&&!named.some(name=>!sheets.includes(name))?sheets[0]:null;
      if(!worksheet)continue;
      const address=match[1]+match[2],key=`${index}:${worksheet}!${address}`;if(seen.has(key))continue;seen.add(key);
      const source=holding.find(item=>item.worksheet===worksheet),row=cell.r-source.area.r,col=cell.c-source.area.c;
      const value=source.values[row]?.[col]??null,displayText=source.displayTexts?.[row]?.[col];
      cited.push({line:index+1,worksheet,cell:address,value:typeof value==='string'?value.slice(0,160):value,...(typeof displayText==='string'&&displayText!==String(value)?{displayText:displayText.slice(0,160)}:{}),statedInLine:stated(line,value,displayText)});
      if(cited.length>=LIMIT)break;
    }
  }
  return cited;
}

import {region} from './office-range.mjs';
import {analyzeTemplate} from './template.mjs';

// A compact, deterministic map of a form for the model: labels beside inputs,
// computed cells, item tables and fixed text. Live runs read a form twenty
// cells per call and needed two to five calls per form; this is one payload.
// Everything here is a HINT derived from position. It never authorizes a write
// and never replaces the user's confirmation of the field mapping.
const columnName=column=>{let name='';for(;column;column=Math.floor((column-1)/26))name=String.fromCharCode(65+(column-1)%26)+name;return name;};
const cellName=(row,column)=>columnName(column)+row;
const clip=(value,max=120)=>String(value).slice(0,max);
const blank=value=>value===null||value===undefined||value==='';
// Row references that follow their own row become {r}, so one pattern describes a column.
const rowPattern=(formula,row)=>formula.split('"').map((part,index)=>index%2?part:part.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g,(all,column,fixed,digits)=>!fixed&&Number(digits)===row?column+'{r}':all)).join('"');

function units(snapshot){
  const outer=region(snapshot.address),analysis=new Map(analyzeTemplate(snapshot).cells.map(cell=>[cell.address,cell])),at=new Map(),list=[];
  for(let r=0;r<outer.rows;r++)for(let c=0;c<outer.cols;c++){
    const row=outer.r+r,column=outer.c+c,address=cellName(row,column),merge=snapshot.properties.mergedAddress[r][c];
    let span={r:row,c:column,rows:1,cols:1};
    if(merge){try{span=region(merge);}catch{span=null;}}
    // A merge that leaves the observed range cannot be described; leave its cells out.
    if(!span||span.r<outer.r||span.c<outer.c||span.r+span.rows>outer.r+outer.rows||span.c+span.cols>outer.c+outer.cols)continue;
    if(span.r!==row||span.c!==column){at.set(address,at.get(cellName(span.r,span.c)));continue;}
    const value=snapshot.values[r][c],formula=snapshot.formulas[r][c],rule=snapshot.properties.validation[r][c],format=snapshot.formats?.numberFormat?.[r]?.[c];
    const unit={address,row,column,lastRow:row+span.rows-1,lastColumn:column+span.cols-1,span:merge?cellName(span.r,span.c)+':'+cellName(span.r+span.rows-1,span.c+span.cols-1):undefined,
      kind:formula?'formula':typeof value==='string'&&value.trim()?'text':blank(value)?'blank':'value',value,formula,writable:analysis.get(address)?.role==='candidate',
      numberFormat:typeof format==='string'&&format!=='General'?format:undefined,
      choices:rule?.type===3&&typeof rule.formula1==='string'&&!rule.formula1.startsWith('=')&&typeof rule.listSeparator==='string'&&rule.listSeparator.length===1?rule.formula1.split(rule.listSeparator).slice(0,20).map(item=>clip(item,40)):undefined};
    at.set(address,unit);list.push(unit);
  }
  const find=(row,column)=>at.get(cellName(row,column));
  return{outer,list,right:unit=>find(unit.row,unit.lastColumn+1),below:unit=>find(unit.lastRow+1,unit.column),find};
}

function findTables(grid){
  const tables=[],used=new Set(),{outer,list,find}=grid;
  for(let row=outer.r;row<outer.r+outer.rows;row++){
    let run=[];
    const close=()=>{
      if(run.length>=3){
        const header=run,body=[];let signature;
        for(let next=row+1;next<outer.r+outer.rows;next++){
          const line=header.map(head=>find(next,head.column));
          if(line.some((unit,index)=>!unit||unit.row!==next||unit.lastRow!==next||unit.column!==header[index].column||unit.lastColumn!==header[index].lastColumn)||line.every(unit=>unit.kind==='text'))break;
          const pattern=line.map(unit=>unit.kind==='formula'?rowPattern(unit.formula,next):'data').join('\u0001');
          if(signature!==undefined&&pattern!==signature)break;
          signature=pattern;body.push(line);
        }
        if(body.length>=2){
          const columns=header.map((head,index)=>{
            const cells=body.map(line=>line[index]),formats=[...new Set(cells.map(unit=>unit.numberFormat))];
            // Populated numeric samples (including zero) can still be inputs.
            // Existing text identifiers remain fixed hints until explicitly
            // requested and confirmed; neither hint grants write authority.
            const populated=cells.every(unit=>unit.kind!=='blank'),zeroSamples=cells.every(unit=>unit.kind==='value'&&unit.value===0);
            const role=cells.every(unit=>unit.kind==='formula')?'formula':populated&&!zeroSamples?'fixed':cells.every(unit=>unit.writable)?'input':'fixed';
            return{column:columnName(head.column),header:clip(head.value,60),role,...(formats.length===1&&formats[0]?{numberFormat:formats[0]}:{}),...(role==='formula'?{formula:clip(rowPattern(cells[0].formula,cells[0].row),200)}:{})};
          });
          tables.push({address:header[0].address+':'+cellName(body.at(-1)[0].row,header.at(-1).lastColumn),headerRow:row,firstRow:row+1,lastRow:row+body.length,columns});
          for(const unit of [...header,...body.flat()])used.add(unit);
        }
      }
      run=[];
    };
    for(const unit of list.filter(item=>item.row===row).sort((a,b)=>a.column-b.column)){
      const joins=run.length&&unit.column===run.at(-1).lastColumn+1;
      if(unit.kind==='text'&&unit.lastRow===row&&!used.has(unit)&&(joins||!run.length)){run.push(unit);continue;}
      close();
      if(unit.kind==='text'&&unit.lastRow===row&&!used.has(unit))run.push(unit);
    }
    close();
  }
  return{tables,used};
}

export function formMap(snapshot,{maxCharacters=12000}={}){
  const grid=units(snapshot),{outer,list,right,below}=grid,{tables,used}=findTables(grid),width=outer.cols;
  const free=list.filter(unit=>!used.has(unit)),texts=free.filter(unit=>unit.kind==='text'),target=new Map(),consumed=new Set();
  const wide=unit=>unit.lastColumn-unit.column+1>width/2&&width>=3;
  const first=texts[0],title=first&&wide(first)&&!free.some(unit=>unit!==first&&unit.row===first.row&&unit.kind!=='blank')?first:undefined;
  const fillable=unit=>unit&&!used.has(unit)&&!target.has(unit)&&(unit.kind==='formula'||unit.kind==='blank'&&unit.writable);
  const pair=(label,unit)=>{target.set(unit,label);consumed.add(label);};
  // 1. A label serves what is to its right: a blank input, a computed cell, or a value that ends the row of text.
  for(const label of texts){
    if(label===title)continue;
    const next=right(label);
    // A right-aligned result can be separated from its label by blank spacer
    // cells. Match the only nonblank remainder when it is a formula, rather
    // than inventing an input in the intervening gap. This remains a hint.
    if(next?.kind==='blank'){
      const rest=free.filter(u=>u.row===label.row&&u.column>label.lastColumn),filled=rest.filter(u=>u.kind!=='blank');
      if(filled.length===1&&filled[0].kind==='formula'&&fillable(filled[0])){pair(label,filled[0]);continue;}
    }
    if(fillable(next)){pair(label,next);continue;}
    if(!next||used.has(next)||target.has(next)||!next.writable||!['text','value'].includes(next.kind)||consumed.has(next))continue;
    const after=right(next),headerLike=fillable(below(label))&&fillable(below(next));
    // Text followed by more text or by a cell to fill is itself a label, not a sample.
    // Two labels over blank cells are column headings.
    if(headerLike||wide(label)||after&&!used.has(after)&&(after.kind!=='blank'||fillable(after)))continue;
    pair(label,next);consumed.add(next);
  }
  // 2. A label that serves nothing to its right names the cell below it.
  for(const label of texts){
    if(label===title||wide(label)||consumed.has(label))continue;
    const next=below(label);if(fillable(next)&&next.kind!=='formula'||next?.kind==='formula'&&fillable(next))pair(label,next);
  }
  const sections=texts.filter(unit=>unit!==title&&!consumed.has(unit)&&unit.lastRow>unit.row&&right(unit)?.kind==='text');
  const sectionOf=unit=>sections.find(section=>unit.row>=section.row&&unit.row<=section.lastRow&&unit.column>section.lastColumn);
  const describe=(unit,label)=>{const section=sectionOf(unit);return{address:unit.address,...(unit.span?{span:unit.span}:{}),...(unit.kind==='formula'?{formula:clip(unit.formula,200)}:{}),label:clip(label.value),labelAddress:label.address,
    ...(section?{section:clip(section.value,60)}:{}),...(unit.kind!=='formula'&&unit.numberFormat?{numberFormat:unit.numberFormat}:{}),...(unit.choices?{choices:unit.choices}:{}),...(unit.kind==='text'||unit.kind==='value'?{sample:typeof unit.value==='string'?clip(unit.value,60):unit.value}:{})};};
  const order=(a,b)=>a.row-b.row||a.column-b.column,paired=[...target].sort(([a],[b])=>order(a,b));
  const map={schemaVersion:1,worksheet:snapshot.worksheet,address:snapshot.address,writable:!(snapshot.readOnly||snapshot.protected),
    ...(title?{title:{address:title.address,...(title.span?{span:title.span}:{}),text:clip(title.value)}}:{}),
    sections:sections.map(unit=>({address:unit.address,span:unit.span,text:clip(unit.value,60)})),
    inputs:paired.filter(([unit])=>unit.kind!=='formula').map(([unit,label])=>describe(unit,label)),
    tables,
    formulas:paired.filter(([unit])=>unit.kind==='formula').map(([unit,label])=>describe(unit,label)),
    notes:texts.filter(unit=>unit!==title&&!consumed.has(unit)&&!sections.includes(unit)).map(unit=>({address:unit.address,...(unit.span?{span:unit.span}:{}),text:clip(unit.value)})),
    note:'Hints from cell positions only. Labels, types and required flags are proposals for the user to confirm.'};
  if(!map.sections.length)delete map.sections;
  // Keep the payload bounded: drop from the end and say how much is missing.
  const omitted={};
  for(const key of ['notes','formulas','inputs','tables']){
    while(JSON.stringify({...map,omitted}).length>maxCharacters-160&&map[key].length){map[key].pop();omitted[key]=(omitted[key]||0)+1;}
  }
  if(Object.keys(omitted).length){map.omitted=omitted;map.note='Cut to fit the context budget: the omitted counts say what is missing. Use inspect_template with an offset to read the remaining cells exactly. '+map.note;}
  return map;
}

// Input cells of the form map that the request names and a proposal leaves out. Only what the user spoke about is
// checked: which of the other cells are inputs is the proposal of the model and the confirmation of the user.
// A column of a table is reported once, by its header. Returns [{address,label}].
export function missingNamedInputs({snapshot,proposed,stated,limit=8}){
  let map;try{map=formMap(snapshot);}catch{return[];}
  const plain=text=>String(text??'').replace(/\s+/g,''),said=plain(stated),have=new Set((proposed||[]).map(field=>String(field.address).toUpperCase())),missing=[];
  // The positions of the form map are hints. A proposal that has a field of that name covers it, wherever its cell is.
  const names=new Set((proposed||[]).map(field=>plain(String(field.label??'').replace(/\([^)]*\)/g,'')).replace(/\d+$/,'')));
  const named=label=>{const name=plain(String(label).replace(/\([^)]*\)/g,''));return name.length>=2&&said.includes(name)&&!names.has(name);};
  for(const input of map.inputs||[])if(!have.has(input.address)&&named(input.label))missing.push({address:input.address,label:input.label});
  for(const table of map.tables||[])for(const column of table.columns||[]){
    if(column.role!=='input'||!named(column.header))continue;
    const cells=[];for(let row=table.firstRow;row<=table.lastRow;row++)cells.push(column.column+row);
    if(cells.every(cell=>!have.has(cell)))missing.push({address:`${cells[0]}:${cells.at(-1)}`,label:column.header});
  }
  return missing.slice(0,limit);
}

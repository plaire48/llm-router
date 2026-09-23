import {tokenize} from 'excel-formula-tokenizer';

export const DOCUMENT_FUNCTIONS='SUM SUMIF SUMIFS COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS AVERAGE AVERAGEIF AVERAGEIFS MIN MAX IF IFERROR IFNA AND OR NOT ROUND ROUNDUP ROUNDDOWN ABS INT MOD DATE YEAR MONTH DAY TODAY CONCATENATE LEFT RIGHT MID LEN TRIM VLOOKUP HLOOKUP INDEX MATCH SUBTOTAL SUMPRODUCT RANK RANK.EQ RANK.AVG'.split(' ');
const allowed=new Set(DOCUMENT_FUNCTIONS);
const blocked=new Set('WEBSERVICE HYPERLINK RTD DDE CALL REGISTER XLOOKUP XMATCH FILTER UNIQUE LET LAMBDA SEQUENCE SORT SORTBY TAKE DROP VSTACK HSTACK TEXTSPLIT INDIRECT OFFSET'.split(' '));
const hints={XLOOKUP:'Use INDEX/MATCH or VLOOKUP with the intended exact/approximate match rule.',XMATCH:'Use MATCH with an explicit match type.',FILTER:'Use Excel 2016 formulas and explicit output cells; dynamic spill formulas are unavailable.',LET:'Use named intermediate cells within the authorized layout.',INDIRECT:'Use explicit observed sheet and cell references.',OFFSET:'Use explicit ranges or INDEX; dynamic references cannot be statically checked.'};
const fail=(code,issue)=>{throw Object.assign(new Error(code),{issue});};
const col=s=>[...s.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
function reference(value,worksheet,sheets,strict){
  if(/[\[\]|#]/.test(value))fail('unsupported_formula','External, structured or spill references are outside the supported formula preflight. Use explicit in-workbook cells.');
  const bang=value.lastIndexOf('!');let name=worksheet,range=value;
  if(bang>=0){name=value.slice(0,bang);range=value.slice(bang+1);if(name.startsWith("'")&&name.endsWith("'"))name=name.slice(1,-1);if(name.includes(':'))fail('unsupported_formula','Replace 3D sheet references with explicit references to each required sheet.');}
  if(sheets&&name&&!sheets.some(s=>s.toLowerCase()===name.toLowerCase()))fail('document_reference_invalid','A referenced worksheet is not in the current workbook plan. Use an exact existing sheet name.');
  let m=/^\$?([A-Z]{1,3})\$?([1-9]\d*)(?::\$?([A-Z]{1,3})\$?([1-9]\d*))?$/i.exec(range),r,c,er,ec;
  if(m){r=+m[2];c=col(m[1]);er=+(m[4]||m[2]);ec=col(m[3]||m[1]);}
  else if((m=/^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/i.exec(range))){r=1;er=1048576;c=col(m[1]);ec=col(m[2]);}
  else if((m=/^\$?([1-9]\d*):\$?([1-9]\d*)$/.exec(range))){r=+m[1];er=+m[2];c=1;ec=16384;}
  else {if(strict)fail('document_reference_invalid','Use explicit A1 cell references; this new document has no defined names.');return{sheet:name,unresolved:range};}
  if(Math.max(r,er)>1048576||Math.max(c,ec)>16384)fail('document_reference_invalid','A referenced cell exceeds the Excel worksheet row or column limit.');
  return{sheet:name,range,r:Math.min(r,er),c:Math.min(c,ec),er:Math.max(r,er),ec:Math.max(c,ec)};
}
function lexicalInput(formula){
  if(typeof formula!=='string'||!formula.startsWith('=')||formula.length>2000||/[\x00-\x1f]/.test(formula))fail('unsupported_formula','Provide one Excel formula beginning with = and at most 2000 characters.');
  let quote='',text='';for(let i=0;i<formula.length;i++){
    const c=formula[i];text+=!quote&&c==='e'&&/\d/.test(formula[i-1]||'')&&/[+\-\d]/.test(formula[i+1]||'')?'E':c;
    if(quote){if(c===quote){if(formula[i+1]===quote){text+=formula[++i];}else quote='';}}
    else if(c==='"'||c==="'")quote=c;
  }
  if(quote)fail('formula_syntax_invalid','Close the quoted text or worksheet name.');return text;
}

// This checks a supported subset, not all Excel grammar or business correctness.
// The third-party tokenizer separates strings from calls/references; no eval.
export function inspectFormula(formula,{sheets,worksheet='',strict=false}={}){
  let tokens;try{tokens=tokenize(lexicalInput(formula));}catch(error){if(error.issue)throw error;fail('formula_syntax_invalid','Check balanced parentheses, separators and quoted text.');}
  const stack=[],references=[],functions=new Set();let expect=true,previous;
  for(const t of tokens){
    if(t.type==='white-space')continue;
    if(['function','subexpression'].includes(t.type)&&t.subtype==='start'){
      if(!expect)fail('formula_syntax_invalid','An operator is missing before a function or parenthesis.');
      const fn=t.type==='function'?t.value.toUpperCase():'';
      if(fn&&(blocked.has(fn)||fn.startsWith('_XLFN.')||strict&&!allowed.has(fn)))fail('unsupported_formula',hints[fn]||'This function is outside the supported Excel 2016 authoring subset. Use a documented supported function; do not replace a requested calculation with a constant.');
      if(fn)functions.add(fn);stack.push({type:t.type,fn,commas:0});expect=true;
    }else if(['function','subexpression'].includes(t.type)&&t.subtype==='stop'){
      const entry=stack.pop();if(!entry||entry.type!==t.type||expect&&previous?.type?.startsWith('operator'))fail('formula_syntax_invalid','Close every expression after its final operand.');
      if(entry.type==='subexpression'&&expect)fail('formula_syntax_invalid','Empty parentheses are not an expression.');
      const count=entry.commas+(previous?.subtype==='start'?0:1);
      const arity={IF:[2,3],IFERROR:[2,2],IFNA:[2,2],TODAY:[0,0],ROUND:[2,2],ROUNDUP:[2,2],ROUNDDOWN:[2,2],DATE:[3,3],MATCH:[2,3],VLOOKUP:[3,4],HLOOKUP:[3,4],RANK:[2,3],'RANK.EQ':[2,3],'RANK.AVG':[2,3]}[entry.fn];
      if(arity&&(count<arity[0]||count>arity[1]))fail('formula_syntax_invalid',`${entry.fn} requires ${arity[0]}${arity[0]===arity[1]?'':' to '+arity[1]} arguments.`);expect=false;
    }else if(t.type==='operand'){
      if(!expect)fail('formula_syntax_invalid','An operator is missing between operands.');
      if(t.subtype==='error')fail('document_reference_invalid','Do not author a formula containing an Excel error literal such as #REF!. Repair its references.');
      if(t.subtype==='range')references.push(reference(t.value,worksheet,sheets,strict));expect=false;
    }else if(t.type==='argument'){
      if(stack.at(-1)?.type!=='function'||previous?.type?.startsWith('operator'))fail('formula_syntax_invalid','A comma must separate complete function arguments.');stack.at(-1).commas++;expect=true;
    }else if(t.type==='operator-prefix'){if(!expect)fail('formula_syntax_invalid','Unexpected prefix operator.');}
    else if(t.type==='operator-infix'){if(expect)fail('formula_syntax_invalid','A binary operator needs a left operand.');expect=true;}
    else if(t.type==='operator-postfix'){if(expect)fail('formula_syntax_invalid','A postfix operator needs a value.');}
    else fail('formula_syntax_invalid','Unsupported or incomplete formula token. Check the Excel 2016 syntax.');
    previous=t;
  }
  if(expect||stack.length)fail('formula_syntax_invalid','The formula is incomplete. Add the missing operand or closing parenthesis.');
  return{functions:[...functions],references};
}

export function documentFormulaAudit(specs){
  const names=specs.map(s=>s.name),nodes=[],issues=[];let comparisons=0;
  for(const s of specs)for(const cell of s.cells)if(cell.formula){
    try{const pos=reference(cell.address,s.name,names,true);nodes.push({...pos,address:cell.address,formula:cell.formula,...inspectFormula(cell.formula,{sheets:names,worksheet:s.name,strict:true})});}
    catch(e){issues.push({sheet:s.name,address:cell.address,code:e.message,issue:e.issue});}
  }
  const dependencies=nodes.map(()=>new Set()),dependents=nodes.map(()=>[]),bySheet=new Map(),byCell=new Map();
  nodes.forEach((n,i)=>{const name=n.sheet.toLowerCase();if(!bySheet.has(name))bySheet.set(name,[]);bySheet.get(name).push(i);byCell.set(`${name}:${n.r}:${n.c}`,i);});
  for(let i=0;i<nodes.length;i++)for(const ref of nodes[i].references){
    const name=ref.sheet.toLowerCase(),point=ref.r===ref.er&&ref.c===ref.ec;
    const exact=byCell.get(`${name}:${ref.r}:${ref.c}`),candidates=point?(exact===undefined?[]:[exact]):bySheet.get(name)||[];
    for(const j of candidates){
      if(++comparisons>1000000)return{verified:false,formulaCount:nodes.length,issues:[{sheet:nodes[i].sheet,address:nodes[i].address,code:'formula_dependency_limit',issue:'The formula graph is too dense for the bounded preflight; simplify repeated references or split this document.'}]};
      const candidate=nodes[j];if(candidate.r>=ref.r&&candidate.r<=ref.er&&candidate.c>=ref.c&&candidate.c<=ref.ec)dependencies[i].add(j);
    }
  }
  dependencies.forEach((ds,i)=>ds.forEach(j=>dependents[j].push(i)));
  const counts=dependencies.map(d=>d.size),queue=counts.flatMap((n,i)=>n===0?[i]:[]);
  for(let cursor=0;cursor<queue.length;cursor++)for(const i of dependents[queue[cursor]])if(--counts[i]===0)queue.push(i);
  // Residual nodes include consumers of a cycle. Repair only actual strongly
  // connected components, so correct downstream sheets are not rewritten.
  const seen=new Set(),order=[];
  for(let root=0;root<nodes.length;root++)if(counts[root]>0&&!seen.has(root)){
    const stack=[[root,false]];
    while(stack.length){const [i,done]=stack.pop();if(done){order.push(i);continue;}if(seen.has(i))continue;seen.add(i);stack.push([i,true]);for(const j of dependencies[i])if(counts[j]>0&&!seen.has(j))stack.push([j,false]);}
  }
  const assigned=new Set();let cyclicCount=0;
  for(const root of order.reverse())if(!assigned.has(root)){
    const members=[],stack=[root];assigned.add(root);
    while(stack.length){const i=stack.pop();members.push(i);for(const j of dependents[i])if(counts[j]>0&&!assigned.has(j)){assigned.add(j);stack.push(j);}}
    if(members.length>1||dependencies[root].has(root))for(const i of members){cyclicCount++;issues.push({sheet:nodes[i].sheet,address:nodes[i].address,code:'circular_formula',issue:'This formula is part of a reference cycle. Repair the cycle; iterative calculations are not enabled for generated documents.'});}
  }
  return{verified:!issues.length,formulaCount:nodes.length,cyclicCount,affectedFormulaCount:counts.filter(n=>n>0).length,issues};
}

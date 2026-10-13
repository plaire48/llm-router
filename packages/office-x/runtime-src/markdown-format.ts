// Markdown is a reading format. Keep addresses/formulas/slide identity in the
// export itself; never ask a model to reconstruct or summarize source text.
export type MarkdownCell={address:string;value:unknown;display?:string;formula?:string;numberFormat?:string};
export type MarkdownSource={kind:'excel'|'word'|'powerpoint'|'pdf'|'text';name:string;sheets?:{name:string;cells:MarkdownCell[];merges?:string[]}[];slides?:{slide:number;id?:number;blocks:any[];notes?:string[]}[];blocks?:any[];notes?:{label:string;text:string}[];warnings:string[]};
export const escapeText=(value:unknown)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_{}\[\]#+!|])/g,'\\$1');
const cellText=(v:unknown)=>escapeText(v).replace(/\r\n?|\n/g,'<br>');
const code=(s:string)=>{const delimiter='`'.repeat(Math.max(1,...Array.from(s.matchAll(/`+/g),m=>m[0].length+1)));return delimiter+' '+s.replace(/\r\n?|\n/g,' ')+' '+delimiter;};
export function markdownTable(rows:unknown[][],header=true):string{
 if(!rows.length)return '';
 const width=Math.max(...rows.map(r=>r.length));if(width>200)throw Error('markdown_table_limit');
 const row=(r:unknown[])=>'| '+Array.from({length:width},(_,i)=>cellText(r[i])).join(' | ')+' |';
 const labels=header?rows[0]:Array.from({length:width},(_,i)=>'열 '+(i+1));
 return [row(labels),row(Array(width).fill('---')), ...(header?rows.slice(1):rows).map(row)].join('\n');
}
const address=(a:string)=>{const m=/^([A-Z]+)([1-9]\d*)$/.exec(a);if(!m)throw Error('markdown_address_invalid');let column=0;for(const c of m[1])column=column*26+c.charCodeAt(0)-64;return {row:Number(m[2]),column};};
const columnName=(n:number)=>{let s='';while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);}return s;};
const rawValue=(v:unknown)=>v==null?'':typeof v==='object'?JSON.stringify(v):String(v);
const valueOf=(c:MarkdownCell)=>c.display??rawValue(c.value);
function sheetMarkdown(sheet:NonNullable<MarkdownSource['sheets']>[number]):string{
 const lines=['## '+escapeText(sheet.name)],cells=sheet.cells.filter(c=>valueOf(c)!==''||c.formula);
 if(!cells.length)return lines.join('\n')+'\n\n(빈 시트)';
 const coords=cells.map(c=>({...address(c.address),cell:c})),rows=[...new Set(coords.map(c=>c.row))].sort((a,b)=>a-b),cols=[...new Set(coords.map(c=>c.column))].sort((a,b)=>a-b);
 // Sparse or wide worksheets become an address/value table, never a huge
 // mostly-empty grid, never silently omit distant cells.
 if(cols.length>24||rows.length*cols.length>20000){lines.push(markdownTable([['셀','값'],...coords.sort((a,b)=>a.row-b.row||a.column-b.column).map(c=>[c.cell.address,valueOf(c.cell)])]));}
 else{const map=new Map(cells.map(c=>[c.address,c]));lines.push(markdownTable([['행',...cols.map(columnName)],...rows.map(r=>[String(r),...cols.map(c=>valueOf(map.get(columnName(c)+r)||{address:'',value:null}))])]));}
 const formulas=cells.filter(c=>c.formula);if(formulas.length)lines.push('### 수식\n\n'+markdownTable([['셀','수식','현재 값'],...formulas.map(c=>[c.address,c.formula,valueOf(c)])]));
 const formatted=cells.filter(c=>c.display!==undefined&&c.display!==rawValue(c.value));if(formatted.length)lines.push('### 원래 값과 표시 형식\n\n'+markdownTable([['셀','표시 값','원래 값','서식'],...formatted.map(c=>[c.address,c.display,rawValue(c.value),c.numberFormat||''])]));
 if(sheet.merges?.length)lines.push('### 병합 범위\n\n'+sheet.merges.map(m=>'- '+code(m)).join('\n'));
 return lines.join('\n\n');
}
export function renderBlocks(blocks:any[]):string{
 const lines:string[]=[];
 for(const b of blocks){if(b.hidden)continue;
  if(b.type==='table'){lines.push(markdownTable(b.rows||[],b.header===true));if(b.mergeNote)lines.push(escapeText(b.mergeNote));for(const nested of b.nested||[])lines.push(renderBlocks([nested]));continue;}
  const text=b.text??(b.runs||[]).map((r:any)=>r.text||'').join('');
  if(!text)continue;
  const escaped=(b.runs?.length?b.runs.map((r:any)=>{let t=escapeText(r.text||'');if(r.bold&&t.trim())t='**'+t+'**';if(r.italic&&t.trim())t='*'+t+'*';if(r.link?.href&&/^(https?:|mailto:|#)/i.test(r.link.href))t='['+t+']('+r.link.href.replace(/[\s()<>]/g,(c:string)=>encodeURIComponent(c))+')';return t;}).join(''):escapeText(text)).replace(/\r\n?|\n/g,'  \n');
  if(b.type==='heading')lines.push('#'.repeat(Math.max(1,Math.min(6,b.level||1)))+' '+escaped);
  else if(b.type==='listItem')lines.push('  '.repeat(Math.min(8,b.list?.ilvl||0))+(b.list?.kind==='ordered'?'1. ':'- ')+escaped);
  else lines.push(escaped);
 }
 return lines.join('\n\n');
}
export function sourceEvidence(source:MarkdownSource):string[]{
 const blocks=(bs:any[]):string[]=>bs.flatMap(b=>b.hidden?[]:b.type==='table'?(b.rows||[]).flat().map(String).concat((b.nested||[]).flatMap((n:any)=>blocks([n]))):[b.text??(b.runs||[]).map((r:any)=>r.text||'').join('')]);
 return [...(source.sheets||[]).flatMap(s=>[s.name,...s.cells.flatMap(c=>[valueOf(c),rawValue(c.value),c.formula||''])]),...(source.slides||[]).flatMap(s=>[...blocks(s.blocks),...(s.notes||[])]),...blocks(source.blocks||[]),...(source.notes||[]).map(n=>n.text)].filter(Boolean);
}
const normal=(s:string)=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<br\s*\/?\s*>/g,' ').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
export function auditMarkdown(markdown:string,evidence:string[]){
 const text=normal(markdown),missing=evidence.filter(s=>{const n=normal(s);return n&&!text.includes(n);});
 return {sourceUnits:evidence.length,verifiedUnits:evidence.length-missing.length,missingUnits:missing.length,empty:!text,complete:missing.length===0&&!!text};
}
export function renderSource(source:MarkdownSource):string{
 const lines=['# '+escapeText(source.name)];
 if(source.kind==='excel')lines.push(...(source.sheets||[]).map(sheetMarkdown));
 else if(source.kind==='powerpoint')for(const s of source.slides||[]){lines.push('## 슬라이드 '+s.slide,renderBlocks(s.blocks));if(s.notes?.some(Boolean))lines.push('### 발표자 노트\n\n'+s.notes.map(escapeText).join('\n\n'));}
 else lines.push(renderBlocks(source.blocks||[]));
 for(const n of source.notes||[])lines.push('## '+escapeText(n.label)+'\n\n'+escapeText(n.text));
 if(source.warnings.length)lines.push('## 변환 안내\n\n'+[...new Set(source.warnings)].map(w=>'- '+escapeText(w)).join('\n'));
 return lines.filter(Boolean).join('\n\n').trim()+'\n';
}

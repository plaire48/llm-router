import {readFileSync} from 'node:fs';
import {extname,posix} from 'node:path';
import {parseDocx} from '@genoffice/docx-engine';
import {openPptx,getSlideNotes} from '@genoffice/pptx-engine';
import {readBasicWorkbook} from '@genoffice/xlsx-gateway/gateway/xlsx-gateway';
import {formatCategoryLabel} from '@genoffice/xlsx-gateway/domain/chart-visual';
import {xlsxToText} from '../vendor/genoffice/packages/file-parse/src/xlsx';
import {docxToText} from '../vendor/genoffice/packages/file-parse/src/docx';
import {pptxToText} from '../vendor/genoffice/packages/file-parse/src/pptx';
import {builtinDateFormat,classifyFormatCode,formatSerial} from '../vendor/genoffice/packages/file-parse/src/xlsx-dates';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {type MarkdownSource} from './markdown-format';
const texts=(xml:string,ns:string,tag:string)=>{if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('markdown_source_invalid');const doc=new DOMParser({onError:()=>{throw Error('markdown_source_invalid');}}).parseFromString(xml,'application/xml');return Array.from(doc.getElementsByTagNameNS(ns,tag)).map(n=>n.textContent||'');};
const table=(model:any):any=>({type:'table',rows:(model.rows||[]).map((r:any[])=>r.flatMap(c=>[c.vMerge==='continue'?'':(c.paras||[]).join('\n'),...Array(Math.max(0,(c.colSpan||1)-1)).fill('')])),header:false,nested:(model.rows||[]).flatMap((r:any[])=>r.flatMap(c=>(c.nestedTables||[]).map(table))),...((model.rows||[]).some((r:any[])=>r.some(c=>c.colSpan>1||c.vMerge))?{mergeNote:'병합 셀은 첫 셀에 내용을 두고 이어지는 셀을 비워 보존했습니다.'}:{})});
export async function wordSource(bytes:Uint8Array,name:string):Promise<{source:MarkdownSource;baseline:string}>{
 const parsed=await parseDocx(bytes),zip=await JSZip.loadAsync(bytes),warnings:string[]=[],blocks:any[]=[];
 for(const b of parsed.blocks){if(b.hidden)continue;if(b.type==='table'&&b.table){blocks.push(table(b.table));continue;}
  if(b.runs?.length)blocks.push({type:b.type,level:b.level,list:b.list,runs:b.runs.map(r=>({text:r.text,bold:r.bold,italic:r.italic,link:r.link}))});
  else if(b.previewText)blocks.push({type:'paragraph',text:b.previewText});
  for(const box of b.textboxes||[])for(const p of box.paras)blocks.push({type:'paragraph',runs:p.runs});
  if(b.type==='image')warnings.push('이미지의 시각 내용은 포함하지 않았습니다.');
 }
 const notes=[...parsed.footnotes.map(n=>({label:'각주 '+n.id,text:n.text})),...parsed.endnotes.map(n=>({label:'미주 '+n.id,text:n.text})),...parsed.comments.map(n=>({label:'주석 '+n.id,text:n.text}))];
 for(const path of Object.keys(zip.files).filter(p=>/^word\/(header|footer)[^/]*\.xml$/.test(p)).sort()){const xml=await zip.file(path)!.async('string'),text=texts(xml,'http://schemas.openxmlformats.org/wordprocessingml/2006/main','t').join(' ');if(text)notes.push({label:path.includes('header')?'머리글':'바닥글',text});}
 return {source:{kind:'word',name,blocks,notes,warnings},baseline:await docxToText(bytes)};
}
export async function genofficeSource(path:string,name:string):Promise<{source:MarkdownSource;baseline:string}>{
 const bytes=readFileSync(path),extension=extname(path).toLowerCase();
 if(extension==='.docx'||extension==='.docm')return wordSource(bytes,name);
 if(extension==='.xlsx'||extension==='.xlsm'){
  const read=await readBasicWorkbook(bytes),zip=await JSZip.loadAsync(bytes),warnings:string[]=[];
  const wb=await zip.file('xl/workbook.xml')!.async('string');const declared=texts(wb,'http://schemas.openxmlformats.org/spreadsheetml/2006/main','sheet').length;if(declared!==read.snapshot.sheets.length)throw Error('markdown_source_incomplete');
  // The original parser validates relationships/shared formulas/zip limits.
  // Formulas and distant sparse cells are exported from its full snapshot.
  const sheets=read.snapshot.sheets.map(s=>({name:s.name,cells:Object.entries(s.cells).map(([address,c])=>({address,value:c.value,formula:c.formula})),merges:s.merges?[...s.merges]:[]}));
  // Basic snapshots omit merged ranges. Resolve their real workbook paths
  // instead of assuming sheetN.xml follows display order.
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',wbDom=new DOMParser().parseFromString(wb,'application/xml'),rels=new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'),'application/xml');
  const wbSheets=Array.from(wbDom.getElementsByTagNameNS(ns,'sheet')),relationships=Array.from(rels.getElementsByTagName('Relationship'));
  const stylesXml=await zip.file('xl/styles.xml')?.async('string'),styleDoc=stylesXml?new DOMParser().parseFromString(stylesXml,'application/xml'):undefined,custom=new Map(Array.from(styleDoc?.getElementsByTagNameNS(ns,'numFmt')||[]).map(n=>[Number(n.getAttribute('numFmtId')),n.getAttribute('formatCode')||'']));
  const xfs=Array.from(styleDoc?.getElementsByTagNameNS(ns,'cellXfs')[0]?.getElementsByTagNameNS(ns,'xf')||[]),date1904=['1','true'].includes(wbDom.getElementsByTagNameNS(ns,'workbookPr')[0]?.getAttribute('date1904')||'');
  for(const s of sheets){const id=wbSheets.find(n=>n.getAttribute('name')===s.name)?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),rel=relationships.find(n=>n.getAttribute('Id')===id),target=rel?.getAttribute('Target');if(!target||rel?.getAttribute('TargetMode')==='External')throw Error('markdown_source_incomplete');
   const part=posix.normalize(target.startsWith('/')?target.slice(1):posix.join('xl',target));if(!part.startsWith('xl/')||!zip.file(part))throw Error('markdown_source_incomplete');const xml=await zip.file(part)!.async('string'),doc=new DOMParser().parseFromString(xml,'application/xml');s.merges=Array.from(doc.getElementsByTagNameNS(ns,'mergeCell')).map(n=>n.getAttribute('ref')||'').filter(Boolean);
   const byAddress=new Map(s.cells.map(c=>[c.address,c]));for(const node of Array.from(doc.getElementsByTagNameNS(ns,'c'))){const cell=byAddress.get(node.getAttribute('r')||'');if(!cell||typeof cell.value!=='number')continue;const xf=xfs[Number(node.getAttribute('s')||0)],numFmt=Number(xf?.getAttribute('numFmtId')||0),parts=custom.has(numFmt)?classifyFormatCode(custom.get(numFmt)!):builtinDateFormat(numFmt);const formats:Record<number,string>={0:'General',1:'0',2:'0.00',3:'#,##0',4:'#,##0.00',9:'0%',10:'0.00%',11:'0.00E+00',49:'@'};const format=custom.get(numFmt)||formats[numFmt];(cell as any).numberFormat=format||'';if(parts){const display=formatSerial(cell.value,parts,date1904);if(display!==null)(cell as any).display=display;}else if(format)(cell as any).display=formatCategoryLabel(String(cell.value),format);}
  }
  if(sheets.reduce((n,s)=>n+s.cells.length,0)>200000)throw Error('markdown_source_limit');
  return {source:{kind:'excel',name,sheets,warnings},baseline:await xlsxToText(bytes)};
 }
 if(extension==='.pptx'||extension==='.pptm'){
  const opened=await openPptx(bytes),warnings:string[]=[],paragraphs=(ps:any[])=>ps.map(p=>(p.runs||[]).map((r:any)=>r.text||'').join('')).join('\n');
  const elements=(es:any[]):any[]=>es.flatMap(e=>e.type==='group'?elements(e.children||e.elements||[]):e.type==='table'?[{type:'table',header:false,rows:e.rows.map((r:any[])=>r.map(c=>c.merged?'':paragraphs(c.text?.paragraphs||[])))}]:e.text?.paragraphs?[{type:'paragraph',text:paragraphs(e.text.paragraphs)}]:e.paragraphs?[{type:'paragraph',text:paragraphs(e.paragraphs)}]:[]);
  const slides=opened.deck.slides.map((s,i)=>({slide:i+1,blocks:elements(s.elements),notes:[getSlideNotes(opened.archive,s.path)]}));
  if(!slides.length)throw Error('markdown_source_empty');return {source:{kind:'powerpoint',name,slides,warnings},baseline:await pptxToText(bytes)};
 }
 throw Error('markdown_genoffice_format');
}

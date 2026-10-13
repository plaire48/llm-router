// The original editors run in a separate process: their DOM cannot change the Office agent runtime.
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {openDocument,closeDocument,saveDocument,applyDocOps,describeDocument,docsCatalog,listStyles,listComments,listNotes,listRevisions,headerFooterState,listFields} from '../vendor/genoffice/packages/cli/src/formats/docx';
import {readBasicWorkbook} from '@genoffice/xlsx-gateway/gateway/xlsx-gateway';
import {runWorkbookDsl,SUPPORTED_DSL_OPS} from '../vendor/genoffice/packages/cli/src/formats/xlsx-dsl';
import {writeWorkbook} from '../vendor/genoffice/packages/cli/src/formats/xlsx';
import {assertAllowed} from '../vendor/genoffice/packages/cli/src/fs';
import {sheetCatalog} from '../vendor/genoffice/packages/cli/src/formats/xlsx-catalog';
import {parseRange,parseAddress} from '@genoffice/xlsx-gateway/domain/cell-address';
import JSZip from 'jszip';

async function run(input:any){
 const ctx={cwd:process.cwd(),env:process.env};
 if(input.action==='catalog')return input.domain==='word'?await docsCatalog():sheetCatalog();
 const path=assertAllowed(resolve(input.path),ctx.env,'read'),bytes=readFileSync(path);
 if(input.domain==='word'){
  const doc=await openDocument(bytes);
  try{
   const read=()=>({blocks:describeDocument(doc,input.range||[0,29],Math.min(4000,input.maxChars||500)),styles:listStyles(doc).slice(0,100),comments:listComments(doc).slice(0,100),notes:listNotes(doc).slice(0,100),revisions:listRevisions(doc).slice(0,100),headerFooter:headerFooterState(doc),fields:listFields(doc).slice(0,100)});
   if(input.action==='read')return read();
   if(input.action!=='apply'||!Array.isArray(input.ops))throw Error('engine_input_invalid');
   const result=await applyDocOps(doc,input.ops,{ctx,baseDir:dirname(path),mode:'atomic',trackAuthor:input.trackAuthor});
   const output=assertAllowed(resolve(input.output),ctx.env,'write');writeFileSync(output,await saveDocument(doc),{mode:0o600});
   return {result,readback:read(),output};
  }finally{closeDocument(doc);}
 }
 if(input.domain!=='excel')throw Error('engine_domain_invalid');
 if(input.action==='read'){
  const imported=await readBasicWorkbook(bytes),zip=await JSZip.loadAsync(bytes);
  // File observations include formats/features without depending on the optional Rust sidecar.
  const sheets=imported.snapshot.sheets.map((s:any)=>({id:s.id,name:s.name,cells:Object.keys(s.cells||{}).length}));
  const sheet=imported.snapshot.sheets.find(s=>s.name===input.sheet||s.id===input.sheet)||(!input.sheet?imported.snapshot.sheets[0]:undefined);if(!sheet)throw Error('sheet_not_found');
  const range=parseRange(input.range||'A1:T100');if((range.endRow-range.startRow+1)*(range.endColumn-range.startColumn+1)>2000)throw Error('read_range_limit');
  const cells=Object.fromEntries(Object.entries(sheet.cells).filter(([a])=>{const c=parseAddress(a);return c.row>=range.startRow&&c.row<=range.endRow&&c.column>=range.startColumn&&c.column<=range.endColumn;}));
  return {sheets,sheetNamesById:imported.sheetNamesById,sheet:sheet.name,range:input.range||'A1:T100',cells,parts:Object.keys(zip.files).filter(p=>!zip.files[p].dir&&/tables|pivotTables|charts|drawings|comments|styles|workbook\.xml/.test(p))};
 }
 if(input.action!=='apply'||!Array.isArray(input.ops))throw Error('engine_input_invalid');
 const plan=await runWorkbookDsl(bytes,input.ops,input.sheet,ctx,{sourcePath:path});
 const output=assertAllowed(resolve(input.output),ctx.env,'write');
 const result=await writeWorkbook(bytes,plan.edits,output,{plan:plan.sheetPlan,structuralOps:plan.structuralOps,renames:plan.renames,gateway:plan.gateway});
 const check=await readBasicWorkbook(readFileSync(output));
 return {result,plan:plan.plan,warnings:plan.warnings,sheets:check.snapshot.sheets.map(s=>({id:s.id,name:s.name})),output};
}

let json='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{json+=chunk;if(json.length>2*1024*1024)process.exit(2);});
process.stdin.on('end',async()=>{try{const result=await run(JSON.parse(json));process.stdout.write('\nNUBI_ENGINE_RESULT:'+JSON.stringify({ok:true,result})+'\n');}catch(e:any){process.stdout.write('\nNUBI_ENGINE_RESULT:'+JSON.stringify({ok:false,error:e.message,detail:e.detail})+'\n');process.exitCode=1;}});

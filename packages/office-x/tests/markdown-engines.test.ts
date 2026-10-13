import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {Artifacts} from '../runtime-src/services';
import {markdownSkill} from '../runtime-src/markdown-skill';
import {runDocumentPython} from '../runtime-src/document-python';
const enabled=!!process.env.NUBI_DOCUMENT_PYTHON;
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
it.skipIf(!enabled)('converts actual Office/HTML/PDF files with real GenOffice, MarkItDown and Docling engines',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nubi-real-markdown-')),rows:any[]=[];try{
  execFileSync(process.env.NUBI_DOCUMENT_PYTHON!,['tests/fixtures/markdown-documents.py',root]);
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(const line of ['Nubi source fidelity check','Second page is preserved']){const page=pdf.addPage();page.drawText(line,{x:50,y:700,font,size:18});page.drawText('Revenue: 1200',{x:50,y:650,font,size:14});}writeFileSync(join(root,'digital.pdf'),await pdf.save());
  const artifacts=new Artifacts(root),native=async(name:string,input:any)=>{if(name!=='save_markdown')throw Error('unexpected native '+name);const output=join(root,'saved-'+rows.length+'.md');writeFileSync(output,readFileSync(input.path));return {kind:name,status:'verified',saved:true,destination:input.destination,sha256:sha(readFileSync(output))};};
  const skill=markdownSkill({native,context:{app:'excel'},artifacts,event(){}});
  for(const [file,expected] of [['report.docx',['누비 매출 보고서','원문 보존','서울','1200','머리글 보존']],['book.xlsx',['매출','날짜','2026-10-14','SUM(B2:B3)','먼 셀 값','A7:C7']],['deck.pptx',['누비 발표','첫 번째 본문','발표자 노트 보존','1200']],['content.html',['누비 HTML','원문 보존','1200']],['digital.pdf',['Nubi source fidelity check','Second page is preserved','1200']]] as [string,string[]][]){
   const before=readFileSync(join(root,file)),a=artifacts.register(join(root,file),file);
   const r=await skill.executeTool({id:file,name:'export_markdown',input:{artifactId:a.id,destination:'C:\\Exports\\'+file+'.md'}});expect(r.isError,r.output).not.toBe(true);const d=JSON.parse(r.output),md=readFileSync(artifacts.get(d.artifactId).path,'utf8');
   for(const text of expected)expect(md.replace(/\\([*_()[\]#|])/g,'$1'),file).toContain(text);
   expect(d.saved).toBe(true);expect(d.quality.missingUnits).toBe(0);expect(readFileSync(join(root,file))).toEqual(before);rows.push({file,status:d.status,engines:d.engines,quality:d.quality,warnings:d.warnings,counts:d.counts,sourceSha256:sha(before),markdownSha256:d.sha256});
  }
  // Explicit Docling Office route must also preserve native GenOffice-only
  // header/formula/notes evidence, not discard it for a prettier conversion.
  const word=artifacts.register(join(root,'report.docx'),'report.docx');const d=await skill.executeTool({id:'docling-word',name:'export_markdown',input:{artifactId:word.id,engine:'docling',save:false}});expect(d.isError,d.output).not.toBe(true);rows.push({file:'report.docx',route:'docling',result:JSON.parse(d.output).quality});
  if(process.env.NUBI_DOCUMENT_TEST_OCR==='1'){
   const scan=artifacts.register(join(root,'scanned.pdf'),'scanned.pdf');const r=await skill.executeTool({id:'scan',name:'export_markdown',input:{artifactId:scan.id,destination:'C:\\Exports\\스캔.md'}});expect(r.isError,r.output).not.toBe(true);const d=JSON.parse(r.output),md=readFileSync(artifacts.get(d.artifactId).path,'utf8');expect(d.engines).toContain('docling');expect(md).toContain('1200');expect(md).toMatch(/누비\s*문서\s*읽기/);expect(md).toContain('MARKDOWN');expect(d.saved).toBe(true);rows.push({file:'scanned.pdf',status:d.status,engines:d.engines,quality:d.quality,warnings:d.warnings,counts:d.counts,markdownSha256:d.sha256});
  }
  await expect(runDocumentPython('markitdown',join(root,'..','private.docx'),root)).rejects.toThrow();
  mkdirSync('verification',{recursive:true});writeFileSync('verification/markdown-engines.json',JSON.stringify({platform:process.platform,actualOffice:false,actualConverters:true,ocr:process.env.NUBI_DOCUMENT_TEST_OCR==='1',rows},null,2)+'\n');
 }finally{rmSync(root,{recursive:true,force:true});}
},1200000);

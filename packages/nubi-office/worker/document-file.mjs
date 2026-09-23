import ExcelJS from 'exceljs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {region} from './office-range.mjs';
import {normalizeTypedValue} from './cell-format.mjs';
export const draftDirectory=()=>join(process.env.LOCALAPPDATA||tmpdir(),'NubiOffice','Drafts');
export function applyStyle(cell,style){
  const font={...cell.font},alignment={...cell.alignment};
  for(const [key,value]of Object.entries(style)){
    if(['bold','italic'].includes(key))font[key]=value;
    else if(key==='fontName')font.name=value;
    else if(key==='fontSize')font.size=value;
    else if(key==='fontColor')font.color={argb:'FF'+value.slice(1)};
    else if(key==='fillColor')cell.fill=value===null?{type:'pattern',pattern:'none'}:{type:'pattern',pattern:'solid',fgColor:{argb:'FF'+value.slice(1)}};
    else if(key==='numberFormat')cell.numFmt=value;
    else if(key==='wrapText')alignment.wrapText=value;
    else if(key==='horizontalAlignment'){if(value==='general')delete alignment.horizontal;else alignment.horizontal=value==='centerAcrossSelection'?'centerContinuous':value;}
    else if(key==='verticalAlignment')alignment.vertical=value==='center'?'middle':value;
  }cell.font=font;cell.alignment=alignment;
}
export async function writeDocument(task,specs,{directory=draftDirectory()}={}){
  if(JSON.stringify(specs).length>120000)throw new Error('evidence_limit');
  if(specs.length!==task.sheets.length)throw new Error('document_incomplete');
  const book=new ExcelJS.Workbook();book.creator='Nubi Office';book.title=task.title;book.subject=task.summary;book.calcProperties.fullCalcOnLoad=true;
  for(const spec of specs){
    const sheet=book.addWorksheet(spec.name,{properties:{defaultRowHeight:22},pageSetup:{paperSize:9,orientation:spec.page.orientation,fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:spec.address},views:[{showGridLines:false}]});
    const area=region(spec.address);for(let r=1;r<=area.rows;r++)for(let c=1;c<=area.cols;c++)applyStyle(sheet.getCell(r,c),{fontName:'맑은 고딕',fontSize:11,verticalAlignment:'center'});
    for(const c of spec.cells){const cell=sheet.getCell(c.address);cell.value=c.formula?{formula:c.formula.slice(1)}:c.value;if(c.numberFormat)cell.numFmt=c.numberFormat;}
    for(const f of spec.formats){const a=region(f.address);for(let r=a.r;r<a.r+a.rows;r++)for(let c=a.c;c<a.c+a.cols;c++)applyStyle(sheet.getCell(r,c),f.style);}
    for(const b of spec.borders){const a=region(b.address),edge={style:'thin',color:{argb:'FF'+b.color.slice(1)}};for(let r=a.r;r<a.r+a.rows;r++)for(let c=a.c;c<a.c+a.cols;c++)sheet.getCell(r,c).border={top:edge,bottom:edge,left:edge,right:edge};}
    for(const merge of spec.merges)sheet.mergeCells(merge);
    for(const width of spec.columnWidths)sheet.getColumn(width.index).width=width.size;
    for(const height of spec.rowHeights)sheet.getRow(height.index).height=height.size;
  }
  await mkdir(directory,{recursive:true});const fileName=randomUUID()+'.xlsx',path=join(directory,fileName),buffer=await book.xlsx.writeBuffer();await writeFile(path,buffer,{flag:'wx'});
  // Read the saved OOXML again; this checks serialization, not Excel calculation.
  const reopened=new ExcelJS.Workbook();await reopened.xlsx.readFile(path);
  for(const spec of specs){const sheet=reopened.getWorksheet(spec.name);if(!sheet)throw new Error('document_file_invalid');for(const c of spec.cells){const actual=sheet.getCell(c.address);if(c.formula?actual.formula!==c.formula.slice(1):JSON.stringify(actual.value instanceof Date?normalizeTypedValue(actual.value.toISOString().slice(0,10),'date'):actual.value)!==JSON.stringify(c.value))throw new Error('document_file_invalid');}}
  return{fileName,path,sha256:createHash('sha256').update(await readFile(path)).digest('hex'),bytes:buffer.length};
}

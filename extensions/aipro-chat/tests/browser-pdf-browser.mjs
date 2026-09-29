import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,cp,copyFile,appendFile,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pdfFile} from './fixtures/documents.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-live-pdf-')),extension=resolve(profile,'extension');
const checks=[],requests=[],errors=[];let context,slowHeld=false;
const check=label=>{checks.push(label);console.log('PASS '+label);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function multiPdf(texts) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${texts.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${texts.length} >>`];
  const fontId=3+texts.length*2;
  for(const [index,text]of texts.entries()) {
    const lines=text.match(/.{1,80}/g)||[''];
    const content=`BT /F1 8 Tf 40 740 Td ${lines.map(line=>`(${line.replace(/[()\\]/g,'\\$&')}) Tj 0 -8 Td`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${4+index*2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const bytes=multiPdf(['FIRST_PAGE '+ 'Original reference '.repeat(350),'SECOND_PAGE_REQUIRED_FACT','']);
const empty=multiPdf(['']),small=pdfFile().buffer;
const server=createServer((req,res)=>{
  requests.push(req.url);
  if(req.url==='/redirect.pdf'&&requests.filter(url=>url===req.url).length>1){res.writeHead(302,{location:'/current.pdf'});return res.end();}
  if(req.url==='/slow.pdf'&&requests.filter(url=>url===req.url).length>1){slowHeld=true;req.on('close',()=>{if(!res.writableEnded)res.destroy();});return;}
  const body=req.url==='/empty.pdf'?empty:req.url==='/bad.pdf'?Buffer.from('%PDF-1.4\nBROKEN'):req.url==='/current.pdf'?bytes:small;
  res.writeHead(200,{'content-type':'application/pdf','content-length':body.length,'cache-control':'no-store','content-disposition':'inline'});res.end(body);
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const origin=`http://127.0.0.1:${server.address().port}`;
try {
  await mkdir('verification/browser-pdf',{recursive:true});await cp(resolve(process.env.TEST_EXTENSION||'dist'),extension,{recursive:true});
  if(process.env.TEST_PDF_SOURCE==='1') {
    const {build}=await import('esbuild');
    await copyFile('background-images.js',resolve(extension,'background-images.js'));
    for(const entry of ['browser-content.js','browser-document-worker.js','image-renderer.js'])await build({entryPoints:[entry],outfile:resolve(extension,entry),bundle:true,platform:'browser',format:'esm',target:'chrome125',external:entry==='browser-content.js'?['./background-images.js','./browser-url.js']:[]});
    await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',resolve(extension,'document-assets/pdf.worker.mjs'));
  }
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.pdfTest={runBrowserAgent,stopBrowserAgent,compareImages,ready:()=>serial(()=>{})};\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,
    args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
  context.setDefaultTimeout(20000);context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>pdfTest.ready());
  const page=await context.newPage();await page.goto(origin+'/current.pdf',{waitUntil:'load'});
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,origin+'/current.pdf');
  let requestId='pdf-text';
  const run=async args=>(await worker.evaluate(({requestId,tabId,args})=>pdfTest.runBrowserAgent(requestId,{tabId},'read_page',{mode:'content',...args}),{requestId,tabId,args})).result;
  const first=await run({});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.method,'pdfjs_text');
  assert.equal(first.pdf.raw_sha256,hash(bytes));assert.equal(first.pdf.page_count,3);assert.equal(first.pdf.pages_without_text,1);
  assert(first.source_document_id);assert.equal(first.coverage.partial,true);assert.equal(first.coverage.textOnly,true);
  assert(first.next_offset!==null,JSON.stringify({characters:first.characters,pages:first.pdf.page_count}));assert(first.ranges[0].page_ranges.every(range=>range.page===1));
  const hit=await run({query:'SECOND_PAGE_REQUIRED_FACT'});assert.equal(hit.ok,true,JSON.stringify(hit));assert.match(hit.ranges.map(range=>range.markdown).join(''),/SECOND_PAGE_REQUIRED_FACT/);
  assert(hit.ranges.some(range=>range.page_ranges.some(page=>page.page===2)));assert.equal(hit.content_hash,first.content_hash);
  assert.equal(requests.filter(url=>url==='/current.pdf').length,2,'Viewer GET plus one resource-snapshot GET; cache does not repeat fetching');
  check('current native PDF is parsed by PDF.js with original hash, exact page ranges, partial scope and no ref/fake whole-document claim');
  let offset=first.next_offset,parts=[...first.ranges];while(offset!==null){const next=await run({offset,content_hash:first.content_hash});assert.equal(next.ok,true);parts.push(...next.ranges);offset=next.next_offset;assert(parts.length<10);}
  assert(parts.some(range=>range.page_ranges.some(page=>page.page===3&&!page.text_available)));
  check('continuation preserves one immutable PDF snapshot and explicitly retains a page without extractable text');
  await page.reload({waitUntil:'load'});const afterReload=await run({offset:first.next_offset,content_hash:first.content_hash});assert.equal(afterReload.error,'browser_content_changed');
  check('same URL reload changes document identity and rejects old content-hash continuation');
  for(const [path,reason]of [['empty.pdf','pdf_text_unavailable'],['bad.pdf','pdf_parse_failed'],['redirect.pdf','pdf_fetch_failed']]) {
    await page.goto(origin+'/'+path,{waitUntil:'load'});const result=await run({});assert.equal(result.error,'page_content_pdf_unavailable',JSON.stringify(result));assert.equal(result.reason,reason,JSON.stringify(result));assert.equal(result.retryable,false);
  }
  check('scanned-empty, corrupt and redirected PDFs remain explicit unavailable results without fabricated content or repeated capture');
  await page.goto(origin+'/current.pdf',{waitUntil:'load'});
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=';
  const [pdf,image]=await Promise.all([run({}),worker.evaluate(png=>pdfTest.compareImages({files:[{ref:'image-one',data:png}],candidates:[{ref:'image-one',number:1}]},new AbortController().signal),png)]);
  assert.equal(pdf.ok,true);assert.equal(image.image?.mimeType,'image/png');assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,0);
  check('PDF parsing and image comparison share one serial offscreen lifecycle and close without competing documents');
  await worker.evaluate(requestId=>pdfTest.stopBrowserAgent(requestId),requestId);requestId='pdf-cancel';
  await page.goto(origin+'/slow.pdf',{waitUntil:'load'});const pending=run({});
  for(let n=0;n<100&&!slowHeld;n++)await new Promise(resolveWait=>setTimeout(resolveWait,20));assert(slowHeld);
  const cancelAt=Date.now();await worker.evaluate(requestId=>pdfTest.stopBrowserAgent(requestId),requestId);const cancelled=await pending;
  assert.equal(cancelled.error,'cancelled',JSON.stringify(cancelled));assert(Date.now()-cancelAt<5000);
  assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,0);
  check('explicit cancellation aborts an unresponsive PDF body read without late evidence, parser or automatic replay');
  assert.deepEqual(errors,[]);
  await writeFile('verification/browser-pdf/browser.json',JSON.stringify({checks,actualBrowser:true,actualModel:false,syntheticSite:true,
    sourceOverlay:process.env.TEST_PDF_SOURCE==='1',pages:3,rawSha256:hash(bytes),requests,errors},null,2)+'\n');
}finally{await context?.close();server.closeAllConnections();await new Promise(resolveClose=>server.close(resolveClose));await rm(profile,{recursive:true,force:true});}

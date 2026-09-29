import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,cp,copyFile,appendFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function multiPdf(texts) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${texts.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${texts.length} >>`];
  const fontId=3+texts.length*2;
  for(const [index,text]of texts.entries()) {
    const lines=text.match(/.{1,80}/g)||[''];
    const diagram=index===1?'0 0 1 rg 100 100 200 200 re f 1 1 1 rg 180 180 40 40 re f ':'';
    const content=diagram+`BT /F1 8 Tf 40 740 Td ${lines.map(line=>`(${line.replace(/[()\\]/g,'\\$&')}) Tj 0 -8 Td`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${4+index*2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const bytes=multiPdf(['The rule refers to Figure A on page two. '+ 'Dense text '.repeat(700),'Figure A. Blue is included; white is excluded.']);
const checks=[],errors=[];let context;
const check=label=>{checks.push(label);console.log('PASS '+label);};
const profile=await mkdtemp(resolve(tmpdir(),'nubi-pdf-page-')),extension=resolve(profile,'extension');
const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/pdf','content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/diagram.pdf`;
try {
 await cp(resolve(process.env.TEST_EXTENSION||'dist'),extension,{recursive:true});
 if(process.env.TEST_PDF_SOURCE==='1') {
  const {build}=await import('esbuild');
  for(const entry of ['background-images.js','browser-agent.js'])await copyFile(entry,resolve(extension,entry));
  for(const entry of ['browser-content.js','browser-document-worker.js','image-renderer.js'])await build({entryPoints:[entry],outfile:resolve(extension,entry),bundle:true,platform:'browser',format:'esm',target:'chrome125',external:entry==='browser-content.js'?['./background-images.js','./browser-url.js']:[]});
  await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',resolve(extension,'document-assets/pdf.worker.mjs'));
 }
 await appendFile(resolve(extension,'background.js'),`
import {renderCurrentPdfPage as pdfRenderTest,extractCurrentPdf as pdfExtractTest} from './background-images.js';
globalThis.pdfPageTest={runBrowserAgent,stopBrowserAgent,compareImages,render:pdfRenderTest,extract:pdfExtractTest,ready:()=>serial(()=>{})};
`);
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
 context.setDefaultTimeout(25000);context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>pdfPageTest.ready());
 const page=await context.newPage();await page.goto(url,{waitUntil:'load'});
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
 const run=async(args,vision=false)=>(await worker.evaluate(({tabId,args,vision})=>pdfPageTest.runBrowserAgent('pdf-page-test',{tabId},'read_page',args,{vision}),{tabId,args,vision})).result;
 const source=await run({mode:'content'});assert.equal(source.ok,true,JSON.stringify(source));assert.equal(source.pdf.raw_sha256,hash(bytes));assert.equal(source.pdf.page_count,2);
 const image=await run({mode:'pdf_page',page:2,raw_sha256:hash(bytes)},true);
 assert.equal(image.ok,true,JSON.stringify(image));assert.equal(image.dataKind,'pdf_page_reference');assert.equal(image.source.page,2);assert.equal(image.source.raw_sha256,hash(bytes));assert.equal(image.source.documentId,source.source_document_id);
 assert.equal(image.referenceImage.width,900);assert.equal(image.referenceImage.height,1200);
 assert.equal(image.screenshot_id,undefined);assert.equal(image.observation,undefined);assert.equal(image.refs,undefined);assert.equal(image.image,undefined);
 assert.deepEqual(image.coverage.pages,[2]);assert.equal(image.coverage.partial,true);assert.match(image.text,/Figure A/);
 const ui=await context.newPage();await ui.goto(`chrome-extension://${worker.url().split('/')[2]}/image-renderer.html`);
 const pixels=await ui.evaluate(async({dataUrl})=>{const blob=new Blob([Uint8Array.from(atob(dataUrl.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'}),bitmap=await createImageBitmap(blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const color=(x,y)=>[...ctx.getImageData(x,y,1,1).data];bitmap.close();return{blue:color(225,975),excluded:color(300,900),outside:color(75,975)};},image.referenceImage);
 assert.deepEqual(pixels.blue,[0,0,255,255]);assert.deepEqual(pixels.excluded,[255,255,255,255]);assert.deepEqual(pixels.outside,[255,255,255,255]);await ui.close();
 check('actual PDF.js worker PNG preserves page-two diagram colors and excluded white region under immutable non-actionable source identity');
 const noVision=await run({mode:'pdf_page',page:2,raw_sha256:hash(bytes)});assert.equal(noVision.error,'vision_unavailable');assert.equal(noVision.referenceImage,undefined);
 const changed=await run({mode:'pdf_page',page:2,raw_sha256:'0'.repeat(64)},true);assert.equal(changed.error,'browser_content_changed');
 const invalid=await run({mode:'pdf_page',page:3,raw_sha256:hash(bytes)},true);assert.equal(invalid.error,'tool_arguments_invalid');
 check('vision-disabled, mismatched source hash and out-of-range page cannot manufacture PDF visual evidence');
 const encoded=bytes.toString('base64'),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH9sAAAAASUVORK5CYII=';
 const results=await worker.evaluate(async({encoded,png})=>Promise.all([
  pdfPageTest.render(encoded,{page:1},new AbortController().signal),pdfPageTest.extract(encoded,new AbortController().signal),pdfPageTest.compareImages({files:[{ref:'one',data:png}],candidates:[{ref:'one',number:1}]},new AbortController().signal)
 ]),{encoded,png});
 assert.equal(results[0].page,1);assert.equal(results[0].text,undefined);assert(results[1].text.length>6000);assert.equal(results[2].image.mimeType,'image/png');
 assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,0);
 check('dense-text page rendering, original extraction and image comparison share one serial offscreen queue and close their document');
 const failures=await worker.evaluate(async encoded=>{const capture=async promise=>{try{await promise;return'no_error';}catch(e){return e.message;}};return{invalid:await capture(pdfPageTest.render(encoded,{page:0},new AbortController().signal)),outside:await capture(pdfPageTest.render(encoded,{page:3},new AbortController().signal)),corrupt:await capture(pdfPageTest.render(btoa('%PDF-1.4 broken'),{page:1},new AbortController().signal)),cancelled:await capture((()=>{const c=new AbortController();c.abort();return pdfPageTest.render(encoded,{page:1},c.signal);})())};},encoded);
 assert.deepEqual(failures,{invalid:'pdf_render_page',outside:'pdf_render_page',corrupt:'pdf_render_failed',cancelled:'cancelled'});
 assert.equal((await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))).length,0);
 check('invalid, corrupt and cancelled renders expose typed failures, no late PNG and no retained offscreen document');
 assert.deepEqual(errors,[]);await mkdir('verification/browser-pdf',{recursive:true});await writeFile('verification/browser-pdf/render-browser.json',JSON.stringify({checks,actualBrowser:true,actualModel:false,syntheticSite:true,sourceOverlay:process.env.TEST_PDF_SOURCE==='1',rawSha256:hash(bytes),pixels,errors},null,2)+'\n');
}finally{await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}

// Isolated IndexedDB regression. No extension build, account, or evaluation profile.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=';
const allowed=new Set(['capture-store.js','image-files.js','agent-trace.js','script-feedback.js','task-plan.js','user-question.js']);
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<title>Capture store test</title>');}
  const name=req.url?.slice(1);
  if(!allowed.has(name)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL(`../${name}`,import.meta.url)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result=await page.evaluate(async png=>{
    const store=await import('/capture-store.js');
    const input={screenshot:{id:'capture-fixture-123',url:'https://example.test',at:Date.now()},image:{mimeType:'image/png',data:png},requestId:'reply',provider:'chatgpt'};
    await store.saveCapture(input);
    const owner={requestId:'reply',provider:'chatgpt'},ids=[input.screenshot.id];
    const first=await store.attachedScreenshotRecords(ids,owner),again=await store.attachedScreenshotRecords(ids,owner);
    const old=await store.attachedScreenshotRecords(ids,{...owner,requestId:'old-reply'});
    const provider=await store.attachedScreenshotRecords(ids,{...owner,provider:'aipro'});
    await store.savePageImage({...input,screenshot:{...input.screenshot,id:'page-image-fixture'}});
    const mixed=await store.attachedScreenshotRecords([...ids,'page-image-fixture'],owner);
    const missing=await store.attachedScreenshotRecords([...ids,'unknown-fixture'],owner);
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('aipro-browser-captures',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const records=await new Promise(resolve=>{const tx=db.transaction('captures','readonly'),req=tx.objectStore('captures').getAll();req.onsuccess=()=>resolve(req.result);});
    const before=records.length;
    // Corrupt the fixture's stored Blob to prove existence alone is insufficient.
    await new Promise(resolve=>{const tx=db.transaction('captures','readwrite');tx.objectStore('captures').put({...records.find(r=>r.id===ids[0]),blob:null});tx.oncomplete=resolve;});
    const noBlob=await store.attachedScreenshotRecords(ids,owner);db.close();
    await store.deleteCaptures(ids);
    const deleted=await store.attachedScreenshotRecords(ids,owner);
    return {first,again,old,provider,mixed,missing,before,noBlob,deleted};
  },png);
  assert.deepEqual(result.first,[{id:'capture-fixture-123',availableInChat:true}]);
  assert.deepEqual(result.again,result.first);assert.equal(result.before,2);
  for(const key of ['old','provider','mixed','missing','noBlob','deleted'])assert.equal(result[key],null,key);
  console.log('PASS: real IndexedDB attachment ownership, repeat lookup, missing/invalid Blob and mixed-source rejection');
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}

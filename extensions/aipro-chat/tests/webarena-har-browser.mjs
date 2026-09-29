import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {benchmarkHarFilter,validateBenchmarkHar} from '../scripts/webarena-runner.mjs';
const root=await mkdtemp(join(tmpdir(),'nubi-har-'));
const site=createServer((_q,r)=>r.end('<title>Benchmark</title><script>fetch("/result")</script>'));
const model=createServer((_q,r)=>r.end('PRIVATE_MODEL_PAYLOAD'));
await Promise.all([new Promise(r=>site.listen(0,'127.0.0.1',r)),new Promise(r=>model.listen(0,'127.0.0.1',r))]);
const origin=`http://127.0.0.1:${site.address().port}`,privateOrigin=`http://127.0.0.1:${model.address().port}`,sites={fixture:{origin}};
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY||chromium.executablePath()});
 const context=await browser.newContext({recordHar:{path:join(root,'network.har'),content:'embed',mode:'full',urlFilter:benchmarkHarFilter(sites)}});
 const page=await context.newPage();await page.goto(origin);await page.waitForLoadState('networkidle');
 const provider=await context.newPage();await provider.goto(privateOrigin);await context.close();
 const raw=await readFile(join(root,'network.har'),'utf8'),har=JSON.parse(raw),capture=validateBenchmarkHar(har,sites);
 assert(capture.entries>=2);assert(!raw.includes('PRIVATE_MODEL_PAYLOAD'));assert(!raw.includes(privateOrigin));assert(har.log.entries.some(entry=>entry.request.url===origin+'/result'));
 await mkdir('verification',{recursive:true});await writeFile('verification/webarena-har-browser.json',JSON.stringify({actualBrowser:true,actualModel:false,officialEnvironment:false,capture,modelTrafficExcluded:true},null,2));console.log('PASS real Playwright HAR retains benchmark frontend requests and excludes provider traffic');
}finally{await browser?.close();for(const server of [site,model]){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(root,{recursive:true,force:true});}

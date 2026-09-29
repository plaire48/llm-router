import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {trackModelEvidence} from '../scripts/evaluation-model-evidence.mjs';
import {ORIGIN} from '../core.js';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY || chromium.executablePath()});
try {
  const context=await browser.newContext();let calls=0;
  await context.route('**/*',route=>{
    if(route.request().method()==='GET')return route.fulfill({contentType:'text/html',body:'<title>Isolated evaluation fixture</title>'});
    calls++;
    return route.fulfill(calls===1 ? {status:401,json:{error:'synthetic authorization rejection'}} :
      {status:200,json:{choices:[{message:{content:'Synthetic valid response'},finish_reason:'stop'}]}});
  });
  const page=await context.newPage();await page.goto(ORIGIN);
  const tracker=trackModelEvidence(context,'fixture-model');
  await page.evaluate(async()=>{
    for(let i=0;i<2;i++)await (await fetch('/api/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'fixture-model',messages:[]})})).text();
  });
  const evidence=await tracker.finish();
  assert.deepEqual(evidence,{modelRequests:2,modelResponses:1,unverifiedResponses:1});
  assert.equal(context.listenerCount('request'),0);assert.equal(context.listenerCount('response'),0);
  const result={status:'passed',browser:browser.version(),actualBrowser:true,actualModel:false,syntheticModelResponses:true,evidence};
  await writeFile('verification/evaluation-evidence-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {await browser.close();}

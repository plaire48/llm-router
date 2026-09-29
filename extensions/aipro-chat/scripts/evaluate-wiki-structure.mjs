// Reproducible structural parity and timing experiment. No model or network calls.
import {wikiChunks as before} from '../verification/openwiki-structure-2026-09-24/before.mjs';
import {wikiChunks as after} from '../site-wiki-retrieval.js';
import assert from 'node:assert/strict';
const results=[];
for(const size of [200,2000,10000]) {
  const text=Array.from({length:size},(_,i)=>`## Section ${i}\n**Budget** &amp; units [policy](https://example.test)\n\n| Label | Amount (KRW) |\n| --- | --- |\n| value${i} | ${i} |\n\n> Context *qualified*.\n`).join('');
  const start=performance.now(),old=before(text),middle=performance.now(),current=after(text),end=performance.now();
  assert.deepEqual(current,old);
  results.push({characters:text.length,chunks:old.length,beforeMs:Math.round(middle-start),afterMs:Math.round(end-middle),identical:true});
}
console.log(JSON.stringify({realModel:false,singleLocalSample:true,results},null,2));

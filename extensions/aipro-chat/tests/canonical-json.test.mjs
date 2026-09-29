import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJSON} from '../canonical-json.js';
import {textDigest} from '../browser-text.js';
test('approval digest survives nested storage key ordering but binds every value and array order',async()=>{
 const original={operation:{method:'upload',files:[{id:'one',name:'training.txt',hash:'a',bytes:60},{id:'two',name:'b.txt',hash:'b',bytes:2}]},documents:[{documentId:'doc',data:{url:'https://x.test/?page=2',fields:[{label:'title',value:'draft'}]}}]};
 const reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().reverse().map(k=>[k,reorder(x[k])])):x;
 const hash=x=>textDigest(canonicalJSON(x));
 assert.equal(await hash(original),await hash(reorder(original)));
 for(const change of [x=>x.operation.files.reverse(),x=>x.operation.files[0].hash='other',x=>x.documents[0].documentId='other',x=>x.documents[0].data.fields[0].value='changed',x=>x.documents[0].data.url='https://x.test/?page=3']){
  const altered=structuredClone(original);change(altered);assert.notEqual(await hash(original),await hash(altered));
 }
});

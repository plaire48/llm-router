import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {evaluationPublicRead} from '../scripts/evaluation-public-read.mjs';
const pages=['https://search.example.test/search'];
const input={url:pages[0]+'?query=public',frames:[{frame:0,documentId:'d1',text:'Current 12.7',textFiltered:true,truncated:true}],privateOther:'OMIT'};
test('public read collection is off without an exact planned page and drops unrelated fields',()=>{
  assert.equal(evaluationPublicRead(input),null);
  const r=evaluationPublicRead(input,pages);assert.equal(r.frames[0].text,'Current 12.7');assert.equal(r.frames[0].documentId,'d1');assert(!JSON.stringify(r).includes('OMIT'));assert(!r.url.includes('?'));
  const serialized=vm.runInNewContext(`(${evaluationPublicRead.toString()})(input,pages)`,{URL,input,pages});assert.deepEqual(JSON.parse(JSON.stringify(serialized)),r);
});
test('unplanned, credentialed, auth, failed and metadata observations are excluded',()=>{
  for(const extra of [{url:'https://private.example.test/search'},{url:'https://u:p@search.example.test/search'},{url:pages[0]+'?access_token=secret'},{url:pages[0]+'?code=secret'},{url:'https://search.example.test/login'},{metadata_only:true},{error:'failed'}])assert.equal(evaluationPublicRead({...input,...extra},[...pages,'https://search.example.test/login']),null);
});
test('captures explicitly report their own truncation and preserve source range identity',()=>{
  const r=evaluationPublicRead({ok:true,url:pages[0],dataKind:'page_content',source_document_id:'d2',content_hash:'a'.repeat(64),ranges:[{start:100,end:6100,markdown:'x'.repeat(6000)}]},pages);
  assert.equal(r.ranges[0].markdown.length,5000);assert.equal(r.ranges[0].captureTruncated,true);assert.equal(r.ranges[0].end,6100);assert.equal(r.documentId,'d2');
});

test('public table capture preserves date/value associations and explicit omissions without private fields',()=>{
  const table={name:'예보',role:'table',observedRows:1,omittedRows:0,partial:false,rows:[{index:1,cells:[
    {column:1,role:'rowheader',text:'오늘 9.28.',ref:'PRIVATE_REF'},
    {column:2,role:'cell',text:'18 / 26',value:'PRIVATE_VALUE',colSpan:2}]}]};
  const frame={...input.frames[0],tables:[table,{...table,name:'x'.repeat(12001)}],tableCoverage:{observed:2,returned:2,queryFiltered:true,omitted:0}};
  const r=evaluationPublicRead({...input,frames:[frame]},pages);
  assert.equal(r.frames[0].tables[0].rows[0].cells[0].text,'오늘 9.28.');
  assert.equal(r.frames[0].tables[0].rows[0].cells[1].colSpan,2);
  assert.equal(r.frames[0].tableCaptureOmitted,1);
  assert.equal(r.frames[0].tableCoverage.queryFiltered,true);
  assert(!JSON.stringify(r).includes('PRIVATE'));
  const serialized=vm.runInNewContext(`(${evaluationPublicRead.toString()})(input,pages)`,{URL,input:{...input,frames:[frame]},pages});
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)),r);
});

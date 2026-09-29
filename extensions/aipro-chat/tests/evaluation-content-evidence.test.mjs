import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {evaluationContentEvidence} from '../scripts/evaluation-content-evidence.mjs';
import {publicSourceURL} from '../browser-public-url.js';
const source = {dataKind:'page_content',ok:true,url:'https://news.kbs.co.kr/news/view.do?ncd=1234&token=SECRET#PRIVATE',characters:500,
  source_key:'a'.repeat(64),content_hash:'b'.repeat(64),content_text_hash:'c'.repeat(64),ranges:[{start:0,end:300,markdown:'PRIVATE_BODY'}],
  next_offset:300,queryFiltered:true,coverage:{partial:true},other:'PRIVATE'};
test('evaluation source identity preserves public resource and coverage without raw body or private query',()=>{
  const result=evaluationContentEvidence(source);
  assert.equal(result.url,'https://news.kbs.co.kr/news/view.do?ncd=1234');
  assert.equal(result.textHash,source.content_text_hash);assert.deepEqual(result.ranges,[{start:0,end:300}]);
  assert.equal(result.queryFiltered,true);assert.equal(result.moreRanges,true);assert.equal(result.sourceCoveragePartial,true);
  assert(!JSON.stringify(result).includes('PRIVATE'));assert(!JSON.stringify(result).includes('SECRET'));
  const context=vm.createContext({URL,result:source});
  const serialized=vm.runInContext(`(${evaluationContentEvidence.toString()})(result, (${publicSourceURL.toString()}))`,context);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)),result);
});
test('failed reads, auth sources and invalid ranges cannot become source evidence',()=>{
  for(const extra of [{error:'failed'},{ok:false},{dataKind:'other'},{characters:-1},{url:'https://auth.openai.com/login'},{url:'https://service.test/auth/callback?code=SECRET'},{url:'file:///private'},{url:'https://user:secret@example.test'}])assert.equal(evaluationContentEvidence({...source,...extra}),null);
  const result=evaluationContentEvidence({...source,content_hash:'PRIVATE',ranges:[{start:0,end:1000},{start:-1,end:20},{start:100,end:100}],next_offset:null});
  assert.equal(result.contentHash,null);assert.deepEqual(result.ranges,[]);assert.equal(result.moreRanges,false);
});
test('PDF evidence retains bounded byte identity and observed page ranges without document text',()=>{
  const input={...source,method:'pdfjs_text',pdf:{raw_sha256:'d'.repeat(64),page_count:3,other:'PRIVATE'},
    ranges:[{start:0,end:300,markdown:'PRIVATE',page_ranges:[{page:1,start:0,end:100,text_available:true,text:'PRIVATE'},
      {page:3,start:100,end:300,text_available:false},{page:4,start:100,end:200},{page:2,start:-1,end:400}]}]};
  const result=evaluationContentEvidence(input);
  assert.deepEqual(result.pdf,{rawHash:'d'.repeat(64),pageCount:3});
  assert.deepEqual(result.ranges[0].pages,[{page:1,start:0,end:100,textAvailable:true},{page:3,start:100,end:300,textAvailable:false}]);
  assert(!JSON.stringify(result).includes('PRIVATE'));
  const context=vm.createContext({URL,result:input});
  const serialized=vm.runInContext(`(${evaluationContentEvidence.toString()})(result, (${publicSourceURL.toString()}))`,context);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)),result);
  assert.equal(evaluationContentEvidence({...input,pdf:{raw_sha256:'invalid',page_count:3}}).pdf,undefined);
});

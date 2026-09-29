import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationTextFeedback} from '../verification-text-feedback.js';

test('a failed literal check receives actual nearby text without being weakened or exposing its expected value', () => {
  const checks = [{kind:'url_is',expected:'https://example.test/'},{kind:'text_present',expected:'펜싱 남자 사브르 세계선수권 우승 PRIVATE_EXPECTED'}];
  const results = [{index:0,kind:'url_is',passed:true},{index:1,kind:'text_present',passed:false}];
  const original = structuredClone({checks,results});
  const feedback = verificationTextFeedback(checks,results,{frames:[{frame:2,documentId:'child',text:'축구 소식\n펜싱 남자 사브르, 세계선수권 은메달…종합 2위'}]});
  assert.equal(feedback[0].checkIndex,1);
  assert.equal(feedback[0].candidates[0].text,'펜싱 남자 사브르, 세계선수권 은메달…종합 2위');
  assert.equal(feedback[0].candidates[0].documentId,'child');
  assert.equal(feedback[0].candidates[0].candidateOnly,true);
  assert.equal(feedback[0].candidates[0].partial,true);
  assert.deepEqual({checks,results},original);
  assert(!JSON.stringify(feedback).includes('PRIVATE_EXPECTED'));
  assert.match(feedback[0].instruction,/never weaken/);
});

test('input values, hidden metadata, unknown documents and successful checks never produce candidate evidence', () => {
  const checks=[{kind:'text_present',expected:'secret'},{kind:'field_value',expected:'secret'}];
  const frames=[{frame:0,documentId:'doc',text:'Public heading',elements:[{value:'PRIVATE_VALUE'}],html:'PRIVATE_HTML'},
    {frame:1,text:'secret UNKNOWN_DOCUMENT'},{frame:2,documentId:'unavailable',unavailable:true,text:'secret UNAVAILABLE'}];
  const f=verificationTextFeedback(checks,[{index:0,kind:'text_present',passed:false},{index:1,kind:'field_value',passed:false}],{frames});
  assert.equal(f.length,1);assert.deepEqual(f[0].candidates,[]);
  assert(!JSON.stringify(f).includes('PRIVATE'));
  assert.deepEqual(verificationTextFeedback(checks,[{index:0,kind:'text_present',passed:true}],{frames}),[]);
});

test('diagnostic output remains bounded and does not invent a match outside the scanned observation', () => {
  const checks=Array.from({length:8},()=>({kind:'text_present',expected:'required condition'}));
  const results=checks.map((c,index)=>({index,kind:c.kind,passed:false}));
  const feedback=verificationTextFeedback(checks,results,{frames:[{frame:0,documentId:'doc',text:('required condition '+ 'x'.repeat(500)+'\n').repeat(100)}]});
  assert.equal(feedback.length,4);
  assert(feedback.every(f=>f.candidates.length<=2&&f.candidates.every(c=>c.text.length<=322)));
  assert(feedback.every(f=>f.reason==='text_not_observed'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceKey} from '../evidence-key.js';

const packet = () => ({args:{mode:'region',region_ref:'r-first-2'},result:{tabId:4,topDocumentId:'top',
  region_scope:{region_ref:'r-first-2',region_index:2,read_only:true,partial:false},
  frames:[{documentId:'document',frame:0,text:'Today current 22 low 17 high 28',
    retrieval:{textBlocks:[{start:0,end:31,regionIndex:0}],textRegions:[{index:0,heading:'Today',region_ref:'r-first-2'}]}}]}});

test('new opaque region handles alone do not make observation progress',()=>{
  const original=packet(),fresh=structuredClone(original);
  fresh.args.region_ref=fresh.result.region_scope.region_ref=fresh.result.frames[0].retrieval.textRegions[0].region_ref='r-next-2';
  assert.equal(evidenceKey(original),evidenceKey(fresh));
  assert.equal(evidenceKey(original,{progress:true}),evidenceKey(fresh,{progress:true}));
});

test('selected region, document, source context and actual text remain distinct',()=>{
  const original=packet();
  for(const change of [
    p=>p.result.region_scope.region_index=3,
    p=>p.result.frames[0].documentId='other-document',
    p=>p.result.topDocumentId='other-top',
    p=>p.result.frames[0].frame=1,
    p=>p.result.frames[0].text='Tomorrow current 25 low 18 high 26',
    p=>p.result.frames[0].retrieval.textRegions[0].heading='Other provider',
    p=>p.result.frames[0].retrieval.textRegions[0].sourceUrl='https://other.test/',
    p=>p.result.frames[0].id='authored-dom-id',
    p=>p.result.region_scope.partial=true,
  ]) {
    const changed=structuredClone(original);change(changed);
    assert.notEqual(evidenceKey(original,{progress:true}),evidenceKey(changed,{progress:true}));
  }
});

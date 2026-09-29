import test from 'node:test';
import assert from 'node:assert/strict';
import {captureCoverage} from '../browser-capture.js';
import {scrollProgress} from '../browser-scroll.js';
import {executeScript} from '../script-sandbox.js';

test('capture coverage never promotes a raster or scroll boundary to all-content verification', () => {
  const screenshot = {mode:'page',width:1000,height:2200,documentWidth:1000,documentHeight:2200,scrollX:0,scrollY:300};
  const observation = {frames:[{frame:'main',elements:[{ref:'current',scroll:{top:20,maxTop:100,height:80},inViewport:true}],
    surfaces:{pendingImages:2,failedImages:1},coverage:{domTruncated:false}}],frameCoverage:{omitted:1}};
  const result = captureCoverage(screenshot,observation);
  assert.equal(result.scope,'rendered_document'); assert.equal(result.allContentVerified,false);
  assert.equal(result.captured.y,0); assert.equal(result.next,'wait_then_reobserve'); assert.equal(result.observationPartial,true);
  assert.equal(result.failedImages,1); assert.equal(result.nestedScrollAreas[0].ref,'current');
  assert.equal(captureCoverage({...screenshot,mode:'viewport',height:700},observation).captured.y,300);
  assert.equal(captureCoverage(screenshot).observationPartial,true);
});
test('scroll receipts distinguish no progress, a rendered boundary and a growing extent', () => {
  const before={top:0,left:0,height:300,width:400,maxTop:1000,maxLeft:0};
  assert.equal(scrollProgress(before,before,'down',225).status,'blocked');
  const end={...before,top:1000};
  assert.equal(scrollProgress(end,end,'down',0).status,'boundary');
  const growth=scrollProgress(before,{...before,top:225,maxTop:1500},'down',225);
  assert.equal(growth.status,'moved');assert.equal(growth.extentChanged,true);assert.equal(growth.boundary,false);
});
test('isolated scroll facade passes only the observed ref and direction',async()=>{
  const calls=[];
  const result=await executeScript('return await browser.scroll("down", "observed-area");',async call=>{calls.push(call);return {ok:true};});
  assert.equal(result.ok,true);assert.deepEqual(calls[0].args,['down','observed-area']);
});

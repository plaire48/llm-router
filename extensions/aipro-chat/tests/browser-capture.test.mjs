import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBrowserPage, screenshotOptions, captureCoverage} from '../browser-capture.js';
import {executeScript} from '../script-sandbox.js';
import {captureRecord} from '../capture-store.js';

function fixture({height = 2200, rasterHeight, changing = false} = {}) {
  const calls = []; let reads = 0;
  return {calls, page: {url: () => 'https://example.test/page?secret=value', frames: () => [{locator: value => value}],
    evaluate: async () => ({width: 1000, height: 700, scrollX: 0, scrollY: 120, documentWidth: 1000, documentHeight: height + (changing ? reads++ : 0)}),
    screenshot: async options => {calls.push(options); const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
      png.writeUInt32BE(options.clip?.width || 1000,16); png.writeUInt32BE(rasterHeight || options.clip?.height || (options.fullPage ? height : 700),20); return png;}}};
}
test('full document and viewport preserve distinct dimensions and exact PNG attachment bytes', async () => {
  const {page, calls} = fixture();
  const full = await captureBrowserPage(page);
  assert.equal(full.screenshot.height,2200); assert.equal(full.viewport.height,700); assert.equal(full.screenshot.mode,'page');
  assert.equal(full.screenshot.scrollY,120); assert.equal(calls[0].fullPage,true); assert.equal(calls[0].style,'nubi-action-pointer { visibility: hidden !important; }'); assert(calls[0].mask[0].includes('password'));
  const record=captureRecord({...full,requestId:'fixture',provider:'aipro'});
  assert.equal(record.mode,'page'); assert.equal(record.height,2200); assert(!JSON.stringify(record).includes('secret'));
  const viewport=await captureBrowserPage(page,{fullPage:false});
  assert.equal(viewport.screenshot.mode,'viewport'); assert.equal(viewport.screenshot.height,700); assert.equal(calls[1].fullPage,false);
  const region=await captureBrowserPage(page,{fullPage:false,region:{x:100,y:80,width:240,height:120}});
  assert.equal(region.screenshot.mode,'region');assert.equal(region.screenshot.width,240);assert.equal(region.screenshot.height,120);
  assert.deepEqual(calls[2].clip,{x:100,y:80,width:240,height:120});
  assert.deepEqual(captureCoverage(region.screenshot).captured,{x:100,y:200,width:240,height:120});
  assert.equal(captureRecord({...region,requestId:'fixture',provider:'aipro'}).mode,'region');
});
// A page image too large for one capture is joined from sections. Node has no
// image APIs, so they are stood in for with recorders of what was drawn.
function imageAPIs() {
  const drawn = [];
  const png = (width, height) => {const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]); const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); return bytes;};
  globalThis.createImageBitmap = async blob => ({blob, close() {}});
  globalThis.OffscreenCanvas = class {constructor(width, height) {this.width = width; this.height = height;}
    getContext() {return {drawImage: (...args) => drawn.push(args.slice(1).map(Math.round))};}
    async convertToBlob() {return new Blob([png(this.width, this.height)], {type: 'image/png'});}};
  return {drawn, restore: () => {delete globalThis.createImageBitmap; delete globalThis.OffscreenCanvas;}};
}
test('a page too large for one image is captured whole from sections and reduced to fit', async () => {
  const apis = imageAPIs();
  try {
    const huge = fixture({height: 40000});
    const result = await captureBrowserPage(huge.page, {fullPage: true});
    assert.equal(result.screenshot.mode, 'page'); assert(result.screenshot.scale > 0 && result.screenshot.scale < 1);
    assert(result.screenshot.width * result.screenshot.height <= 32 * 1024 * 1024);
    assert.equal(Math.round(result.screenshot.height / result.screenshot.width), 40, 'the whole page keeps its proportions');
    const clips = huge.calls.map(call => call.clip);
    assert(clips.length > 1 && clips.every(clip => clip.width === 1000 && clip.x === 0));
    assert.equal(clips[0].y, 0); assert.equal(clips.at(-1).y + clips.at(-1).height, 40000, 'the sections reach the end of the page');
    assert(huge.calls.every(call => call.mask[0].includes('password')), 'secret fields stay masked in every section');
    assert.equal(apis.drawn.length, clips.length);
  } finally {apis.restore();}
});
test('a few pixels of difference is the same page; a page image at least the window size is kept with its real size', async () => {
  const near = fixture({rasterHeight: 2212});
  assert.equal((await captureBrowserPage(near.page, {fullPage: true})).screenshot.documentCovered, undefined);
  const short = await captureBrowserPage(fixture({rasterHeight: 700}).page, {fullPage: true});
  assert.equal(short.screenshot.documentCovered, false); assert.equal(short.screenshot.height, 700); assert.equal(short.screenshot.documentHeight, 2200);
  await assert.rejects(captureBrowserPage(fixture({rasterHeight: 300}).page, {fullPage: true}), /capture_incomplete/);
  await assert.rejects(captureBrowserPage(fixture({rasterHeight: 400}).page, {fullPage: false}), /capture_incomplete/);
});
test('truncated, unstable and cancelled captures never produce successful attachments',async()=>{
  const moving=fixture({changing:true});
  await assert.rejects(captureBrowserPage(moving.page,{fullPage:true}),/browser_stale/); assert.equal(moving.calls.length,2);
  await assert.rejects(captureBrowserPage(fixture().page,{cancelled:()=>true}),/cancelled/);
});
test('a stalled layout read is bounded by one capture deadline and never starts a screenshot',async()=>{
  const frozen=fixture();frozen.page.evaluate=()=>new Promise(()=>{});
  await assert.rejects(captureBrowserPage(frozen.page,{deadlineMs:50}),/capture_timeout/);
  assert.equal(frozen.calls.length,0);
  let stopped=false;
  const cancelled=fixture();cancelled.page.evaluate=()=>new Promise(()=>{});
  setTimeout(()=>{stopped=true;},25);
  await assert.rejects(captureBrowserPage(cancelled.page,{cancelled:()=>stopped,deadlineMs:500}),/cancelled/);
  assert.equal(cancelled.calls.length,0);
});
test('the isolated screenshot facade forwards the documented fullPage option without adding arbitrary screenshot options',async()=>{
  const calls=[];
  const result=await executeScript('await browser.screenshot(); return await browser.screenshot({fullPage:true});',async call=>{calls.push(call);return {screenshot_id:'example'};});
  assert.equal(result.ok,true); assert.deepEqual(calls.map(c=>c.args),[[],[{fullPage:true}]]);
  assert.deepEqual(screenshotOptions(calls[1].args[0]),{full_page:true});
  assert.deepEqual(screenshotOptions(),{full_page:true});
  assert.deepEqual(screenshotOptions({}),{full_page:true});
  assert.deepEqual(screenshotOptions({fullPage:false}),{full_page:false});
  assert.deepEqual(screenshotOptions({fullPage:false,region:{x:1,y:2,width:3,height:4}}),{full_page:false,region:{x:1,y:2,width:3,height:4}});
  for(const value of [null,true,[],{fullPage:'true'},{path:'private.png'},{clip:{x:0}},
    {region:{x:1,y:2,width:3,height:4}},{fullPage:false,region:{x:0,y:0,width:0,height:2}},
    {fullPage:false,region:{x:0.5,y:0,width:2,height:2}},{fullPage:false,region:{x:0,y:0,width:2,height:2,token:'x'}}])assert.throws(()=>screenshotOptions(value),/tool_arguments_invalid/);
  await assert.rejects(captureBrowserPage(fixture().page,{fullPage:false,region:{x:900,y:0,width:200,height:100}}),/tool_arguments_invalid/);
});

test('long overviews request section-level reading and never claim complete coverage', async () => {
  const {screenshot} = await captureBrowserPage(fixture().page);
  const coverage = captureCoverage(screenshot, {frames:[{elements:[],surfaces:{}}]});
  assert.equal(coverage.detailRecommended, true);
  assert.equal(coverage.next, 'inspect_relevant_sections');
  assert.equal(coverage.captured.y, 0);
  assert.equal(coverage.allContentVerified, false);
  assert.match(coverage.instruction, /full_page:false/);
  const viewport = await captureBrowserPage(fixture().page, {fullPage:false});
  assert.equal(captureCoverage(viewport.screenshot).detailRecommended, false);
  const short = await captureBrowserPage(fixture({height:700}).page);
  assert.equal(captureCoverage(short.screenshot).detailRecommended, false);
});

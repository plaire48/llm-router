import test from 'node:test';
import assert from 'node:assert/strict';
import {contentPacket} from '../browser-content.js';
const source = text => ({url:'https://example.test/report',title:'Report',frame:0,documentId:'doc-1',sourceIdentity:['doc-1','https://example.test/report'],text,method:'test',coverage:{partial:false}});

test('initial content read includes body after a short heading before an oversized section', async()=>{
  const text='# Service status\n\nObserved 2031-04-09: current 12.7, minimum 8, maximum 17.\n'+ 'Independent status row.\n'.repeat(600);
  const packet=await contentPacket(source(text));
  assert.match(packet.ranges[0].markdown,/Observed 2031-04-09/);
  assert(packet.ranges[0].markdown.length>4000 && packet.ranges[0].markdown.length<=5000);
  assert.equal(packet.ranges[0].markdown,text.slice(packet.ranges[0].start,packet.ranges[0].end));
  assert.equal(packet.coverage.partial,true);
});

test('unfiltered continuation retains exact source text and advances without skipped whitespace or repeated prefixes', async()=>{
  const text='# Intro\n\n'+ 'Repeated line\n'.repeat(900)+'\n\nEnd of report.   \n';
  const input=source(text);let packet=await contentPacket(input),combined='',offset=0,count=0;
  for(;;) {
    assert(++count<10);assert.equal(packet.ranges.length,1);
    const row=packet.ranges[0];assert.equal(row.start,offset);assert.equal(row.markdown,text.slice(row.start,row.end));
    assert(row.end>offset);assert(row.markdown.length<=5000);combined+=row.markdown;
    if(packet.next_offset===null)break;
    offset=packet.next_offset;packet=await contentPacket(input,{offset,content_hash:packet.content_hash});
  }
  assert.equal(combined,text);
});

test('arbitrary observed continuation offset is exact and EOF produces no backwards range',async()=>{
  const input=source('A paragraph with repeated tokens. '.repeat(500));const first=await contentPacket(input);
  const part=await contentPacket(input,{offset:113,content_hash:first.content_hash});
  assert.equal(part.ranges[0].start,113);assert.equal(part.ranges[0].markdown,input.text.slice(113,part.ranges[0].end));
  const end=await contentPacket(input,{offset:input.text.length,content_hash:first.content_hash});assert.deepEqual(end.ranges,[]);assert.equal(end.next_offset,null);
  assert.equal((await contentPacket({...input,documentId:'doc-2',sourceIdentity:['doc-2',input.url]},{offset:113,content_hash:first.content_hash})).error,'browser_content_changed');
});

test('bounded windows do not split a Unicode surrogate pair and preserve partial source coverage',async()=>{
  const input=source('x'.repeat(4999)+'🌡️'+'測'.repeat(100));input.coverage={partial:true,embeddedFrames:1};
  const first=await contentPacket(input);assert.equal(first.ranges[0].end,4999);assert.equal(first.coverage.embeddedFrames,1);
  const second=await contentPacket(input,{offset:first.next_offset,content_hash:first.content_hash});
  assert(second.ranges[0].markdown.startsWith('🌡️'));assert.equal(second.coverage.partial,true);
});

test('focused lexical lookup remains independent from sequential windows and preserves original source offsets',async()=>{
  const input=source('# Intro\n\n'+ 'Background material. '.repeat(600)+'\n\n## Eligibility\n\nThe Zephyr condition excludes hands.');
  const focused=await contentPacket(input,{query:'Zephyr'});assert.equal(focused.queryFiltered,true);assert.equal(focused.coverage.partial,true);
  assert.match(focused.ranges[0].markdown,/excludes hands/);
  for(const row of focused.ranges)assert.equal(row.markdown,input.text.slice(row.start,row.end));
  const absent=await contentPacket(input,{query:'uniquelyabsentterm'});assert.deepEqual(absent.ranges,[]);assert.equal(absent.coverage.partial,true);
});

test('PDF window page associations describe only returned characters',async()=>{
  const text='# PDF intro\n\n'+'body '.repeat(1500);const input={...source(text),pdf:{page_count:2},pageRanges:[{page:1,start:0,end:3000,textAvailable:true},{page:2,start:3000,end:text.length,textAvailable:true}]};
  const packet=await contentPacket(input);assert.deepEqual(packet.ranges[0].page_ranges,[{page:1,start:0,end:3000,text_available:true},{page:2,start:3000,end:5000,text_available:true}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceKey} from '../evidence-key.js';
import {contentPacket} from '../browser-content.js';
import {createBrowserRecovery} from '../browser-recovery.js';
import {clearDuplicateObservations} from '../context-evidence.js';

test('host read timestamps do not manufacture task progress; changed facts still do',()=>{
  const frame = {elements:[], documentId:'document-a', observedAt:'2026-09-28T04:00:00Z', text:'Published 2025-01-01'};
  const later = {...frame, observedAt:'2026-09-28T04:01:00Z'};
  assert.equal(evidenceKey(frame,{progress:true}),evidenceKey(later,{progress:true}));
  assert.equal(evidenceKey(frame),evidenceKey(later));
  assert.notEqual(evidenceKey(frame,{progress:true}),evidenceKey({...later,text:'Published 2025-02-01'},{progress:true}));
  assert.notEqual(evidenceKey({observedAt:'source-time-a'},{progress:true}),evidenceKey({observedAt:'source-time-b'},{progress:true}));
  const recovery=createBrowserRecovery();
  for(let i=1;i<=3;i++) {
    const result=recovery.observe('read_page',{}, {url:'https://example.test',frames:[{...frame,observedAt:`2026-09-28T04:0${i}:00Z`}]}, 'read');
    assert.equal(result.repetitions,i);
    assert.equal(result.changed,false);
  }
});

test('read clocks cannot defeat duplicate observation pruning; the two latest dated reads survive',()=>{
  const wire=Array.from({length:4},(_,i)=>[
    {role:'assistant',tool_calls:[{id:`call-${i}`,function:{name:'browser_snapshot',arguments:'{}'}}]},
    {role:'tool',tool_call_id:`call-${i}`,content:JSON.stringify({url:'https://example.test',frames:[{elements:[],documentId:'same-document',text:'same source',observedAt:`2026-09-28T04:0${i}:00Z`}]})}
  ]).flat();
  const result=clearDuplicateObservations(wire);
  assert.equal(result.filter(m=>m.role==='tool' && JSON.parse(m.content).contextCleared).length,2);
  assert.equal(result.at(-1).content,wire.at(-1).content);
  assert.equal(result.at(-3).content,wire.at(-3).content);
});

test('content read reports the host read time separately from unchanged source date text',async()=>{
  const before=Date.now();
  const packet=await contentPacket({url:'https://example.test/profile',frame:0,documentId:'document-a',title:'Profile',text:'Career since 2022.01. Self contribution 2025.02.06.',coverage:{partial:false}});
  assert(Date.parse(packet.observedAt)>=before && Date.parse(packet.observedAt)<=Date.now());
  assert.equal(packet.ranges[0].markdown,'Career since 2022.01. Self contribution 2025.02.06.');
  assert.equal(packet.publishedAt,undefined);
  assert.equal(packet.updatedAt,undefined);
});

test('changed lexical queries returning the same range count as repetition; new ranges remain distinct',()=>{
  const recovery=createBrowserRecovery();
  const packet={ok:true,dataKind:'page_content',url:'https://example.test/rules',frame:0,content_hash:'a'.repeat(64),ranges:[{start:0,end:11,markdown:'same source'}]};
  for(let i=1;i<=3;i++) {
    const result=recovery.observe('read_page',{mode:'content',query:`word ${i}`},{...packet,observedAt:`2026-09-28T04:0${i}:00Z`,retrieval:{match:{terms:[`word ${i}`]}}},`query-${i}`);
    assert.equal(result.repetitions,i);
  }
  assert.equal(recovery.observe('read_page',{mode:'content',offset:11},{...packet,ranges:[{start:11,end:22,markdown:'new excerpt'}]},'next-range').repetitions,1);
});

test('content query exposes partial lexical coverage without promoting it to factual certainty',async()=>{
  const result=await contentPacket({url:'https://example.test/rules',frame:0,title:'Equipment rules',text:'Equipment coating requirements and inspections.',coverage:{partial:false}},{query:'coating exclusions'});
  assert.equal(result.retrieval.method,'lexical');
  assert.deepEqual(result.retrieval.match.terms,['coating']);
  assert.equal(result.retrieval.match.coverage,0.5);
  assert.match(result.retrieval.scope,/not factual relevance/);
});

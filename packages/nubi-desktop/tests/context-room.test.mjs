// User decision of 2026-09-30: the model windows are 256K to 512K and compaction exists, so the Desktop uses
// the context for quality. Limits that held whatever the window are raised; a small window keeps its own paths.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {contextBudget} from '../../../extensions/aipro-chat/context-manager.js';
import {resultReviewInput,reviewInputLimit,REVIEW_ENTRIES} from '../runtime/result-review.mjs';
import {processOutputPreview,PREVIEW_EDGE} from '../runtime/process-output.mjs';
import {SEARCH_EXCERPT} from '../runtime/source-search.mjs';
import {spokenTurns} from '../runtime/agent.mjs';

const large={contextLength:272000},small={contextLength:22000};

test('the review takes up to half of a large window and whole long reads',()=>{
  assert.equal(reviewInputLimit(large),Math.floor(contextBudget(large).input*.5));
  assert.ok(reviewInputLimit(large)>100000,'it was 24,000 tokens whatever the window');
  assert.equal(reviewInputLimit(small),contextBudget(small).input,'a small window keeps its whole input');
  assert.equal(REVIEW_ENTRIES,128);
  const lines=Array.from({length:1000},(_,index)=>`${String(index+1).padStart(4,'0')} `+'value '.repeat(19));
  const read={tool:'read_source',result:{path:'docs/long.md',content:lines.join('\n'),hash:'sha256:abc',lines:1000,start:1,end:1000,truncated:false,nextStart:null,dataKind:'project_reference'}};
  const task={id:'t',request:'문서를 정리해 줘',criteria:[],messages:[{role:'user',content:'문서를 정리해 줘'}]};
  const {data}=resultReviewInput({task,evidence:[read],receipts:{},candidate:'답',model:large});
  const parts=data.evidence.filter(entry=>entry.tool==='read_source');
  assert.ok(parts.length>=8,'parts: '+parts.length);assert.equal(data.omittedEvidence,0,'no part of the read is left out');
  assert.equal(parts.map(entry=>entry.result.content).join('\n'),lines.join('\n'));
});

test('a command preview keeps 20,000 characters at each end',()=>{
  assert.equal(PREVIEW_EDGE,20000);
  const whole=processOutputPreview({id:'p',output:'a'.repeat(39000)});
  assert.equal(whole.outputTruncated,false);assert.equal(whole.output.length,39000);
  const text='HEAD'+'x'.repeat(60000)+'TAIL',cut=processOutputPreview({id:'p',output:text});
  assert.equal(cut.outputTruncated,true);assert.ok(cut.output.startsWith(text.slice(0,20000)));assert.ok(cut.output.endsWith(text.slice(-20000)));
});

test('a search excerpt keeps up to 1,500 characters of its line',async t=>{
  const {service,root}=await fixture(t);
  await writeFile(path.join(root,'long-line.txt'),'SEARCH_MARK '+'가나다 '.repeat(1000)+'\n');
  await git(root,['add','-A']);await git(root,['commit','-qm','long line']);
  const found=await service.search({query:'SEARCH_MARK'});
  assert.equal(SEARCH_EXCERPT,1500);assert.equal(found.results[0].excerpt.length,SEARCH_EXCERPT);
});

test('after a compaction the user messages keep a quarter of a large window',()=>{
  const task={request:'첫 요청',messages:[]},long='요청 내용 '.repeat(1500);
  const messages=Array.from({length:6},(_,index)=>({role:'user',content:index+' '+long}));
  task.messages=messages.map(message=>({...message}));
  const room=1e9,cap=Math.max(20000,Math.floor(contextBudget(large).input*.25));
  assert.ok(spokenTurns(task,messages,room).length<spokenTurns(task,messages,room,cap).length,'the 20,000 default keeps fewer');
  assert.equal(spokenTurns(task,messages,room,cap).length,6);
});

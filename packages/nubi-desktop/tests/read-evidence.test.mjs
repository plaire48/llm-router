// Found by the live run B2 of 2026-09-29 (cases D2 and D3): reading a long
// Wiki page gave a result above 12,000 characters, which a review cannot use
// as evidence, so the review asked for the same reads until the time ran out.
// Every read also repeated 3,500 characters of project rules that the host
// receipts already carry, and a request for more than 200 lines was refused
// with guidance about the file length.
//
// B4 cut a read at 9,000 characters. In B3 and B5 case D1 the agent then
// stopped before line 296 of a file, where the answer stood. Since B6 the read
// reaches the main agent whole and the review receives it in parts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {resultReviewInput} from '../runtime/result-review.mjs';
import {recoveryInstruction} from '../runtime/tool-feedback.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const REVIEW_ENTRY_LIMIT=12000;
const line=(index,width)=>`${String(index).padStart(3,'0')} `+'가나다라 "quoted" \\ value '.repeat(20).slice(0,width-4);
async function project(t){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'docs'));await mkdir(path.join(root,'src'));
  await writeFile(path.join(root,'AGENTS.md'),'# Rules\n\n'+'Keep amounts as integers. '.repeat(120));
  await writeFile(path.join(root,'src','AGENTS.md'),'Scoped rule for src.');
  await writeFile(path.join(root,'src','code.mjs'),Array.from({length:60},(_,i)=>`export const v${i}=${i};`).join('\n'));
  await writeFile(path.join(root,'docs','long.md'),Array.from({length:300},(_,i)=>line(i+1,120)).join('\n'));
  await writeFile(path.join(root,'docs','short.md'),Array.from({length:260},(_,i)=>'row '+(i+1)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','documents']);
  return {service,root};
}
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function reads(t,requests){
  const {service}=await project(t);let round=0,receipts;const results=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool');if(last)results.push({text:last.content,value:JSON.parse(last.content)});
    receipts??=messages.find(message=>String(message.content).startsWith('Current host receipts'))?.content;
    return round<requests.length?call('read_source',requests[round++]):{content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'문서를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  return {results,receipts,service,task};
}

test('a request for more than 200 lines returns its first 200 and says where to continue',async t=>{
  const {service}=await project(t);
  const read=await service.read({path:'docs/short.md',start:1,end:260});
  assert.equal(read.start,1);assert.equal(read.end,200);assert.equal(read.nextStart,201);assert.equal(read.truncated,true);
  assert.deepEqual(read.limited,{by:'lines',requestedEnd:260});
  assert.equal(read.content.split('\n').length,200);
  const rest=await service.read({path:'docs/short.md',start:201,end:260});
  assert.equal(rest.end,260);assert.equal(rest.nextStart,null);assert.equal('limited' in rest,false);
});

test('a start beyond the file is refused with the file length',async t=>{
  const {service}=await project(t);
  await assert.rejects(service.read({path:'docs/short.md',start:261}),error=>error.message==='range_invalid'&&error.details.lines===260);
  await assert.rejects(service.read({path:'docs/short.md',start:5,end:4}),/range_invalid/);
  assert.match(recoveryInstruction('range_invalid','read_source'),/details\.lines/);
});

test('a long read reaches the main agent whole, up to 200 lines',async t=>{
  const {results}=await reads(t,[{path:'docs/long.md'},{path:'docs/long.md',start:1,end:300}]);
  for(const {text,value} of results){
    assert.equal(value.end,200);assert.equal(value.nextStart,201);
    assert.equal(value.content.split('\n').length,200);assert.equal(value.content.split('\n').at(-1),line(200,120));
    assert.ok(text.length>20000,'nothing was cut: '+text.length);
    assert.equal(value.provenance.end,200);
  }
  assert.deepEqual(results[1].value.limited,{by:'lines',requestedEnd:300});assert.equal('limited' in results[0].value,false);
});

// A window of 22,000 tokens holds the fixed part of a request and little else.
// A read of 200 long lines did not fit, could not be compacted because it was
// the newest result, and the run stopped.
test('a read is as long as the next request of the model can hold',async t=>{
  const {service}=await project(t);
  const whole=await service.read({path:'docs/long.md'});
  assert.equal(whole.end,200);assert.equal('limited' in whole,false);
  const measure=text=>Math.ceil(text.length/4),small=await service.read({path:'docs/long.md',room:1500,measure});
  assert.ok(small.end<200&&small.end>=40,'lines that fit 1,500 tokens: '+small.end);
  assert.deepEqual(small.limited,{by:'size'});assert.equal(small.nextStart,small.end+1);
  assert.equal(small.content.split('\n').length,small.end);assert.equal(small.content.split('\n').at(-1),line(small.end,120));
  assert.ok(small.content.split('\n').reduce((sum,text)=>sum+measure(text),0)<=1500);
  const none=await service.read({path:'docs/long.md',room:-100,measure});
  assert.equal(none.end,1,'the first line is always returned');
});

test('a read that fits is returned whole',async t=>{
  const {results}=await reads(t,[{path:'app.txt'},{path:'src/code.mjs'}]);
  assert.equal(results[0].value.content,'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
  assert.equal('limited' in results[0].value,false);assert.equal(results[1].value.end,60);
});

test('rules that host receipts already carry are named in a read, not repeated',async t=>{
  const {results,receipts,service,task}=await reads(t,[{path:'docs/short.md'},{path:'src/code.mjs'}]);
  assert.match(receipts,/Keep amounts as integers/,'host receipts carry the root rules');
  const [document,code]=results.map(result=>result.value);
  assert.equal(document.projectRules.files.length,1);
  assert.deepEqual(Object.keys(document.projectRules.files[0]).sort(),['hash','path','scope','shown']);
  assert.equal(document.projectRules.files[0].shown,'host receipts projectGuidance');
  assert.ok(!results[0].text.includes('Keep amounts as integers'));
  assert.equal(document.projectRules.fingerprint,(await service.read({path:'docs/short.md',taskId:task.id})).projectRules.fingerprint,'the fingerprint that edits are checked against is unchanged');
  assert.deepEqual(code.projectRules.files.map(file=>file.path),['AGENTS.md','src/AGENTS.md']);
  assert.equal(code.projectRules.files[1].content,'Scoped rule for src.','rules the receipts do not carry stay in the read');
});

test('an edit still needs the rules fingerprint of the read',async t=>{
  const {service}=await project(t);
  const read=await service.read({path:'src/code.mjs'});
  assert.equal(read.projectRules.files[0].content.startsWith('# Rules'),true,'the service result keeps the rules for host checks');
});

const task={id:'t',request:'문서를 정리해 줘',criteria:[],messages:[{role:'user',content:'문서를 정리해 줘'}]};
const pageLines=Array.from({length:200},(_,index)=>line(index+1,120));
const longRead={tool:'read_source',result:{path:'docs/long.md',content:pageLines.join('\n'),hash:'sha256:abc',lines:300,start:1,end:200,truncated:true,nextStart:201,dataKind:'project_reference'}};

test('the review receives a long read in parts of whole lines that it can use',()=>{
  const {data}=resultReviewInput({task,evidence:[{tool:'source_search',result:{results:[]}},longRead],receipts:{},candidate:'답',model:{contextLength:200000}});
  const parts=data.evidence.filter(entry=>entry.tool==='read_source');
  assert.ok(parts.length>=3,'parts: '+parts.length);
  assert.deepEqual(parts.map(entry=>entry.id),parts.map((_,index)=>index?`tool:1.${index+1}`:'tool:1'));
  for(const [index,entry] of parts.entries()){
    assert.equal(entry.usable,true);assert.equal(entry.truncated,false);
    assert.ok(JSON.stringify(entry.result).length<=12000,String(JSON.stringify(entry.result).length));
    assert.equal(entry.result.path,'docs/long.md');assert.equal(entry.result.hash,'sha256:abc');
    assert.deepEqual(entry.result.part,{index:index+1,of:parts.length});
    assert.equal(entry.result.content.split('\n').length,entry.result.end-entry.result.start+1,'whole lines');
    assert.equal(entry.result.content.split('\n')[0],line(entry.result.start,120));
  }
  assert.equal(parts[0].result.start,1);assert.equal(parts.at(-1).result.end,200);
  for(const [index,entry] of parts.entries())if(index)assert.equal(entry.result.start,parts[index-1].result.end+1,'no line is lost between parts');
  assert.equal(parts.map(entry=>entry.result.content).join('\n'),pageLines.join('\n'));
  assert.equal(data.omittedEvidence,0);
});

test('a result that cannot be divided into lines stays unusable',()=>{
  const {data}=resultReviewInput({task,evidence:[{tool:'read_source',result:{path:'wide.md',content:'x'.repeat(13000),hash:'h',start:1,end:1}},{tool:'read_process_output',result:{text:'y'.repeat(13000)}}],receipts:{},candidate:'답',model:{contextLength:200000}});
  assert.deepEqual(data.evidence.filter(entry=>entry.id.startsWith('tool:')).map(entry=>[entry.id,entry.truncated,entry.usable]),[['tool:1',true,false],['tool:0',true,false]]);
});

test('parts that do not fit the review are counted as left out',()=>{
  const evidence=Array.from({length:12},(_,index)=>({tool:'read_source',result:{...longRead.result,path:`docs/page-${index}.md`}}));
  const {data}=resultReviewInput({task,evidence,receipts:{},candidate:'답',model:{contextLength:200000}});
  const shown=data.evidence.filter(entry=>entry.tool==='read_source');
  assert.ok(shown.length<12*3&&shown.length>0);assert.ok(shown.every(entry=>entry.usable));
  assert.ok(data.omittedEvidence>0,'reads that did not fit are counted');
  assert.equal(shown[0].result.path,'docs/page-11.md','the newest read comes first');
});

const source=(pathName,start,end,content)=>({tool:'read_source',result:{path:pathName,content,hash:'h',start,end}});
test('the same result read twice is given to the review once',()=>{
  const evidence=[source('a.md',1,50,'alpha'),source('b.md',1,50,'beta'),source('a.md',1,50,'alpha'),{tool:'read_source',result:{ok:false,error:'range_invalid'}},{tool:'read_source',result:{ok:false,error:'range_invalid'}}];
  const {data}=resultReviewInput({task,evidence,receipts:{},candidate:'답',model:{contextLength:200000}});
  assert.deepEqual(data.evidence.map(entry=>entry.id),['host','user','tool:4','tool:2','tool:1']);
  assert.equal(data.duplicateEvidence,2);assert.equal(data.omittedEvidence,0);
});

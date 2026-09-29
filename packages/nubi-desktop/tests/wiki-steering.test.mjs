// Found by the live runs of 2026-09-29: for questions the Wiki answers, the
// agent searched source text instead. In B1 case W2 it made nine literal
// searches, no Wiki query, and missed a fact stated on a Wiki page. Korean
// questions against an English Wiki cannot match by words at all.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,fixtureReview} from './fixtures.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
import {git} from '../runtime/files.mjs';
import {wikiOverview} from '../runtime/wiki-evidence.mjs';
import {DOCUMENT_TOOL} from '../runtime/workspace-documents.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

async function wiki(t,{language,pages=3}={}){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'openwiki','operations'),{recursive:true});await mkdir(path.join(root,'openwiki','.claims'),{recursive:true});
  for(let i=0;i<pages;i++)await writeFile(path.join(root,'openwiki','operations',`page-${String(i).padStart(2,'0')}.md`),`---\ntitle: Operations page ${i}\ndescription: How part ${i} is operated.\n---\n\n# Operations page ${i}\n\nBody ${i}.\n`);
  await writeFile(path.join(root,'openwiki','.claims','page.json'),'{}');
  if(language)await writeFile(path.join(root,'openwiki','.last-update.json'),JSON.stringify({updatedAt:'2026-09-17T08:09:59.813Z',command:'update',gitHead:'db1c0f06fce1a8116bd76a28598a33d57f6cbe81',status:'complete',language}));
  await git(root,['add','-A','-f','.']);await git(root,['commit','-qm','wiki']);
  return service;
}

test('the overview lists Wiki pages with titles, the language and the generation time',async t=>{
  const service=await wiki(t,{language:'en'}),task=await service.createTask({request:'q'}),overview=await wikiOverview(service,task.id);
  assert.equal(overview.language,'en');assert.equal(overview.updatedAt,'2026-09-17T08:09:59.813Z');
  assert.equal(overview.pages,4,'three operations pages and the fixture home page');
  assert.deepEqual(overview.list.map(page=>page.path),['openwiki/home.md','openwiki/operations/page-00.md','openwiki/operations/page-01.md','openwiki/operations/page-02.md']);
  assert.deepEqual(overview.list[1],{path:'openwiki/operations/page-00.md',title:'Operations page 0'});
  assert.ok(!JSON.stringify(overview).includes('.claims'));
  assert.match(overview.instruction,/ask_openwiki/);
});

test('without a generation record the language comes from the page titles',async t=>{
  const service=await wiki(t),task=await service.createTask({request:'q'});
  assert.equal((await wikiOverview(service,task.id)).language,'en');assert.equal((await wikiOverview(service,task.id)).updatedAt,null);
  const {service:korean,root}=await fixture(t);
  await writeFile(path.join(root,'openwiki','home.md'),'---\ntitle: 배송 정책\n---\n\n# 배송 정책\n');await writeFile(path.join(root,'openwiki','order.md'),'# 주문 상태\n');
  await git(root,['add','-A']);await git(root,['commit','-qm','ko']);
  const task2=await korean.createTask({request:'q'});
  assert.equal((await wikiOverview(korean,task2.id)).language,'ko');
});

test('a long Wiki is listed up to forty pages and says how many were left out',async t=>{
  const service=await wiki(t,{language:'en',pages:45}),task=await service.createTask({request:'q'}),overview=await wikiOverview(service,task.id);
  assert.equal(overview.pages,46);assert.equal(overview.list.length,40);assert.equal(overview.omitted,6);
  assert.ok(JSON.stringify(overview).length<4500,String(JSON.stringify(overview).length));
});

test('a project without a Wiki has no overview',async t=>{
  const {service,root}=await fixture(t);await git(root,['rm','-q','-r','openwiki']);await git(root,['commit','-qm','no wiki']);
  const task=await service.createTask({request:'q'});
  assert.equal(await wikiOverview(service,task.id),null);
});

test('the agent receives the overview and tools that say when to use the Wiki',async t=>{
  const service=await wiki(t,{language:'en'});let request;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){request??={messages,tools};return {content:'확인했습니다.',calls:[]};}};
  const task=await service.createTask({request:'운영 방법을 알려 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const receipts=request.messages.find(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts'));
  const data=JSON.parse(receipts.content.slice(receipts.content.indexOf('{')));
  assert.equal(data.wiki.language,'en');assert.equal(data.wiki.list.length,4);
  const described=name=>request.tools.find(item=>item.function.name===name).function.description;
  assert.match(described('ask_openwiki'),/Start here/);assert.match(described('ask_openwiki'),/OpenWiki agent.*its own context/);assert.match(described('ask_openwiki'),/read_source/);assert.match(described('ask_openwiki'),/wiki\.language/);
  // Found in B3 case D2: the main agent added "exhaustive review is required" to a question about one topic, and the OpenWiki agent read the whole Wiki with 150 model calls.
  assert.match(described('ask_openwiki'),/Ask for exhaustive review only when the user wants the whole Wiki read/);assert.match(described('ask_openwiki'),/many model calls/);
  assert.deepEqual(request.tools.find(item=>item.function.name==='ask_openwiki').function.parameters.properties.wiki.enum,['external']);
  assert.match(described('wiki_query'),/record_change_plan/);assert.match(described('wiki_query'),/ask_openwiki/);
  assert.match(described('source_search'),/exact text/i);assert.match(described('source_search'),/ask_openwiki/);
  assert.match(described('analyze_documents'),/model calls/);assert.match(described('analyze_documents'),/ask_openwiki/);
  assert.match(DOCUMENT_TOOL.function.description,/60,000 characters/);
});

// The intended path: the main agent hands a Wiki question to the OpenWiki
// agent and receives its answer. Desktop had only a word search for the main
// agent and an investigation of files the model had to choose.
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
function openwikiAgent(seen){
  return async(messages,tools)=>{
    const prompt=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    if(prompt.includes('Plan OpenWiki research')){seen.planner=JSON.parse(messages.find(message=>message.role==='user').content);return {content:JSON.stringify({mode:'focused',questions:['How is part 1 operated?']})};}
    if(prompt.includes('Synthesize')){const ids=JSON.parse(messages.at(-1).content).evidence.map(item=>item.id);return {content:JSON.stringify({status:'complete',answer:'Part 1 is operated as described on its page.',findings:[{text:'How part 1 is operated.',citations:ids.slice(0,3)}],uncertainties:[]})};}
    seen.childTools=tools.map(tool=>tool.function.name).sort();
    const reads=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
    // search_wiki returns a list of candidate ranges; read_wiki returns one excerpt with its evidence id.
    const found=reads.find(item=>Array.isArray(item));
    if(!found)return call('search_wiki',{query:'operated part 1'});
    const read=reads.find(item=>!Array.isArray(item)&&item.id&&item.excerpt);
    if(!read)return call('read_wiki',{documentId:found[0].documentId,start:0,length:6000});
    return {content:JSON.stringify({status:'complete',answer:'Part 1 is operated as described.',findings:[{text:'How part 1 is operated.',citations:[read.id]}],uncertainties:[]})};
  };
}

test('a Wiki question is handed to the OpenWiki agent and its cited answer comes back',async t=>{
  const service=await wiki(t,{language:'en'}),seen={},research=openwikiAgent(seen);let leader=0,delivered;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){
    const first=messages[0].content;
    if(!first.startsWith('You are Nubi Desktop'))return research(messages,tools);
    if(leader++===0)return call('ask_openwiki',{wiki:'external',question:'1번 부분은 어떻게 운영해? (Wiki language: en)'});
    delivered=JSON.parse(messages.findLast(message=>message.role==='tool').content);
    return {content:'1번 부분의 운영 방법을 확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'1번 부분은 어떻게 운영해?'}),{runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  assert.equal(delivered.dataKind,'openwiki_reference');assert.equal(delivered.status,'complete');assert.equal(delivered.advisory,true);
  assert.match(delivered.answer,/Part 1/);assert.ok(delivered.findings[0].citations.length>0);
  assert.equal(delivered.wiki,'external');assert.match(delivered.wikiId,/^external:/);
  assert.equal(delivered.coverage.documents,4,'the whole Wiki, without the model choosing files');
  assert.ok(delivered.evidence.length>0&&delivered.evidence.every(item=>item.path.startsWith('openwiki/')));
  assert.deepEqual(seen.planner.catalog.map(item=>item.title),['home.md','page-00.md','page-01.md','page-02.md']);
  assert.deepEqual(seen.childTools,['read_wiki','search_wiki'],'the OpenWiki agent has no project, edit or app tools');
  assert.match(seen.planner.question,/1번 부분은 어떻게 운영해\?/);
  const {readRunMetrics}=await import('../runtime/run-metrics.mjs'),{summary}=readRunMetrics(service.store,{taskId:task.id,runId});
  assert.ok(summary.byPurpose.analysis.calls>=3,'OpenWiki agent calls are counted apart from the main agent');
  assert.equal(summary.byTool.ask_openwiki.calls,2,'the pages are supplied before the research and compared after it');
  assert.ok(summary.byTool.ask_openwiki.resultCharacters<100,'page text goes to the OpenWiki agent, not into the measured model context');
});

test('a project without a Wiki does not offer the OpenWiki agent',async t=>{
  const {service,root}=await fixture(t);await git(root,['rm','-q','-r','openwiki']);await git(root,['commit','-qm','no wiki']);let names;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){names??=tools.map(item=>item.function.name);return {content:'확인했습니다.',calls:[]};}};
  const task=await service.createTask({request:'q'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(!names.includes('ask_openwiki'));assert.ok(names.includes('wiki_query'),'docs and specifications remain searchable');
});

// Found while reading the delegation path (2026-09-29): the host recorded the
// pages it supplied as the main agent's own evidence, and the answer came
// back as one entry of 18,836 characters. A review can use no entry above
// 12,000 characters. The cited text is what later steps work from, so it is
// divided for the review, not cut.
const filler='Background line about unrelated matters.\n'.repeat(200),fact='The nightly export is operated by the export worker at 02:00.';
async function delegated(t,{pages=1,contextLength=200000}={}){
  const {service,root}=await fixture(t,{scriptedReview:true});
  await mkdir(path.join(root,'openwiki','operations'),{recursive:true});
  for(let page=0;page<pages;page++)await writeFile(path.join(root,'openwiki','operations',`export-${page}.md`),`# Export ${page}\n\n`+filler+fact+'\n'+filler);
  await git(root,['add','-A']);await git(root,['commit','-qm','long pages']);
  let leader=0,delivered,reviewed,compactions=0;
  const research=async messages=>{
    const prompt=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    if(prompt.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'focused',questions:['When is the nightly export operated?']})};
    if(prompt.includes('Synthesize')){const ids=JSON.parse(messages.at(-1).content).evidence.map(item=>item.id);return {content:JSON.stringify({status:'complete',answer:'야간 내보내기는 02:00에 내보내기 작업자가 운영합니다.',findings:[{text:'야간 내보내기는 02:00에 운영합니다.',citations:ids}],uncertainties:[]})};}
    const results=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
    const found=results.find(item=>Array.isArray(item));
    if(!found)return call('search_wiki',{query:'nightly export worker'});
    // Two researchers work on one question. With two pages each reads its own page, in three parts.
    const second=messages.some(message=>message.role==='user'&&String(message.content).includes('Independently search'));
    const ranges=results.filter(item=>!Array.isArray(item)&&item.id&&item.excerpt),title=`export-${pages>1&&second?1:0}.md`;
    if(ranges.length<3)return call('read_wiki',{documentId:found.find(item=>item.title===title).documentId,start:ranges.length*6000,length:6000});
    return {content:JSON.stringify({status:'complete',answer:'야간 내보내기는 02:00에 내보내기 작업자가 운영합니다.',findings:[{text:'야간 내보내기는 02:00에 운영합니다.',citations:ranges.map(item=>item.id)}],uncertainties:[]})};
  };
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength}]}),dispose(){},async complete(messages,tools){
    const first=messages[0].content;
    if(first.startsWith(REVIEW_PROMPT)){reviewed=JSON.parse(messages[1].content);return fixtureReview(messages);}
    if(first.startsWith('Summarize conversation')){compactions++;return {content:JSON.stringify({goal:'야간 내보내기 운영 확인',constraints:[],decisions:[],completed:['OpenWiki 답을 받았다: 02:00에 내보내기 작업자가 운영'],pending:[],references:['openwiki/operations/export-0.md']}),calls:[]};}
    if(!first.startsWith('You are Nubi Desktop'))return research(messages,tools);
    if(leader++===0)return call('ask_openwiki',{wiki:'external',question:'야간 내보내기는 언제 어떻게 운영해? (Wiki language: en)'});
    delivered??=messages.findLast(message=>message.role==='tool').content;
    return {content:'야간 내보내기는 02:00에 내보내기 작업자가 운영합니다.',calls:[]};
  }};
  const task=await service.createTask({request:'야간 내보내기는 언제 어떻게 운영해?'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  return {answer:JSON.parse(delivered),characters:delivered.length,reviewed,compactions};
}

test('the main agent receives the cited text of the OpenWiki answer in full',async t=>{
  const {answer,characters}=await delegated(t);
  // Found in B3 case K1: the answer was right and named no source, because a finding carried only evidence ids.
  assert.deepEqual(answer.desktop.sources,['openwiki/operations/export-0.md']);
  assert.match(answer.desktop.note,/Name the pages of sources in the answer/);
  // User decision 2026-09-29: what the OpenWiki agent returns is passed on as it came.
  assert.deepEqual(Object.keys(answer.findings[0]).sort(),['citations','text']);
  assert.ok(answer.evidence.every(item=>/^e_\d+_\d+_\d+$/.test(item.id)&&!('evidenceId' in item)),'ids of the OpenWiki agent');
  assert.match(answer.instruction,/^Independent OpenWiki advice/,'the instruction of the shared protocol');
  assert.equal(answer.dataKind,'openwiki_reference');assert.equal(answer.status,'complete');
  assert.equal(answer.evidence.length,3);assert.ok(characters>16000,'nothing was cut: '+characters);
  assert.ok(answer.evidence.every(item=>!item.excerptTruncated&&item.excerpt.length===item.end-item.start));
  assert.ok(answer.evidence.some(item=>item.excerpt.includes(fact)),'a Korean finding keeps its English source');
  assert.equal('omittedExcerpts' in answer.desktop,false);
});

test('the review receives the answer and every cited text as entries it can use',async t=>{
  const {reviewed}=await delegated(t);
  const entries=reviewed.evidence.filter(entry=>entry.tool==='ask_openwiki'),texts=reviewed.evidence.filter(entry=>entry.tool==='openwiki_excerpt');
  assert.equal(entries.length,1,'the answer, once');assert.equal(texts.length,3,'one entry for each cited text');
  for(const entry of [...entries,...texts]){assert.equal(entry.usable,true,entry.id);assert.equal(entry.truncated,false,entry.id);}
  assert.equal(entries[0].result.dataKind,'openwiki_reference');assert.match(entries[0].result.answer,/02:00/);
  assert.deepEqual(entries[0].result.evidence.map(item=>Object.keys(item).sort()),Array(3).fill(['end','hash','id','path','start','unit']),'the answer entry names its sources; their text follows in its own entries');
  assert.deepEqual(texts.map(entry=>entry.result.id).sort(),entries[0].result.evidence.map(item=>item.id).sort());
  assert.ok(texts.some(entry=>entry.result.excerpt.includes(fact)));
  assert.ok(texts.every(entry=>entry.result.path.startsWith('openwiki/operations/export-')&&entry.result.excerpt.length===entry.result.end-entry.result.start));
  assert.ok(reviewed.evidence.every(entry=>!entry.result?.documents),'the supplied pages are not recorded as observations');
});

// User decision 2026-09-29: pass on as much of the original text as the model
// can take. Automatic compaction handles a conversation that grows too long.
test('six cited texts reach the main agent in full when the model can take them',async t=>{
  const {answer,characters,reviewed}=await delegated(t,{pages:2});
  assert.equal(answer.evidence.length,6);assert.ok(characters>32000,'nothing was cut: '+characters);
  assert.ok(answer.evidence.every(item=>!item.excerptTruncated&&item.excerpt.length===item.end-item.start));
  assert.equal('omittedExcerpts' in answer.desktop,false);
  assert.equal(reviewed.evidence.filter(entry=>entry.tool==='openwiki_excerpt'&&entry.usable).length,6);
});

test('only text that one request of the model cannot hold is shortened, and the answer says so',async t=>{
  // 20,000 tokens of context: the fixed request and six texts of about 1,500 tokens each do not fit together.
  // A small window offers fewer tools since B8, so the window is smaller than the 24,000 it was.
  const {answer}=await delegated(t,{pages:2,contextLength:20000});
  assert.equal(answer.evidence.length,6);
  const whole=answer.evidence.filter(item=>!item.excerptTruncated),cut=answer.evidence.filter(item=>item.excerptTruncated);
  assert.ok(whole.length>=1&&cut.length>=1,`whole ${whole.length}, shortened ${cut.length}`);
  assert.deepEqual(answer.evidence.map(item=>!!item.excerptTruncated),[...whole.map(()=>false),...cut.map(()=>true)],'texts stay whole in citation order');
  for(const item of cut){assert.ok(item.excerpt.length<=800);assert.ok(item.excerptStart>=item.start&&item.excerptEnd<=item.end);}
  assert.equal(answer.desktop.omittedExcerpts,cut.length);assert.match(answer.desktop.note,/excerptTruncated/);
});

// Found in B3 case C1: the agent asked the OpenWiki agent, then a change plan
// that cited the answer was refused, and it searched the same Wiki again with
// wiki_query only to obtain an evidence ID.
test('a change plan can cite the text that the OpenWiki agent returned',async t=>{
  const service=await wiki(t,{language:'en'}),research=openwikiAgent({});let leader=0,answer,planned,hashOfTarget;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){
    const first=messages[0].content;
    if(!first.startsWith('You are Nubi Desktop'))return research(messages,tools);
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(leader++){
      case 0:return call('ask_openwiki',{wiki:'external',question:'How is part 1 operated? (Wiki language: en)'});
      case 1:answer=result;return call('read_source',{path:'app.txt'});
      case 2:hashOfTarget=result.hash;return call('record_change_plan',{summary:'Update observed text',requirements:[{id:'R1',text:'Follow the operation page',evidenceIds:[answer.evidence[0].id]}],targets:[{path:'app.txt',reason:'Observed behavior',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'Assert expected stored content'}],assumptions:[]});
      case 3:planned=result;return {content:'계획을 기록했습니다.',calls:[]};
      default:return {content:'계획을 기록했습니다.',calls:[]};
    }
  }};
  const task=await service.createTask({request:'1번 부분 운영 방식에 맞게 app.txt를 고쳐 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const cited=answer.evidence[0];
  // Found in B3 and B5 cases C1 and C2: the plan cited the id that the answer gave and was refused.
  assert.match(cited.id,/^e_\d+_\d+_\d+$/);assert.equal(cited.path,'openwiki/operations/page-01.md');
  assert.match(answer.desktop.note,/record_change_plan/);
  assert.notEqual(planned.error,'wiki_evidence_required',JSON.stringify(planned).slice(0,300));
  assert.ok(planned.id,'the plan was recorded: '+JSON.stringify(planned).slice(0,300));
  const stored=service.task(task.id).changePlan.wikiEvidence;
  assert.equal(stored.length,1);assert.match(stored[0].evidenceId,/^wiki:[0-9a-f]{24}$/,'the host keeps its own identity of the text');
  assert.equal(stored[0].path,'openwiki/operations/page-01.md');assert.equal(typeof stored[0].freshness,'string');
  assert.ok(hashOfTarget);
});

// Found in B3 case S1: the question was about a constant in the code. The Wiki
// did not hold it, the main agent reported that it was not found, and the
// review accepted the report. No source file had been searched.
test('an OpenWiki answer that does not settle the question sends the main agent to the source',async()=>{
  const {wikiAnswer}=await import('../runtime/wiki-evidence.mjs'),{REVIEW_PROMPT}=await import('../runtime/result-review.mjs');
  const base={dataKind:'openwiki_reference',wikiId:'external:x',wiki:'external',advisory:true,coverage:{mode:'focused'},evidence:[]};
  const missing=wikiAnswer({...base,status:'partial',answer:'The Wiki does not state the constant.',findings:[],uncertainties:['No page names the constant.']}).delivered;
  assert.match(missing.desktop.note,/The Wiki did not settle this question/);assert.match(missing.desktop.note,/source_search/);assert.match(missing.desktop.note,/before reporting that it is not found/);
  const given={...base,status:'complete',answer:'The port is 53682.',findings:[{text:'The port is 53682.',citations:['e_1']}],uncertainties:[],instruction:'Independent OpenWiki advice.',evidence:[{id:'e_1',path:'openwiki/a.md',hash:'h',start:0,end:4,unit:'utf16',excerpt:'port'}]};
  const settled=wikiAnswer(given).delivered;
  assert.doesNotMatch(settled.desktop.note,/did not settle/);
  const {desktop,...rest}=settled;assert.deepEqual(rest,given,'nothing of the answer is changed');
  assert.match(REVIEW_PROMPT,/for a question about code or behavior that includes the source, not only the Wiki/);
});

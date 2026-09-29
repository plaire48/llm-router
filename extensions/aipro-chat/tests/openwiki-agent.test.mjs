import {createWikiQuestionSearch} from '../openwiki-retrieval.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {delegateWikiQuestion, NubiOpenWikiModel, createResearchProgress} from '../openwiki-agent.js';
import {openWikiTools} from '../openwiki-contract.js';
import {createQuestionCorpus, questionWindows, evidencePreview, evidenceReader, runWikiQuestion} from '../../../packages/openwiki/src/agent/wiki-question.ts';

const doc = (text='Vacation allowance is 18 days.', extra={}) => ({id:'doc',kind:'site',path:'https://example.test/a',title:'Policy',text,version:'1',...extra});
const packet = (documents=[doc()], extra={}) => ({wikiId:'internal:test',sourceComplete:true,documents,...extra});
const report = (ids, extra={}) => ({status:'complete',answer:'18 days',findings:[{text:'18 days',citations:ids.slice(0,3)}],uncertainties:[],...extra});
function model({mode='focused',seen=[],skip=false,forged=false}={}) {
  return async(messages,tools,scope)=>{
    seen.push({messages,tools,scope});
    assert(tools.every(tool=>['read_wiki','search_wiki'].includes(tool.function.name)), 'No shell, filesystem mutations, browser tools or recursive delegates');
    const last=messages.at(-1), system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    if(system.includes('Plan OpenWiki research')) return {content:JSON.stringify({mode,questions:['How many vacation days?']})};
    if(system.includes('Synthesize')) {
      const data=JSON.parse(last.content);
      return {content:JSON.stringify(data.evidence.length ? report(data.evidence.slice(0,2).map(row=>row.id)) : {status:'blocked',answer:'No evidence',findings:[],uncertainties:['Missing evidence']})};
    }
    if(system.includes('Repair the previous')) return {content:JSON.stringify(report(['invented']))};
    const user=messages.find(m=>m.role==='user'), data=JSON.parse(user.content), range=data.assignment.range;
    const reads=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).filter(row=>row.id);
    const start=reads.at(-1)?.end ?? range?.start ?? 0;
    if(reads.length && (!range || skip || start>=range.end)) return {content:JSON.stringify(report(forged ? ['invented'] : reads.map(row=>row.id)))};
    return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_wiki',arguments:JSON.stringify({documentId:data.assignment.documentIds[0],start,length:6000})}}]};
  };
}
const run=(snapshot, options={})=>delegateWikiQuestion({wiki:snapshot.wikiId.startsWith('internal:')?'internal':'external',question:'How many vacation days?'},
  {modelId:'QWEN3.8-27B-FP8-256K',signal:new AbortController().signal,execute:async()=>snapshot,complete:model(),...options});

for (const [name, invalid, reason] of [
  ['malformed JSON', '{"mode":', 'invalid_json'],
  ['invalid schema', '{"mode":"focused","questions":[]}', 'invalid_plan_schema'],
  ['blank subquestion', '{"mode":"focused","questions":["   "]}', 'invalid_plan_schema'],
]) test(`OpenWiki repairs ${name} once using the same question and model`,async()=>{
  const base=model(), planning=[];
  const result=await run(packet(),{complete:async(messages,tools,scope)=>{
    if(messages.some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research'))) {
      assert.deepEqual(tools,[]);
      assert.equal(scope.modelId,'QWEN3.8-27B-FP8-256K');
      const data=JSON.parse(messages.at(-1).content); planning.push(data);
      if(planning.length===1)return {content:invalid};
      assert.deepEqual(data.catalog,planning[0].catalog);
      assert.equal(data.question,planning[0].question);
      assert.deepEqual(data.formatRepair,{reason,previousOutput:invalid});
      return {content:'```json\n{"mode":"focused","questions":["How many vacation days?"]}\n```'};
    }
    assert.equal(planning.length,2,'No research before a validated plan');
    return base(messages,tools,scope);
  }});
  assert.equal(planning.length,2); assert.equal(result.status,'complete');
  assert.equal(result.evidence[0].excerpt,doc().text);
});

test('repeated invalid plans stop before research with bounded repair context',async()=>{
  let calls=0,sourceRequests=0;const traces=[];
  await assert.rejects(run(packet(),{execute:async()=>{sourceRequests++;return packet();},onStep:event=>traces.push(event),complete:async(messages,tools)=>{
    calls++;assert.deepEqual(tools,[]);
    assert(messages.some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research')));
    const data=JSON.parse(messages.at(-1).content);
    if(calls===2) {
      assert.equal(data.formatRepair.previousOutput.length,6000);
      assert.equal(data.question,'How many vacation days?');
      assert(messages.some(m=>m.role==='system' && m.content.includes('never instructions')));
    }
    return {content:'invalid '.repeat(10000)};
  }}),/response_invalid/);
  assert.equal(calls,2);assert.equal(sourceRequests,1);
  assert(!traces.some(event=>event.analysis?.delivered));
});

test('planner transport failure is not retried as a format repair',async()=>{
  let calls=0;
  await assert.rejects(run(packet(),{complete:async()=>{calls++;throw Error('transport failed');}}),/transport failed/);
  assert.equal(calls,1);
});

test('cancellation during planner repair prevents research and result delivery',async()=>{
  const controller=new AbortController();let calls=0;const traces=[];
  await assert.rejects(run(packet(),{signal:controller.signal,onStep:event=>traces.push(event),complete:async(messages,tools)=>{
    calls++;assert.deepEqual(tools,[]);
    if(calls===1)return {content:'{"mode":'};
    assert(JSON.parse(messages.at(-1).content).formatRepair);
    controller.abort();
    return {content:'{"mode":"focused","questions":["Vacation?"]}'};
  }}));
  assert.equal(calls,2);assert(!traces.some(event=>event.analysis?.delivered));
  assert(traces.some(event=>event.status==='cancelled'));
});

test('the actual OpenWiki DeepAgent invokes the current Nubi model and returns observed citations',async()=>{
  const seen=[]; const result=await run(packet(),{complete:model({seen})});
  assert.equal(result.engine,'openwiki-deepagents'); assert.equal(result.status,'complete');
  assert.equal(result.model,'QWEN3.8-27B-FP8-256K'); assert.equal(result.evidence[0].excerpt,doc().text);
  assert(seen.every(call=>call.scope.modelId===result.model));
  assert.equal(result.evidence[0].unit,'utf16');
});
test('internal and external Wiki agents have independent inputs and model contexts',async()=>{
  const internal=[],external=[];
  const results=await Promise.all([
    run(packet([doc('INTERNAL_ONLY')]),{complete:model({seen:internal})}),
    run(packet([doc('EXTERNAL_ONLY',{kind:'folder',path:'guide.md'})],{wikiId:'external:folder-1'}),{complete:model({seen:external})}),
  ]);
  assert(!JSON.stringify(internal).includes('EXTERNAL_ONLY')); assert(!JSON.stringify(external).includes('INTERNAL_ONLY'));
  assert.notEqual(results[0].wikiId,results[1].wikiId);
});
test('long documents automatically create multiple isolated researchers and read every range',async()=>{
  const source=doc('0123456789'.repeat(5500));
  const result=await run(packet([source]),{complete:model({mode:'comprehensive'})});
  assert.equal(result.coverage.tasks,3); assert.deepEqual(result.coverage.unreadRanges,[]); assert.equal(result.status,'complete');
});
test('a giant line remains addressable beyond the old 40000-character cap',async()=>{
  const source=doc('x'.repeat(1200000)+'TAIL_FACT'); const corpus=await createQuestionCorpus([source]);
  const windows=questionWindows(source); assert.equal(windows.at(-1).end,source.text.length);
  assert.equal(windows.reduce((n,r)=>n+r.end-r.start,0),source.text.length);
  const read=corpus.read('doc',1200000,6000,{documentIds:['doc'],question:'tail'},new Set());
  assert.equal(read.excerpt,'TAIL_FACT'); assert.equal(read.start,1200000);
});
test('incomplete reading and source collection never become complete after synthesis',async()=>{
  const result=await run(packet([doc('x'.repeat(30000))],{sourceComplete:false}),{complete:model({mode:'comprehensive',skip:true})});
  assert.equal(result.status,'partial'); assert.deepEqual(result.coverage.unreadRanges,[]); assert(result.coverage.repairTasks>0); assert.equal(result.coverage.sourceComplete,false);
});
test('fabricated citations cannot escape failed child validation',async()=>{
  const result=await run(packet(),{complete:model({forged:true})});
  assert.equal(result.coverage.failedTasks,1); assert.equal(result.evidence.length,0); assert.notEqual(result.status,'complete');
});
test('changed source is rejected after research rather than returning a stale answer',async()=>{
  let reads=0;
  const result=await run(packet(),{execute:async()=>++reads===1 ? packet() : packet([doc('changed')])});
  assert.equal(result.error,'openwiki_changed');
});
test('cancellation before dispatch performs no model calls',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(run(packet(),{signal:controller.signal,complete:async()=>{calls++;}})); assert.equal(calls,0);
});
test('source scope and tool schema cannot silently combine different Wikis',async()=>{
  await assert.rejects(run(packet([doc('external',{kind:'folder'})])),/openwiki_source_invalid/);
  assert.deepEqual(openWikiTools({internal:true})[0].function.parameters.properties.wiki.enum,['internal']);
  assert.deepEqual(openWikiTools(),[]);
});


test('empty Wiki uses no model calls and synthesis failures retain completed work',async()=>{
  let calls=0;
  const empty=await run(packet([]),{complete:async()=>{calls++;throw Error('should not run');}});
  assert.equal(calls,0); assert.equal(empty.status,'blocked');
  const complete=model();
  const result=await run(packet(),{complete:async(...args)=>{
    if(args[0].some(m=>m.role==='system' && m.content.includes('Synthesize')))throw Error('transport failed');
    return complete(...args);
  }});
  assert.equal(result.status,'partial'); assert.equal(result.evidence.length,1); assert.match(result.uncertainties[0],/Synthesis failed/);
});
test('source changes outside the final citations invalidate the entire result',async()=>{
  let calls=0;
  const snapshot=packet([doc(),doc('old',{id:'other',path:'other.md'})]);
  const result=await run(snapshot,{execute:async()=>++calls===1?snapshot:packet([doc(),doc('new',{id:'other',path:'other.md'})])});
  assert.equal(result.error,'openwiki_changed');
});
test('cancellation during a child propagates and never starts synthesis',async()=>{
  const controller=new AbortController(), complete=model(); let synthesised=false;
  await assert.rejects(run(packet(),{signal:controller.signal,complete:async(...args)=>{
    const system=args[0].filter(m=>m.role==='system').map(m=>m.content).join(' ');
    if(system.includes('Synthesize'))synthesised=true;
    if(!system.includes('Plan OpenWiki research'))controller.abort();
    return complete(...args);
  }}));
  assert.equal(synthesised,false);
});


test('delegated retrieval preserves Markdown text, Korean spacing and long-document tails',()=>{
  const search=createWikiQuestionSearch();
  const docs=[doc('# 인사\n휴가 **신청** 기준은 18일입니다.\n',{id:'policy'}),doc('# Hidden\n<div data-key="secretKeyword"></div>')];
  assert.equal(search('휴가신청',docs)[0].documentId,'policy');
  assert.deepEqual(search('secretKeyword',docs),[]);
  const long=doc('설명\n'.repeat(18000)+'마지막특별규정',{id:'long'});
  const found=search('마지막특별규정',[long]); assert(found.length); assert(found[0].end>40000);
});
test('a model cannot execute the DeepAgents default filesystem tools',async()=>{
  const complete=model();
  const result=await run(packet(),{complete:async(...args)=>{
    if(args[0].some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research')))return complete(...args);
    if(args[0].some(m=>m.role==='system' && m.content.includes('Synthesize')))return complete(...args);
    return {content:'',calls:[{id:'forbidden',function:{name:'write_file',arguments:JSON.stringify({file_path:'/outside',content:'bad'})}}]};
  }});
  assert.equal(result.coverage.failedTasks,1); assert.equal(result.evidence.length,0);
});


test('long supported site URLs remain valid Wiki document IDs',async()=>{
  const url='https://example.test/'+ 'a'.repeat(550);
  const result=await run(packet([doc('policy',{id:url,path:url})]));
  assert.equal(result.status,'complete'); assert.equal(result.evidence[0].documentId,url);
});

test('synthesis receives matching tail text and can re-read only its own evidence',async()=>{
  const text='Unrelated introduction. '.repeat(200)+'SPECIALTAIL allowance is 18 days.';
  const corpus=await createQuestionCorpus([doc(text)]), seen=new Set();
  const entry=corpus.read('doc',0,6000,{documentIds:['doc'],question:'allowance'},seen);
  assert(!entry.excerpt.slice(0,800).includes('SPECIALTAIL'),'old prefix preview loses the claim');
  const preview=evidencePreview(entry,'SPECIALTAIL allowance');
  assert(preview.excerpt.includes('SPECIALTAIL')); assert.equal(preview.excerpt,text.slice(preview.excerptStart,preview.excerptEnd));
  const reader=evidenceReader(corpus.evidence,seen);
  assert.equal((await reader.invoke({evidenceId:entry.id,length:6000})).excerpt,text);
  assert.equal((await reader.invoke({evidenceId:'another-wiki-id',length:6000})).error,'evidence_unavailable');
  assert.equal((await reader.invoke({evidenceId:entry.id,start:entry.end,length:1})).error,'range_unavailable');
});
test('long-document recovery reads only remaining ranges in fresh child contexts',async()=>{
  const calls=[];
  const result=await run(packet([doc('x'.repeat(55000))]),{complete:model({mode:'comprehensive',skip:true,seen:calls})});
  assert.equal(result.status,'complete'); assert.deepEqual(result.coverage.unreadRanges,[]); assert(result.coverage.repairTasks>=6);
  const starts=calls.filter(c=>c.messages.at(-1).role==='user' && c.messages[0].content.includes("OpenWiki's read-only evidence researcher") && !c.messages[0].content.includes('Synthesize'))
    .map(c=>JSON.parse(c.messages.at(-1).content).assignment?.range?.start).filter(n=>n!==undefined);
  assert.equal(new Set(starts).size,starts.length,'successful ranges are not replayed');
});
test('no progress stops gap recovery and preserves explicit remaining work',async()=>{
  const base=model({mode:'comprehensive'});
  const result=await run(packet([doc('x'.repeat(24000))]),{complete:async(...args)=>{
    if(args[0].some(m=>m.role==='system' && (m.content.includes('Plan OpenWiki research') || m.content.includes('Synthesize'))))return base(...args);
    return {content:JSON.stringify({status:'blocked',answer:'Unable to read',findings:[],uncertainties:['No source read']})};
  }});
  assert.equal(result.coverage.repairTasks,1); assert.equal(result.coverage.unreadRanges[0].end,24000); assert.notEqual(result.status,'complete');
});
test('intermediate synthesis failure cannot disappear in a later successful reduction',async()=>{
  const base=model({mode:'comprehensive'}); let syntheses=0;
  const result=await run(packet([doc('x'.repeat(24000*6))]),{complete:async(...args)=>{
    if(args[0].some(m=>m.role==='system' && m.content.includes('Synthesize')) && ++syntheses===1)throw Error('temporary synthesis failure');
    return base(...args);
  }});
  assert(syntheses>1); assert.equal(result.status,'partial'); assert.equal(result.coverage.synthesisFailures,1);
  assert(result.uncertainties.some(text=>text.includes('Synthesis failed')));
});

test('the actual synthesis DeepAgent can load omitted context through its evidence tool',async()=>{
  const base=model(); let fetched=false;
  const result=await run(packet([doc('background '.repeat(450)+'18 days')]),{complete:async(messages,tools,scope)=>{
    if(!messages.some(m=>m.role==='system' && m.content.includes('Synthesize')))return base(messages,tools,scope);
    const last=messages.at(-1);
    if(last.role==='tool') {const source=JSON.parse(last.content);assert(source.excerpt.endsWith('18 days'));fetched=true;return {content:JSON.stringify(report([source.id]))};}
    const source=JSON.parse(last.content).evidence[0];
    return {content:'',calls:[{id:'synthesis-read',function:{name:'read_wiki',arguments:JSON.stringify({evidenceId:source.id,length:6000})}}]};
  }});
  assert(fetched);assert.equal(result.status,'complete');
});
test('many repaired contexts stay in groups of four and within two concurrent model calls',async()=>{
  const base=model({mode:'comprehensive',skip:true});let active=0,peak=0,reducers=0;
  const result=await run(packet([doc('x'.repeat(30000))]),{complete:async(messages,tools,scope)=>{
    active++;peak=Math.max(peak,active);
    try {
      await new Promise(resolve=>setTimeout(resolve,1));
      if(messages.some(m=>m.role==='system' && m.content.includes('Synthesize'))) {
        const input=JSON.parse(messages.at(-1).content);assert(input.reports.length<=4);reducers++;
      }
      const response=await base(messages,tools,scope);
      for(const call of response.calls || [])if(call.function.name==='read_wiki') {
        const args=JSON.parse(call.function.arguments);args.length=1000;call.function.arguments=JSON.stringify(args);
      }
      return response;
    } finally {active--;}
  }});
  assert.equal(result.status,'complete');assert.equal(peak,2);assert(reducers>2);assert.deepEqual(result.coverage.unreadRanges,[]);
});

test('candidate retrieval reserves space for another matching source',()=>{
  const search=createWikiQuestionSearch();
  const results=search('출장 규정',[doc(('출장 규정은 일반 한도를 따릅니다.\n').repeat(1500),{id:'general',title:'출장 규정'}),
    doc('# 예외\n해외 출장 규정은 별도 심사를 따릅니다.',{id:'exception',title:'예외'})]);
  assert(results.slice(0,8).some(item=>item.documentId==='exception'));
  assert.equal(results[0].documentId,'general');
});

test('delegated search preserves distant table headers as readable source locators',async()=>{
  const text='# Expense policy\n\n| Item | Allowance (KRW, per day) |\n| --- | --- |\n'+
    Array.from({length:500},(_,i)=>`| Standard${i} | 100 |\n`).join('')+'| SPECIALDESTINATION | 270 |\n';
  const corpus=await createQuestionCorpus([doc(text)],createWikiQuestionSearch()),seen=new Set();
  const tools=corpus.tools({documentIds:['doc'],question:'SPECIALDESTINATION'},seen);
  const hits=JSON.parse(await tools[0].invoke({query:'SPECIALDESTINATION'}));
  assert(hits[0].start>6000);
  const header=hits[0].contextRanges.find(item=>item.kind==='table_header');
  assert(header && header.end<hits[0].start);
  assert.equal(seen.size,0,'search/context locators are not observations');
  const evidence=await tools[1].invoke({documentId:'doc',start:header.start,length:header.end-header.start});
  assert(evidence.excerpt.includes('KRW, per day'));assert(seen.has(evidence.id));
  assert.equal(evidence.excerpt,text.slice(header.start,header.end));
  const scoped=corpus.tools({documentIds:['doc'],question:'SPECIALDESTINATION',range:{documentId:'doc',start:6000,end:text.length}},new Set());
  const limited=JSON.parse(await scoped[0].invoke({query:'SPECIALDESTINATION'}));
  assert(limited[0].contextUnavailable);assert.deepEqual(limited[0].contextRanges,[]);
  assert.equal((await scoped[1].invoke({documentId:'doc',start:header.start,length:100})).error,'range_unavailable');
});
test('injected retrieval cannot leak other documents or invalid context ranges',async()=>{
  const corpus=await createQuestionCorpus([doc('public'),doc('PRIVATE',{id:'other'})],()=>[
    {documentId:'other',start:0,end:7}, {documentId:'doc',start:NaN,end:6},
    {documentId:'doc',start:0,end:6,contextRanges:[{kind:'heading',start:-1,end:2},{kind:'table_header',start:0,end:999}],extra:'UNTRUSTED_METADATA'},
  ]);
  const hits=JSON.parse(await corpus.tools({documentIds:['doc'],question:'public'},new Set())[0].invoke({query:'public'}));
  assert.equal(hits.length,1);assert.equal(hits[0].documentId,'doc');assert(hits[0].contextUnavailable);
  assert.deepEqual(hits[0].contextRanges,[]);assert(!JSON.stringify(hits).includes('UNTRUSTED_METADATA'));
});

test('a late assigned read automatically observes its own source header without opening general outside reads',async()=>{
  const text='# 출장 기준\n\n| 지역 | 한도 (원/일) |\n| --- | --- |\n'+'| 국내 | 100 |\n'.repeat(2400)+'| 특별지역 | 270 |\n';
  const source=doc(text),corpus=await createQuestionCorpus([source,doc('PRIVATE_OTHER_WIKI',{id:'other'})],createWikiQuestionSearch());
  const start=text.indexOf('| 특별지역'),seen=new Set();
  const assignment={documentIds:['doc'],question:'한도',range:{documentId:'doc',start,end:text.length}};
  const result=corpus.read('doc',start,6000,assignment,seen);
  const header=result.contextEvidence.find(entry=>entry.contextKind==='table_header');
  assert(header.excerpt.includes('원/일'));assert.equal(header.hash,result.hash);assert.equal(header.documentId,'doc');
  assert.equal(header.excerpt,text.slice(header.start,header.end));assert(seen.has(header.id));
  assert(!JSON.stringify(result).includes('PRIVATE_OTHER_WIKI'));
  assert(result.contextEvidence.reduce((n,e)=>n+e.excerpt.length,0)<=600);
  assert.equal(corpus.read('doc',0,6000,assignment,seen).error,'range_unavailable');
  assert.equal(result.nextStart,null);
});
test('structural evidence is bounded and copied from the snapshot, and parser failure preserves the body',async()=>{
  const text='ORIGINAL '.repeat(1000),search=()=>[];
  search.context=()=>({ranges:[{kind:'heading',start:-1,end:2},{kind:'table_header',start:0,end:900,text:'FORGED',documentId:'other'}]});
  const corpus=await createQuestionCorpus([doc(text)],search),seen=new Set(),assignment={documentIds:['doc'],question:'x'};
  const result=corpus.read('doc',7000,100,assignment,seen);
  assert.equal(result.contextEvidence.length,1);assert.equal(result.contextEvidence[0].excerpt,text.slice(0,600));
  assert(result.contextTruncated);assert(result.contextEvidence[0].truncated);assert(!JSON.stringify(result).includes('FORGED'));
  search.context=()=>{throw Error('parse failure');};
  const failed=corpus.read('doc',7000,100,assignment,new Set());
  assert.equal(failed.excerpt,text.slice(7000,7100));assert(failed.contextTruncated);assert.deepEqual(failed.contextEvidence,[]);
});
test('comprehensive DeepAgents receive source units across document windows and retain header citations',async()=>{
  const source=doc('# Expense limits\n\n| Location | Allowance (KRW per day) |\n| --- | --- |\n'+'| Standard | 100 |\n'.repeat(3000));
  const base=model({mode:'comprehensive'});let lateReads=0,headerId;
  const result=await run(packet([source]),{complete:async(messages,tools,scope)=>{
    const last=messages.at(-1),system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    if(last.role==='tool' && !system.includes('Synthesize')) {
      const read=JSON.parse(last.content);
      if(read.start>=24000){const header=read.contextEvidence.find(e=>e.contextKind==='table_header');assert(header.excerpt.includes('KRW per day'));headerId=header.id;lateReads++;}
    }
    const response=await base(messages,tools,scope);
    if(headerId && response.content && !system.includes('Plan OpenWiki research')) {
      const output=JSON.parse(response.content);
      const available=system.includes('Synthesize') ? JSON.parse(last.content).evidence.map(e=>e.id) : messages.filter(m=>m.role==='tool').flatMap(m=>JSON.parse(m.content).contextEvidence?.map(e=>e.id) || []);
      if(available.includes(headerId)) output.findings[0].citations=[...new Set([...output.findings[0].citations.slice(0,2),headerId])];
      response.content=JSON.stringify(output);
    }
    return response;
  }});
  assert(lateReads>0);assert.equal(result.status,'complete');assert.deepEqual(result.coverage.unreadRanges,[]);
  assert(result.evidence.some(e=>e.id===headerId && e.excerpt.includes('KRW per day')));
});
test('reused search caches invalidate source text and structural context together',async()=>{
  const search=createWikiQuestionSearch(),old=doc('# OLDHEADER\n'+'oldvalue '.repeat(1000)),current=doc('# NEWHEADER\n'+'newvalue '.repeat(1000));
  assert(search('oldvalue',[old]).length);
  assert.deepEqual(search('oldvalue',[current]),[]);assert(search('newvalue',[current]).length);
  const corpus=await createQuestionCorpus([current],search);
  const result=corpus.read('doc',6000,100,{documentIds:['doc'],question:'new'},new Set());
  assert(result.contextEvidence.some(e=>e.excerpt.includes('NEWHEADER')));assert(!JSON.stringify(result).includes('OLDHEADER'));
});

test('context outside a task does not enlarge its coverage or recovery assignment',async()=>{
  const calls=[],signal=new AbortController().signal,search=()=>[];
  search.context=()=>({ranges:[{kind:'table_header',start:30000,end:30600}]});
  const result=await runWikiQuestion({question:'Read all',documents:[doc('x'.repeat(48000))],sourceComplete:true},{
    signal,modelId:'fixture',search,model:new NubiOpenWikiModel({signal,modelId:'fixture',taskId:'test',complete:model({mode:'comprehensive',skip:true,seen:calls})}),
  });
  const ranges=calls.filter(c=>c.messages.at(-1).role==='user' && c.messages[0].content.includes("OpenWiki's read-only evidence researcher") && !c.messages[0].content.includes('Synthesize'))
    .map(c=>JSON.parse(c.messages.at(-1).content).assignment?.range).filter(Boolean);
  assert(ranges.length>2);
  assert(ranges.filter(r=>r.start<24000).every(r=>r.end<=24000),'supplemental header does not extend the first task');
  assert.equal(result.status,'complete');assert.deepEqual(result.coverage.unreadRanges,[]);
});

test('hierarchical synthesis recovers omitted descendant findings and uncertainties without crossing branches',async()=>{
  const documents=Array.from({length:17},(_,i)=>doc(i===3?'RAREEXCEPTION requires separate approval':i===16?'OTHERBRANCH ordinary policy':`General policy ${i}`,{id:`doc${i}`}));
  const base=model({mode:'comprehensive'});let branchIsolated=false,recoveredNote=false,recoveredSource=false,recoveredUncertainty=false;
  const result=await run(packet(documents),{complete:async(messages,tools,scope)=>{
    const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),last=messages.at(-1);
    if(!system.includes('Synthesize')) {
      if(last.role==='tool') {
        const read=JSON.parse(last.content);
        return {content:JSON.stringify({status:'complete',answer:read.excerpt,findings:[{text:read.excerpt,citations:[read.id]}],uncertainties:read.excerpt.includes('RAREEXCEPTION')?['OPENQUESTION: confirm effective date']:[]})};
      }
      return base(messages,tools,scope);
    }
    const input=JSON.parse(messages.find(m=>m.role==='user').content);
    const call=(id,name,args)=>({content:'',calls:[{id,function:{name,arguments:JSON.stringify(args)}}]});
    if(input.reports.length===4) {
      if(last.role==='user')return call('branch-check','search_wiki',{query:'OTHERBRANCH'});
      assert.deepEqual(JSON.parse(last.content),[]);branchIsolated=true;
      // Intentionally drop the exception and its uncertainty from the summary.
      return {content:JSON.stringify(report([input.evidence[0].id],{answer:'General rules',findings:[{text:'General rules',citations:[input.evidence[0].id]}]}))};
    }
    if(input.reports.length===1)return base(messages,tools,scope);
    assert.equal(input.reports.length,2);
    assert(!JSON.stringify(input.reports).includes('RAREEXCEPTION'));
    assert(!JSON.stringify(input.evidence).includes('RAREEXCEPTION'));
    if(last.role==='user')return call('uncertainty-search','search_wiki',{query:'OPENQUESTION'});
    if(last.tool_call_id==='uncertainty-search') {
      const hits=JSON.parse(last.content);assert(hits.some(h=>h.kind==='uncertainty' && h.text.includes('effective date')));recoveredUncertainty=true;
      return call('exception-search','search_wiki',{query:'RAREEXCEPTION'});
    }
    if(last.tool_call_id==='exception-search') {
      const hit=JSON.parse(last.content).find(h=>h.kind==='finding');assert(hit.text.includes('RAREEXCEPTION'));recoveredNote=true;
      return call('exception-read','read_wiki',{evidenceId:hit.citations[0],length:6000});
    }
    const source=JSON.parse(last.content);assert(source.excerpt.includes('separate approval'));recoveredSource=true;
    return {content:JSON.stringify(report([source.id],{answer:source.excerpt,findings:[{text:source.excerpt,citations:[source.id]}],uncertainties:['Effective date still needs confirmation']}))};
  }});
  assert(branchIsolated && recoveredNote && recoveredSource && recoveredUncertainty);
  assert(result.evidence.some(e=>e.documentId==='doc3'));assert(result.findings.some(f=>f.text.includes('RAREEXCEPTION')));
});

for(const query of ['TARGETPHRASE','ZZZMISSING']) test(`research search survives the actual model transport: ${query}`,async()=>{
  const base=model();let observed=false;
  const result=await run(packet([doc('TARGETPHRASE policy requires review')]),{complete:async(messages,tools,scope)=>{
    const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),last=messages.at(-1);
    if(system.includes('Plan OpenWiki research') || system.includes('Synthesize'))return base(messages,tools,scope);
    if(last.role==='user')return {content:'',calls:[{id:'research-search',function:{name:'search_wiki',arguments:JSON.stringify({query})}}]};
    if(last.tool_call_id==='research-search') {
      const hits=JSON.parse(last.content);assert(Array.isArray(hits));observed=true;
      if(query==='ZZZMISSING') {assert.deepEqual(hits,[]);return {content:JSON.stringify({status:'blocked',answer:'No match found',findings:[],uncertainties:['Search alone does not prove absence']})};}
      assert.equal(hits[0].documentId,'doc');
      return {content:'',calls:[{id:'research-read',function:{name:'read_wiki',arguments:JSON.stringify({documentId:hits[0].documentId,start:hits[0].start,length:6000})}}]};
    }
    const read=JSON.parse(last.content);assert(read.excerpt.includes('TARGETPHRASE'));
    return {content:JSON.stringify(report([read.id]))};
  }});
  assert(observed);assert.equal(result.status,query==='ZZZMISSING'?'blocked':'complete');
});

for (const failure of [
  {message:'unauthorized',status:401}, {message:'forbidden',status:403},
  {message:'unauthorized'}, {message:'forbidden'}, {message:'no_credential'}, {message:'expired_token'},
]) test(`Wiki authentication failure stops remaining research (${failure.message}/${failure.status || 'stream'})`,async()=>{
  let calls=0,sourceReads=0;const phases=[];
  const auth=Object.assign(new Error(failure.message),failure);
  const snapshot=packet(Array.from({length:6},(_,i)=>doc('source',{id:`doc-${i}`})));
  await assert.rejects(run(snapshot,{execute:async()=>{sourceReads++;return snapshot;},onStep:step=>phases.push(step),complete:async messages=>{
    calls++;
    if(messages.some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research')))return {content:JSON.stringify({mode:'comprehensive',questions:['Read all documents']})};
    throw auth;
  }}),error=>error.message===auth.message && error.status===auth.status);
  assert(calls<=3,`Only planner and at most two already-started researchers, got ${calls}`);
  assert.equal(sourceReads,1,'No stale-result reread after authentication failure');
  assert(!phases.some(step=>step.analysis?.delivered));
});

test('Wiki authentication aborts an in-flight sibling without cancelling another Wiki or the parent',async()=>{
  const parent=new AbortController(),auth=Object.assign(new Error('unauthorized'),{status:401});
  let releasePeer,children=0,peerAborted=false,timer;
  const peerStarted=new Promise(resolve=>{releasePeer=resolve;});
  const snapshot=packet(Array.from({length:6},(_,i)=>doc('source',{id:`parallel-${i}`})));
  const failing=run(snapshot,{signal:parent.signal,complete:async(messages,_tools,scope)=>{
    if(messages.some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research')))return {content:JSON.stringify({mode:'comprehensive',questions:['Read all']})};
    children++;
    if(children===1){await peerStarted;throw auth;}
    releasePeer();
    return new Promise((resolve,reject)=>{
      const abort=()=>{peerAborted=true;clearTimeout(timer);reject(new Error('cancelled'));};
      scope.signal.addEventListener('abort',abort,{once:true});
      if(scope.signal.aborted)return abort();
      timer=setTimeout(()=>{scope.signal.removeEventListener('abort',abort);resolve({content:JSON.stringify({status:'blocked',answer:'No result',findings:[],uncertainties:['Pending']})});},1000);
    });
  }});
  const healthy=run(packet([doc('healthy',{kind:'folder',path:'healthy.md'})],{wikiId:'external:healthy'}),{signal:parent.signal});
  try {
    const results=await Promise.allSettled([failing,healthy]);
    assert.equal(results[0].status,'rejected');assert.equal(results[0].reason,auth);
    assert.equal(results[1].status,'fulfilled');assert.equal(results[1].value.status,'complete');
    assert.equal(children,2);assert.equal(peerAborted,true);assert.equal(parent.signal.aborted,false);
    assert.equal((await run(packet(),{signal:parent.signal})).status,'complete','A later run must not inherit the aborted Wiki scope');
  } finally {clearTimeout(timer);parent.abort();}
});
test('authentication failure during synthesis cannot become a partial success',async()=>{
  const base=model();let syntheses=0,sourceReads=0;
  await assert.rejects(run(packet(),{execute:async()=>{sourceReads++;return packet();},complete:async(...args)=>{
    if(args[0].some(m=>m.role==='system' && m.content.includes('Synthesize'))){syntheses++;throw new Error('forbidden');}
    return base(...args);
  }}),/forbidden/);
  assert.equal(syntheses,1);assert.equal(sourceReads,1);
});

test('parent Pi run propagates Wiki authentication without another model round',async()=>{
  const {runAgent}=await import('../agent-runtime.js');let mainCalls=0,childCalls=0;
  await assert.rejects(runAgent({messages:[{role:'user',content:'Read this Wiki'}],tools:openWikiTools({internal:true}),signal:new AbortController().signal,modelId:'chosen',execute:async()=>packet(),
    complete:async()=>{mainCalls++;return mainCalls===1?{content:'',calls:[{id:'wiki',function:{name:'ask_openwiki',arguments:JSON.stringify({wiki:'internal',question:'Vacation?'})}}]}:{content:'This must not be requested'};},
    completeAnalysis:async messages=>{childCalls++;if(messages.some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research')))return {content:JSON.stringify({mode:'focused',questions:['Vacation?']})};throw Object.assign(new Error('unauthorized'),{status:401});},
  }),error=>error.message==='unauthorized' && error.status===401);
  assert.equal(mainCalls,1);assert.equal(childCalls,2);
});


test('research progress identifies actual child reads, immutable assignments and each synthesis call',async()=>{
  const controller=new AbortController(),events=[],calls=[];
  const source=doc('x'.repeat(55000));
  const result=await runWikiQuestion({question:'Read all',documents:[source],sourceComplete:true},{
    signal:controller.signal,modelId:'fixture',model:new NubiOpenWikiModel({complete:model({mode:'comprehensive',seen:calls}),signal:controller.signal,modelId:'fixture'}),
    onProgress:event=>{
      events.push(structuredClone(event));
      if(event.assignment){event.assignment.documentIds.push('observer-mutation');if(event.assignment.range)event.assignment.range.end=-1;}
    },
  });
  assert.equal(result.status,'complete');
  const reads=events.filter(event=>event.phase==='reading' && event.role==='research');
  assert.deepEqual([...new Set(reads.map(event=>event.taskId))].sort(),[0,1,2]);
  for(const event of reads){
    assert.deepEqual(event.assignment.documentIds,['doc']);
    assert(event.assignment.range.end>event.assignment.range.start);
    assert(event.assignment.range.end<=source.text.length);
  }
  assert(!JSON.stringify(calls).includes('observer-mutation'));
  assert(events.some(event=>event.phase==='thinking' && event.role==='planner'));
  const syntheses=events.filter(event=>event.phase==='synthesizing' && event.synthesisId!==undefined);
  assert(syntheses.length>0);
  for(const start of syntheses){
    assert(events.some(event=>event.phase==='thinking' && event.role==='synthesis' && event.synthesisId===start.synthesisId));
    assert(events.some(event=>event.phase==='synthesis_finished' && event.synthesisId===start.synthesisId && event.outcome==='complete'));
  }
  assert.equal(events.filter(event=>event.phase==='finished' && event.role==='research').length,3);
});

test('gap recovery progress identifies its own remaining source range',async()=>{
  const signal=new AbortController().signal,events=[];
  const result=await runWikiQuestion({question:'Read all',documents:[doc('x'.repeat(12000))],sourceComplete:true},{
    signal,modelId:'fixture',model:new NubiOpenWikiModel({complete:model({mode:'comprehensive',skip:true}),signal,modelId:'fixture'}),onProgress:event=>events.push(event),
  });
  assert.equal(result.status,'complete');assert.equal(result.coverage.repairTasks,1);
  const recovery=events.filter(event=>event.role==='recovery');
  assert(recovery.some(event=>event.phase==='reading'));
  assert(recovery.every(event=>event.taskId===1 && event.assignment.range.start===6000 && event.assignment.range.end===12000));
  assert.equal(recovery.at(-1).phase,'finished');assert.equal(recovery.at(-1).outcome,'complete');
});


test('parent Pi stops workspace document authentication failures without another round or dispatch',async()=>{
  const {runAgent}=await import('../agent-runtime.js');
  const tools=[{type:'function',function:{name:'analyze_documents',description:'Read scoped workspace documents.',parameters:{type:'object',properties:{},additionalProperties:false}}}];
  for(const [code,status] of [['unauthorized',401],['forbidden',403],['expired_token',undefined]]){
    let mainCalls=0,dispatches=0;
    const error=Object.assign(new Error(code),status?{status}:{});
    await assert.rejects(runAgent({messages:[{role:'user',content:'Analyze the workspace documents.'}],tools,signal:new AbortController().signal,modelId:'chosen',
      complete:async()=>{mainCalls++;return mainCalls===1?{content:'',calls:[{id:'workspace-documents',function:{name:'analyze_documents',arguments:'{}'}}]}:{content:'This must not be requested'};},
      execute:async()=>{dispatches++;throw error;},
    }),failure=>failure===error);
    assert.equal(mainCalls,1,code);assert.equal(dispatches,1,code);
  }
});


test('Wiki adapter preserves decomposition, repair, synthesis and parent handoff as distinct public workers',async()=>{
  const events=[];
  const result=await run(packet([doc('x'.repeat(55000))]),{complete:model({mode:'comprehensive',skip:true}),onStep:event=>events.push(event)});
  assert.equal(result.status,'complete');
  for(const role of ['planner','research','recovery','synthesis','coordinator'])assert(events.some(event=>event.analysis.role===role),role);
  const planner=events.filter(event=>event.analysis.role==='planner');assert.equal(planner.at(-1).status,'done');assert.equal(planner.at(-1).analysis.delivered,false);
  // Independent readers may start out of order; identify the first source
  // range by its assignment, not whichever worker wins the scheduling race.
  const leaf=events.find(event=>event.analysis.role==='research' && event.analysis.phase==='reading' && event.analysis.assignment.range.start===0);
  assert.deepEqual(leaf.analysis.assignment.documents,[{id:'doc',title:'Policy'}]);assert.equal(leaf.analysis.assignment.range.start,0);
  const synthesizers=new Set(events.filter(event=>event.analysis.role==='synthesis').map(event=>event.index));
  assert(synthesizers.size>0);assert(!synthesizers.has(leaf.index));
  for(const index of synthesizers){const last=events.filter(event=>event.index===index).at(-1);assert.equal(last.status,'done');assert.equal(last.analysis.phase,'synthesis_finished');}
  assert(events.some(event=>event.analysis.role==='recovery' && event.analysis.assignment.range.start>0));
  assert(events.filter(event=>event.analysis.role==='research' && event.status==='done').every(event=>event.analysis.deliveredTo==='synthesis'));
  const main=events.filter(event=>event.analysis.deliveredTo==='main');assert.equal(main.length,1);assert.equal(main[0],events.at(-1));
  assert.equal(main[0].analysis.completed,main[0].analysis.total);assert(main[0].analysis.total>3);
});
test('public worker observers cannot mutate an active assignment and cancellation keeps completed work',()=>{
  const events=[], taskId='wiki-10000000-0000-4000-8000-000000000001';
  const progress=createResearchProgress({taskId,task:'Read policy',documents:[doc()],onStep:event=>{events.push(structuredClone(event));if(event.analysis.assignment)event.analysis.assignment.range.end=999999;}});
  const assignment={question:'Check dates',documentIds:['doc'],range:{documentId:'doc',start:0,end:20}};
  progress.progress({phase:'planning',role:'planner',completed:0,total:0});
  progress.progress({phase:'researching',completed:0,total:2});
  progress.progress({phase:'reading',role:'research',taskId:0,assignment,completed:0,total:2});
  progress.progress({phase:'finished',role:'research',taskId:0,assignment,completed:1,total:2,outcome:'partial'});
  progress.progress({phase:'reading',role:'recovery',taskId:1,assignment,completed:1,total:2});
  progress.fail({cancelled:true});
  assert.equal(assignment.range.end,20);
  assert.equal(events.filter(event=>event.index===`${taskId}-0`).at(-1).status,'done');
  assert.equal(events.filter(event=>event.index===`${taskId}-1`).at(-1).status,'cancelled');
  assert.equal(events.at(-1).analysis.delivered,false);assert.equal(events.at(-1).analysis.completed,1);
  assert(!events.some(event=>event.analysis.deliveredTo==='main'));
  const count=events.length;
  progress.progress({phase:'thinking',role:'recovery',taskId:1,assignment,completed:1,total:2});
  progress.finish({status:'complete',answer:'Late completion'});
  assert.equal(events.length,count,'Cancelled runs cannot be reopened by late model callbacks');
});

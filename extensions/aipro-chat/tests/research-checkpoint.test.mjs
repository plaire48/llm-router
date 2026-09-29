import test from 'node:test';
import assert from 'node:assert/strict';
import {runWikiQuestion} from '../../../packages/openwiki/src/agent/wiki-question.ts';
import {NubiOpenWikiModel,delegateWikiQuestion} from '../openwiki-agent.js';
import {storeResearchHandoff,createResearchHandoff,cancelResearchHandoffs,normalizeResearchHandoff} from '../research-handoff.js';
const input={question:'Review every requirement and exception.',sourceComplete:true,documents:[{id:'doc',kind:'site',path:'https://example.test/a',title:'Requirements',text:'x'.repeat(50000),version:'v1'}]};
function completion(calls=[],{skip=false,delay=false}={}){return async(messages)=>{
 const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
 const data=JSON.parse(messages.find(m=>m.role==='user').content);
 const report=ids=>({status:'complete',answer:'Evidence inspected',findings:[{text:'Source requirement',citations:ids.slice(0,3)}],uncertainties:[]});
 if(system.includes('Plan OpenWiki research')){calls.push({kind:'plan'});return{content:JSON.stringify({mode:'comprehensive',questions:['All requirements']})};}
 if(system.includes('Synthesize')){calls.push({kind:'synthesis'});return{content:JSON.stringify(report(data.evidence.map(e=>e.id)))};}
 const reads=messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
 const ranges=[...(data.restoredReads?.ranges||[]),...reads];
 const start=ranges.at(-1)?.end??data.assignment.range.start;
 if(start>=data.assignment.range.end||skip&&ranges.length){calls.push({kind:'report',start:data.assignment.range.start});return{content:JSON.stringify(report(ranges.map(r=>r.id||`e_0_${r.start}_${r.end}`)))};}
 if(delay&&data.assignment.range.start===0)await new Promise(resolve=>setTimeout(resolve,20));
 calls.push({kind:'read',start});return{calls:[{id:crypto.randomUUID(),function:{name:'read_wiki',arguments:JSON.stringify({documentId:'doc',start,length:6000})}}]};
};}
async function run(options={}){const signal=options.signal||new AbortController().signal,complete=options.complete||completion();return runWikiQuestion(options.input||input,{signal,modelId:'test',model:new NubiOpenWikiModel({signal,modelId:'test',complete}),...options});}
test('semantic checkpoints recover completed leaves and partial reads across a new research executor',async()=>{
 const controller=new AbortController();let saved;const before=[];
 await assert.rejects(run({signal:controller.signal,complete:completion(before),onCheckpoint:async checkpoint=>{saved=structuredClone(checkpoint);if(checkpoint.entries.filter(e=>e.output!==undefined).length>=2)controller.abort(Error('simulated process loss'));}}));
 assert(saved.entries.some(e=>e.reads.length));
 const resumed=[];const result=await run({checkpoint:saved,complete:completion(resumed),onCheckpoint:async checkpoint=>{saved=structuredClone(checkpoint);}});
 assert.equal(result.status,'complete');assert.deepEqual(result.coverage.unreadRanges,[]);
 assert.equal(resumed.filter(c=>c.kind==='plan').length,0);
 const savedReads=before.filter(c=>c.kind==='read').map(c=>c.start);
 assert(resumed.filter(c=>c.kind==='read').every(c=>!savedReads.includes(c.start)),'completed reads are reconstructed from the same current snapshot');
 const again=await run({checkpoint:saved,complete:()=>assert.fail('completed graph must not call a model')});
 assert.deepEqual(again,result);assert(!JSON.stringify(saved).includes('x'.repeat(100)));
});
test('checkpoint reuse rejects changed source, scope or model before inference and fails closed on storage loss',async()=>{
 let saved;await run({onCheckpoint:async checkpoint=>{saved=structuredClone(checkpoint);}});
 for(const change of [{...input,question:'Different goal'},{...input,documents:[{...input.documents[0],text:'different'}]},{...input,sourceComplete:false}])await assert.rejects(run({input:change,checkpoint:saved,complete:()=>assert.fail()}),/research_checkpoint_changed/);
 await assert.rejects(run({modelId:'other',checkpoint:saved,complete:()=>assert.fail()}),/research_checkpoint_changed/);
 await assert.rejects(run({onCheckpoint:async()=>{throw Error('quota');},complete:()=>assert.fail()}),/research_checkpoint_storage/);
});
test('host checkpoints are isolated by wiki, question and selected model and never reuse cancellation',async()=>{
 let state;const base={kind:'internal',owner:'internal:a',question:input.question,modelId:'test'};
 const writer=await createResearchHandoff({...base,onHandoff:async r=>{state=storeResearchHandoff(state,r);}});
 await run({onCheckpoint:writer.onCheckpoint});await writer.finish();
 const reader=await createResearchHandoff({...base,handoffs:state});assert(reader.checkpoint);
 for(const change of [{kind:'external'},{owner:'internal:b'},{modelId:'other'},{question:'different'}])assert.equal((await createResearchHandoff({...base,...change,handoffs:state})).checkpoint,undefined);
 state.records[0].status='running';assert.equal((await createResearchHandoff({...base,handoffs:cancelResearchHandoffs(state)})).checkpoint,undefined);
 const record=structuredClone(state.records[0]);record.secret='hidden';record.checkpoint.entries[0].rawDocument='private';
 const normalized=normalizeResearchHandoff(record);assert(!JSON.stringify(normalized).includes('private'));assert(!JSON.stringify(normalized).includes('hidden'));
});
test('the actual Wiki delegate persists and reuses semantic checkpoints after fresh source authorization',async()=>{
 let state,reads=0;const snapshot={wikiId:'internal:owned',...input};
 const options={signal:new AbortController().signal,modelId:'test',execute:async()=>{reads++;return snapshot;},complete:completion(),onResearchHandoff:async r=>{state=storeResearchHandoff(state,r);}};
 const args={wiki:'internal',question:input.question};
 const first=await delegateWikiQuestion(args,options);assert.equal(first.status,'complete');assert.equal(state.records[0].status,'done');
 const second=await delegateWikiQuestion(args,{...options,researchHandoffs:state,complete:()=>assert.fail('cached model')});
 assert.equal(second.status,'complete');assert.equal(reads,4,'fresh snapshot before and after each reuse');
});
test('source changes require an explicit fresh research plan and checkpoint storage remains cancellable',async()=>{
 let state,current={wikiId:'internal:owned',...input};
 const args={wiki:'internal',question:input.question};
 const base={signal:new AbortController().signal,modelId:'test',execute:async()=>current,complete:completion(),onResearchHandoff:async r=>{state=storeResearchHandoff(state,r);}};
 await delegateWikiQuestion(args,base);current={...current,documents:[{...input.documents[0],version:'v2',text:'y'.repeat(50000)}]};
 const changed=await delegateWikiQuestion(args,{...base,researchHandoffs:state,complete:()=>assert.fail('changed snapshot cannot use old reports')});assert.equal(changed.error,'research_checkpoint_changed');
 const fresh=await delegateWikiQuestion({...args,restart_research:true},{...base,researchHandoffs:state});assert.equal(fresh.status,'complete');assert(fresh.evidence.every(e=>e.version==='v2'));
 const controller=new AbortController();const pending=run({signal:controller.signal,onCheckpoint:()=>new Promise(()=>{}),complete:()=>assert.fail()});
 setTimeout(()=>controller.abort(Error('cancelled')),10);await assert.rejects(pending,/cancelled/);
});
test('checkpoint retention keeps the original plan when old leaf records exceed the storage budget',async()=>{
 let saved;await run({onCheckpoint:async value=>{saved=structuredClone(value);}});
 const plan=saved.entries.find(e=>e.output&&JSON.parse(e.output).mode);
 const filled={...saved,entries:[plan,...Array.from({length:511},(_,i)=>({key:(i+1).toString(16).padStart(64,'0'),reads:[],output:'x'.repeat(1800)}))]};
 const controller=new AbortController();let retained;
 await assert.rejects(run({checkpoint:filled,signal:controller.signal,complete:()=>assert.fail('stop before new research'),onCheckpoint:async value=>{retained=value;controller.abort(Error('retention checked'));}}));
 assert(retained.entries.some(e=>e.key===plan.key));assert(retained.omitted>0);assert(JSON.stringify(retained).length<=900000);
});
test('parallel recovery and hierarchical synthesis reuse semantic work even when completion order changes',async()=>{
 let saved;const original=await run({complete:completion([],{skip:true,delay:true}),onCheckpoint:async value=>{saved=structuredClone(value);}});
 assert(original.coverage.repairTasks>0);assert.deepEqual(original.coverage.unreadRanges,[]);
 const resumed=await run({checkpoint:saved,complete:()=>assert.fail('transient worker sequence must not invalidate completed semantic work')});
 assert.deepEqual(resumed,original);
});

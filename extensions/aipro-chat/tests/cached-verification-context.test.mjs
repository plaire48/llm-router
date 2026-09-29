import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {clearCachedToolResults} from '../context-evidence.js';
import {createRunContext, contextTokens} from '../context-manager.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const pair = (id, result, args = {}) => [{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name:'verify_page',arguments:JSON.stringify(args)}}]}, {role:'tool',tool_call_id:id,content:JSON.stringify(result)}];
const observation = (text = 'article source '.repeat(6000)) => ({url:'https://example.test/article',tabId:1,topDocumentId:'doc-a',frames:[{frame:0,documentId:'doc-a',text}]});
const receipt = (extra = {}) => ({ok:true,verified:true,checks:[{kind:'text_present',passed:true}],scope:'Visible observation only.',actionIssued:false,observation:observation(),...extra});
const setup = t => {const value=createAnalysisCoordinator({signal:new AbortController().signal});t.after(()=>value.dispose());return value;};
function store(value, result, id, args = {}) {return pair(id,{...result,analysis_evidence_id:value.observe('verify_page',args,result)},args);}
const nestedCleared = wire => wire.filter(m=>m.role==='tool'&&JSON.parse(m.content).observation?.contextCleared);

test('old successful verification DOM references round-trip the exact stored original and preserve every receipt field',async t=>{
  const value=setup(t), originals=Array.from({length:6},(_,i)=>receipt({checkSequence:i}));
  const user={role:'user',content:'Read only. Do not publish.'};
  const wire=[user,...originals.flatMap((result,i)=>store(value,result,`v${i}`,{checks:[{kind:'text_present',expected:'article'}]}))];
  const before=structuredClone(wire), packed=value.prepareContext(wire);
  assert.equal(nestedCleared(packed).length,4); assert.deepEqual(packed.slice(-4),wire.slice(-4));
  assert.deepEqual(wire,before); assert.deepEqual(packed[0],user); assert.equal(packed.length,wire.length);
  const saved=JSON.parse(packed[2].content), {observation:omitted,...fields}=saved;
  const {observation:originalDOM,...originalFields}=JSON.parse(wire[2].content);
  assert.deepEqual(fields,originalFields);assert.equal(omitted.source_path,'result.observation');
  assert.match(omitted.instruction,/not current page state/);
  let text='',offset=0;
  do {const packet=await value.execute('read_analysis_evidence',{evidence_id:omitted.analysis_evidence_id,offset});
    assert.equal(packet.coverage_scope,'returned_observation_only'); text+=packet.text;offset=packet.next_offset;
  } while(offset!==null);
  assert.equal(text,JSON.stringify({input:{checks:[{kind:'text_present',expected:'article'}]},result:originals[0]}));
  assert.deepEqual(JSON.parse(text).result.observation,originalDOM);
  assert(JSON.stringify(packed).length<JSON.stringify(wire).length*.4);
});

test('missing, evicted, truncated, visual, failed, uncertain and action-bearing verification originals stay intact',t=>{
  const value=setup(t);
  const variants=[receipt({error:'verification_failed'}),receipt({ok:false}),receipt({verified:false}),receipt({cancelled:true}),receipt({actionIssued:true}),receipt({applied:1}),receipt({requiresApproval:true}),receipt({requiresUserInput:true}),receipt({uncertain:true}),receipt({unresolvedAction:{id:'unknown'}}),receipt({image:{mimeType:'image/png',data:'AA=='}}),receipt({observation:observation('x'.repeat(210000))}),receipt({observation:{...observation(),image:{mimeType:'image/png',data:'AA=='}}})];
  const wire=variants.flatMap((r,i)=>store(value,r,`guard${i}`));
  wire.push(...pair('missing',{...receipt(),analysis_evidence_id:'ev_missing'}));
  for(let i=0;i<3;i++)wire.push(...store(value,receipt(),`recent${i}`));
  const packed=value.prepareContext(wire);
  assert.deepEqual(packed.slice(0,(variants.length+1)*2),wire.slice(0,(variants.length+1)*2));
  assert.equal(nestedCleared(packed).length,1);
  const evicted=store(value,receipt(),'evicted');
  for(let i=0;i<50;i++)value.observe('read_page',{}, {text:String(i)});
  assert.deepEqual(value.prepareContext([...evicted,...wire.slice(-6)]),[...evicted,...wire.slice(-6)]);
  value.dispose();assert.deepEqual(value.prepareContext(wire),wire);
});

test('metadata must match the exact verification tool and evidence ID and small wires stay unchanged',()=>{
  const wire=Array.from({length:3},(_,i)=>pair(`v${i}`,{...receipt(),analysis_evidence_id:`ev_${i+1}`})).flat();
  for(const extra of [{tool:'read_page'},{evidence_id:'ev_other'},{truncated:true},{has_image:true},{source_status:'metadata'}]) {
    assert.deepEqual(clearCachedToolResults(wire,id=>({tool:'verify_page',evidence_id:id,source_status:'observed',truncated:false,has_image:false,...extra})),wire);
  }
  const small=pair('v',{...receipt({observation:observation('short')}),analysis_evidence_id:'ev_1'});
  assert.deepEqual(clearCachedToolResults(small,()=>assert.fail('small wire must skip metadata work')),small);
});

test('six cached verification observations avoid synthetic summary calls without losing requirements or receipts',async t=>{
  const value=setup(t), wire=[{role:'system',content:'rules'},{role:'user',content:'Read only. Do not publish.'},...Array.from({length:6},(_,i)=>store(value,receipt(),String(i))).flat()];
  let calls=0;
  const context=createRunContext({model:{contextLength:128000},tools:[],goal:wire[1].content,signal:new AbortController().signal,invoke:async()=>{calls++;return {content:JSON.stringify({goal:'Read only.',constraints:['Do not publish.'],decisions:[],completed:[],pending:[],references:[]})}}});
  const packed=value.prepareContext(wire), result=await context.prepare(packed);
  assert.equal(calls,0);assert.deepEqual(result,packed);assert(contextTokens(result)<contextTokens(wire)*.4);
  assert.deepEqual(result.slice(0,2),wire.slice(0,2));
  assert(result.filter(m=>m.role==='tool').every(m=>JSON.parse(m.content).verified===true));
});

test('runtime leader gets cached DOM while final review and original execution results retain full observations',async()=>{
  const tools=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).filter(t=>t.function.name!=='update_plan');
  const originals=[],wires=[];let round=0,reviews=0;
  const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const result=await runAgent({messages:[{role:'user',content:'Read only. Verify the article markers.'}],tools,harness:true,stepwise:false,signal:new AbortController().signal,
    completeAnalysis:async()=>assert.fail('No subagent is required'),prepareContext:wire=>{wires.push(structuredClone(wire));return wire;},
    execute:async(name,args)=>{if(name==='browser_snapshot')return observation();assert.equal(name,'verify_page');const r=receipt({checks:args.checks.map(c=>({...c,passed:true}))});originals.push(r);return r;},
    complete:async wire=>{round++;if(round===1)return call('browser_snapshot');if(round<=5)return call('verify_page',{checks:[{kind:'text_present',expected:`article ${round}`} ]});assert.equal(nestedCleared(wire).length,2);return {content:'Article markers verified.'};},
    reviewGoal:async({evidence})=>{reviews++;const verifications=evidence.filter(e=>e.tool==='verify_page');assert.equal(verifications.length,4);for(let i=0;i<4;i++)assert.deepEqual(verifications[i].result,originals[i]);return {status:'complete'};}});
  assert.equal(result.content,'Article markers verified.');assert.equal(reviews,1);assert.equal(originals.length,4);
  assert(originals.every(r=>r.observation.frames[0].text.length===90000));assert.equal(nestedCleared(wires.at(-1)).length,2);
});


test('failed verification retains every error and check while older DOM is recoverable without summarizing',async t=>{
  const value=setup(t), failed=receipt({ok:false,verified:false,error:'verification_failed',
    checks:[{kind:'text_present',passed:true},{kind:'link_destination',passed:false,reason:'url_query_mismatch'}],
    instruction:'Read the current result; never replay a write.'});
  const wire=[{role:'user',content:'Find two sources; do not publish.'},...store(value,failed,'failed')];
  for(let i=0;i<2;i++) {
    const result=observation(`fresh ${i} `.repeat(9000)),id=value.observe('browser_snapshot',{},result);
    wire.push({role:'assistant',tool_calls:[{id:`fresh${i}`,type:'function',function:{name:'browser_snapshot',arguments:'{}'}}]},
      {role:'tool',tool_call_id:`fresh${i}`,content:JSON.stringify({...result,analysis_evidence_id:id})});
  }
  const before=structuredClone(wire),packed=value.prepareContext(wire),retained=JSON.parse(packed[2].content);
  const {observation:oldDOM,...receiptFields}=JSON.parse(wire[2].content);
  const {observation:locator,...actualFields}=retained;
  assert.deepEqual(actualFields,receiptFields);assert.equal(retained.verified,false);assert.equal(retained.error,'verification_failed');
  assert.equal(locator.reason,'cached_failed_verification_observation');assert.equal(locator.evidence.source_status,'error');
  assert.deepEqual(packed.slice(-4),wire.slice(-4));assert.deepEqual(wire,before);
  let raw='',offset=0;
  do {const packet=await value.execute('read_analysis_evidence',{evidence_id:retained.analysis_evidence_id,offset});
    assert.equal(packet.source_status,'error');raw+=packet.text;offset=packet.next_offset;
  } while(offset!==null);
  assert.deepEqual(JSON.parse(raw),{input:{},result:failed});
  assert(JSON.stringify(packed).length<JSON.stringify(wire).length*.8);
});

test('failed checks remain whole while their DOM is recent or their source was truncated',t=>{
  const value=setup(t),failed=receipt({ok:false,verified:false,error:'verification_failed',checks:[{kind:'text_present',passed:false}]});
  const wire=[...store(value,failed,'fail1'),...store(value,failed,'fail2')];
  assert.deepEqual(value.prepareContext(wire),wire);
  const oversized=receipt({...failed,observation:observation('x'.repeat(210000))});
  const old=store(value,oversized,'oversized');
  assert.deepEqual(value.prepareContext([...old,...wire]).slice(0,2),old);
});

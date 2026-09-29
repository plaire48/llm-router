import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {clearCachedToolResults} from '../context-evidence.js';
import {createRunContext,contextTokens,contextBudget} from '../context-manager.js';

const pair=(id,name,result,args={})=>[{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},
  {role:'tool',tool_call_id:id,content:JSON.stringify(result)}];
const dom=(text='Original source '.repeat(6000))=>({url:'https://example.test/search',topDocumentId:'doc-a',frames:[{frame:0,documentId:'doc-a',text,elements:[{ref:'original-ref',role:'combobox'}]}]});
const fill=(extra={})=>({ok:true,verified:true,actionIssued:true,applied:1,matched:1,submitted:false,
  inputExecution:{commands:[{method:'fill',state:'returned',actionIssued:true,inputReceipt:{dataKind:'script_input_dispatch',version:1,
    method:'fill',actionIssued:true,targetStatus:'observed',target:{documentId:'doc-a',controlId:'control-a'},
    readback:{status:'observed',matchesExpected:true,expectedDigest:'a'.repeat(64)}}}],omitted:0},observation:dom(),...extra});
const setup=t=>{const value=createAnalysisCoordinator({signal:new AbortController().signal});t.after(()=>value.dispose());return value;};
const store=(value,id,name,result,args={})=>pair(id,name,{...result,analysis_evidence_id:value.observe(name,args,result)},args);
const latest=(value)=>[...store(value,'latest-one','browser_snapshot',dom('First current DOM')),...store(value,'latest-two','browser_snapshot',dom('Second current DOM'))];
const body=(wire,index=1)=>JSON.parse(wire[index].content);

test('one old verified fill DOM is archived while every input receipt and original readback remain exact',async t=>{
  const value=setup(t),original=fill(),args={fields:[{field_id:'field-a',value:'Requested search'}]};
  const wire=[...store(value,'fill-one','fill_form',original,args),...latest(value)],before=structuredClone(wire);
  const packed=value.prepareContext(wire),saved=body(packed),{observation:omitted,...receipt}=saved;
  const {observation,...expectedReceipt}=body(wire);
  assert.deepEqual(receipt,expectedReceipt);assert.deepEqual(wire,before);assert.equal(packed.length,wire.length);
  assert.equal(omitted.reason,'cached_fill_observation');assert.equal(omitted.source_path,'result.observation');
  assert.match(omitted.instruction,/Never replay/);assert.deepEqual(packed.slice(2),wire.slice(2));
  let text='',offset=0;
  do{const packet=await value.execute('read_analysis_evidence',{evidence_id:omitted.analysis_evidence_id,offset});
    assert.equal(packet.coverage_scope,'returned_observation_only');text+=packet.text;offset=packet.next_offset;}while(offset!==null);
  assert.deepEqual(JSON.parse(text),{input:args,result:original});assert.deepEqual(JSON.parse(text).result.observation,observation);
  assert(JSON.stringify(packed).length<JSON.stringify(wire).length*.1);
});

test('latest two DOM results across operations remain full and text excerpts do not retire fill refs',t=>{
  const value=setup(t),wire=store(value,'fill-one','fill_form',fill());
  wire.push(...store(value,'article','read_page',{ok:true,dataKind:'page_content',text:'reference '.repeat(6000)}));
  assert.deepEqual(value.prepareContext(wire),wire);
  wire.push(...store(value,'click','click_element',{ok:true,actionIssued:true,observation:dom('Current click DOM')}));
  assert.deepEqual(value.prepareContext(wire),wire,'Fill is still the second newest actual DOM');
  const failure=store(value,'failed-check','verify_page',{ok:false,error:'verification_failed',observation:dom('Failed check DOM')});
  wire.push(...failure);
  const packed=value.prepareContext(wire);assert.equal(body(packed).observation.reason,'cached_fill_observation');
  assert.deepEqual(packed.slice(-4),wire.slice(-4),'Newer click and failed verification remain unchanged');
});

test('failed, cancelled, uncertain, pending, visual and truncated fill originals are never cleared',t=>{
  const value=setup(t),variants=[fill({ok:false}),fill({verified:false}),fill({error:'fill_not_retained'}),fill({cancelled:true}),
    fill({uncertain:true}),fill({unresolvedAction:{id:'unknown'}}),fill({requiresApproval:true}),fill({requiresUserInput:true}),
    fill({image:{mimeType:'image/png',data:'AA=='}}),fill({observation:{...dom(),image:{mimeType:'image/png',data:'AA=='}}}),
    fill({observation:{...dom(),error:'browser_stale'}}),fill({observation:dom('x'.repeat(210000))})];
  const wire=[...variants.flatMap((r,i)=>store(value,'guard-'+i,'fill_form',r)),...latest(value)];
  assert.deepEqual(value.prepareContext(wire),wire);
});

test('fill history pointer requires exact complete observed source metadata; lost or evicted originals remain full',t=>{
  const value=setup(t),wire=[...store(value,'old-fill','fill_form',fill()),...latest(value)];
  const id=body(wire).analysis_evidence_id;
  for(const extra of [{tool:'verify_page'},{evidence_id:'ev_other'},{truncated:true},{has_image:true},{source_status:'error'}]){
    assert.deepEqual(clearCachedToolResults(wire,()=>({tool:'fill_form',evidence_id:id,source_status:'observed',truncated:false,has_image:false,...extra})),wire);
  }
  assert.deepEqual(clearCachedToolResults(wire,()=>null),wire);
  for(let i=0;i<50;i++)value.observe('read_page',{}, {text:String(i)});
  assert.deepEqual(value.prepareContext(wire),wire);value.dispose();assert.deepEqual(value.prepareContext(wire),wire);
});

test('archived verified fill reduces measured wire size and avoids a synthetic summary within the same input budget',async t=>{
  const value=setup(t),goal='Keep the requested input and original source. Do not submit or replay it.';
  const wire=[{role:'system',content:'rules'},{role:'user',content:goal},...store(value,'old-fill','fill_form',fill()),...latest(value)];
  const tools=[{type:'function',function:{name:'read_analysis_evidence',description:'schema '.repeat(1000)}}];
  const model={contextLength:32000};let beforeCalls=0,afterCalls=0;
  const summary={goal,constraints:['Do not submit or replay.'],decisions:[],completed:[],pending:[],references:[]};
  await createRunContext({model,tools,goal,signal:new AbortController().signal,invoke:async()=>{beforeCalls++;return{content:JSON.stringify(summary)};}}).prepare(wire);
  const packed=value.prepareContext(wire),result=await createRunContext({model,tools,goal,signal:new AbortController().signal,
    invoke:async()=>{afterCalls++;return{content:JSON.stringify(summary)};}}).prepare(packed);
  assert(beforeCalls>0);assert.equal(afterCalls,0);assert.deepEqual(result,packed);assert(contextTokens(result,tools)<contextBudget(model).input);
  assert(contextTokens(result,tools)<contextTokens(wire,tools)*.2);assert.deepEqual(result.slice(0,2),wire.slice(0,2));
  const old=body(wire,3),saved=body(result,3);const{observation:oldDOM,...fields}=old;const{observation:ref,...actual}=saved;
  assert.deepEqual(actual,fields);assert.equal(ref.source_path,'result.observation');assert.equal(saved.submitted,false);
  t.diagnostic(JSON.stringify({synthetic:true,actualModel:false,beforeCharacters:JSON.stringify(wire).length,
    afterCharacters:JSON.stringify(result).length,beforeSummaryCalls:beforeCalls,afterSummaryCalls:afterCalls}));
});


test('returned key command keeps exact host receipt when only its historical DOM is cached',async t=>{
  const value=setup(t);
  const key={ok:true,verified:false,actionIssued:true,observation:dom(),inputExecution:{omitted:0,commands:[{
    method:'press',state:'returned',actionIssued:true,inputReceipt:{dataKind:'script_input_dispatch',version:1,method:'press',
      actionIssued:true,targetStatus:'observed',key:'Enter',target:{tabId:1,documentId:'doc-a',controlId:'search',role:'combobox'}}}]}};
  const wire=[...store(value,'key','press_key',key),...latest(value)],before=structuredClone(wire),packed=value.prepareContext(wire);
  const first=JSON.parse(packed[1].content), original=JSON.parse(wire[1].content);
  const {observation:oldDOM,...expected}=original,{observation:locator,...actual}=first;
  assert.deepEqual(actual,expected);assert.equal(first.verified,false);assert.equal(locator.reason,'cached_key_observation');
  assert.deepEqual(wire,before);assert.deepEqual(packed.slice(-4),wire.slice(-4));
  let text='',offset=0;
  do {const packet=await value.execute('read_analysis_evidence',{evidence_id:first.analysis_evidence_id,offset});text+=packet.text;offset=packet.next_offset;}while(offset!==null);
  assert.deepEqual(JSON.parse(text).result,key);
  for(const change of [{error:'unknown'},{unresolvedAction:{id:'u'}},{cancelled:true},{inputExecution:{omitted:1,commands:key.inputExecution.commands}},
    {inputExecution:{omitted:0,commands:[{...key.inputExecution.commands[0],state:'unknown'}]}},{inputExecution:{omitted:0,commands:[]}}]) {
    const guarded=[...store(value,'guard-key','press_key',{...key,...change}),...latest(value)];
    assert.deepEqual(value.prepareContext(guarded),guarded);
  }
});

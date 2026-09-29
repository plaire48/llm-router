import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator, ANALYSIS_IMAGE_LIMIT} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

const image = value => ({mimeType:'image/png',data:Buffer.from(value).toString('base64')});
const imageUrls = wire => wire.flatMap(message=>Array.isArray(message.content)?message.content.filter(part=>part.type==='image_url').map(part=>part.image_url.url):[]);
const call = (name,args,id=crypto.randomUUID()) => ({id,function:{name,arguments:JSON.stringify(args)}});
const report = {status:'complete',summary:'Assigned sources compared',findings:[{text:'Source comparison',evidence_ids:['ev_1','ev_2']}],uncertainties:[],next_step:''};
async function compare(t,{mode='image',fail=false,cancel=false,omitFirst=false}={}) {
  const controller=new AbortController(),events=[],wires=[];let calls=0;
  const h=createAnalysisCoordinator({signal:controller.signal,modelId:'fixture',tools:[],execute:async()=>assert.fail('No host operation'),
    run:options=>runAgent({...options,complete:(wire,tools)=>options.complete(omitFirst ? wire.map(message=>{
      if(message.role!=='user'||!Array.isArray(message.content))return message;
      let envelope;try{envelope=JSON.parse(message.content[0]?.text);}catch{return message;}
      return envelope?.evidence_id==='ev_1'?{...message,content:message.content.filter(part=>part.type!=='image_url')}:message;
    }):wire,tools)}),onStep:event=>events.push(structuredClone(event)),complete:async wire=>{
      wires.push(structuredClone(wire));calls++;
      if(calls===1)return {calls:['ev_1','ev_2'].map(id=>call('read_analysis_evidence',{evidence_id:id,mode}))};
      if(fail)throw new Error('attachment_vision');
      if(cancel)controller.abort();
      return {content:JSON.stringify(report)};
    }});
  t.after(()=>h.dispose());
  h.observe('capture_page',{}, {text:'First source',image:image('FIRST_PIXELS')});
  h.observe('capture_page',{}, {text:'Second source',image:image('SECOND_PIXELS')});
  await h.execute('delegate_analysis',{tasks:[{role:'review',task:'Compare assigned sources',done_when:'Check both sources',evidence_ids:['ev_1','ev_2']}]});
  if(cancel){await assert.rejects(h.collect(),/cancelled/);return{events,wires};}
  return {result:(await h.collect()).results[0],events,wires};
}

test('parallel frozen image reads both reach the analyst and retain distinct evidence identities',async t=>{
  const {result,wires,events}=await compare(t);
  assert.deepEqual(imageUrls(wires[1]),['FIRST_PIXELS','SECOND_PIXELS'].map(value=>`data:image/png;base64,${image(value).data}`));
  const envelopes=wires[1].filter(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url')).map(message=>JSON.parse(message.content[0].text));
  assert.deepEqual(envelopes.map(value=>value.evidence_id),['ev_1','ev_2']);
  assert(envelopes.every(value=>value.dataKind==='analysis_image_reference'&&value.instruction.includes('Not the current viewport')));
  assert(result.evidence.every(value=>value.image_read===true));assert.equal(result.report.status,'complete');
  assert(events.filter(event=>event.analysis.phase==='reading').every(event=>event.analysis.sources.every(source=>!source.imageRead)),'Retrieval alone is not a successful model call');
});
test('text-only source reads never claim that available image bytes were inspected',async t=>{
  const {result,wires}=await compare(t,{mode:'text'});
  assert.equal(imageUrls(wires[1]).length,0);
  assert(result.evidence.every(value=>value.has_image===true&&value.image_read===false));
});
test('a vision route failure leaves image reads unacknowledged',async t=>{
  const {result,wires,events}=await compare(t,{fail:true});
  assert.equal(imageUrls(wires[1]).length,2);assert.equal(result.status,'failed');
  assert(result.evidence.every(value=>value.image_read===false));
  assert(events.every(event=>event.analysis.sources.every(source=>!source.imageRead)));
});
test('cancellation after preparing image input never acknowledges a returned model result',async t=>{
  const {events,wires}=await compare(t,{cancel:true});
  assert.equal(imageUrls(wires[1]).length,2);
  assert(events.every(event=>event.analysis.sources.every(source=>!source.imageRead)));
  assert(!events.some(event=>event.analysis.outcome==='complete'));
});
test('an image removed by context selection is not acknowledged through text metadata alone',async t=>{
  const {result,wires}=await compare(t,{omitFirst:true});
  assert.equal(imageUrls(wires[1]).length,1);
  assert.deepEqual(result.evidence.map(value=>[value.evidence_id,value.image_read]),[['ev_1',false],['ev_2',true]]);
});
test('parent live viewport keeps only its newest screenshot, while frozen reference images are bounded separately',async()=>{
  const tool=name=>({type:'function',function:{name,description:'Read source',parameters:{type:'object',properties:{evidence_id:{type:'string'}}}}});
  const wires=[];let round=0;
  await runAgent({messages:[{role:'user',content:'Read references'}],tools:[tool('capture_page'),tool('read_analysis_evidence')],signal:new AbortController().signal,
    complete:async wire=>{
      wires.push(structuredClone(wire));round++;
      if(round<=2)return{calls:[call('capture_page',{})]};
      if(round<=10)return{calls:[call('read_analysis_evidence',{evidence_id:`ev_${round-2}`})]};
      return{content:'done'};
    },execute:async(name,args)=>name==='capture_page'?{text:'viewport',image:image(`VIEW_${round}`)}:{evidence_id:args.evidence_id,text:'reference',image:image(args.evidence_id)},
  });
  assert.deepEqual(imageUrls(wires[2]),[`data:image/png;base64,${image('VIEW_2').data}`]);
  const final=imageUrls(wires.at(-1));assert.equal(final.length,1+ANALYSIS_IMAGE_LIMIT);
  assert.equal(final[0],`data:image/png;base64,${image('VIEW_2').data}`);
  assert.deepEqual(final.slice(1),Array.from({length:ANALYSIS_IMAGE_LIMIT},(_,i)=>`data:image/png;base64,${image(`ev_${i+3}`).data}`));
});

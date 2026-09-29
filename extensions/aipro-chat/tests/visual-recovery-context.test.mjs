import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools,BUILTIN_SKILLS} from '../skills.js';
import {createRunContext} from '../context-manager.js';

const call=(name,args={},id=crypto.randomUUID())=>({content:'',calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const available=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).filter(t=>t.function.name!=='update_plan');
if(!available.some(t=>t.function.name==='capture_page'))available.push({type:'function',function:{name:'capture_page',parameters:{type:'object',properties:{full_page:{type:'boolean'}}}}});
const page=text=>({tabId:11,topDocumentId:'doc',url:'https://example.test/form',frames:[{frame:0,documentId:'doc',url:'https://example.test/form',text,elements:[{ref:'r1',role:'button',name:'저장',id:'save'}]}]});
const summary={goal:'초안만 확인',constraints:['최종 전송 금지'],decisions:[],completed:[],pending:['미확정 동작 검증'],references:[]};

async function executeFixture({visualDOM=true,sourceRead=false}={}) {
  const fullText='UNIQUE_DOM_START '+ '가시 원문 label/value 0123456789 '.repeat(2200)+' UNIQUE_DOM_END';
  const original=page('Before action'),visual={image:{mimeType:'image/png',data:'AAAA'},screenshot_id:'s1',capture_mode:'viewport',
    visualTargets:[{ref:'r1',name:'저장',bounds:{x:1,y:2,width:30,height:20}}],...(visualDOM?{observation:page(fullText)}:{})};
  const failure={ok:false,error:'script_timeout',reason:'script_timeout',actionIssued:true,applied:1,
    recovery:{execution:'unknown'},unresolvedAction:{kind:'unknown_write',documentId:'doc'},observation:original};
  const untouched={visual:structuredClone(visual),failure:structuredClone(failure)},executed=[],wires=[];
  let round=0,failed,readText='',next=0,id,blocked=false;
  const result=await runAgent({messages:[{role:'user',content:'초안만 확인. 최종 전송 금지.'}],tools:available,signal:new AbortController().signal,harness:true,
    prepareContext:async wire=>wire,
    ...(sourceRead?{completeAnalysis:async()=>assert.fail('no advisory model call is needed to read the preserved source')} : {}),
    complete:async(wire,_tools,state)=>{
      wires.push(structuredClone(wire));round++;
      if(round===1)return call('read_page');
      if(round===2)return call('click_element',{ref:'r1'});
      if(round===3){
        failed=JSON.parse(wire.findLast(m=>m.role==='tool').content);id=failed.analysis_evidence_id;
        assert.equal(state.verificationPending,true);assert.equal(failed.error,'script_timeout');assert.equal(failed.reason,'script_timeout');
        assert.equal(failed.actionIssued,true);assert.equal(failed.applied,1);assert.deepEqual(failed.unresolvedAction,failure.unresolvedAction);
        assert.deepEqual(failed.observation,visualDOM?visual.observation:original);
        assert(!Object.hasOwn(failed.visualRecovery,'observation'));
        assert.equal(failed.visualRecovery.screenshot_id,'s1');assert.equal(failed.visualRecovery.capture_mode,'viewport');
        assert.deepEqual(failed.visualRecovery.visualTargets,visual.visualTargets);
        const images=wire.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url'):[]);
        assert(images.some(p=>p.image_url.url==='data:image/png;base64,AAAA'));
        if(sourceRead){assert(id);return call('read_analysis_evidence',{evidence_id:id,offset:0});}
      }else if(sourceRead&&next!==null){
        const packet=JSON.parse(wire.findLast(m=>m.role==='tool').content);assert.equal(packet.evidence_id,id);assert.equal(packet.truncated,false);
        readText+=packet.text;next=packet.next_offset;
        if(next!==null)return call('read_analysis_evidence',{evidence_id:id,offset:next});
      }
      if(!blocked){blocked=true;return call('click_element',{ref:'r1'});}
      assert.equal(JSON.parse(wire.findLast(m=>m.role==='tool').content).error,'action_outcome_unknown');
      assert.equal(state.verificationPending,true);
      return call('ask_user',{question:'미확정 동작을 유지하고 계속 확인할까요?'});
    },execute:async (name,args)=>{
      executed.push(name==='read_page'&&args.mode==='content'?'read_page:content':name);
      // The host retains an identified source before any write. This form has
      // no readable article; that failure must not affect later write receipts.
      if(name==='read_page')return args.mode==='content'?{error:'page_content_unavailable'}:original;
      if(name==='click_element')return failure;if(name==='capture_page')return visual;if(name==='ask_user')return {requiresUserInput:true};throw Error('unexpected '+name);
    }});
  assert.deepEqual(executed,['read_page','read_page:content','click_element','capture_page','ask_user']);assert.equal(result.awaitingUser,true);
  assert.deepEqual(visual,untouched.visual);assert.deepEqual(failure,untouched.failure);
  return {failed,wires,fullText,visual,readText,result};
}

test('actual runtime keeps one full visual DOM, unchanged failure receipts, image and targets while blocking a second write',async t=>{
  const f=await executeFixture(),content=f.wires[2].findLast(m=>m.role==='tool').content;
  assert.equal(content.split('UNIQUE_DOM_START').length-1,1);
  const oldShape={...f.failed,visualRecovery:{...f.failed.visualRecovery,observation:f.visual.observation}};
  const removed=JSON.stringify(oldShape).length-content.length;
  assert.equal(removed,JSON.stringify(f.visual.observation).length+',"observation":'.length);
  assert(removed>60000);
  t.diagnostic(JSON.stringify({synthetic:true,beforeCharacters:JSON.stringify(oldShape).length,afterCharacters:content.length,removedCharacters:removed,domCharacters:JSON.stringify(f.visual.observation).length}));
});

test('missing visual DOM preserves the previous action observation without changing failure handling',async()=>{
  const f=await executeFixture({visualDOM:false});assert.equal(f.failed.observation.frames[0].text,'Before action');
});

test('actual runtime analysis store round-trip retains the full failed source once with its uncertainty and image metadata',async()=>{
  const f=await executeFixture({sourceRead:true}),stored=JSON.parse(f.readText);
  assert.equal(stored.result.observation.frames[0].text,f.fullText);
  assert.equal(stored.result.actionIssued,true);assert.equal(stored.result.error,'script_timeout');
  assert.deepEqual(stored.result.unresolvedAction,f.failed.unresolvedAction);
  assert.deepEqual(stored.result.visualRecovery,f.failed.visualRecovery);
  assert.equal(f.readText.split('UNIQUE_DOM_START').length-1,1);
});

test('compaction receives one exact DOM copy from the runtime and preserves the original wire, user constraint and uncertain receipt',async()=>{
  const f=await executeFixture(),wire=structuredClone(f.wires[2]);
  for(const id of ['recent1','recent2'])wire.push({role:'assistant',content:'',tool_calls:call('read_page',{},id).calls},{role:'tool',tool_call_id:id,content:JSON.stringify({text:'recent small observation '+id})});
  const before=structuredClone(wire),fragments=[],saved=[];
  const context=createRunContext({model:{contextLength:128000},tools:[],goal:'초안만 확인. 최종 전송 금지.',signal:new AbortController().signal,
    invoke:async messages=>{fragments.push(messages.at(-1).content.replace(/^Source fragment \([^\n]+\):\n/,''));return{content:JSON.stringify(summary)};},save:v=>saved.push(v)});
  const packed=await context.prepare(wire,true),source=fragments.join('');
  assert.equal(source.split('UNIQUE_DOM_START').length-1,1);assert.equal(source.split('UNIQUE_DOM_END').length-1,1);
  assert(source.includes(f.fullText));assert.equal(saved.length,1);assert.deepEqual(wire,before);
  assert(packed.some(m=>m.content==='초안만 확인. 최종 전송 금지.'));
  assert(packed.some(m=>typeof m.content==='string'&&m.content.includes('script_timeout')));
});

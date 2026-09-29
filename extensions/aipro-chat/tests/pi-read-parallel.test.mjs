import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
const definition=name=>({type:'function',function:{name,description:name,parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}});
const call=(name,id)=>({id,type:'function',function:{name,arguments:JSON.stringify({id})}});
const base=()=>({messages:[{role:'user',content:'독립된 근거 두 개를 확인하세요'}],modelId:'QWEN3.8-27B-FP8-256K',tools:[definition('wiki_read')],parallelReads:true,signal:new AbortController().signal});

test('native Pi parallel reads overlap, finish early independently and preserve call/result order',async()=>{
  let round=0, active=0, peak=0, releaseFirst; const finished=[];
  const first=new Promise(resolve=>{releaseFirst=resolve;});
  await runAgent({...base(),complete:async wire=>{
    if(++round===1)return {content:'',calls:[call('wiki_read','first'),call('wiki_read','second')]};
    const results=wire.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content).id);
    assert.deepEqual(results,['first','second']); return {content:'검토 완료',calls:null};
  },execute:async(name,{id})=>{
    active++;peak=Math.max(peak,active);
    if(id==='first')await first;
    else {finished.push(id);releaseFirst();active--;return {id};}
    finished.push(id);active--;return {id};
  }});
  assert.equal(peak,2);assert.deepEqual(finished,['second','first']);assert.equal(round,2);
});

test('a failed independent read preserves its successful sibling and defers excess reads',async()=>{
  let round=0;const executed=[];
  await runAgent({...base(),complete:async wire=>{
    if(++round===1)return {content:'',calls:['bad','good','deferred'].map(id=>call('wiki_read',id))};
    const results=wire.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
    assert.equal(results[0].error,'project_not_found');assert.equal(results[1].id,'good');assert.equal(results[2].error,'analysis_read_batch');
    return {content:'일부 근거 없음',calls:null};
  },execute:async(name,{id})=>{executed.push(id);return id==='bad'?{error:'project_not_found'}:{id};}});
  assert.deepEqual(executed,['bad','good']);
});

test('parallel opt-in cannot parallelize a mixed batch with browser actions',async()=>{
  let round=0;const events=[];
  await runAgent({...base(),tools:[definition('wiki_read'),definition('click_element')],complete:async()=>++round===1?{content:'',calls:[call('wiki_read','read'),call('click_element','write')]}:{content:'완료',calls:null},
    execute:async(name)=>{events.push(name+' start');await new Promise(resolve=>setTimeout(resolve,5));events.push(name+' end');return{ok:true};}});
  assert.deepEqual(events,['wiki_read start','wiki_read end','click_element start','click_element end']);
});

test('Pi stop hook preserves a pending question and prevents later operations',async()=>{
  let round=0;const executed=[];
  const result=await runAgent({...base(),parallelReads:false,tools:[definition('ask_user'),definition('click_element')],complete:async()=>{
    assert.equal(++round,1);return{content:'',calls:[call('ask_user','question'),call('click_element','forbidden')]};
  },execute:async(name)=>{executed.push(name);return{requiresUserInput:true};}});
  assert.deepEqual(executed,['ask_user']);assert.equal(result.awaitingUser,true);assert.equal(result.calls,null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {evaluationComposer, evaluationClickReasons, submitEvaluationTask, waitForEvaluationUI} from '../scripts/evaluation-reset.mjs';

function fixture(overrides = {}) {
  let clock = 0;
  const current = {busy:false,chat:{sessionId:'new-session',draft:'',messages:[]}};
  const view = {conversationId:'new-session',documentVisible:true,composerCount:1,inputValue:'',inputEnabled:true,
    buttonCount:1,buttonVisible:true,buttonEnabled:true,centerHitsButton:true};
  const calls = {activate:0,fill:0,click:0};
  const value = {current,view,calls,now:()=>clock,state:async()=>structuredClone(current),
    wait:async ms=>{clock+=ms;await overrides.tick?.(value,clock);}};
  value.composer = {
    activate:async()=>{calls.activate++;await overrides.activate?.(value);},
    inspect:async()=>structuredClone(view),
    fill:async text=>{calls.fill++;view.inputValue=text;if(overrides.fill)await overrides.fill(value,text);else current.chat.draft=text;},
    click:async()=>{calls.click++;if(overrides.click)return overrides.click(value);
      current.chat.messages=[{id:'user-1',role:'user',content:view.inputValue},{id:'request-1',role:'assistant',state:'pending'}];},
  };
  value.submit=()=>submitEvaluationTask({...value,sessionId:'new-session',text:'Investigate only. Do not submit anything.',timeoutMs:1000});
  return value;
}

test('delayed new-session UI and persisted draft must both synchronize before exactly one send',async()=>{
  let filledAt;
  const f=fixture({activate:f=>{f.view.documentVisible=true;},fill:(_f,_text)=>{},tick:(f,time)=>{
    if(time>=300)f.view.conversationId='new-session';
    if(f.calls.fill&&filledAt===undefined)filledAt=time;
    if(filledAt!==undefined&&time>=filledAt+200)f.current.chat.draft=f.view.inputValue;
  }});
  f.view.conversationId='previous-session';f.view.documentVisible=false;
  const received=await f.submit();
  assert(filledAt>=300);assert.equal(received.requestId,'request-1');assert.equal(received.acknowledged,true);
  assert.deepEqual(f.calls,{activate:1,fill:1,click:1});
});

test('missing or wrong applied session never fills the old view',async()=>{
  for(const id of [null,'previous-session']) {
    const f=fixture();f.view.conversationId=id;
    await assert.rejects(f.submit(),error=>error.message==='evaluation_ui_not_ready'&&error.submissionDiagnostics.uiSessionMatches===false);
    assert.equal(f.calls.fill,0);assert.equal(f.calls.click,0);
  }
});

test('a lost UI draft or unpersisted draft cannot trigger send',async()=>{
  for(const mode of ['unpersisted','overwritten']) {
    const f=fixture({fill:(f,text)=>{if(mode==='overwritten'){f.current.chat.draft=text;f.view.inputValue='';}}});
    await assert.rejects(f.submit(),/evaluation_draft_not_ready/);assert.equal(f.calls.click,0);
  }
});

test('stray characters in the composer are replaced by a bounded refill before the single send',async()=>{
  const f=fixture({fill:(f,text)=>{f.view.inputValue=f.calls.fill===1?`${text}ab`:text;f.current.chat.draft=f.view.inputValue;}});
  const received=await f.submit();
  assert.equal(received.acknowledged,true);assert.equal(received.draftFills,2);
  assert.deepEqual(f.calls,{activate:1,fill:2,click:1});
  assert.equal(f.current.chat.messages[0].content,'Investigate only. Do not submit anything.');
});

test('a composer that keeps changing the text stops after three fills and reports lengths only',async()=>{
  const f=fixture({fill:(f,text)=>{f.view.inputValue=`${text}ab`;f.current.chat.draft=f.view.inputValue;}});
  await assert.rejects(f.submit(),error=>{
    assert.equal(error.message,'evaluation_draft_not_ready');
    assert.equal(error.submissionDiagnostics.draftFills,3);
    assert.equal(error.submissionDiagnostics.expectedCharacters,'Investigate only. Do not submit anything.'.length);
    assert.equal(error.submissionDiagnostics.inputCharacters,error.submissionDiagnostics.expectedCharacters+2);
    assert(!JSON.stringify(error.submissionDiagnostics).includes('Investigate'));
    return true;
  });
  assert.deepEqual(f.calls,{activate:1,fill:3,click:0});
});

test('conversation change or concurrent execution during draft synchronization aborts before clicking',async()=>{
  for(const change of [f=>{f.current.chat.sessionId='other';},f=>{f.current.busy=true;},f=>{f.current.chat.messages=[{role:'user',content:'Other request'}];}]) {
    const f=fixture({fill:change});
    await assert.rejects(f.submit(),/evaluation_send_(session_changed|already_started)/);assert.equal(f.calls.click,0);
  }
});

test('timed-out click is reconciled with its actual request acknowledgement without replay',async()=>{
  const f=fixture({click:()=>{throw Error('Timeout 30000ms exceeded: element is not stable PRIVATE_DRAFT');},tick:(f,time)=>{
    if(f.calls.click&&time>=200)f.current.chat.messages=[{id:'user-2',role:'user',content:f.view.inputValue},{id:'request-2',role:'assistant',state:'done'}];
  }});
  const received=await f.submit();assert.equal(received.requestId,'request-2');assert(received.reconciledAfterClickError);
  assert.deepEqual(received.clickReasons,['not_stable','timeout']);assert.equal(f.calls.click,1);
  assert(!JSON.stringify(received).includes('PRIVATE_DRAFT'));
});

test('unacknowledged click reports only allowlisted metadata and is never retried',async()=>{
  const f=fixture({click:()=>{throw Error('locator.click: Timeout 30000ms exceeded. PRIVATE_TOKEN PRIVATE_DRAFT intercepts pointer events');}});
  await assert.rejects(f.submit(),error=>{
    assert.equal(error.message,'evaluation_send_unacknowledged');
    assert.deepEqual(error.submissionDiagnostics.clickReasons,['intercepted','timeout']);
    assert.equal(error.submissionDiagnostics.clickAttempted,true);
    assert.equal(error.submissionDiagnostics.inputCharacters,f.view.inputValue.length);
    const stored=JSON.stringify(error.submissionDiagnostics);
    for(const secret of ['PRIVATE_TOKEN','PRIVATE_DRAFT',f.view.inputValue,'new-session'])assert(!stored.includes(secret));
    return true;
  });
  assert.equal(f.calls.click,1);
});

test('acknowledgement must belong to this conversation and include the assistant request',async()=>{
  for(const changed of [false,true]) {
    const f=fixture({click:f=>{
      f.current.chat.messages=[{role:'user',content:f.view.inputValue}];
      if(changed){f.current.chat.sessionId='other';f.current.chat.messages.push({id:'other-request',role:'assistant'});}
    }});
    await assert.rejects(f.submit(),changed?/evaluation_send_session_changed/:/evaluation_send_unacknowledged/);
    assert.equal(f.calls.click,1);
  }
});

test('public composer adapter reads the applied DOM session and uses normal accessible controls only',async()=>{
  const calls=[];
  const button={disabled:false,getBoundingClientRect:()=>({x:10,y:20,width:30,height:30}),contains:node=>node==='own-svg'};
  const form={getAttribute:name=>name==='data-conversation-id'?'applied-session':null,
    querySelector:()=>({value:'LOCAL_INPUT',disabled:false}),querySelectorAll:()=>[button]};
  const ui={bringToFront:async()=>calls.push('activate'),evaluate:async fn=>runInNewContext(`(${fn.toString()})()`,{
    document:{hidden:false,querySelectorAll:()=>[form],elementFromPoint:()=> 'own-svg'},getComputedStyle:()=>({visibility:'visible',display:'block'})}),
    getByRole:(role,options)=>({fill:async text=>calls.push({role,options,text}),click:async options=>calls.push({role,options})})};
  const adapter=evaluationComposer(ui),view=await adapter.inspect();
  assert.equal(view.conversationId,'applied-session');assert.equal(view.inputValue,'LOCAL_INPUT');assert(view.centerHitsButton);
  await adapter.activate();await adapter.fill('test');await adapter.click();
  assert.deepEqual(calls[1],{role:'textbox',options:{name:'메시지',exact:true},text:'test'});
  assert.deepEqual(calls[2],{role:'button',options:{timeout:30000}});
  const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(app,/<form className="composer" data-conversation-id=\{data.chat.sessionId\}/);
  assert.deepEqual(evaluationClickReasons(Error('secret custom failure')),[]);
});

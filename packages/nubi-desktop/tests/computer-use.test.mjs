import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {fixture} from './fixtures.mjs';
import {WinappComputer,observeComputer,proposeComputerAction,verifyComputerValue,imageDifference,readPng} from '../runtime/computer-use.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {createComputerProgress,computerCheckpoint,readComputerResult} from '../runtime/computer-harness.mjs';
installAgent(ProjectService);

async function setup(t){
  const {service}=await fixture(t),task=await service.createTask({request:'로컬 앱에서 결과를 확인한다.'});
  const status={hwnd:100,processId:42,processName:'Fixture',windowTitle:'Test app',windowDpi:144,scale:1.5,coordinateSpace:'physical-screen-pixels'};
  const control={selector:'txt-query-ab12',name:'검색',type:'Edit',isEnabled:true,isOffscreen:false,x:-180,y:60,width:120,height:40,isInvokable:true};
  const data={status,control,text:'old',calls:[],failAction:false,failAfter:false,password:'False',acted:0};
  const runner=async args=>{
    data.calls.push(args);const command=args[1];
    if(command==='list-windows')return [{...status,title:status.windowTitle,width:800,height:600}];
    if(command==='status')return {...status};
    if(command==='inspect')return {windows:[{hwnd:100,elements:[{...control}]}]};
    if(command==='get-property')return {elementId:control.selector,element:{...control},properties:{IsPassword:data.password,IsReadOnly:'False'}};
    if(command==='get-value')return {elementId:control.selector,text:data.text};
    if(command==='screenshot'){
      if(data.failAfter&&data.acted)throw Error('capture failed');
      const png=new PNG({width:120,height:40});png.data.fill(data.acted?240:255);
      const file=args[args.indexOf('--output')+1];await writeFile(file,PNG.sync.write(png));
      return {hwnd:100,elementId:args[2]==='--capture-screen'?null:args[2],filePath:file,width:120,height:40};
    }
    data.acted++;
    if(command==='set-value')data.text=args[3];
    if(data.failAction)throw Error('response lost after input');
    return {ok:true};
  };
  service.computerAdapter=new WinappComputer({platform:'win32',runner});
  await service.computer({method:'bind',taskId:task.id,window:100});
  const propose=async(action='click',extra={})=>{
    const observation=await observeComputer(service,task.id);
    return proposeComputerAction(service,task.id,{observationId:observation.observationId,selector:control.selector,action,reason:'요청한 결과를 확인합니다.',...extra});
  };
  const decide=(p,decision='approve')=>service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision});
  return {service,task,data,propose,decide};
}
test('computer use is unavailable outside Windows and does not discover PATH executables',()=>{
  assert.equal(new WinappComputer({platform:'darwin'}).availability().available,false);
  assert.equal(new WinappComputer({platform:'win32',binary:'winapp'}).availability().available,false);
});
test('proposal is inert; one approved click captures readback and duplicate decisions do not replay',async t=>{
  const {service,data,propose,decide}=await setup(t),p=await propose();assert.equal(data.acted,0);
  const [a,b]=await Promise.all([decide(p),decide(p)]);assert.equal(data.acted,1);
  const receipt=service.state().computer.actions[0];assert.equal(receipt.state,'observed');assert.equal(receipt.verification,'not_verified');assert.equal(receipt.visualDifference.changedPixels,0); // threshold ignores small pixel differences
  assert(!('before' in receipt));assert(a.actions&&b.actions);
  assert.deepEqual(data.calls.find(v=>v[1]==='click'),['ui','click','txt-query-ab12','-w','100','--json']);
});
test('literal text uses set-value argv and exact readback instead of key grammar',async t=>{
  const {data,propose,decide,service}=await setup(t),value='한국어 + {ENTER} $(echo no)';
  const p=await propose('set_value',{value});await decide(p);
  assert.equal(data.text,value);assert.equal(data.calls.find(v=>v[1]==='set-value')[3],value);assert.equal(service.state().computer.actions[0].verification,'value_matched');
});
test('changed input is preserved and a moved target cannot be clicked',async t=>{
  const {data,propose,decide,service}=await setup(t);const p=await propose('set_value',{value:'new'});data.text='human edit';await decide(p);
  assert.equal(data.acted,0);assert.equal(data.text,'human edit');assert.equal(service.state().computer.actions[0].state,'stale');
  const q=await propose();data.control.x+=20;await decide(q);assert.equal(data.acted,0);
});
test('expired approval, HWND identity changes and user cancellation never issue input',async t=>{
  const {data,propose,decide,service,task}=await setup(t),p=await propose();
  const saved=service.store.get('computer-action:'+p.id);saved.expiresAt=0;service.store.set('computer-action:'+p.id,saved);await decide(p);assert.equal(data.acted,0);
  const q=await propose();data.status.processId++;await decide(q);assert.equal(data.acted,0);
  service.store.set('task:'+task.id,{...task,state:'cancelled'});await assert.rejects(()=>propose(),/computer_cancelled/);
});
test('uncertain click outcome is journaled and cannot be replayed or disguised as another proposal',async t=>{
  const {data,propose,decide,service}=await setup(t),p=await propose();data.failAction=true;
  await decide(p);assert.equal(service.state().computer.actions[0].execution,'unknown');await decide(p);assert.equal(data.acted,1);
  await assert.rejects(()=>propose(),/computer_review_required/);
  await decide(p,'acknowledge');assert.equal(service.state().computer.actions[0].state,'acknowledged');assert.equal(data.acted,1);
});
test('failed readback remains uncertain even after CLI returned successfully',async t=>{
  const {data,propose,decide,service}=await setup(t),p=await propose('hover');data.failAfter=true;await decide(p);
  assert.equal(data.acted,1);assert.equal(service.state().computer.actions[0].state,'attention');assert.equal(service.state().computer.actions[0].execution,'command_returned');
  assert(data.calls.some(v=>v[1]==='hover'&&v.includes('--dwell-time')));
});
test('missing password metadata, raw coordinates and offscreen controls fail closed',async t=>{
  const {service,task,data,propose}=await setup(t);data.password=undefined;await assert.rejects(()=>propose('set_value',{value:'secret'}),/computer_input_unavailable/);
  data.control.isOffscreen=true;await assert.rejects(()=>propose('click'),/computer_target_unavailable/);
  await assert.rejects(()=>proposeComputerAction(service,task.id,{observationId:'x',selector:'10,20',action:'click',reason:'click'}),/computer_invalid/);assert.equal(data.acted,0);
});
test('rejecting and disconnecting invalidate action execution without replay',async t=>{
  const {service,task,data,propose,decide}=await setup(t);const p=await propose();await decide(p,'reject');await decide(p);assert.equal(data.acted,0);
  const q=await propose();await service.computer({method:'unbind',taskId:task.id});await decide(q);assert.equal(data.acted,0);assert.equal(service.state().computer.actions[0].state,'stale');
});
test('host restart loses window grant and quarantines an in-flight action',async t=>{
  const {service,task,propose}=await setup(t),p=await propose();const item=service.store.get('computer-action:'+p.id);item.state='starting';service.store.set('computer-action:'+p.id,item);
  const root=service.root;service.store.close();await service.open(root);
  assert.equal(service.state().computer.binding,null);assert.equal(service.state().computer.actions[0].state,'attention');
  await assert.rejects(()=>observeComputer(service,task.id),/computer_binding_required/);
});
test('PNG analysis rejects malformed and oversized images; image differences do not assert success',()=>{
  assert.throws(()=>readPng(Buffer.from('bad')),/computer_image_invalid/);
  const a=new PNG({width:2,height:2}),b=new PNG({width:3,height:2});a.data.fill(255);b.data.fill(0);
  assert.deepEqual(imageDifference({data:PNG.sync.write(a).toString('base64')},{data:PNG.sync.write(b).toString('base64')}),{state:'size_changed',verification:'not_verified'});
});

test('structured-only observation and independent exact-value check do not capture or issue input',async t=>{
  const {service,task,data}=await setup(t);const o=await observeComputer(service,task.id,{includeImage:false});
  assert.equal(o.image,undefined);assert(!data.calls.some(v=>v[1]==='screenshot'));
  const args={observationId:o.observationId,selector:data.control.selector,expected:'old'};
  const matched=await verifyComputerValue(service,task.id,args);assert.equal(matched.verification,'value_matched');assert.equal(matched.scope,'exact_control_value');
  data.text='a different value';assert.equal((await verifyComputerValue(service,task.id,args)).verification,'value_mismatch');assert.equal(data.acted,0);assert.equal(service.state().computer.checks.length,2);
  data.password='True';await assert.rejects(()=>verifyComputerValue(service,task.id,args),/computer_input_unavailable/);
  data.password='False';data.control.width++;await assert.rejects(()=>verifyComputerValue(service,task.id,args),/computer_target_changed/);
});

test('Pi can verify structured values with no image-capable model and no mutation tools',async t=>{
  const {service,task,data}=await setup(t);let round=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'text-fixture',models:[{id:'text-fixture',contextLength:32000}]}),dispose(){},complete:async(messages)=>{
    assert.doesNotMatch(JSON.stringify(messages),/data:image\/png;base64/);
    if(++round===1)return call('observe_computer',{includeImage:false});
    if(round===2){const o=JSON.parse(messages.findLast(m=>m.role==='tool').content);return call('verify_computer_value',{observationId:o.observationId,selector:data.control.selector,expected:'old'});}
    assert.match(JSON.stringify(messages),/value_matched/);return {content:'조회한 값이 일치합니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(round,3);assert.equal(data.acted,0);assert.equal(service.state().computer.checks[0].verification,'value_matched');
});

test('shared Pi sends actual PNG observations to the model, proposes only and receives host receipts',async t=>{
  const {service,task,data,decide}=await setup(t);let round=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,definitions)=>{
    assert(!definitions.some(v=>v.function?.name==='computer'||v.function?.name==='decide_computer_action'));
    if(++round===1)return call('observe_computer',{});
    if(round===2){
      assert.match(JSON.stringify(messages),/data:image\/png;base64/);
      const result=JSON.parse(messages.findLast(m=>m.role==='tool').content);
      return call('propose_computer_action',{observationId:result.observationId,selector:result.elements[0].selector,action:'hover',reason:'도움말 표시를 확인합니다.'});
    }
    if(round===3)assert.match(JSON.stringify(messages),/command_returned/);
    return {content:'확인된 기록을 검토해 주세요.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(data.acted,0);assert.equal(round,2);
  await decide(service.state().computer.actions[0]);assert.equal(data.acted,1);
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(round,3);assert.equal(data.acted,1);
});

test('frozen Windows captures reach isolated page/review agents but cannot grant leader input authority',async t=>{
  const {service,task,data,propose,decide}=await setup(t);const p=await propose();await decide(p);
  task.request='PARENT_PRIVATE: inspect the approved result';service.store.set('task:'+task.id,task);
  let stage=0,evidenceId;const children=new Map();
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,tools)=>{
    const role=/isolated (page|review) analyst/.exec(messages[0].content)?.[1];
    if(role){
      assert(!JSON.stringify(messages).includes('PARENT_PRIVATE'));assert(tools.every(t=>t.function.name==='read_analysis_evidence'));
      const count=(children.get(role)||0)+1;children.set(role,count);
      if(count===1){const brief=JSON.parse(messages[1].content);assert.equal(brief.evidence[0].kind,'computer');assert.equal(brief.evidence[0].historical,true);return call('read_analysis_evidence',{evidence_id:evidenceId,mode:'image'});}
      assert.match(JSON.stringify(messages),/data:image\/png;base64/);
      return {content:JSON.stringify({status:'complete',summary:'Captured result inspected',findings:[{text:'This is historical capture, not current input authority.',evidence_ids:[evidenceId]}],uncertainties:['Business outcome requires another check.'],next_step:'Freshly observe the app.'}),calls:[]};
    }
    if(stage++===0)return call('read_computer_result',{actionId:p.id,includeImage:true});
    if(stage===2){evidenceId=JSON.parse(messages.findLast(m=>m.role==='tool').content).analysis_evidence_id;assert(evidenceId);return call('delegate_analysis',{tasks:['page','review'].map(role=>({role,task:'Inspect only this frozen result.',done_when:'Return evidence and uncertainty.',evidence_ids:[evidenceId]}))});}
    if([...children.values()].some(n=>n<2)||children.size<2)return call('collect_analysis',{wait:true});
    if(!JSON.stringify(messages).includes('computer_observation_stale'))return call('propose_computer_action',{observationId:p.observationId,selector:data.control.selector,action:'click',reason:'Must fail without leader fresh read'});
    return {content:'현재 화면을 다시 읽어야 합니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(children.size,2);assert.equal(data.acted,1);assert.equal(service.state().computer.actions.length,1);
});

test('result analysis is one-shot, preserves the native receipt and never replays the approved operation',async t=>{
  const {service,task,data,propose,decide}=await setup(t);const p=await propose();await decide(p);let calls=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{calls++;assert.match(JSON.stringify(messages),new RegExp(p.id));return {content:'동작 기록을 확인했습니다. 업무 성공은 미확인입니다.',calls:[]};}};
  const args={method:'review_result',taskId:task.id,id:p.id,fingerprint:p.fingerprint};await Promise.all([service.computer(args),service.computer(args)]);await service.agent.promise;await new Promise(r=>setTimeout(r,0));
  await service.computer(args);assert.equal(calls,1);assert.equal(data.acted,1);assert.equal(service.state().computer.actions[0].review.state,'finished');assert.equal(service.state().computer.actions[0].verification,'not_verified');
});

test('failed analysis connection does not relabel the successful native action or lose its capture',async t=>{
  const {service,task,data,propose,decide}=await setup(t);const p=await propose();await decide(p);
  await service.computer({method:'review_result',taskId:task.id,id:p.id,fingerprint:p.fingerprint});const action=service.state().computer.actions[0];
  assert.equal(action.state,'observed');assert.equal(action.review.state,'unavailable');assert.equal(data.acted,1);assert(readComputerResult(service,task.id,{actionId:p.id,includeImage:true}).image);
  const other=await service.createTask({request:'Other task'});assert.throws(()=>readComputerResult(service,other.id,{actionId:p.id}),/computer_result_missing/);
  await service.computer({method:'unbind',taskId:task.id});assert.throws(()=>readComputerResult(service,task.id,{actionId:p.id,includeImage:true}),/computer_binding_required/);
  assert.equal(computerCheckpoint(service,task.id).actions[0].execution,'command_returned');
});

test('new observation IDs and repeated successful reads do not erase unchanged native failures',()=>{
  const progress=createComputerProgress(),observe=id=>progress.observe('observe_computer',{}, {observationId:id,identity:{hwnd:1},elements:[{name:'unchanged'}]});
  observe('first');for(let i=0;i<3;i++){const result=progress.observe('propose_computer_action',{}, {error:'computer_target_unavailable'});assert.equal(result.needsInput,i===2);observe('new-id-'+i);}
  progress.observe('observe_computer',{}, {observationId:'changed',identity:{hwnd:1},elements:[{name:'changed'}]});assert.equal(progress.observe('propose_computer_action',{}, {error:'computer_target_unavailable'}).failures,1);
});

test('three unchanged Windows failures pause the same task in existing HITL without input',async t=>{
  const {service,task,data}=await setup(t);let calls=0;
  service.computerBinding=null;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>{calls++;return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'observe_computer',arguments:JSON.stringify({includeImage:!!(calls%2)})}}]};}};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'waiting_input');assert(service.task(task.id).question);assert.equal(calls,3);assert.equal(data.acted,0);
});

test('a pending or uncertain newer operation blocks continuation from an older result',async t=>{
  const {service,task,data,propose,decide}=await setup(t);const first=await propose();await decide(first);const next=await propose();
  const args={method:'review_result',taskId:task.id,id:first.id,fingerprint:first.fingerprint};
  await assert.rejects(()=>service.computer(args),/computer_review_required/);
  data.failAction=true;await decide(next);await assert.rejects(()=>service.computer(args),/computer_review_required/);
  assert.equal(data.acted,2);assert.equal(service.store.get('computer-action:'+first.id).review,undefined);
});

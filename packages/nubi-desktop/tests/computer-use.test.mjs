import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {writeFile,symlink,readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {fixture} from './fixtures.mjs';
import {WinappComputer,observeComputer,proposeComputerAction,verifyComputerValue,imageDifference,readPng} from '../runtime/computer-use.mjs';
import {rememberWikiEvidence} from '../runtime/wiki-evidence.mjs';
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
    if(command==='inspect')return {windows:[{hwnd:100,elements:data.acted&&data.afterElements?data.afterElements:(data.elements||[{...control}])}]};
    if(command==='search')return data.searchResult||{matchCount:1,hasMore:false,matches:[{...control}]};
    if(command==='get-property'){const selected=data.elements?.find(v=>v.selector===args[2])||control;return {elementId:selected.selector,element:{...selected},properties:{IsPassword:data.password,IsReadOnly:'False',...data.properties}};}
    if(command==='get-value')return {elementId:control.selector,text:data.text};
    if(command==='screenshot'){
      if(data.failAfter&&data.acted)throw Error('capture failed');
      const png=new PNG({width:120,height:40});png.data.fill(data.acted?240:255);
      const file=args[args.indexOf('--output')+1];await writeFile(file,PNG.sync.write(png));
      return {hwnd:100,elementId:args[2]==='--capture-screen'?null:args[2],filePath:file,width:120,height:40};
    }
    data.acted++;
    if(data.onAction)await data.onAction();
    if(command==='set-value')data.text=args[3];
    if(command==='invoke'&&data.transition)data.transition(args[4]);
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
for(const [action,property,before,after,native] of [
  ['select','IsSelected','False','True','select'],
  ['toggle_on','ToggleState','Off','On','toggle-on'],
  ['toggle_off','ToggleState','On','Off','toggle-off'],
  ['expand','ExpandCollapseState','Collapsed','Expanded','expand'],
  ['collapse','ExpandCollapseState','Expanded','Collapsed','collapse'],
])test('explicit UIA '+action+' reads back state without physical input and is not replayed',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  data.properties={[property]:before};data.transition=command=>{assert.equal(command,native);data.properties[property]=after;};
  const observed=await observeComputer(service,task.id,{selector:data.control.selector,includeImage:false});assert(observed.target.controlState);
  const p=await propose(action);assert.equal(data.acted,0);await decide(p);await decide(p);
  const receipt=readComputerResult(service,task.id,{actionId:p.id}).receipt;
  assert.equal(receipt.verification,'state_matched');assert.equal(receipt.controlCheck.actual,after);assert.equal(receipt.controlCheck.scope,'exact_control_state');assert.equal(data.acted,1);
  assert(!data.calls.some(args=>['click','hover','drag','send-keys','focus'].includes(args[1])));
  const q=await propose(action);await decide(q);assert.equal(data.acted,1);assert.equal(service.store.get('computer-action:'+q.id).execution,'already_at_target');
});

test('missing patterns and leaf nodes cannot grant actions; changed state invalidates approval',async t=>{
  const {service,data,propose,decide}=await setup(t);
  for(const action of ['select','toggle_on','expand'])await assert.rejects(()=>propose(action),/computer_target_unavailable/);
  data.properties={ExpandCollapseState:'LeafNode'};await assert.rejects(()=>propose('expand'),/computer_target_unavailable/);
  data.properties={ToggleState:'Off'};const p=await propose('toggle_on');data.properties.ToggleState='On';await decide(p);
  assert.equal(data.acted,0);assert.equal(service.store.get('computer-action:'+p.id).state,'stale');
});

for(const unreadable of [false,true])test('state '+(unreadable?'missing':'mismatch')+' after a returned command stays unresolved',async t=>{
  const {service,data,propose,decide}=await setup(t);data.properties={IsSelected:'False'};
  if(unreadable)data.transition=()=>{delete data.properties.IsSelected;};
  const p=await propose('select');await decide(p);await decide(p);
  const receipt=service.store.get('computer-action:'+p.id);assert.equal(receipt.state,'attention');assert.equal(receipt.verification,unreadable?'state_unavailable':'state_mismatch');assert.equal(data.acted,1);
  await assert.rejects(()=>propose('select'),/computer_review_required/);
});

test('state action response loss never replays an operation that already changed the app',async t=>{
  const {service,data,propose,decide}=await setup(t);data.properties={ToggleState:'Off'};data.transition=()=>{data.properties.ToggleState='On';};data.failAction=true;
  const p=await propose('toggle_on');await decide(p);await decide(p);
  assert.equal(data.properties.ToggleState,'On');assert.equal(data.acted,1);assert.equal(service.store.get('computer-action:'+p.id).execution,'unknown');
});

test('computer proposals require actually retrieved Wiki references and revalidate them at approval',async t=>{
  const {service,task,data,decide}=await setup(t),observations={};
  const row=(await service.wikiQuery({query:'welcome',taskId:task.id})).results[0];assert(row);
  const o=await observeComputer(service,task.id);
  const args={observationId:o.observationId,selector:data.control.selector,action:'invoke',reason:'문서의 안내를 확인합니다.',evidenceIds:[row.evidenceId]};
  await assert.rejects(()=>proposeComputerAction(service,task.id,args,observations),/wiki_evidence_required/);
  rememberWikiEvidence(observations,[row]);const proposal=await proposeComputerAction(service,task.id,args,observations);
  assert.equal(proposal.wikiEvidence[0].path,row.path);
  await writeFile(service.root+'/'+row.path,'# Updated\nA human changed the work instructions.');
  await decide(proposal);const receipt=readComputerResult(service,task.id,{actionId:proposal.id}).receipt;
  assert.equal(receipt.state,'stale');assert.equal(receipt.error,'wiki_evidence_stale');assert.equal(data.acted,0);assert.equal(receipt.wikiEvidence[0].evidenceId,row.evidenceId);
  const record=await service.recordKnowledge({taskId:task.id}),content=await readFile(service.root+'/'+record.path,'utf8');
  assert.match(content,/## 앱 동작에 사용한 Wiki/);assert(content.includes(row.path+':'+row.provenance.start));assert(content.includes(row.hash));assert.doesNotMatch(content,/Test app|Fixture|txt-query-ab12/);
  await writeFile(service.root+'/'+row.path,'# Updated again\nAnother human edit.');assert.equal((await service.knowledgeStatus({taskId:task.id})).state,'outdated');
  await assert.rejects(()=>proposeComputerAction(service,task.id,args,observations),/wiki_evidence_stale/);
});

for(const phase of ['move','pulse'])test('Wiki changes during visual pointer '+phase+' stop native input',async t=>{
  const {service,task,data,decide}=await setup(t),observations={};
  const row=(await service.wikiQuery({query:'welcome',taskId:task.id})).results[0];assert(row);
  rememberWikiEvidence(observations,[row]);
  const o=await observeComputer(service,task.id);
  const proposal=await proposeComputerAction(service,task.id,{observationId:o.observationId,selector:data.control.selector,action:'invoke',reason:'Wiki에서 확인한 안내를 엽니다.',evidenceIds:[row.evidenceId]},observations);
  const events=[];
  const change=async()=>writeFile(service.root+'/'+row.path,'# Updated\nA changed instruction during approval.');
  service.computerPointer={dispose(){},async move(){events.push('move');if(phase==='move')await change();return {available:true};},async pulse(){events.push('pulse');if(phase==='pulse')await change();},async hide(){events.push('hide');return {available:true};}};
  await decide(proposal);await decide(proposal);
  const receipt=readComputerResult(service,task.id,{actionId:proposal.id}).receipt;
  assert.equal(data.acted,0);assert.equal(receipt.state,'stale');assert.equal(receipt.execution,'not_started');assert.equal(receipt.error,'wiki_evidence_stale');
  assert.deepEqual(events,['move','pulse','hide']);
  assert.equal(service.store.get('computer-image:'+proposal.id).after,undefined);
});

test('Pi carries its own Wiki evidence into an approved UIA state action and reads the receipt',async t=>{
  const {service,task,data,decide}=await setup(t);let round=0,evidenceId;
  data.properties={ToggleState:'Off'};data.transition=()=>{data.properties.ToggleState='On';};
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,definitions)=>{
    const definition=definitions.find(v=>v.function?.name==='propose_computer_action').function;
    assert(definition.parameters.properties.action.enum.includes('toggle_on'));assert.match(definition.description,/Real input, approved on its own/);
    const last=messages.findLast(m=>m.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(++round){
      case 1:return call('wiki_query',{query:'welcome'});
      case 2:evidenceId=result.results[0].evidenceId;return call('observe_computer',{selector:data.control.selector,includeImage:false});
      case 3:assert.equal(result.target.controlState.toggle,'Off');return call('propose_computer_action',{observationId:result.observationId,selector:data.control.selector,action:'toggle_on',reason:'문서에 연결한 설정을 확인합니다.',evidenceIds:[evidenceId]});
      default:assert.match(JSON.stringify(messages),/state_matched/);return {content:'설정 상태가 일치합니다. 업무 결과는 추가 확인이 필요합니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(data.acted,0);assert.equal(round,3);
  const p=service.state().computer.actions[0];assert.equal(p.wikiEvidence[0].evidenceId,evidenceId);await decide(p);
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(round,4);assert.equal(data.acted,1);
});

test('computer use is unavailable outside Windows and does not discover PATH executables',()=>{
  assert.equal(new WinappComputer({platform:'darwin'}).availability().available,false);
  assert.equal(new WinappComputer({platform:'win32',binary:'winapp'}).availability().available,false);
});
test('proposal is inert; one approved click captures readback and duplicate decisions do not replay',async t=>{
  const {service,data,propose,decide}=await setup(t),p=await propose();assert.equal(data.acted,0);
  const [a,b]=await Promise.all([decide(p),decide(p)]);assert.equal(data.acted,1);
  const receipt=service.state().computer.actions[0];assert.equal(receipt.state,'observed');assert.equal(receipt.verification,'not_verified');assert.equal(receipt.visualDifference.state,'scope_changed'); // target crop and full result window are not comparable
  assert(!('before' in receipt));assert(a.actions&&b.actions);
  assert.deepEqual(data.calls.find(v=>v[1]==='invoke'),['ui','invoke','txt-query-ab12','--action','invoke','-w','100','--json']);
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
  const {data,propose,decide,service}=await setup(t),p=await propose('invoke');data.failAfter=true;await decide(p);
  assert.equal(data.acted,1);assert.equal(service.state().computer.actions[0].state,'attention');assert.equal(service.state().computer.actions[0].execution,'command_returned');
  assert(data.calls.some(v=>v[1]==='invoke'));assert(!data.calls.some(v=>['click','hover','send-keys'].includes(v[1])));
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
      return call('propose_computer_action',{observationId:result.observationId,selector:result.elements[0].selector,action:'invoke',reason:'버튼 결과를 확인합니다.'});
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
  data.status.processId=777; // Bound identity has changed; setup absence is handled separately.
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>{calls++;return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'observe_computer',arguments:JSON.stringify({includeImage:!!(calls%2)})}}]};}};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'waiting_input');assert(service.task(task.id).question);assert.equal(calls,3);assert.equal(data.acted,0);
});

test('a pending or uncertain newer operation blocks continuation from an older result',async t=>{
  const {service,task,data,propose,decide}=await setup(t);const first=await propose();await decide(first);
  // The first action changed nothing that the host saw: the same proposal is warned about once, then accepted.
  await assert.rejects(()=>propose(),/computer_no_effect_repeat/);const next=await propose();
  const args={method:'review_result',taskId:task.id,id:first.id,fingerprint:first.fingerprint};
  await assert.rejects(()=>service.computer(args),/computer_review_required/);
  data.failAction=true;await decide(next);await assert.rejects(()=>service.computer(args),/computer_review_required/);
  assert.equal(data.acted,2);assert.equal(service.store.get('computer-action:'+first.id).review,undefined);
});

// 150 elements before the user decision of 2026-09-30 on large windows (case A16).
test('targeted UIA search finds a control outside the first INSPECT_ELEMENTS elements without input or capture',async t=>{
  const {service,task,data}=await setup(t);
  const {INSPECT_ELEMENTS}=await import('../runtime/computer-use.mjs');assert.equal(INSPECT_ELEMENTS,400);
  data.elements=Array.from({length:INSPECT_ELEMENTS+10},(_,i)=>({...data.control,selector:'row-'+i,name:'Unrelated row'}));
  const shallow=await observeComputer(service,task.id,{includeImage:false});
  assert.equal(shallow.elements.length,INSPECT_ELEMENTS);assert.equal(shallow.truncated,true);
  const focused=await observeComputer(service,task.id,{query:'검색',includeImage:false});
  assert.equal(focused.elements[0].selector,data.control.selector);assert.equal(focused.coverage.mode,'search');
  assert.deepEqual(data.calls.find(v=>v[1]==='search'),['ui','search','검색','-w','100','--max','20','--json']);
  assert(!data.calls.some(v=>v[1]==='screenshot'));assert.equal(data.acted,0);
  await proposeComputerAction(service,task.id,{observationId:focused.observationId,selector:data.control.selector,action:'click',reason:'확인'});
  assert.equal(data.acted,0); // search evidence authorizes a proposal, never execution
});

test('search empty results are partial evidence and malformed results never grant selectors',async t=>{
  const {service,task,data}=await setup(t);
  data.searchResult={matchCount:0,hasMore:false,matches:[]};
  const result=await observeComputer(service,task.id,{query:'존재하지 않음',includeImage:false});
  assert.deepEqual(result.elements,[]);assert.equal(result.coverage.complete,false);
  // Several keywords in one query match no control (A5, 2026-09-30): the result says to search one word of a label.
  assert.match(result.searchHint,/one word or a short phrase of a single label/);
  data.searchResult={matchCount:1,hasMore:false,matches:[data.control]};
  assert.equal((await observeComputer(service,task.id,{query:'검색',includeImage:false})).searchHint,undefined);
  data.searchResult={matchCount:0,hasMore:false,matches:[]};
  for(const query of ['', ' -w', '\0', 'x'.repeat(201)])await assert.rejects(()=>observeComputer(service,task.id,{query,includeImage:false}),/computer_invalid/);
  data.searchResult={matchCount:2,hasMore:false,matches:[data.control,data.control]};
  await assert.rejects(()=>observeComputer(service,task.id,{query:'검색'}),/computer_contract/);
  data.searchResult={matchCount:9,hasMore:false,matches:[data.control]};
  await assert.rejects(()=>observeComputer(service,task.id,{query:'검색'}),/computer_contract/);
  assert.equal(data.acted,0);
});

test('only documented empty search exit 1 is a successful read, never an action or transport error',async()=>{
  let error=Object.assign(Error('empty'),{code:1,stdout:JSON.stringify({matchCount:0,hasMore:false,matches:[]}),stderr:''});
  const a=new WinappComputer({platform:'win32',runner:async()=>{throw error;}});
  assert.deepEqual((await a.search(100,'missing')).elements,[]);
  await assert.rejects(()=>a.act(100,'btn-x','click'),/computer_command_failed/);
  for(const extra of [{killed:true},{signal:'SIGTERM'},{stderr:'failed'},{code:2},{stdout:'not json'},{stdout:'{"error":"unavailable"}'}]){
    const original=error;error=Object.assign(Error('failed'),original,extra);
    await assert.rejects(()=>a.search(100,'missing'),/computer_command_failed/);error=original;
  }
});

test('click readback observes a new screen after the old target disappears; history grants no new action',async t=>{
  const {service,task,data,propose,decide}=await setup(t),p=await propose();
  data.afterElements=[{...data.control,selector:'txt-result',name:'결과'}];
  const original=service.computerAdapter.runner;
  service.computerAdapter.runner=async args=>{
    if(data.acted&&((args[1]==='screenshot'&&args[2]===data.control.selector)||args[1]==='get-property'))throw Error('old target disappeared');
    return original(args);
  };
  await decide(p);await decide(p);
  const result=readComputerResult(service,task.id,{actionId:p.id,includeImage:true});
  assert.equal(result.receipt.state,'observed');assert.equal(result.receipt.verification,'not_verified');assert.equal(data.acted,1);
  assert.equal(result.image.scope,'window_region');assert.equal(result.observation.elements[0].selector,'txt-result');
  assert.equal(result.observation.historical,true);assert.equal(service.computerObservation,null);
  await assert.rejects(()=>proposeComputerAction(service,task.id,{observationId:p.observationId,selector:'txt-result',action:'click',reason:'확인'}),/computer_observation_stale/);
  assert(readComputerResult(service,task.id,{actionId:p.id}).observation); // text-only models can inspect UIA
  await service.computer({method:'unbind',taskId:task.id});
  assert.equal(readComputerResult(service,task.id,{actionId:p.id}).observation,undefined);
});

test('query switches, result order and new observations do not reset repeated failures',()=>{
  const p=createComputerProgress(),elements=[{selector:'a'},{selector:'b'}];
  const observe=(query,els=elements)=>p.observe('observe_computer',{}, {observationId:crypto.randomUUID(),identity:{hwnd:1},coverage:{mode:'search',query},elements:els});
  const failed=()=>p.observe('propose_computer_action',{}, {error:'computer_target_unavailable'});
  observe('first');failed();observe('second');failed();observe('first',[...elements].reverse());assert.equal(failed().needsInput,true);
  observe('first',[{selector:'c'}]);assert.equal(failed().failures,1);
});

test('upstream nullable accessible names remain usable without weakening selector or geometry checks',async t=>{
  const {service,task,data}=await setup(t);delete data.control.name;
  const result=await observeComputer(service,task.id,{includeImage:false});assert.equal(result.elements[0].name,'');
  data.control.name=42;await assert.rejects(()=>observeComputer(service,task.id,{includeImage:false}),/computer_contract/);
});
test('window screenshot accepts omitted nullable elementId from upstream JSON',async t=>{
  const {service,task}=await setup(t),a=service.computerAdapter,original=a.runner;
  a.runner=async args=>{const result=await original(args);if(args[1]==='screenshot'&&result.elementId===null)delete result.elementId;return result;};
  const result=await observeComputer(service,task.id);assert(result.image.data);
});
test('AutomationId tree aliases resolve to native semantic selectors without weakening target checks',async t=>{
  const {service,data,propose,decide}=await setup(t),a=service.computerAdapter,original=a.runner;
  data.control.selector='NubiValue';const canonical='txt-nubivalue-1651';
  a.runner=async args=>{
    const result=await original(args);
    if(args[1]==='get-property')return {...result,elementId:canonical,element:{...result.element,selector:canonical,automationId:'NubiValue'}};
    if(args[1]==='get-value'){assert.equal(args[2],canonical);return {...result,elementId:canonical};}
    if(args[1]==='screenshot'&&args[2]!=='--capture-screen')assert.equal(args[2],canonical);
    return result;
  };
  const p=await propose('set_value',{value:'verified'});await decide(p);
  assert.equal(service.store.get('computer-action:'+p.id).verification,'value_matched');assert.equal(data.acted,1);
  await assert.rejects(()=>a.property(100,'another-target'),/computer_target_changed/);
  a.runner=async()=>({elementId:'different',element:{...data.control,selector:canonical,automationId:'NubiValue'}});
  await assert.rejects(()=>a.property(100,'NubiValue'),/computer_target_changed/);
});
test('capture validates the actual output file while rejecting an unrelated returned path',async t=>{
  const {service}=await setup(t),a=service.computerAdapter,original=a.runner;
  a.runner=async args=>{const result=await original(args);if(args[1]==='screenshot'){const alias=result.filePath+'.alias';await symlink(result.filePath,alias,'file');return {...result,filePath:alias};}return result;};
  assert((await a.capture(100)).data);
  a.runner=async args=>{const result=await original(args);if(args[1]==='screenshot'){const other=result.filePath+'.different';await writeFile(other,'not the captured file');return {...result,filePath:other};}return result;};
  await assert.rejects(()=>a.capture(100),/computer_contract/);
});


test('unique automation IDs resolve to canonical UIA selectors without accepting a different element',async t=>{
 const {service,data}=await setup(t),a=service.computerAdapter,original=a.runner;
 a.runner=async args=>{const raw=await original(args);if(args[1]==='get-property')return {...raw,element:{...raw.element,automationId:'NubiValue'}};return raw;};
 const observed=await a.property(100,'NubiValue');assert.equal(observed.element.selector,'NubiValue');assert.equal(observed.resolvedSelector,data.control.selector);
 assert.equal(await a.value(100,'NubiValue'),'old');assert.equal(data.calls.findLast(v=>v[1]==='get-value')[2],data.control.selector);
 await assert.rejects(a.property(100,'DifferentControl'),/computer_target_changed/);
 a.runner=async args=>{const raw=await original(args);return args[1]==='get-property'?{...raw,elementId:'different-selector',element:{...raw.element,automationId:'NubiValue'}}:raw;};
 await assert.rejects(a.property(100,'NubiValue'),/computer_target_changed/);
});


test('UIA is the default and legacy hover records cannot acquire mouse consent',async t=>{
 const {service,task,data,propose,decide}=await setup(t),a=service.computerAdapter;
 for(const action of ['hover','drag','pointer_click'])await assert.rejects(a.act(100,data.control.selector,action),/computer_pointer_consent_required/);
 for(const action of ['right_click','unknown'])await assert.rejects(a.act(100,data.control.selector,action),/computer_virtual_only/);
 data.control.isInvokable=false;await assert.rejects(propose('click'),/computer_target_unavailable/);data.control.isInvokable=true;
 const p=await propose('click'),record=service.store.get('computer-action:'+p.id);service.store.set('computer-action:'+p.id,{...record,action:'hover'});
 await assert.rejects(decide(p),/computer_pointer_consent_required/);
 await assert.rejects(service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',pointerConsent:true}),/computer_pointer_consent_required/);assert.equal(data.acted,0);
 assert(!data.calls.some(v=>['click','hover','send-keys','drag'].includes(v[1])));
});

async function allowPointer(propose){
  for(let i=0;i<3;i++)await assert.rejects(()=>propose('select'),error=>error.message==='computer_target_unavailable'&&error.pointerFallback.failures===i+1);
}

// User decision 2026-09-30: every mouse operation, each approved on its own. Gestures that UIA does not offer are
// proposed directly; a left click is for a control that cannot be invoked (see the test after this one).
for(const [action,command,flag] of [['pointer_click','click',null],['pointer_double_click','click','--double'],['pointer_right_click','click','--right'],['hover','hover','--dwell-time']])test(action+' is proposed directly and needs a one-action mouse consent',async t=>{
  const {service,task,data,propose,decide}=await setup(t);data.control.isInvokable=false;
  const p=await propose(action);assert.equal(p.inputMode,'shared_pointer');assert.equal(p.pointerBasis,action==='pointer_click'?'not_invokable':'gesture');assert.equal(data.acted,0);
  await assert.rejects(decide(p),/computer_pointer_consent_required/);assert.equal(data.acted,0);
  const approve=()=>service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',pointerConsent:true});
  await approve();await approve();assert.equal(data.acted,1);
  const args=data.calls.find(v=>v[1]===command);assert(args);if(flag)assert(args.includes(flag));assert(args.includes('100'));
  const receipt=readComputerResult(service,task.id,{actionId:p.id}).receipt;assert.equal(receipt.pointerApproval.scope,'one_action');assert.equal(receipt.inputMode,'shared_pointer');assert.equal(receipt.verification,'not_verified');
  // The window did not change: the same gesture again is warned about once, then proposed with its own consent.
  await assert.rejects(propose(action),/computer_no_effect_repeat/);const q=await propose(action);assert.equal(q.repeats.times,1);
  await assert.rejects(decide(q),/computer_pointer_consent_required/);assert.equal(data.acted,1);
});

test('a real click on a control that can be invoked waits until its invoke changed nothing',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  await assert.rejects(propose('pointer_click'),/computer_uia_attempts_required/);assert.equal(data.acted,0);
  const invoked=await propose('invoke');await decide(invoked);assert.equal(data.acted,1);
  const p=await propose('pointer_click');assert.equal(p.pointerBasis,'invoke_no_change');
  await service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',pointerConsent:true});
  assert.equal(data.acted,2);assert.deepEqual(data.calls.find(v=>v[1]==='click'),['ui','click',data.control.selector,'-w','100','--json']);
});

test('drag binds two observed selectors and rejects a destination changed after approval preview',async t=>{
  const {service,task,data,propose}=await setup(t),destination={...data.control,selector:'drop-target',name:'도착 위치',x:100};data.elements=[data.control,destination];
  await allowPointer(propose);await assert.rejects(propose('drag'),/computer_invalid/);
  await assert.rejects(propose('drag',{destinationSelector:'unobserved'}),/computer_target_unavailable/);
  await assert.rejects(propose('drag',{destinationSelector:'200,300'}),/computer_invalid/);
  const p=await propose('drag',{destinationSelector:destination.selector});assert(service.store.get('computer-image:'+p.id).destinationBefore);
  destination.x++;await service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',pointerConsent:true});assert.equal(data.acted,0);
  const q=await propose('drag',{destinationSelector:destination.selector});await service.computer({method:'decide',taskId:task.id,id:q.id,fingerprint:q.fingerprint,decision:'approve',pointerConsent:true});
  assert.equal(data.acted,1);assert.deepEqual(data.calls.find(v=>v[1]==='drag'),['ui','drag',data.control.selector,'drop-target','-w','100','--json']);
});

test('lost pointer response is uncertain and is never resent',async t=>{
  const {service,task,data,propose}=await setup(t);await allowPointer(propose);const p=await propose('pointer_click');data.failAction=true;
  const args={method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',pointerConsent:true};
  await service.computer(args);await service.computer(args);assert.equal(data.acted,1);assert.equal(service.store.get('computer-action:'+p.id).execution,'unknown');
  await assert.rejects(propose('pointer_click'),/computer_review_required/);
});

test('user stop during an approved gesture preserves uncertainty and prevents subsequent steps',async t=>{
  const {service,task,data,propose}=await setup(t);await allowPointer(propose);const p=await propose('hover');let release,started;
  const waiting=new Promise(resolve=>{started=resolve;});data.onAction=()=>{started();return new Promise(resolve=>{release=resolve;});};
  const running=service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',pointerConsent:true});
  await waiting;await service.stopAgent({taskId:task.id});release();await running;
  const receipt=service.store.get('computer-action:'+p.id);assert.equal(receipt.state,'attention');assert.equal(data.acted,1);assert.equal(service.task(task.id).state,'cancelled');
  await assert.rejects(propose('hover'),/computer_cancelled/);
});

test('mouse fallback counts fresh safe UIA failures, not duplicated observations, and expires on rebind',async t=>{
  const {service,task,data,propose}=await setup(t);
  await assert.rejects(propose('pointer_click'),/computer_uia_attempts_required/);
  const observation=await observeComputer(service,task.id);
  const args={observationId:observation.observationId,selector:data.control.selector,action:'select',reason:'Select observed control'};
  for(let i=0;i<4;i++)await assert.rejects(proposeComputerAction(service,task.id,args),e=>e.pointerFallback.failures===1&&!e.pointerFallback.eligible);
  await assert.rejects(propose('pointer_click'),/computer_uia_attempts_required/);
  for(let i=2;i<=3;i++)await assert.rejects(propose('select'),e=>e.pointerFallback.failures===i);
  const p=await propose('pointer_click');assert.equal(p.pointerFallback.failures,3);
  await service.computer({method:'bind',taskId:task.id,window:100});
  await service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'approve',pointerConsent:true});
  assert.equal(data.acted,0);assert.equal(service.store.get('computer-action:'+p.id).state,'stale');
  await assert.rejects(propose('pointer_click'),/computer_uia_attempts_required/);
});

test('visual pointer follows host dispatch and hides before result capture without replay',async t=>{
  const {service,data,propose,decide}=await setup(t),events=[];
  service.computerPointer={move:async()=>{events.push('move');return {available:true};},pulse:async()=>events.push('pulse'),hide:async()=>{events.push('hide');return {available:true};},dispose(){}};
  data.onAction=async()=>events.push('act');const capture=service.computerAdapter.capture.bind(service.computerAdapter);
  service.computerAdapter.capture=async(...args)=>{events.push('capture');return capture(...args);};
  const p=await propose('click');events.length=0;await decide(p);await decide(p);
  assert.deepEqual(events,['move','pulse','act','hide','capture']);assert.equal(data.acted,1);
});

test('visual pointer movement cannot bypass a changed target and cannot pulse a no-op',async t=>{
  const {service,data,propose,decide}=await setup(t),events=[];
  service.computerPointer={move:async()=>{events.push('move');data.control.x++;return {available:true};},pulse:async()=>events.push('pulse'),hide:async()=>{events.push('hide');return {available:true};},dispose(){}};
  const p=await propose('click');await decide(p);assert.deepEqual(events,['move','hide']);assert.equal(data.acted,0);
  assert.equal(service.store.get('computer-action:'+p.id).execution,'not_started');
  data.properties={ToggleState:'On'};events.length=0;const q=await propose('toggle_on');await decide(q);assert.deepEqual(events,[]);
});

for(const phase of ['move','pulse'])test('user edits during pointer '+phase+' prevent stale value dispatch without replay',async t=>{
  const {service,data,propose,decide}=await setup(t),events=[];
  service.computerPointer={
    async move(){events.push('move');if(phase==='move')data.text='User changed this value';return {available:true};},
    async pulse(){events.push('pulse');if(phase==='pulse')data.text='User changed this value';},
    async hide(){events.push('hide');return {available:true};},dispose(){},
  };
  const proposal=await propose('set_value',{value:'Agent replacement'});
  assert.equal(proposal.documentEvidence,undefined,'ordinary input must receive the same final conflict check');
  await decide(proposal);await decide(proposal);
  assert.equal(data.text,'User changed this value');assert.equal(data.acted,0);
  const receipt=service.store.get('computer-action:'+proposal.id);
  assert.equal(receipt.state,'stale');assert.equal(receipt.execution,'not_started');
  assert.equal(receipt.error,'computer_target_changed');assert.deepEqual(events,['move','pulse','hide']);
  assert(!service.store.get('computer-image:'+proposal.id).after);
});

test('target changes during pointer pulse prevent stale native dispatch',async t=>{
  const {service,data,propose,decide}=await setup(t);let hidden=0;
  service.computerPointer={async move(){return {available:true};},async pulse(){data.control.x++;},async hide(){hidden++;return {available:true};},dispose(){}};
  const proposal=await propose('click');await decide(proposal);await decide(proposal);
  assert.equal(data.acted,0);assert.equal(hidden,1);
  const receipt=service.store.get('computer-action:'+proposal.id);
  assert.equal(receipt.state,'stale');assert.equal(receipt.execution,'not_started');
});

test('failed pointer hide preserves returned input receipt and does not capture misleading evidence',async t=>{
  const {service,data,propose,decide}=await setup(t);
  service.computerPointer={move:async()=>({available:true}),pulse:async()=>({available:true}),hide:async()=>({available:false}),dispose(){}};
  const p=await propose('click');await decide(p);await decide(p);
  assert.equal(data.acted,1);const receipt=service.store.get('computer-action:'+p.id);
  assert.equal(receipt.state,'attention');assert.equal(receipt.execution,'command_returned');assert(!service.store.get('computer-image:'+p.id).after);
});

test('unknown UIA writes do not unlock mouse fallback even after user acknowledgement',async t=>{
  const {service,task,data,propose,decide}=await setup(t);
  await allowPointer(propose);const p=await propose('click');data.failAction=true;await decide(p);
  await service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision:'acknowledge'});
  await assert.rejects(propose('pointer_click'),/computer_uia_attempts_required/);assert.equal(data.acted,1);
});

test('Pi receives host fallback eligibility after safe failures and stops at mouse HITL',async t=>{
  const {service,task,data}=await setup(t);let round=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
    round++;
    if(round<=5&&round%2)return call('observe_computer',{includeImage:false});
    const result=JSON.parse(messages.findLast(m=>m.role==='tool').content);
    if(round<=6)return call('propose_computer_action',{observationId:result.observationId,selector:data.control.selector,action:['select','toggle_on','expand'][round/2-1],reason:'확인한 UIA 패턴을 검사합니다.'});
    assert.equal(round,7);assert.equal(result.pointerFallback.eligible,true);assert.equal(result.actionIssued,false);
    return call('propose_computer_action',{observationId:service.computerObservation.id,selector:data.control.selector,action:'pointer_click',reason:'UIA 조작이 지원되지 않아 마우스 승인을 요청합니다.'});
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(round,7);assert.equal(data.acted,0);assert.equal(service.task(task.id).state,'review');assert(!service.task(task.id).question);
  const proposal=service.state().computer.actions[0];assert.equal(proposal.state,'proposed');assert.equal(proposal.inputMode,'shared_pointer');assert.equal(proposal.pointerFallback.failures,3);
});

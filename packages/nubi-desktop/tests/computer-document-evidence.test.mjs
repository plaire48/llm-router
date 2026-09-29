import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import {fixture} from './fixtures.mjs';
import {WinappComputer,observeComputer,proposeComputerAction} from '../runtime/computer-use.mjs';
import {documentSnapshot} from '../runtime/workspace-documents.mjs';
import {readComputerResult} from '../runtime/computer-harness.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function setup(t){
  const {service,root}=await fixture(t),task=await service.createTask({request:'로컬 앱에서 결과를 확인한다.'});
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
  return {service,root,task,data,propose,decide};
}

async function documentRecord(service,root,taskId,state='complete'){
  const documents=await documentSnapshot(root,['app.txt'],new AbortController().signal);
  const record={id:crypto.randomUUID(),taskId,state,sources:documents.map(doc=>({id:doc.id,path:doc.path,hash:doc.version,characters:doc.text.length})),result:{status:state,answer:'Snapshot reference only',evidence:[],findings:[],uncertainties:state==='partial'?['Unread ranges remain']:[]}};
  service.store.set('document-analysis:'+record.id,record);return record;
}
for(const state of ['complete','partial'])test('document '+state+' report binds source hashes to one approved UIA action',async t=>{
  const {service,root,task,data,propose,decide}=await setup(t),record=await documentRecord(service,root,task.id,state);
  const p=await propose('click',{documentAnalysisId:record.id});
  assert.equal(data.acted,0);assert.equal(p.documentEvidence.id,record.id);assert.equal(p.documentEvidence.status,state);assert.equal(p.documentEvidence.advisory,true);
  assert.equal(p.documentEvidence.sources[0].hash,record.sources[0].hash);assert.match(p.documentEvidence.resultHash,/^sha256:/);
  assert.equal(service.task(task.id).sources?.length||0,0,'Report does not authorize source edits');
  await decide(p);await decide(p);assert.equal(data.acted,1);
  const action=service.state().computer.actions[0];assert.equal(action.state,'observed');assert.equal(action.verification,'not_verified');assert.deepEqual(action.documentEvidence,p.documentEvidence);
  const receipt=readComputerResult(service,task.id,{actionId:p.id,includeImage:true});assert.equal(receipt.imageStatus,'captured');assert.equal(receipt.historical,true);assert.deepEqual(receipt.receipt.documentEvidence,p.documentEvidence);
});
test('missing, foreign, failed and malformed document reports cannot create an action proposal',async t=>{
  const {service,root,task,data,propose}=await setup(t),record=await documentRecord(service,root,task.id);
  for(const invalid of [null,{...record,taskId:'foreign'},{...record,state:'failed'},{...record,result:undefined},{...record,sources:[]},{...record,sources:[{path:'app.txt',hash:'invented',characters:20}]}]){
    if(invalid)service.store.set('document-analysis:'+record.id,invalid);
    await assert.rejects(()=>propose('click',{documentAnalysisId:invalid?record.id:'missing'}),/computer_document_required/);
  }
  assert.equal(data.acted,0);assert.equal(service.state().computer.actions.length,0);
});
test('changed document before proposal is rejected without issuing input',async t=>{
  const {service,root,task,data,propose}=await setup(t),record=await documentRecord(service,root,task.id);await writeFile(path.join(root,'app.txt'),'different original');
  await assert.rejects(()=>propose('click',{documentAnalysisId:record.id}),/computer_document_stale/);assert.equal(data.acted,0);assert.equal(service.state().computer.actions.length,0);
});
for(const mutation of ['source','removed','report','scope'])test('document '+mutation+' change after proposal prevents approved dispatch',async t=>{
  const {service,root,task,data,propose,decide}=await setup(t),record=await documentRecord(service,root,task.id),p=await propose('click',{documentAnalysisId:record.id});
  if(mutation==='source')await writeFile(path.join(root,'app.txt'),'human revision');
  if(mutation==='removed')await unlink(path.join(root,'app.txt'));
  if(mutation==='report')service.store.set('document-analysis:'+record.id,{...record,result:{...record.result,answer:'Changed interpretation'}});
  if(mutation==='scope')service.store.set('document-analysis:'+record.id,{...record,taskId:'foreign'});
  await decide(p);await decide(p);
  const saved=service.state().computer.actions[0];assert.equal(data.acted,0);assert.equal(saved.state,'stale');assert.equal(saved.execution,'not_started');assert.match(saved.error,/^computer_document_(stale|required)$/);
});
test('source change during virtual pointer movement is checked before native dispatch',async t=>{
  const {service,root,task,data,propose,decide}=await setup(t),record=await documentRecord(service,root,task.id),p=await propose('click',{documentAnalysisId:record.id});
  let hidden=0;service.computerPointer={dispose(){},async move(){await writeFile(path.join(root,'app.txt'),'edited while pointer moved');return {available:true};},async pulse(){},async hide(){hidden++;return {available:true};}};
  await decide(p);assert.equal(data.acted,0);assert.equal(hidden,1);assert.equal(service.state().computer.actions[0].error,'computer_document_stale');
});


test('Pi links a document report to approved Windows input then delegates frozen PNG review without replay',async t=>{
  const {service,root,task,data,decide}=await setup(t),record=await documentRecord(service,root,task.id);
  let stage=0,evidenceId,proposal;const children=new Map();
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000}]}),dispose(){},complete:async(messages,tools)=>{
    const role=/isolated (page|review) analyst/.exec(messages[0].content)?.[1];
    if(role){
      assert.ok(tools.every(tool=>tool.function.name==='read_analysis_evidence'));
      const count=(children.get(role)||0)+1;children.set(role,count);
      if(count===1)return call('read_analysis_evidence',{evidence_id:evidenceId,mode:'image'});
      assert.match(JSON.stringify(messages),/data:image\/png;base64/);
      return {content:JSON.stringify({status:'complete',summary:'Captured result inspected',findings:[{text:'Historical PNG reviewed; business outcome remains unknown.',evidence_ids:[evidenceId]}],uncertainties:['No current input authority.'],next_step:'Read the live app before any further input.'}),calls:[]};
    }
    const last=messages.findLast(message=>message.role==='tool');
    if(stage===0){stage++;return call('read_document_analysis',{id:record.id});}
    if(stage===1){stage++;assert.equal(JSON.parse(last.content).id,record.id);return call('observe_computer',{});}
    if(stage===2){stage++;const observation=JSON.parse(last.content);return call('propose_computer_action',{observationId:observation.observationId,selector:data.control.selector,action:'click',reason:'문서에서 검토한 동작을 확인합니다.',documentAnalysisId:record.id});}
    if(stage===3){stage++;return call('read_computer_result',{actionId:proposal.id,includeImage:true});}
    if(stage===4){stage++;evidenceId=JSON.parse(last.content).analysis_evidence_id;assert.ok(evidenceId);return call('delegate_analysis',{tasks:['page','review'].map(role=>({role,task:'Independently inspect this captured app result.',done_when:'Cite the observed image and remaining uncertainty.',evidence_ids:[evidenceId]}))});}
    if([...children.values()].some(count=>count<2)||children.size<2)return call('collect_analysis',{wait:true});
    return {content:'캡처를 분담해서 확인했습니다. 업무 완료는 아직 검증하지 않았습니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(data.acted,0);assert.equal(stage,3);proposal=service.state().computer.actions[0];assert.equal(proposal.documentEvidence.id,record.id);
  await decide(proposal);assert.equal(data.acted,1);
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(children.size,2);assert.equal(data.acted,1);assert.equal(service.state().computer.actions.length,1);
  assert.equal(service.task(task.id).trace.filter(event=>['analysis_page','analysis_review'].includes(event.tool)&&event.status==='done').length,2);
  const history=service.analysisHistory({taskId:task.id}).records.find(item=>item.kind==='roles');
  assert.equal(history.workers.length,2);
  for(const worker of history.workers){
    assert.equal(worker.analysis.delivered,true);
    assert.equal(worker.analysis.sources[0].hasImage,true);
    assert.equal(worker.analysis.sources[0].imageRead,true);
    assert.equal(worker.analysis.sources[0].historical,true);
  }
  assert.doesNotMatch(JSON.stringify(history),/data:image\/png;base64/);

});

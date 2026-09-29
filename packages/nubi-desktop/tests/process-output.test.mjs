import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,appendFile,symlink,unlink,link} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures.mjs';
import {readProcessOutput,processOutputPreview} from '../runtime/process-output.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);
async function saved(t,text,privilege='user'){
  const {service,root}=await fixture(t),task=await service.createTask({request:'실패한 실행을 분석합니다.'}),id=randomUUID();
  const file=path.join(service.store.directory,...(privilege==='administrator'?['elevation',id,'output.log']:['logs',id+'.log']));
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);
  const record={id,taskId:task.id,state:'failed',execution:'command_returned',exitCode:1,output:text.slice(-128000),privilege};service.store.set('process:'+id,record);
  return {service,root,task,id,file,record,read:args=>readProcessOutput(service,task.id,{processId:id,...args})};
}
test('large saved output is read exactly with UTF-8 paging rather than lost buffer tails',async t=>{
  const text='BEGIN\n'+('가😀나다\n'.repeat(25000))+'END',f=await saved(t,text);let offset=0,revision,result='';
  do{const page=await f.read({offset,revision});assert.equal(page.historical,true);assert.equal(page.encodingLoss,false);assert.equal(page.revisionKind,'file_metadata');assert.ok(Buffer.byteLength(page.text)<=8000);result+=page.text;offset=page.nextOffset;revision=page.revision;}while(offset!==null);
  assert.equal(result,text);assert.ok(!f.record.output.includes('BEGIN'));assert.equal(f.service.store.list('process:').length,1);
});
test('literal search scans bounded ranges, keeps boundary matches and exposes unread ranges',async t=>{
  const text='x'.repeat(262141)+'분석ERROR marker'+'y'.repeat(18000),f=await saved(t,text);
  const first=await f.read({query:'분석ERROR'});assert.equal(first.matches.length,1);assert.equal(first.matches[0].offset,262141);assert.equal(first.nextOffset,262144);assert.equal(first.matchMode,'literal_case_sensitive');
  const empty=await f.read({query:'markerX'});assert.equal(empty.matches.length,0);assert.ok(empty.nextOffset,'no matches is not whole-log absence');
  const tail=await f.read({query:'marker',offset:first.nextOffset,revision:first.revision});assert.equal(tail.matches.length,1);assert.equal(tail.nextOffset,null);
  const repeated=await saved(t,'ERROR\n'.repeat(30));let offset=0,revision,found=[];do{const page=await repeated.read({offset,revision,query:'ERROR'});found.push(...page.matches.map(m=>m.offset));offset=page.nextOffset;revision=page.revision;}while(offset!==null);assert.equal(found.length,30);assert.equal(new Set(found).size,30);
});
test('modified, appended or missing log invalidates a continuation instead of mixing versions',async t=>{
  const f=await saved(t,'a'.repeat(18000)),page=await f.read({});
  await assert.rejects(f.read({offset:8000}),/process_log_revision_required/);
  await appendFile(f.file,'changed');await assert.rejects(f.read({offset:page.nextOffset,revision:page.revision}),/process_log_changed/);
  await writeFile(f.file,'replacement');await assert.rejects(f.read({revision:page.revision}),/process_log_changed/);
  await unlink(f.file);await assert.rejects(f.read({revision:page.revision}),/process_log_changed/);
  const fallback=await f.read({});assert.equal(fallback.available,false);assert.equal(fallback.outputScope,'retained_buffer');assert.equal(fallback.outputReference.processId,f.id);
});
test('task, ID, range and cancellation boundaries prohibit arbitrary output reads',async t=>{
  const f=await saved(t,'private');const other=await f.service.createTask({request:'another'});
  await assert.rejects(readProcessOutput(f.service,other.id,{processId:f.id}),/process_log_missing/);
  for(const args of [{processId:'../secret'},{offset:-1},{offset:1.2},{query:''},{query:'x'.repeat(201)},{revision:'invented'},{offset:9000,revision:(await f.read({})).revision}])await assert.rejects(f.read(args),/process_log_arguments/);
  const abort=new AbortController();abort.abort(new Error('cancelled'));await assert.rejects(readProcessOutput(f.service,f.task.id,{processId:f.id},abort.signal),/cancelled/);
});
test('saved path overrides, symlink and hardlink logs cannot escape the owned log directory',async t=>{
  const f=await saved(t,'owned'),secret=path.join(f.root,'private.txt');await writeFile(secret,'NOT_A_LOG');
  f.service.store.set('process:'+f.id,{...f.record,logPath:secret});assert.equal((await f.read({})).text,'owned');
  await unlink(f.file);await symlink(secret,f.file);await assert.rejects(f.read({}),/process_log_scope/);
  await unlink(f.file);await link(secret,f.file);await assert.rejects(f.read({}),/process_log_scope/);
});
test('administrator logs use their fixed owned location and incomplete output remains disclosed',async t=>{
  const f=await saved(t,'admin output','administrator');f.service.store.set('process:'+f.id,{...f.record,logIncomplete:true});const page=await f.read({});assert.equal(page.text,'admin output');assert.equal(page.logIncomplete,true);assert.equal(page.execution,'command_returned');
  const preview=processOutputPreview({...f.record,output:'HEAD'+'.'.repeat(16000)+'TAIL'});assert.ok(preview.output.startsWith('HEAD'));assert.ok(preview.output.endsWith('TAIL'));assert.equal(preview.outputTruncated,true);
});
test('actual Bash output beyond the retained buffer stays recoverable without restarting the process',async t=>{
  if(process.platform==='win32'){t.skip('Bash local integration');return;}
  const {service}=await fixture(t),task=await service.createTask({request:'실행 결과 확인'});
  const p=await service.run({taskId:task.id,profile:'bash',script:"printf 'EARLY_ERROR\\n'; printf '%200000s' ' '; printf '\\nFINISHED\\n'",autoDiagnose:false});
  for(let i=0;i<200&&service.processes.active.size;i++)await new Promise(r=>setTimeout(r,10));assert.equal(service.processes.active.size,0);
  assert.ok(!service.processes.poll(p.id).output.includes('EARLY_ERROR'));
  const result=await readProcessOutput(service,task.id,{processId:p.id,query:'EARLY_ERROR'});assert.equal(result.matches.length,1);assert.equal(service.store.list('process:').length,1);
});
const call=(name,args)=>({content:'',calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('Pi retrieves saved diagnostics and a scoped recovery worker reads them without shell authority',async t=>{
  const f=await saved(t,'ORIGINAL_ERROR\n'+'x'.repeat(150000));let stage=0,childCalls=0,evidenceId;
  f.service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000}]}),dispose(){},async complete(messages,tools){
    if(messages[0].content.includes('isolated recovery analyst')){
      assert.deepEqual(tools.map(t=>t.function.name),['read_analysis_evidence']);
      if(childCalls++===0)return call('read_analysis_evidence',{evidence_id:evidenceId});
      assert.match(JSON.stringify(messages),/ORIGINAL_ERROR/);
      return {content:JSON.stringify({status:'complete',summary:'원래 오류를 확인했습니다.',findings:[{text:'원래 오류가 기록에 있습니다.',evidence_ids:[evidenceId]}],uncertainties:['실행 성공은 미확인'],next_step:'필요한 수정안을 별도로 검토합니다.'}),calls:[]};
    }
    if(stage++===0){assert.match(JSON.stringify(messages),/read_process_output/);return call('read_process_output',{processId:f.id,query:'ORIGINAL_ERROR'});}
    if(stage===2){const result=JSON.parse(messages.findLast(m=>m.role==='tool').content);evidenceId=result.analysis_evidence_id;assert.ok(evidenceId);return call('delegate_analysis',{tasks:[{role:'recovery',task:'저장된 오류 원인 확인',done_when:'기록과 불확실성을 구분',evidence_ids:[evidenceId]}]});}
    if(childCalls<2)return call('collect_analysis',{wait:true});
    return {content:'기존 실행 기록에서 오류를 확인했습니다. 실행은 반복하지 않았습니다.',calls:[]};
  }};
  await f.service.startAgent({taskId:f.task.id});await f.service.agent.promise;
  assert.equal(childCalls,2);assert.equal(f.service.task(f.task.id).state,'review');assert.equal(f.service.store.list('process:').length,1);assert.equal(f.service.state().proposals.length,0);
  assert.equal(f.service.store.list('operation:').find(o=>o.tool==='read_process_output').effect,'read');
});

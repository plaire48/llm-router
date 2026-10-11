import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {projectRules,RULES_LIMITS} from '../runtime/project-rules.mjs';
import {hash} from '../runtime/files.mjs';
import {SourceObservations} from '../runtime/source-edits.mjs';
import {recordChangePlan,requirePlannedEdit} from '../runtime/change-plan.mjs';
import {collectKnowledge} from '../runtime/knowledge-records.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const plan=()=>({summary:'Add tested helper',requirements:[{id:'R1',text:'Return two',criterionId:'AC-1'}],targets:[{path:'helper.ts',action:'create',reason:'New helper',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'Assert helper returns two'}],assumptions:[]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('project rules use directory precedence, CLAUDE fallback and isolate sibling rules',async t=>{
  const {root}=await fixture(t);await mkdir(path.join(root,'src'));await mkdir(path.join(root,'other'));
  await writeFile(path.join(root,'AGENTS.md'),'Root rules');await writeFile(path.join(root,'CLAUDE.md'),'Ignored root');
  await writeFile(path.join(root,'src/CLAUDE.md'),'Scoped rules');await writeFile(path.join(root,'other/AGENTS.md'),'Unrelated rules');
  const rules=await projectRules(root,'src/new.ts');assert.deepEqual(rules.files.map(f=>f.content),['Root rules','Scoped rules']);
  assert.equal(rules.authority,'project_guidance_not_execution_permission');
  await writeFile(path.join(root,'src/AGENTS.md'),'Preferred scoped rules');
  const next=await projectRules(root,'src/new.ts');assert.notEqual(next.fingerprint,rules.fingerprint);assert.deepEqual(next.files.map(f=>f.content),['Root rules','Preferred scoped rules']);
});

test('rule reads reject outside links; oversized guidance is shown in part with its omitted headings',async t=>{
  const {root,directory}=await fixture(t);await writeFile(path.join(directory,'outside.md'),'Outside');await symlink(path.join(directory,'outside.md'),path.join(root,'AGENTS.md'));
  await assert.rejects(projectRules(root),/rules_unavailable/);await unlink(path.join(root,'AGENTS.md'));
  const head='# 규칙\n'+'가나다라 마바사아 자차카타.\n'.repeat(1500),tail='## 뒤쪽 절\n'+'x'.repeat(100)+'\n### 더 뒤쪽\n끝\n',whole=head+tail;
  await writeFile(path.join(root,'AGENTS.md'),whole);
  const [file]=(await projectRules(root)).files;
  assert.equal(file.truncated,true);assert.ok(Buffer.byteLength(file.content)<=RULES_LIMITS.fileBytes);assert.ok(file.content.endsWith('.\n')&&!file.content.includes('\uFFFD'),'cut at a line boundary, never inside a character');
  assert.equal(file.shownLines,file.content.split('\n').length-1);assert.equal(file.totalLines,whole.split('\n').length);assert.equal(file.totalBytes,Buffer.byteLength(whole));
  assert.deepEqual(file.omittedHeadings.map(h=>h.heading),['## 뒤쪽 절','### 더 뒤쪽']);assert.equal(file.omittedHeadings[0].line,1502);assert.match(file.note,/read_source/);
  assert.equal(file.hash,hash(Buffer.from(whole)),'the hash that edits are checked against covers the whole file');
  await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/AGENTS.md'),'b'.repeat(40000));
  const scoped=await projectRules(root,'src/new.ts');assert.deepEqual(scoped.files.map(f=>f.path),['AGENTS.md','src/AGENTS.md']);
  assert.ok(scoped.files.reduce((sum,f)=>sum+Buffer.byteLength(f.content),0)<=RULES_LIMITS.totalBytes,'the chain stays within the total budget');assert.equal(scoped.files[1].truncated,true);assert.deepEqual(scoped.files[1].omittedHeadings,[]);
  const deep=Array.from({length:25},(_,i)=>'d'+i).join('/');await mkdir(path.join(root,deep),{recursive:true});await writeFile(path.join(root,deep,'AGENTS.md'),'Deep rule');
  assert.equal((await projectRules(root,deep+'/file.ts')).files.at(-1).content,'Deep rule','a deep path walks every level');
});

test('newly added rules invalidate observed plans and pending existing-file proposals',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Change',criteria:['Return two']}),seen=new SourceObservations(),source=await service.read({path:'app.txt'});seen.observe(source);
  const input=plan();input.targets=[{path:'app.txt',reason:'Change existing',requirementIds:['R1']}];
  await recordChangePlan(service,task,input,seen,'run');const proposal=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'new'});
  await writeFile(path.join(root,'AGENTS.md'),'New project rule');
  await assert.rejects(recordChangePlan(service,task,input,seen,'run'),/project_rules_changed/);
  await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/project_rules_changed/);
  const current=await service.read({path:'app.txt'});assert.throws(()=>requirePlannedEdit(task,'app.txt',current.hash,'run',current.projectRules.fingerprint),/project_rules_changed/);
  seen.observe(current);await recordChangePlan(service,task,input,seen,'run');
  const fresh=await service.propose({taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'new'});assert.notEqual(fresh.id,proposal.id);
});

test('new files require observed absence, syntax validation and human application; readback persists',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Add helper',criteria:['Return two']}),seen=new SourceObservations();
  await assert.rejects(recordChangePlan(service,task,plan(),seen,'run'),/source_read_required/);
  seen.observeMissing(await service.inspectPath({taskId:task.id,path:'helper.ts'}));await recordChangePlan(service,task,plan(),seen,'run');
  assert.throws(()=>requirePlannedEdit(task,'helper.ts','absent','another-run'),/change_plan_required/);
  await assert.rejects(service.proposeNewFile({taskId:task.id,path:'helper.ts',content:'export const result = ;'}),/proposal_invalid_syntax/);
  const proposal=await service.proposeNewFile({taskId:task.id,path:'helper.ts',content:'export const result = 2;\n'});assert.equal(proposal.quality.state,'passed');
  await assert.rejects(readFile(path.join(root,'helper.ts')),/ENOENT/);assert.equal((await collectKnowledge(service,task.id)).packet.sources[0].state,'pending_creation');
  await assert.rejects(service.mergeProposal({proposalId:proposal.id}),/proposal_missing/);
  const results=await Promise.allSettled([service.applyNewFile({proposalId:proposal.id}),service.applyNewFile({proposalId:proposal.id})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await readFile(path.join(root,'helper.ts'),'utf8'),'export const result = 2;\n');assert.equal((await service.applyNewFile({proposalId:proposal.id})).alreadyApplied,true);
  service.store.close();await service.open(root);assert.equal((await service.prepareProposal({proposalId:proposal.id})).alreadyApplied,true);
  await writeFile(path.join(root,'helper.ts'),'Human change');await assert.rejects(service.applyNewFile({proposalId:proposal.id}),/applied_changed/);assert.equal(await readFile(path.join(root,'helper.ts'),'utf8'),'Human change');
});

test('same-content collisions, missing directories, links and rule drift never overwrite a new target',async t=>{
  const {service,root,directory}=await fixture(t),task=await service.createTask({request:'Add helper'}),args={taskId:task.id,path:'helper.ts',content:'export const result = 2;\n'};
  await assert.rejects(service.inspectPath({taskId:task.id,path:'missing/file.ts'}),/parent_missing/);
  for(const file of ['CON.ts','NUL','file.txt:stream','ending.'])await assert.rejects(service.inspectPath({taskId:task.id,path:file}),/path_scope/);
  await assert.rejects(service.proposeNewFile({...args,content:'binary\0content'}),/content_limit/);
  await assert.rejects(service.inspectPath({taskId:task.id,path:'../outside.ts'}),/path_scope/);
  await symlink(directory,path.join(root,'linked'));await assert.rejects(service.inspectPath({taskId:task.id,path:'linked/file.ts'}),/path_scope/);
  await symlink(path.join(root,'absent.ts'),path.join(root,'dangling.ts'));await assert.rejects(service.inspectPath({taskId:task.id,path:'dangling.ts'}),/file_exists/);
  const proposal=await service.proposeNewFile(args);await writeFile(path.join(root,'AGENTS.md'),'New rule');await assert.rejects(service.applyNewFile({proposalId:proposal.id}),/project_rules_changed/);
  const fresh=await service.proposeNewFile(args);await writeFile(path.join(root,'helper.ts'),args.content);
  await assert.rejects(service.applyNewFile({proposalId:fresh.id}),/file_exists/);await assert.rejects(service.confirmProposal({proposalId:fresh.id}),/write_unconfirmed/);
  assert.equal(service.store.get('proposal:'+fresh.id).state,'proposed');assert.equal(await readFile(path.join(root,'helper.ts'),'utf8'),args.content);
});

test('interrupted creation is preserved for inspection and never replayed after restart',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Add helper'}),p=await service.proposeNewFile({taskId:task.id,path:'helper.ts',content:'export const result = 2;'});
  service.store.set('proposal:'+p.id,{...p,state:'creating'});service.store.close();await service.open(root);
  assert.equal(service.store.get('proposal:'+p.id).state,'attention');await assert.rejects(service.applyNewFile({proposalId:p.id}),/write_unconfirmed/);await assert.rejects(readFile(path.join(root,'helper.ts')),/ENOENT/);
});

test('Pi receives project rules, cannot create without current observations and returns a reviewable new file',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Add helper',criteria:['Return two']});await writeFile(path.join(root,'AGENTS.md'),'RULE_SENTINEL: preserve the public API.');let round=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
    const serialized=JSON.stringify(messages);assert.match(serialized,/RULE_SENTINEL/);
    const input={path:'helper.ts',content:'export const result = 2;\n',reason:'Implement helper'};
    switch(round++){
      case 0:return call('propose_new_file',input);
      case 1:assert.match(serialized,/source_read_required/);return call('inspect_path',{path:'helper.ts'});
      case 2:assert.match(serialized,/project_guidance_not_execution_permission/);return call('propose_new_file',input);
      case 3:assert.match(serialized,/change_plan_required/);return call('record_change_plan',plan());
      case 4:return call('propose_new_file',input);
      default:return {content:'새 파일을 제안했습니다. 반영과 실행 검증을 기다립니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.state().proposals.length,1);assert.equal(service.state().proposals[0].kind,'create');assert.equal(service.task(task.id).criteria[0].state,'unknown');assert.equal(service.task(task.id).changePlan.checks[0].state,'not_run');await assert.rejects(readFile(path.join(root,'helper.ts')),/ENOENT/);
  await service.applyNewFile({proposalId:service.state().proposals[0].id});assert.match(await readFile(path.join(root,'helper.ts'),'utf8'),/result = 2/);
});

test('context overflow retains project guidance and original criteria; compaction invalidates old creation observations',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Add helper',criteria:['ORIGINAL_REQUIRED_RESULT']});
  await writeFile(path.join(root,'AGENTS.md'),'ROOT_RULE_MUST_SURVIVE');
  task.messages=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',content:'Old notes '+('details '.repeat(300))}));service.store.set('task:'+task.id,task);
  let calls=0,summaries=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify({goal:'Add helper',constraints:[],decisions:[],completed:[],pending:['Inspect source'],references:[]}),calls:[]};}
    const content=JSON.stringify(messages);
    switch(++calls){
      case 1:return call('inspect_path',{path:'helper.ts'});
      case 2:throw new Error('context_overflow');
      case 3:assert.match(content,/ROOT_RULE_MUST_SURVIVE/);assert.match(content,/ORIGINAL_REQUIRED_RESULT/);return call('propose_new_file',{path:'helper.ts',content:'export const result = 2;',reason:'Add helper'});
      default:assert.match(content,/source_read_required/);return {content:'문맥을 압축했습니다. 생성 위치부터 다시 확인해야 합니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.ok(summaries>0);assert.equal(calls,4);assert.equal(service.state().proposals.length,0);assert.equal(service.task(task.id).state,'review');
});

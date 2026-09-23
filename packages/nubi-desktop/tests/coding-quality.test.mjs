import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {hash} from '../runtime/files.mjs';
import {checkCodeQuality,requireCodeQuality,runCodeAnalysis} from '../runtime/code-quality.mjs';
import {SourceObservations} from '../runtime/source-edits.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const samples=[['src/app.ts','export const value: number = 1;','export const value: number = ;'],['widget.tsx','export const View=()=> <div>OK</div>;','export const View=()=> <div>OK</span>;'],['app.js','const value=1;','const value:number=1;'],['package.json','{"name":"example"}','{"name":}'],['config.yaml','key: value\n','key: [1,\n']];
for(const [file,before,after] of samples)test('actual parser rejects introduced syntax errors in '+file,async()=>{
  const quality=await checkCodeQuality(file,before,after);assert.equal(quality.state,'blocked');assert.ok(quality.diagnostics[0].line>=1);assert.ok(quality.diagnostics[0].column>=1);assert.equal(quality.diagnostics[0].origin,'introduced');assert.equal(quality.afterHash,hash(after));assert.throws(()=>requireCodeQuality(quality),/proposal_invalid_syntax/);
  const repaired=await checkCodeQuality(file,before,before+'\n');assert.equal(repaired.state,'passed');assert.equal(repaired.tests,'not_run');assert.equal(repaired.types,'not_checked');
});

test('baseline syntax errors survive line shifts as warnings; an identical error on a new line is blocked',async()=>{
  const before='const bad = ;\nconst valid = 1;\n';
  const shifted=await checkCodeQuality('old.ts',before,'// added comment\n'+before);assert.equal(shifted.state,'existing_issues');assert.equal(shifted.diagnostics[0].origin,'existing');
  const added=await checkCodeQuality('old.ts',before,before+'const alsoBad = ;\n');assert.equal(added.state,'blocked');assert.ok(added.diagnostics.some(d=>d.origin==='introduced'));
  const fixed=await checkCodeQuality('old.ts',before,'const bad = 0;\nconst valid = 1;\n');assert.equal(fixed.state,'passed');
});

test('JSON comments have explicit format scope; unsupported languages and timeouts never pass',async()=>{
  assert.equal((await checkCodeQuality('tsconfig.json','{}','{/* comment */ "strict":true,}')).state,'passed');
  assert.equal((await checkCodeQuality('package.json','{}','{/* comment */ "name":"x"}')).state,'blocked');
  assert.equal((await checkCodeQuality('legacy.py','pass','not Python syntax')).state,'unsupported');
  const timeout=await checkCodeQuality('a.ts','const a=1;','const a=2;',{timeoutMs:1});assert.equal(timeout.state,'unavailable');assert.throws(()=>requireCodeQuality(timeout),/quality_unavailable/);
  const c=new AbortController();c.abort();assert.equal((await runCodeAnalysis({mode:'outline',path:'a.ts',content:'const x=1;'},{signal:c.signal})).error,'cancelled');
});

test('parsers never load project plugins or execute source, and outlines do not authorize edits',async t=>{
  const {service,root}=await fixture(t);await mkdir(path.join(root,'src'));
  const text='import fs from "node:fs";\nexport function dangerous() { fs.writeFileSync("MUST_NOT_EXIST", "x"); }\nexport class Service { run() {return 1;} }\nexport const view = () => 2;\n';
  await writeFile(path.join(root,'src/app.ts'),text);await writeFile(path.join(root,'tsconfig.json'),'{"compilerOptions":{"plugins":[{"name":"./evil.js"}]}}');await writeFile(path.join(root,'evil.js'),'throw new Error("PROJECT_PLUGIN_EXECUTED")');
  const result=await service.codeOutline({path:'src/app.ts'});assert.deepEqual(result.symbols.map(s=>s.name),['dangerous','Service','run','view']);assert.equal(result.symbols[0].start,2);assert.equal(result.imports[0].module,'node:fs');assert.equal(result.hash,hash(text));
  assert.throws(()=>new SourceObservations().require({path:result.path,hash:result.hash,lines:4}),/source_read_required/);await assert.rejects(readFile(path.join(root,'MUST_NOT_EXIST')),e=>e.code==='ENOENT');
  assert.equal((await checkCodeQuality('src/app.ts',text,text+'\n')).state,'passed');
});

test('ripgrep finds a file beyond the old 3000-file cutoff and supports scoped filename discovery',async t=>{
  const {root,service}=await fixture(t);await mkdir(path.join(root,'many'));
  for(let at=0;at<3100;at+=100)await Promise.all(Array.from({length:Math.min(100,3100-at)},(_,i)=>writeFile(path.join(root,'many',String(at+i).padStart(5,'0')+'.txt'),'nothing here\n')));
  await writeFile(path.join(root,'z-last.ts'),'export const target = "SENTINEL_LITERAL";\n');
  const result=await service.search({query:'SENTINEL_LITERAL'});assert.equal(result.engine,'ripgrep');assert.equal(result.results[0].path,'z-last.ts');assert.ok(result.scanned>3000);assert.equal(result.truncated,false);
  const paths=await service.search({query:'LAST',mode:'path'});assert.deepEqual(paths.results.map(r=>r.path),['z-last.ts']);
  assert.equal((await service.search({query:'SENTINEL_LITERAL',within:'many'})).results.length,0);
  assert.equal((await service.search({query:'SENTINEL_LITERAL',within:'z-last.ts'})).scanned,1);
  await mkdir(path.join(root,'literal[1]'));await writeFile(path.join(root,'literal[1]/target.txt'),'SCOPED');
  assert.equal((await service.search({query:'SCOPED',within:'literal[1]'})).results[0].path,'literal[1]/target.txt');
});

test('ripgrep treats query text literally and excludes secrets, ignored files, symlinks and traversal',async t=>{
  const {root,service,directory}=await fixture(t),needle='$(touch INJECTED) [a-z]';
  await writeFile(path.join(root,'source.txt'),needle+'\n');await writeFile(path.join(root,'.env'),'PRIVATE_SENTINEL');await writeFile(path.join(root,'.gitignore'),'ignored.txt\n');await writeFile(path.join(root,'ignored.txt'),'PRIVATE_SENTINEL');await writeFile(path.join(directory,'outside.txt'),'PRIVATE_SENTINEL');await symlink(path.join(directory,'outside.txt'),path.join(root,'outside-link.txt'));
  const result=await service.search({query:needle});assert.equal(result.results.length,1);assert.equal(result.results[0].hash,hash(needle+'\n'));assert.equal((await service.search({query:'PRIVATE_SENTINEL'})).results.length,0);await assert.rejects(readFile(path.join(root,'INJECTED')),e=>e.code==='ENOENT');
  await assert.rejects(service.search({query:'x',within:'../outside'}),/path_scope/);
  const controller=new AbortController();controller.abort();await assert.rejects(service.search({query:'x',signal:controller.signal}),/cancelled/);
});

test('proposal creation and old proposal application both enforce parser results without changing source',async t=>{
  const {root,service}=await fixture(t),task=await service.createTask({request:'Update code'}),file='app.ts',content='export const value=1;\n';await writeFile(path.join(root,file),content);
  await assert.rejects(service.propose({taskId:task.id,path:file,expectedHash:hash(content),content:'export const value=;'}),/proposal_invalid_syntax/);assert.equal(service.state().proposals.length,0);assert.equal(await readFile(path.join(root,file),'utf8'),content);
  const proposal=await service.propose({taskId:task.id,path:file,expectedHash:hash(content),content:'export const value=2;\n'});assert.equal(proposal.quality.state,'passed');assert.equal(proposal.quality.afterHash,proposal.afterHash);
  service.store.set('proposal:'+proposal.id,{...proposal,quality:undefined});const reused=await service.propose({taskId:task.id,path:file,expectedHash:hash(content),content:proposal.content});assert.equal(reused.id,proposal.id);assert.equal(reused.reused,true);assert.equal(reused.quality.state,'passed');
  service.store.set('proposal:'+proposal.id,{...proposal,quality:undefined,content:'export const value=;'});await assert.rejects(service.prepareProposal({proposalId:proposal.id}),/proposal_invalid_syntax/);assert.equal(service.state().proposals[0].quality.state,'blocked');assert.equal(await readFile(path.join(root,file),'utf8'),content);
});

test('Pi receives actual diagnostics, repairs the draft, and creates only the corrected proposal',async t=>{
  const {service,root}=await fixture(t),content='export const value=1;\n';await writeFile(path.join(root,'app.ts'),content);let round=0,seenHash;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(m=>m.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(round++){
      case 0:return call('code_outline',{path:'app.ts'});
      case 1:assert.equal(result.hash,hash(content));return call('read_source',{path:'app.ts'});
      case 2:seenHash=result.hash;return call('record_change_plan',{summary:'Change value',requirements:[{id:'R1',text:'Value is two',criterionId:'AC-1'}],targets:[{path:'app.ts',reason:'Current value',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'Check exported value equals two'}],assumptions:[]});
      case 3:return call('propose_patch',{path:'app.ts',expectedHash:seenHash,edits:[{oldText:'value=1',newText:'value='}],reason:'Fixture syntax failure'});
      case 4:assert.equal(result.error,'proposal_invalid_syntax');assert.equal(result.quality.diagnostics[0].code,'TS1109');assert.equal(service.state().proposals.length,0);assert.equal(await readFile(path.join(root,'app.ts'),'utf8'),content);return call('propose_patch',{path:'app.ts',expectedHash:seenHash,edits:[{oldText:'value=1',newText:'value=2'}],reason:'Corrected value'});
      default:assert.equal(result.quality.state,'passed');return {content:'문법 오류를 고친 제안을 준비했습니다. 실제 실행은 아직 확인하지 않았습니다.',calls:[]};
    }
  }};
  const task=await service.createTask({request:'Change exported value to two',criteria:['value is two']});await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(service.task(task.id).state,'review');assert.equal(round,6);assert.equal(service.state().proposals.length,1);assert.equal(service.task(task.id).criteria[0].state,'unknown');assert.equal(await readFile(path.join(root,'app.ts'),'utf8'),content);
  service.store.close();await service.open(root);assert.equal(service.state().proposals[0].quality.state,'passed');const saved=await service.recordKnowledge({taskId:task.id});assert.match(await readFile(path.join(root,saved.path),'utf8'),/문법 검사/);
});

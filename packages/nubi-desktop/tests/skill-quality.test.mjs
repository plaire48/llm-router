import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
import {skillCatalog,readSkill,useSkill,listSkillResources} from '../runtime/agent-capabilities.mjs';

const markdown=name=>`---\nname: ${name}\ndescription: 회사 문서 작성 규칙\n---\nRead references/guide.md.`;
async function source(directory,name='writing'){
  const folder=path.join(directory,'upload');await mkdir(path.join(folder,'references'),{recursive:true});
  await writeFile(path.join(folder,'SKILL.md'),markdown(name));await writeFile(path.join(folder,'references/guide.md'),'First version');return folder;
}
const args=catalog=>({path:catalog.skills[0].path,expectedHash:catalog.skills[0].hash});

test('long registered references are read in bounded pages and reject mixed revisions',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory);const content='문서 작성 지침\n'.repeat(8000);
  await writeFile(path.join(folder,'references/guide.md'),content);await service.importSkill({source:folder});
  const catalog=await skillCatalog(root),base={...args(catalog),resource:'references/guide.md'};
  const first=await readSkill(root,catalog,base);assert.equal(first.content.length,8000);
  const next=await readSkill(root,catalog,{...base,offset:first.nextOffset,resourceHash:first.hash});assert.equal(next.content,content.slice(8000,16000));
  await writeFile(path.join(root,'.agents/skills/writing/references/guide.md'),content.replace('문서','변경'));
  await assert.rejects(readSkill(root,catalog,{...base,offset:first.nextOffset,resourceHash:first.hash}),/skill_resource_changed/);
});

test('binary templates return resource facts without text or invented content',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory);await writeFile(path.join(folder,'template.docx'),Buffer.from([0x50,0x4b,0,255]));await service.importSkill({source:folder});
  const catalog=await skillCatalog(root),result=await readSkill(root,catalog,{...args(catalog),resource:'template.docx'});
  assert.equal(result.format,'binary');assert.equal(result.bytes,4);assert.equal(result.content,null);assert.equal(result.editObservation,false);
});

test('identical retry reconciles stored bytes after restart while extra or edited files remain conflicts',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory);await service.importSkill({source:folder});
  const file=path.join(root,'.agents/skills/writing/SKILL.md'),mtime=(await stat(file)).mtimeMs;
  service.store.close();await service.open(root);
  const result=await service.importSkill({source:folder});assert.equal(result.noChange,true);assert.equal((await stat(file)).mtimeMs,mtime);
  await writeFile(path.join(root,'.agents/skills/writing/user-notes.md'),'Human notes');await assert.rejects(service.importSkill({source:folder}),/skill_exists/);
  assert.equal(await readFile(path.join(root,'.agents/skills/writing/user-notes.md'),'utf8'),'Human notes');
});

test('Windows reserved destination names are refused before creating the skills folder',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory,'con');
  await assert.rejects(service.importSkill({source:folder}),/skill_import_path/);await assert.rejects(stat(path.join(root,'.agents')),/ENOENT/);
});

test('ignored staging folders cannot hide valid skills from the catalog',async t=>{
  const {root}=await fixture(t),base=path.join(root,'.agents/skills');await mkdir(base,{recursive:true});
  for(let i=0;i<130;i++)await mkdir(path.join(base,`.pending-${i}`));
  await mkdir(path.join(base,'writing'));await writeFile(path.join(base,'writing/SKILL.md'),markdown('writing'));
  const catalog=await skillCatalog(root);assert.equal(catalog.skills.length,1);assert.equal(catalog.truncated,false);
});


test('resource listing exposes later files and rejects a changed listing between pages',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory);
  for(let i=0;i<125;i++)await writeFile(path.join(folder,'references',`part-${String(i).padStart(3,'0')}.md`),`Reference ${i}`);
  await service.importSkill({source:folder});const catalog=await skillCatalog(root),base=args(catalog);
  const active=await useSkill(root,catalog,base);assert.equal(active.resources.length,100);assert.equal(active.resourcesNextOffset,100);
  const next=await listSkillResources(root,catalog,{...base,offset:100,resourcesHash:active.resourcesHash});assert.equal(next.resources.length,26);assert.equal(next.nextOffset,null);assert.equal(next.coverage,'complete');
  assert.equal(new Set([...active.resources,...next.resources].map(r=>r.path)).size,126);
  await writeFile(path.join(root,'.agents/skills/writing/references/new.md'),'New reference');
  await assert.rejects(listSkillResources(root,catalog,{...base,offset:100,resourcesHash:active.resourcesHash}),/skill_resources_changed/);
});

test('reference paging requires a version hash and preserves Unicode character boundaries',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory),text='x'.repeat(7999)+'🐦한글'+ 'y'.repeat(20);
  await writeFile(path.join(folder,'references/guide.md'),text);await service.importSkill({source:folder});const catalog=await skillCatalog(root),base={...args(catalog),resource:'references/guide.md'};
  const first=await readSkill(root,catalog,base);assert.equal(first.nextOffset,7999);
  await assert.rejects(readSkill(root,catalog,{...base,offset:first.nextOffset}),/skill_resource_hash_required/);
  const next=await readSkill(root,catalog,{...base,offset:first.nextOffset,resourceHash:first.hash});assert.equal(first.content+next.content,text);
});

test('a full catalog refuses a new registration before writing any package files',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory),base=path.join(root,'.agents/skills');
  for(let i=0;i<120;i++){const name=`skill-${i}`;await mkdir(path.join(base,name),{recursive:true});await writeFile(path.join(base,name,'SKILL.md'),markdown(name));}
  await assert.rejects(service.importSkill({source:folder}),/skill_catalog_full/);
  await assert.rejects(stat(path.join(base,'writing')),/ENOENT/);assert.equal((await skillCatalog(root)).skills.length,120);
});


test('Pi routes resource paging, binary facts and changed-reference recovery without stopping the task',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory);
  await writeFile(path.join(folder,'template.docx'),Buffer.from([0x50,0x4b,0,255]));
  await writeFile(path.join(folder,'references/guide.md'),'Original guide '.repeat(4000));
  for(let i=0;i<110;i++)await writeFile(path.join(folder,'references',`note-${i}.md`),'Reference');
  await service.importSkill({source:folder});let round=0,entry,page,reference;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxOutputTokens:4096}]}),dispose(){},async complete(messages,definitions){
    if(messages[0]?.content.startsWith('Summarize conversation'))return {content:JSON.stringify({goal:'등록 스킬의 자료 확인',constraints:['실행이나 파일 변경 없음'],decisions:[],completed:['스킬과 자료 목록 조회'],pending:['변경된 참조 다시 읽기'],references:['.agents/skills/writing/SKILL.md']}),calls:[]};
    const last=messages.findLast(m=>m.role==='tool');
    if(round++===0){assert.ok(definitions.some(d=>d.function.name==='list_skill_resources'));return call('discover_capabilities',{query:'문서'});}
    if(round===2){entry=JSON.parse(last.content).results.find(r=>r.kind==='skill');return call('use_skill',{path:entry.path,expectedHash:entry.hash});}
    const base={path:entry.path,expectedHash:entry.hash};
    if(round===3){page=JSON.parse(last.content);return call('list_skill_resources',{...base,offset:page.resourcesNextOffset,resourcesHash:page.resourcesHash});}
    if(round===4){assert.ok(JSON.parse(last.content).resources.some(r=>r.path==='template.docx'));return call('read_skill',{...base,resource:'template.docx'});}
    if(round===5){assert.equal(JSON.parse(last.content).format,'binary');return call('read_skill',{...base,resource:'references/guide.md'});}
    if(round===6){reference=JSON.parse(last.content);await writeFile(path.join(root,'.agents/skills/writing/references/guide.md'),'Revised guide '.repeat(4000));return call('read_skill',{...base,resource:'references/guide.md',offset:reference.nextOffset,resourceHash:reference.hash});}
    if(round===7){assert.match(last.content,/skill_resource_changed/);return call('read_skill',{...base,resource:'references/guide.md'});}
    assert.match(last.content,/Revised guide/);return {content:'변경된 참조 문서를 다시 확인했습니다. 문서 작성과 실행은 아직 하지 않았습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'등록한 문서 작성 스킬의 자료를 확인해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.ok(service.task(task.id).trace.some(e=>e.tool==='list_skill_resources'&&e.status==='done'));
  assert.equal(service.state().processes.length,0);assert.equal(service.state().proposals.length,0);
});


test('skill activation retains compatibility and preparation instructions without running scripts',async t=>{
  const {service,root,directory}=await fixture(t),folder=await source(directory);
  await writeFile(path.join(folder,'SKILL.md'),markdown('writing').replace('description:', 'compatibility: Requires PowerShell 5.1 and Python 3.12\ndescription:'));
  await service.importSkill({source:folder});const catalog=await skillCatalog(root),active=await useSkill(root,catalog,args(catalog));
  assert.equal(active.compatibility,'Requires PowerShell 5.1 and Python 3.12');assert.match(active.instruction,/not installed or executed/);assert.match(active.instruction,/propose_setup_action/);assert.equal(active.editObservation,false);
});

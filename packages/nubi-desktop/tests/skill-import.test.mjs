import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {zip} from './skill-zip-fixture.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readSkillPackage,SKILL_IMPORT_LIMITS} from '../runtime/skill-import.mjs';
installAgent(ProjectService);

const instruction='---\nname: company-writing\ndescription: 회사 문서 작성과 보고서 양식 writing report\n---\nRead references/세부/guide.md, then inspect scripts/draft.mjs before proposing a command. Preserve assets/templates/template.docx.';
const entries=[['SKILL.md',instruction],['references/세부/guide.md','회사 문서의 핵심 결론을 먼저 작성합니다.'],['scripts/draft.mjs','throw Error("MUST_NOT_RUN_AT_REGISTRATION");'],['assets/templates/template.docx',Buffer.from([0x50,0x4b,0,0xff])]];
async function folder(base){const dir=path.join(base,'사용자 스킬');for(const [rel,bytes] of entries){const at=path.join(dir,rel);await mkdir(path.dirname(at),{recursive:true});await writeFile(at,bytes);}await mkdir(path.join(dir,'EmptyAssets'));return dir;}

async function archive(base,records=entries,name='skill.zip'){const source=path.join(base,name);await writeFile(source,zip(records));return source;}

test('folder registration preserves nested references, script text, binary assets and empty directories without running code',async t=>{
  const {service,root,directory}=await fixture(t),source=await folder(directory);
  const result=await service.invoke('importSkill',{source});assert.equal(result.state,'registered');assert.equal(result.execution,'not_started');assert.equal(result.fileCount,4);
  for(const [rel,bytes] of entries)assert.deepEqual(await readFile(path.join(root,'.nubi/skill/company-writing',rel)),Buffer.from(bytes));
  assert.ok((await stat(path.join(root,'.nubi/skill/company-writing/EmptyAssets'))).isDirectory());
  assert.equal(service.state().processes.length,0);
  service.store.close();await service.open(root);
  const catalog=await service.invoke('listSkills');assert.equal(catalog.skills[0].name,'company-writing');assert.doesNotMatch(JSON.stringify(catalog),/MUST_NOT_RUN|회사 문서의 핵심/);
});

test('wrapped ZIP and flat ZIP have identical resources; selected folder name does not override SKILL metadata',async t=>{
  const {directory}=await fixture(t);
  for(const prefix of ['','download/company-writing/']) {
    const source=await archive(directory,entries.map(([name,bytes])=>[prefix+name,bytes]));
    const result=await readSkillPackage(source);assert.equal(result.metadata.name,'company-writing');assert.deepEqual([...result.files.keys()],entries.map(([name])=>name));
  }
});

test('duplicate registration never overwrites existing skill or edited resources',async t=>{
  const {service,root,directory}=await fixture(t),source=await archive(directory);
  await service.importSkill({source});const guide=path.join(root,'.nubi/skill/company-writing/references/세부/guide.md');await writeFile(guide,'Human edit');
  await assert.rejects(service.importSkill({source}),/skill_exists/);assert.equal(await readFile(guide,'utf8'),'Human edit');
  assert.deepEqual(await readdir(path.join(root,'.nubi/skill')),['company-writing']);
});

test('archive paths, Windows aliases, symlinks, secrets and case collisions are rejected before installation',async t=>{
  const {service,root,directory}=await fixture(t);
  for(const rel of ['../escape.txt','/absolute.txt','C:/escape.txt','assets\\escape.txt','assets/CON.txt','assets/COM¹.txt','assets/file:stream','assets/end.','.env','scripts/id_rsa']) {
    const source=await archive(directory,[...entries,[rel,'bad']]);await assert.rejects(service.importSkill({source}),/skill_(import_path|archive_invalid)/,rel);
  }
  for(const records of [[...entries,['assets/link','../../outside',0o120777]],[...entries,['skill.md','duplicate']],[...entries,['Assets/a.txt','a']],[...entries,['SKILL.md',instruction]]])await assert.rejects(service.importSkill({source:await archive(directory,records)}),/skill_(import_path|import_duplicate)/);
  await assert.rejects(stat(path.join(root,'.nubi')),/ENOENT/);
});

test('corrupt CRC, truncated archive and expanded size budget refuse the whole package',async t=>{
  const {service,root,directory}=await fixture(t),source=path.join(directory,'broken.zip');
  const bytes=zip(entries);bytes[30+Buffer.byteLength('SKILL.md')+1]^=1;await writeFile(source,bytes);await assert.rejects(service.importSkill({source}),/skill_archive_invalid/);
  await writeFile(source,bytes.subarray(0,100));await assert.rejects(service.importSkill({source}),/skill_archive_invalid/);
  await archive(directory,[...entries,['assets/huge.bin',Buffer.alloc(SKILL_IMPORT_LIMITS.fileBytes+1)]],'broken.zip');await assert.rejects(service.importSkill({source}),/skill_import_limit/);
  await assert.rejects(stat(path.join(root,'.nubi')),/ENOENT/);
});

test('missing or ambiguous entrypoint, invalid metadata, folder links and linked destination are refused',async t=>{
  const {service,root,directory}=await fixture(t);
  for(const records of [[['readme.md','instructions']], [...entries,['nested/SKILL.md',instruction]], [['SKILL.md','no metadata']]])await assert.rejects(service.importSkill({source:await archive(directory,records)}),/skill_(entry_required|invalid)/);
  const source=await folder(directory);await symlink(path.join(root,'app.txt'),path.join(source,'link.md'),'file');await assert.rejects(service.importSkill({source}),/skill_import_path/);
  await mkdir(path.join(root,'.nubi'));await symlink(directory,path.join(root,'.nubi/skill'),process.platform==='win32'?'junction':'dir');await assert.rejects(service.importSkill({source:await archive(directory)}),/skill_import_path/);
});

test('registration cannot race an agent or change projects while copying',async t=>{
  const {service,directory}=await fixture(t),source=await folder(directory);
  service.agent={running:true};await assert.rejects(service.importSkill({source}),/agent_busy/);service.agent=null;
  const pending=service.importSkill({source});assert.equal(service.skillImportBusy,true);await assert.rejects(service.importSkill({source}),/agent_busy/);await assert.rejects(service.startAgent({taskId:'unused'}),/agent_busy/);await pending;assert.equal(service.skillImportBusy,false);
});

test('real Pi loop discovers a user upload, activates it and reads its nested reference using tools',async t=>{
  const {service,directory}=await fixture(t);await service.importSkill({source:await archive(directory)});let round=0,selected;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxOutputTokens:4096}]}),dispose(){},async complete(messages,definitions){
    const last=messages.findLast(m=>m.role==='tool');
    if(round++===0){assert.ok(definitions.some(d=>d.function.name==='use_skill'));assert.ok(messages.some(m=>m.content?.includes('company-writing')));return call('discover_capabilities',{query:'문서'});}
    if(round===2){selected=JSON.parse(last.content).results.find(r=>r.kind==='skill');return call('use_skill',{path:selected.path,expectedHash:selected.hash});}
    if(round===3){const result=JSON.parse(last.content);assert.ok(result.resources.some(r=>r.path==='assets/templates/template.docx'));assert.match(result.content,/references\/세부\/guide.md/);return call('read_skill',{path:selected.path,expectedHash:selected.hash,resource:'references/세부/guide.md'});}
    assert.match(last.content,/핵심 결론/);return {content:'등록한 회사 문서 스킬의 작성 지침을 확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'회사 문서 작성 지침을 확인해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(service.task(task.id).trace.some(e=>e.tool==='use_skill'&&e.status==='done'));assert.equal(service.state().processes.length,0);assert.equal(service.state().proposals.length,0);
});


test('deflated ZIP preserves resources and checks the combined expanded byte budget',async t=>{
  const {directory}=await fixture(t),source=path.join(directory,'compressed.zip');
  await writeFile(source,zip(entries,{deflate:true}));const result=await readSkillPackage(source);
  assert.deepEqual(result.files.get('assets/templates/template.docx'),Buffer.from(entries[3][1]));
  await writeFile(source,zip([...entries,...[1,2,3].map(i=>[`assets/large-${i}.bin`,Buffer.alloc(8*1024*1024)])],{deflate:true}));
  assert.ok((await stat(source)).size<1024*1024);await assert.rejects(readSkillPackage(source),/skill_import_limit/);
});

test('registered folder deletion uses a persisted whole-package receipt and keeps a recovery copy',async t=>{
  const {service,root,directory}=await fixture(t);await service.importSkill({source:await folder(directory)});const skill=(await service.listSkills()).skills[0];assert.equal(skill.managed,true);
  const removed=await service.removeSkill({name:skill.name,expectedHash:skill.packageHash});assert.equal(removed.removed,true);assert.equal((await service.listSkills()).skills.length,0);
  const trash=(await service.skillTrash({operation:'list'})).items;assert.equal(trash[0]?.name,skill.name,'the deleted skill waits in the trash');
  assert.equal(await readFile(path.join(root,'.nubi/skill',trash[0].id,'references/세부/guide.md'),'utf8'),'회사 문서의 핵심 결론을 먼저 작성합니다.');
});
test('registered deletion refuses edited resources, stale receipts and arbitrary source paths',async t=>{
  const {service,root,directory}=await fixture(t);await service.importSkill({source:await folder(directory)});const skill=(await service.listSkills()).skills[0];
  await assert.rejects(service.removeSkill({name:'../outside',expectedHash:skill.packageHash}),/input_invalid/);await assert.rejects(service.removeSkill({name:skill.name,expectedHash:'wrong'}),/skill_import_changed/);
  const file=path.join(root,'.nubi/skill',skill.name,'references/세부/guide.md');await writeFile(file,'Human edit');await assert.rejects(service.removeSkill({name:skill.name,expectedHash:skill.packageHash}),/skill_import_changed/);assert.equal(await readFile(file,'utf8'),'Human edit');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {skillCatalog,discoverCapabilities,readSkill,WORKFLOWS} from '../runtime/agent-capabilities.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const tools=[...new Set(WORKFLOWS.flatMap(w=>w.tools))];
async function skill(root,name='code-review',base='.agents/skills',body='Review the current source.'){const rel=`${base}/${name}/SKILL.md`;await mkdir(path.dirname(path.join(root,rel)),{recursive:true});await writeFile(path.join(root,rel),`---\nname: ${name}\ndescription: 코드 검토 code review\nallowed-tools: Bash(*)\n---\n${body}`);return rel;}
const load=(root,catalog,entry,extra={})=>readSkill(root,catalog,{path:entry.path,expectedHash:entry.hash,...extra});

test('skill discovery exposes metadata only across compatible project roots and keeps duplicate names distinct',async t=>{
  const {root}=await fixture(t);for(const base of ['.agents/skills','.claude/skills','.opencode/skills'])await skill(root,'code-review',base,'BODY_NOT_IN_CATALOG');
  const catalog=await skillCatalog(root);assert.equal(catalog.skills.length,3);assert.doesNotMatch(JSON.stringify(catalog),/BODY_NOT_IN_CATALOG|Bash/);
  assert.equal(new Set(catalog.skills.map(s=>s.path)).size,3);
  const result=discoverCapabilities(catalog,{query:'review'},tools);assert.equal(result.results.filter(r=>r.kind==='skill').length,3);
  const loaded=await load(root,catalog,catalog.skills[0]);assert.equal(loaded.content,'BODY_NOT_IN_CATALOG');assert.equal(loaded.editObservation,false);assert.match(loaded.authority,/not_execution_permission/);
});

test('skill read rejects stale or invented identity and rediscovery obtains the changed version',async t=>{
  const {root}=await fixture(t);const rel=await skill(root);const catalog=await skillCatalog(root),entry=catalog.skills[0];
  await assert.rejects(load(root,catalog,{...entry,hash:'made-up'}),/skill_catalog_required/);
  await writeFile(path.join(root,rel),(await readFile(path.join(root,rel),'utf8'))+'\nUpdated instruction');
  await assert.rejects(load(root,catalog,entry),/skill_changed/);
  const fresh=await skillCatalog(root);assert.match((await load(root,fresh,fresh.skills[0])).content,/Updated instruction/);
});

test('skill resources are bounded text, block traversal and secret files, and never run scripts',async t=>{
  const {root}=await fixture(t);await skill(root);const catalog=await skillCatalog(root),entry=catalog.skills[0];const base=path.join(root,path.posix.dirname(entry.path));
  await writeFile(path.join(base,'reference.md'),'x'.repeat(17000));await writeFile(path.join(base,'script.sh'),'echo NEVER_RUN');
  const first=await load(root,catalog,entry,{resource:'reference.md'});assert.equal(first.content.length,8000);assert.equal(first.nextOffset,8000);
  const last=await load(root,catalog,entry,{resource:'reference.md',offset:16000,resourceHash:first.hash});assert.equal(last.content.length,1000);assert.equal(last.nextOffset,null);
  assert.equal((await load(root,catalog,entry,{resource:'script.sh'})).content,'echo NEVER_RUN');
  for(const resource of ['../app.txt','/etc/passwd','.env','nested/../../app.txt','C:/outside'])await assert.rejects(load(root,catalog,entry,{resource}),/path_scope/);
});

test('invalid YAML, duplicate fields, aliases and oversized skills stay unavailable without blocking valid skills',async t=>{
  const {root}=await fixture(t);await skill(root);
  for(const [name,content] of Object.entries({duplicate:'---\nname: duplicate\nname: other\ndescription: bad\n---\nx',alias:'---\nname: alias\ndescription: &a [*a]\n---\nx',big:'x'.repeat(33000)})){
    const rel=await skill(root,name);await writeFile(path.join(root,rel),content);
  }
  const catalog=await skillCatalog(root);assert.equal(catalog.skills.length,1);assert.equal(catalog.issues.length,3);
});

test('skill loader refuses symlink directories and resources even when a link remains in the workspace',async t=>{
  const {root}=await fixture(t);await skill(root);const catalog=await skillCatalog(root),entry=catalog.skills[0];
  await mkdir(path.join(root,'.claude'),{recursive:true});await symlink(path.join(root,'.agents','skills'),path.join(root,'.claude','skills'),process.platform==='win32'?'junction':'dir');
  assert.ok((await skillCatalog(root)).issues.some(v=>v.path==='.claude/skills'));
  await symlink(path.join(root,'app.txt'),path.join(root,'.agents','skills','code-review','linked.md'),'file');
  await assert.rejects(load(root,catalog,entry,{resource:'linked.md'}),/skill_scope/);
});

test('capability routing uses only registered host tools, offers pagination and admits missing coverage',()=>{
  const catalog={skills:[],issues:[],truncated:false};
  for(const [query,id] of [['OpenWiki','knowledge'],['PowerShell','environment'],['cursor','windows-app'],['recovery','recovery'],['코드','source-change']]){
    const result=discoverCapabilities(catalog,{query},tools);assert.ok(result.results.some(r=>r.id===id),query);
  }
  const restricted=discoverCapabilities(catalog,{query:'Windows'},['observe_computer']);assert.deepEqual(restricted.results[0].tools,['observe_computer']);
  assert.equal(discoverCapabilities(catalog,{query:'unrelated-zebra'},tools).total,0);
  const many={...catalog,skills:Array.from({length:12},(_,i)=>({path:`skill-${i}`,name:`skill-${i}`,description:'review'})),truncated:true};
  const first=discoverCapabilities(many,{},tools);assert.equal(first.results.length,8);assert.equal(first.nextOffset,8);assert.equal(first.coverage,'partial');
  assert.equal(discoverCapabilities(many,{offset:16},tools).nextOffset,null);
});

test('real Pi tool loop loads project guidance but never gains source edit authority or script execution',async t=>{
  const {service,root}=await fixture(t);await skill(root,'code-review','.agents/skills','Inspect app.txt and propose a change.');let round=0,entry;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxOutputTokens:4096}]}),dispose(){},async complete(messages,definitions){
    const last=messages.findLast(m=>m.role==='tool');
    if(round++===0){assert.ok(definitions.some(t=>t.function.name==='discover_capabilities'));return call('discover_capabilities',{query:'review'});}
    if(round===2){const packet=JSON.parse(last.content);entry=packet.results.find(r=>r.kind==='skill');return call('read_skill',{path:entry.path,expectedHash:entry.hash});}
    if(round===3){assert.match(last.content,/Inspect app.txt/);return call('propose_edit',{path:'app.txt',expectedHash:'not-observed',content:'forbidden',reason:'must refuse'});}
    assert.match(last.content,/source_read_required/);return {content:'스킬은 확인했습니다. 수정할 소스를 먼저 읽어야 합니다.',calls:[]};
  }};
  const task=await service.createTask({request:'Use the code review skill'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(service.state().proposals.length,0);assert.equal(service.state().processes.length,0);
  assert.ok(service.task(task.id).trace.some(e=>e.tool==='read_skill'&&e.status==='done'));
});

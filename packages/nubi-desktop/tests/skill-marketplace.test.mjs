import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './fixtures.mjs';
import {ghesMarketplaceReader,MARKETPLACE,compareVersions} from '../runtime/skill-marketplace.mjs';

const name='simple-addition',id=name+'/'+name;
const gitHash=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
function remote(version='1.0.0',extra={}){
  const prefix=`plugins/${name}/skills/${name}/`;
  const raw={'.agents/plugins/marketplace.json':JSON.stringify({name:'ai-workspace',plugins:[{name,source:{source:'local',path:'./plugins/'+name}}]}),'.claude-plugin/marketplace.json':JSON.stringify({name:'ai-workspace',plugins:[{name,version,source:'./plugins/'+name}]}),[`plugins/${name}/.codex-plugin/plugin.json`]:JSON.stringify({name,version,description:'두 수를 더합니다.',interface:{displayName:'간단 덧셈'}}),[prefix+'SKILL.md']:`---\nname: ${name}\ndescription: 두 수를 더합니다.\nmetadata:\n  version: ${version}\n---\nVersion ${version}. Read references/guide.md.`,[prefix+'references/guide.md']:'Result '+version,[prefix+'scripts/no-run.mjs']:'throw Error("MUST_NOT_EXECUTE")',...extra};
  const bytes=new Map(Object.entries(raw).map(([file,value])=>[file,Buffer.from(value)]));
  const files=[...bytes].map(([file,data])=>({path:file,mode:'100644',type:'blob',size:data.length,sha:gitHash(data)}));
  return {async tree(){return {commit:gitHash(Buffer.from(version)),files};},async blob(entry){return bytes.get(entry.path);}};
}
async function refresh(service,reader=remote()){service.marketplaceReader=reader;const result=await service.skillMarketplace({operation:'refresh'});return result.items[0];}
const install=(service,item)=>service.skillMarketplace({operation:'install',id:item.id,expectedVersion:item.version,expectedCommit:item.commit});

test('both company marketplace formats resolve one immutable skill; status never accesses the network',async t=>{
  const {service}=await fixture(t);const item=await refresh(service);assert.equal(item.id,id);assert.equal(item.title,'간단 덧셈');assert.equal(item.version,'1.0.0');assert.equal(item.state,'available');
  service.marketplaceReader={tree(){throw Error('NETWORK_MUST_NOT_RUN');}};assert.equal((await service.skillMarketplace()).items.length,1);assert.equal(MARKETPLACE.website,'https://code.sdsdev.co.kr/pages/Manufacturing-IT/ai_workspace');
});
test('install readback persists through reopen and reaches the existing agent skill catalog without execution',async t=>{
  const {service,root}=await fixture(t),item=await refresh(service);const result=await install(service,item);assert.equal(result.items[0].state,'installed');assert.equal(result.installed[0].version,'1.0.0');assert.equal((await service.listSkills()).skills[0].name,name);assert.match(await readFile(path.join(root,'.nubi/skill',name,'scripts/no-run.mjs'),'utf8'),/MUST_NOT_EXECUTE/);assert.equal(service.state().processes.length,0);
  service.store.close();await service.open(root);assert.equal((await service.skillMarketplace()).installed[0].state,'installed');assert.equal((await service.listSkills()).skills.length,1);
});
test('one-click update replaces all resources, preserves the previous version and refuses downgrade',async t=>{
  const {service,root}=await fixture(t);await install(service,await refresh(service));const item=await refresh(service,remote('1.1.0'));assert.equal(item.updateAvailable,true);assert.equal(item.installedVersion,'1.0.0');const result=await install(service,item);assert.equal(result.installed[0].version,'1.1.0');assert.equal(await readFile(path.join(root,'.nubi/skill',name,'references/guide.md'),'utf8'),'Result 1.1.0');assert.equal(await readFile(path.join(root,'.nubi/skill',result.installed[0].backup,'references/guide.md'),'utf8'),'Result 1.0.0');await assert.rejects(install(service,await refresh(service)),/marketplace_version/);
});
test('same-version idempotency verifies bytes; republished different content requires a new version',async t=>{
  const {service}=await fixture(t),item=await refresh(service);await install(service,item);await install(service,item);const changed=await refresh(service,remote('1.0.0',{[`plugins/${name}/skills/${name}/references/guide.md`]:'Republished'}));await assert.rejects(install(service,changed),/marketplace_version_changed/);
});
test('human-edited resources block both update and deletion without changing the files',async t=>{
  const {service,root}=await fixture(t);await install(service,await refresh(service));const file=path.join(root,'.nubi/skill',name,'references/guide.md');await writeFile(file,'Human edit');const next=await refresh(service,remote('2.0.0'));assert.equal(next.state,'modified');await assert.rejects(install(service,next),/marketplace_modified/);await assert.rejects(service.skillMarketplace({operation:'remove',id}),/marketplace_modified/);assert.equal(await readFile(file,'utf8'),'Human edit');
});
test('uninstall verifies absence from the agent catalog and keeps a recovery copy; reinstall works',async t=>{
  const {service,root}=await fixture(t),item=await refresh(service);await install(service,item);const result=await service.skillMarketplace({operation:'remove',id});assert.equal(result.installed.length,0);assert.equal((await service.listSkills()).skills.length,0);const backup=(await readdir(path.join(root,'.nubi/skill'))).find(p=>p.startsWith('.removed-'));assert.match(await readFile(path.join(root,'.nubi/skill',backup,'SKILL.md'),'utf8'),/1.0.0/);assert.equal((await install(service,item)).installed.length,1);
});
test('stale selections, running agents and unsettled outcomes refuse mutations',async t=>{
  const {service}=await fixture(t),old=await refresh(service);await refresh(service,remote('2.0.0'));await assert.rejects(install(service,old),/marketplace_changed/);service.agent={running:true};await assert.rejects(service.skillMarketplace({operation:'refresh'}),/agent_busy/);service.agent=null;service.unsettledOperations=new Set(['unknown']);await assert.rejects(service.skillMarketplace({operation:'remove',id}),/agent_busy/);
});
test('preexisting local skills and linked destination cannot be overwritten by a marketplace install',async t=>{
  const {service,root,directory}=await fixture(t),item=await refresh(service);await mkdir(path.join(root,'.nubi/skill',name),{recursive:true});await writeFile(path.join(root,'.nubi/skill',name,'SKILL.md'),'Human file');await assert.rejects(install(service,item),/skill_exists/);
  const other=path.join(directory,'other');await mkdir(other);await symlink(other,path.join(root,'.nubi/skill/linked'));const malicious=remote('1.0.0',{[`plugins/${name}/skills/${name}/assets/CON.txt`]:'bad'});await assert.rejects(install(service,await refresh(service,malicious)),/skill_exists/);
});
test('unsafe plugin sources and inconsistent manifests are disclosed instead of installed',async t=>{
  const {service}=await fixture(t);const result=await service.skillMarketplace.call({...service,ready:()=>{},target:()=>service.root,store:service.store,marketplaceReader:remote('1.0.0',{'.agents/plugins/marketplace.json':JSON.stringify({name:'ai-workspace',plugins:[{name:'escape',source:'../outside'}]}),[`plugins/${name}/.claude-plugin/plugin.json`]:JSON.stringify({name,version:'9.0.0'})})},{operation:'refresh'});assert.equal(result.items.length,0);assert.ok(result.issues.some(i=>i.error==='marketplace_source'));assert.ok(result.issues.some(i=>i.error==='marketplace_version'));
});
test('lost install response reconciles actual hashes without writing or replaying tools',async t=>{
  const {service,root}=await fixture(t);await install(service,await refresh(service));const entry=service.store.entries('nubi-marketplace-skill:')[0];service.store.set(entry.key,{...entry.value,state:'installing'});assert.equal((await service.skillMarketplace()).installed[0].state,'installing');await assert.rejects(install(service,await refresh(service,remote('2.0.0'))),/marketplace_reconcile/);const before=await readFile(path.join(root,'.nubi/skill',name,'SKILL.md'));const result=await service.skillMarketplace({operation:'reconcile',id});assert.equal(result.installed[0].state,'installed');assert.deepEqual(await readFile(path.join(root,'.nubi/skill',name,'SKILL.md')),before);
});
test('GHES reader pins commit/tree and verifies binary Git blob hash; credential never appears in URL',async()=>{
  const bytes=Buffer.from([0,255,65]),sha=gitHash(bytes),requests=[];const reader=ghesMarketplaceReader('private-token',async(url,options)=>{requests.push({url,options});return Response.json(url.endsWith('/commits/main')?{sha:'a'.repeat(40),commit:{tree:{sha:'b'.repeat(40)}}}:url.includes('/git/trees/')?{tree:[],truncated:false}:{encoding:'base64',content:bytes.toString('base64')});});assert.equal((await reader.tree()).commit,'a'.repeat(40));assert.deepEqual(await reader.blob({sha,size:3}),bytes);assert.ok(requests.every(r=>r.url.startsWith('https://code.sdsdev.co.kr/api/v3/repos/Manufacturing-IT/ai_workspace/')&&!r.url.includes('private-token')&&r.options.redirect==='error'));assert.ok(requests.some(r=>r.url.includes('b'.repeat(40))));await assert.rejects(reader.blob({sha:'c'.repeat(40),size:3}),/marketplace_changed/);
});
test('authentication, network and truncated trees return actionable codes; version comparison is numeric',async()=>{
  await assert.rejects(ghesMarketplaceReader('',async()=>new Response('',{status:401})).tree(),/ghes_login_required/);await assert.rejects(ghesMarketplaceReader('private-token',async()=>{throw Error('secret internal error');}).tree(),/marketplace_network/);let n=0;await assert.rejects(ghesMarketplaceReader('private-token',async()=>Response.json(n++?{tree:[],truncated:true}:{sha:'a'.repeat(40),commit:{tree:{sha:'b'.repeat(40)}}})).tree(),/marketplace_limit/);assert.equal(compareVersions('1.10.0','1.9.0'),1);assert.equal(compareVersions('1.0.0-beta.2','1.0.0-beta.10'),-1);assert.equal(compareVersions('1.0.0-beta','1.0.0'),-1);assert.throws(()=>compareVersions('1.0','1.0.0'),/marketplace_version/);
});

 test('portable resource paths and symbolic-link parents are refused before any outside write',async t=>{
  const {service,root,directory}=await fixture(t);
  for(const rel of ['assets/CON.txt','assets/COM¹.txt','assets/file:stream','assets/end.','../escape','.env','Assets/a.txt']){
    const extra={[`plugins/${name}/skills/${name}/${rel}`]:'bad',...(rel==='Assets/a.txt'?{[`plugins/${name}/skills/${name}/assets/a.txt`]:'other'}:{})};
    await assert.rejects(install(service,await refresh(service,remote('1.0.0',extra))),/skill_(import_path|import_duplicate)/);
  }
  const outside=path.join(directory,'outside');await mkdir(outside);
  const {rm}=await import('node:fs/promises');await rm(path.join(root,'.nubi/skill'),{recursive:true});await symlink(outside,path.join(root,'.nubi/skill'));
  await assert.rejects(install(service,await refresh(service)),/skill_import_path/);assert.deepEqual(await readdir(outside),[]);
 });

test('entering a token is distinct from a verified catalog connection and never persists the token',async t=>{
  const {service}=await fixture(t);assert.deepEqual(service.connectSkillMarketplace({token:'PRIVATE_TEST_TOKEN'}),{credentialsReady:true});assert.equal((await service.skillMarketplace()).connected,false);await refresh(service);assert.equal((await service.skillMarketplace()).connected,true);assert.doesNotMatch(JSON.stringify(service.store.entries('')),/PRIVATE_TEST_TOKEN/);service.dispose();assert.equal(service.marketplaceToken,null);
});


test('Nubi downloads are project scoped even from a task worktree, and legacy receipts stay hidden',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Use a skill'});await service.createWorktree({taskId:task.id});
 service.store.set('marketplace-skill:legacy:ghost',{name:'ghost',state:'installed'});
 const item=await refresh(service);await service.skillMarketplace({operation:'install',taskId:task.id,id:item.id,expectedVersion:item.version,expectedCommit:item.commit});
 assert.match(await readFile(path.join(root,'.nubi/skill',name,'SKILL.md'),'utf8'),/simple-addition/);
 await assert.rejects(readFile(path.join(service.task(task.id).workspace,'.nubi/skill',name,'SKILL.md')),{code:'ENOENT'});
 assert.equal((await service.listSkills({taskId:task.id})).skills[0].path,'.nubi/skill/simple-addition/SKILL.md');
 assert.equal((await service.skillMarketplace()).installed.length,1);
});

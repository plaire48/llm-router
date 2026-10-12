import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {git,hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';
import {wikiUpdateStatus} from '../runtime/wiki-update.mjs';
import {wikiInitializationError} from '../runtime/wiki-initialization-error.mjs';

async function setup(t,{gitProject=false}={}){
  const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-flow-')),root=path.join(temp,'source');await mkdir(root);await writeFile(path.join(root,'app.txt'),'initial source\n');
  if(gitProject){await git(root,['init','-q']);await git(root,['add','-A']);await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','-qm','Source']);}
  const service=new ProjectService({storageRoot:path.join(temp,'state')});
  t.after(async()=>{service.dispose();service.store?.close();await rm(temp,{recursive:true,force:true});});
  await service.open(root);service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
  service.wikiInitializer=async({root:copy})=>{
    assert.match((await git(copy,['rev-parse','HEAD'])).trim(),/^[a-f0-9]{40}$/,'OpenWiki receives its required Git snapshot');
    await publish(copy,'# App\n\ninitial source\n');
    const commit=(await git(copy,['rev-parse','HEAD'])).trim();
    await writeFile(path.join(copy,'openwiki/.last-update.json'),JSON.stringify({status:'complete',command:'init',language:'ko',gitHead:commit}));
    await writeFile(path.join(copy,'openwiki/.page-manifest.json'),JSON.stringify({schemaVersion:1,pages:{'openwiki/home.md':{gitHead:commit}}}));
  };
  await service.initializeWiki();await service.wikiInitPromise;
  assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));return {root:service.root,service};
}
async function publish(root,text){
  await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),text);
  const resource='repo://app.txt',resolved=await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource);
  await writeFile(path.join(root,'openwiki/.claims/home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:'app',statement:'App source',evidence:[{resource,version:resolved.evidence.version}]}]}));
}
async function settle(service,id){for(let i=0;i<200;i++){const value=(await service.wikiUpdate({method:'status'})).updates.find(item=>item.id===id);if(value.state!=='running')return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Wiki update did not settle');}

test('initialization retains native metadata and Claims without initializing the user folder',async t=>{
  const {root}=await setup(t);
  await assert.rejects(access(path.join(root,'.git')));
  const record=JSON.parse(await readFile(path.join(root,'openwiki/.last-update.json'),'utf8'));
  assert.equal(record.status,'complete');assert.equal(record.gitHead,undefined,'temporary Git commit is not advertised as a source commit');
  assert((await readFile(path.join(root,'openwiki/.claims/home.json'),'utf8')).includes('repo://app.txt'));
  assert.equal((await wikiUpdateStatus(root)).state,'current');
  await writeFile(path.join(root,'app.txt'),'changed source\n');
  assert.deepEqual((await wikiUpdateStatus(root)).changedFiles,['app.txt']);
});
test('plain-folder update reads the current Wiki, proposes a result and preserves concurrent human edits',async t=>{
  const {root,service}=await setup(t);await writeFile(path.join(root,'app.txt'),'changed source\n');
  service.wikiUpdater=async({root:copy})=>{assert.match(await readFile(path.join(copy,'openwiki/home.md'),'utf8'),/initial source/);await publish(copy,'# App\n\nchanged source\n');return {};};
  const proposal=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);assert.equal(ready.state,'ready',JSON.stringify(ready));
  assert.match(await readFile(path.join(root,'openwiki/home.md'),'utf8'),/initial source/);
  await service.wikiUpdate({method:'apply',id:ready.id,fingerprint:ready.fingerprint});assert.equal((await wikiUpdateStatus(root)).state,'current');
  await writeFile(path.join(root,'app.txt'),'third source\n');
  service.wikiUpdater=async({root:copy})=>{await writeFile(path.join(root,'openwiki/home.md'),'human edits while generating');await publish(copy,'# App\n\nthird source\n');return {};};
  const next=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:next.id,fingerprint:next.fingerprint});
  const conflict=await settle(service,next.id);await assert.rejects(service.wikiUpdate({method:'apply',id:conflict.id,fingerprint:conflict.fingerprint}),/wiki_update_conflict/);
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),'human edits while generating');
});
test('Git updates include the current uncommitted Wiki and still use committed source scope',async t=>{
  const {root,service}=await setup(t,{gitProject:true});await writeFile(path.join(root,'app.txt'),'committed change\n');
  await git(root,['add','app.txt']);await git(root,['-c','user.name=Fixture','-c','user.email=fixture@localhost','-c','commit.gpgSign=false','commit','-qm','Changed source']);
  service.wikiUpdater=async({root:copy})=>{assert.match(await readFile(path.join(copy,'openwiki/home.md'),'utf8'),/initial source/);assert.equal((await readFile(path.join(copy,'app.txt'),'utf8')).replace(/\r\n/g,'\n'),'committed change\n');await publish(copy,'# App\n\ncommitted change\n');return {};};
  const proposal=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);assert.equal(ready.state,'ready',JSON.stringify(ready));
});

test('initialization returns its scanning job before a slow listing and cancellation remains responsive',async t=>{
  const {service}=await setup(t);await rm(path.join(service.root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  service.wikiSourceLister=()=>{entered();return new Promise(resolve=>release=resolve);};
  let modelCalled=false;service.wikiInitializer=async()=>{modelCalled=true;};
  const first=await service.initializeWiki();assert.equal(first.state,'running');assert.equal(first.stage,'scanning');assert(first.startedAt);
  await started;assert.equal(service.wikiInitialization().stage,'scanning');
  service.wikiInitialization({action:'cancel'});assert.equal(service.wikiInitialization().state,'cancelled');
  release({paths:['app.txt'],truncated:false});await service.wikiInitPromise;
  assert.equal(modelCalled,false);assert.equal(service.wikiInitialization().state,'cancelled');
  assert.equal((await service.initializeWiki()).state,'cancelled');
});

test('a listing failure remains a staged, sanitized retryable result',async t=>{
  const {service}=await setup(t);await rm(path.join(service.root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);
  service.wikiSourceLister=async()=>{throw Object.assign(Error('private path and private server reply'),{code:'EACCES'});};
  await service.initializeWiki();await service.wikiInitPromise;
  const failure=service.wikiInitialization();assert.equal(failure.state,'attention');assert.equal(failure.stage,'scanning');assert.equal(failure.error,'wiki_permission_denied');assert(!JSON.stringify(failure).includes('private'));
  service.wikiSourceLister=async()=>({paths:[],truncated:false});
  const retry=service.wikiInitialization({action:'retry'});assert.equal(retry.state,'running');assert.notEqual(retry.id,failure.id);await service.wikiInitPromise;assert.equal(service.wikiInitialization().error,'wiki_no_sources');
});

test('Wiki failure diagnostics preserve actionable codes without raw errors',()=>{
  assert.equal(wikiInitializationError({code:'ENOENT'},'snapshot_git'),'wiki_git_required');
  assert.equal(wikiInitializationError({code:128,stderr:'private'},'snapshot_git'),'wiki_snapshot_failed');
  assert.equal(wikiInitializationError({code:'ENOSPC'},'publishing'),'wiki_disk_full');
  assert.equal(wikiInitializationError({code:'EEXIST'},'publishing'),'wiki_output_conflict');
  assert.equal(wikiInitializationError(Error('response_invalid'),'planning'),'response_invalid');
  assert.equal(wikiInitializationError(Error('unknown_private_reply'),'planning'),'wiki_failed');
});

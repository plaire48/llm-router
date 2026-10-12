// Gaps found on 2026-10-12 while reviewing OpenWiki in the Electron app: the pages the
// screen shows must reach the agent, a failure must keep its cause, Nubi's own records
// are not a Wiki, a run nothing can reach any more must end, and one unreadable page
// must not fail a question.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,access,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git,hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';
import {wikiPages,stalePages} from '../runtime/wiki-evidence.mjs';
import {listWikiPages,hasWikiPages} from '../runtime/wiki-snapshot.mjs';
import {wikiInitializationError} from '../runtime/wiki-initialization-error.mjs';
import {wikiSnapshot} from '../runtime/workspace-documents.mjs';
import {wikiChangeSummary} from '../runtime/wiki-update.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const connected={status:()=>({connected:true,provider:'fixture',model:'fixture'}),dispose(){}};
async function claims(root,{page='openwiki/home.md',resource='repo://app.txt',content='# Welcome\n\nWelcome uses app.txt.\n'}={}){
  await mkdir(path.join(root,path.dirname(page)),{recursive:true});await writeFile(path.join(root,page),content);
  const sidecar='openwiki/.claims/'+page.slice('openwiki/'.length).replace(/\.md$/,'.json');await mkdir(path.dirname(path.join(root,sidecar)),{recursive:true});
  const evidence=await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource);
  await writeFile(path.join(root,sidecar),JSON.stringify({schemaVersion:1,pageVersion:hash(content),claims:[{id:'claim-1',statement:'Welcome uses app.txt.',evidence:[{resource,version:evidence.evidence.version}]}]}));
}

test('a gitignored Wiki reaches the agent as the screen shows it: pages, search, the question snapshot and staleness',async t=>{
  const {root,service}=await fixture(t);
  await writeFile(path.join(root,'.gitignore'),'openwiki/\n');await git(root,['rm','-rq','--cached','openwiki']);await git(root,['add','.gitignore']);await git(root,['commit','-qm','Ignore the generated Wiki']);
  await claims(root);
  assert.deepEqual(await wikiPages(root),['openwiki/home.md']);
  assert.equal((await service.wikiQuery({query:'welcome'})).results.find(r=>r.path==='openwiki/home.md')?.freshness,'source_matched');
  assert.equal((await wikiSnapshot({root,pages:await wikiPages(root),projectId:'p',signal:new AbortController().signal})).documents.length,1);
  await writeFile(path.join(root,'app.txt'),'changed source\n');
  assert.deepEqual(await stalePages(root),[{path:'openwiki/home.md',freshness:'source_changed'}]);
});

test('Nubi records under openwiki/ are not a Wiki: initialization still runs and the page lists leave them out',async t=>{
  const {root,service}=await fixture(t);await rm(path.join(root,'openwiki'),{recursive:true});
  await mkdir(path.join(root,'openwiki/nubi-evidence/task-1'),{recursive:true});await writeFile(path.join(root,'openwiki/nubi-evidence/task-1/record.md'),'# Record\n');
  assert.equal(await hasWikiPages(root),false);assert.deepEqual(await listWikiPages(root),[]);
  assert.deepEqual(await listWikiPages(root,{includeNubi:true}),['openwiki/nubi-evidence/task-1/record.md']);assert.deepEqual(await wikiPages(root),[]);
  service.store.set('wiki-init',null);service.providers=connected;
  let called=false;service.wikiInitializer=async({root:copy})=>{called=true;await mkdir(path.join(copy,'openwiki'),{recursive:true});await writeFile(path.join(copy,'openwiki/home.md'),'# Home\n');};
  await service.initializeWiki();await service.wikiInitPromise;
  assert.equal(called,true);assert.equal(service.wikiInitialization().state,'completed',JSON.stringify(service.wikiInitialization()));
  assert.deepEqual(await wikiPages(root),['openwiki/home.md']);
});

test('generation failures keep their cause: transport names and connection codes reach the view',()=>{
  assert.equal(wikiInitializationError(Error('network'),'generating'),'network_error');
  assert.equal(wikiInitializationError(Error('model_timeout'),'generating'),'timeout');
  assert.equal(wikiInitializationError(Error('tls_untrusted'),'planning'),'tls_untrusted');
  assert.equal(wikiInitializationError(Error('network_dns'),'planning'),'network_dns');
  assert.equal(wikiInitializationError(Error('a private message'),'planning'),'wiki_failed');
});

test('a model failure behind an empty generation is reported instead of wiki_empty',async t=>{
  const {root,service}=await fixture(t);await rm(path.join(root,'openwiki'),{recursive:true});service.store.set('wiki-init',null);service.providers=connected;
  service.wikiInitializer=async({onEvent})=>{onEvent({type:'model_error',code:'unauthorized'});};
  await service.initializeWiki();await service.wikiInitPromise;
  const job=service.wikiInitialization();assert.equal(job.state,'attention');assert.equal(job.error,'unauthorized');
});

test('an update that nothing can reach any more ends as interrupted and its copy is removed',async t=>{
  const {service}=await fixture(t);
  const copy=path.join(service.store.directory,'wiki-update','orphan');await mkdir(copy,{recursive:true});await writeFile(path.join(copy,'page.md'),'x');
  service.store.set('wiki-update:orphan',{id:'orphan',state:'running',createdAt:'2026-10-12T00:00:00.000Z',copy,status:{head:null,changedFiles:[],stalePages:[],lastUpdate:{}},events:[]});
  const {updates}=await service.wikiUpdate({method:'status'});
  const record=updates.find(item=>item.id==='orphan');assert.equal(record.state,'failed');assert.equal(record.error,'wiki_update_interrupted');assert(record.finishedAt);
  await assert.rejects(access(copy));
  assert.equal((await service.wikiUpdate({method:'cancel',id:'orphan'})).state,'failed');
});

test('knowledge status in a folder without Git has no base commit and does not fail',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-plain-')),root=path.join(temp,'source');await mkdir(root);await writeFile(path.join(root,'app.txt'),'plain\n');
  const service=new ProjectService({storageRoot:path.join(temp,'state')});t.after(async()=>{service.dispose();service.store?.close();await rm(temp,{recursive:true,force:true});});
  await service.open(root);const task=await service.createTask({request:'메모',criteria:[]});
  assert.equal((await service.knowledgeStatus({taskId:task.id})).state,'none');
});

test('a Wiki page the host cannot read is skipped by the question snapshot instead of failing it',async t=>{
  const {root}=await fixture(t);
  await writeFile(path.join(root,'openwiki/binary.md'),Buffer.from([0x23,0x20,0x00,0xff]));
  const signal=new AbortController().signal,snapshot=await wikiSnapshot({root,pages:['openwiki/home.md','openwiki/binary.md'],projectId:'p',signal});
  assert.deepEqual(snapshot.documents.map(d=>d.path),['openwiki/home.md']);assert.equal(snapshot.sourceComplete,false);
  await assert.rejects(wikiSnapshot({root,pages:['openwiki/binary.md'],projectId:'p',signal}),/document_wiki_missing/);
});

test('the update copy leaves private files out, as the initialization snapshot does',async t=>{
  const {root,service}=await fixture(t);
  await writeFile(path.join(root,'.env'),'SECRET=1\n');await git(root,['add','-f','.env']);await git(root,['commit','-qm','Tracked secret']);
  let seen;service.wikiUpdater=async({root:copy})=>{seen=await access(path.join(copy,'.env')).then(()=>true,()=>false);await writeFile(path.join(copy,'openwiki/home.md'),'# Updated\n');return {};};
  const proposal=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  let record;for(let i=0;i<300&&(!record||record.state==='running');i++){record=(await service.wikiUpdate({method:'status'})).updates.find(item=>item.id===proposal.id);await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(record.state,'ready',JSON.stringify(record));assert.equal(seen,false,'the copy holds no private file');assert.deepEqual(record.outside,[],'its absence is not a change of the runner');
  await access(path.join(root,'.env'));
});

// The agent answered from a Wiki the card called stale: its receipt only looked at commits (2026-10-12).
test('the run receipt sees uncommitted edits and folders without Git through the checkpoint of the last run',async t=>{
  const {root}=await fixture(t);
  const head=(await git(root,['rev-parse','HEAD'])).trim(),appHash=hash(await readFile(path.join(root,'app.txt')));
  await writeFile(path.join(root,'openwiki/.last-update.json'),JSON.stringify({status:'complete',command:'init',gitHead:head}));
  await writeFile(path.join(root,'openwiki/.nubi-sources.json'),JSON.stringify({schemaVersion:1,files:{'app.txt':appHash}}));
  assert.equal(await wikiChangeSummary(root),null,'nothing changed since the run');
  await writeFile(path.join(root,'app.txt'),'edited, not committed\n');
  assert.deepEqual(await wikiChangeSummary(root),{state:'stale',changedFiles:1,sample:['app.txt']});
  // Roots are real paths, as the service opens them (the temporary folder is a symbolic link on macOS).
  const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-plain-'))),folder=path.join(temp,'source');t.after(()=>rm(temp,{recursive:true,force:true}));
  await mkdir(path.join(folder,'openwiki'),{recursive:true});await writeFile(path.join(folder,'app.txt'),'plain\n');await writeFile(path.join(folder,'openwiki/home.md'),'# Home\n');
  await writeFile(path.join(folder,'openwiki/.last-update.json'),JSON.stringify({status:'complete',command:'init'}));
  await writeFile(path.join(folder,'openwiki/.nubi-sources.json'),JSON.stringify({schemaVersion:1,files:{'app.txt':hash('plain\n')}}));
  assert.equal(await wikiChangeSummary(folder),null);
  await writeFile(path.join(folder,'new.txt'),'new\n');
  assert.deepEqual(await wikiChangeSummary(folder),{state:'stale',changedFiles:1,sample:['new.txt']});
});

test('a source with a Korean name and spaces reaches the update copy and the status unquoted',async t=>{
  const {root,service}=await fixture(t);
  await writeFile(path.join(root,'한글 메모.txt'),'메모\n');
  const status=await service.wikiUpdate({method:'status'});assert.deepEqual(status.status.uncommitted,['한글 메모.txt']);
  let copied;service.wikiUpdater=async({root:copy})=>{copied=await readFile(path.join(copy,'한글 메모.txt'),'utf8');await writeFile(path.join(copy,'openwiki/한글 페이지.md'),'# 한글\n');return {};};
  const proposal=await service.wikiUpdate({method:'propose'});await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  let record;for(let i=0;i<300&&(!record||record.state==='running');i++){record=(await service.wikiUpdate({method:'status'})).updates.find(item=>item.id===proposal.id);await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(record.state,'ready',JSON.stringify(record));assert.equal(copied,'메모\n');assert.deepEqual(record.outside,[]);
  assert.ok(record.changes.some(change=>change.path==='openwiki/한글 페이지.md'&&change.change==='added'),JSON.stringify(record.changes));
});

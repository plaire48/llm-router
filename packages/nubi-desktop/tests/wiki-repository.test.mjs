import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,mkdir,readFile,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const {WikiRepository,collectWiki,safePath}=createRequire(import.meta.url)('../electron-app/wiki-repository.cjs');
const hash=text=>createHash('sha1').update(text).digest('hex');
const gitBlob=content=>hash(Buffer.concat([Buffer.from('blob '+Buffer.byteLength(content)+'\0'),Buffer.from(content)]));
function mock(){
 const blobs=new Map(),trees=new Map(),commits=new Map(),calls=[];let head=hash('initial'),n=0;
 const initial=new Map([['README.md',gitBlob('preserve')]]);blobs.set(gitBlob('preserve'),'preserve');trees.set(hash('tree'),initial);commits.set(head,{tree:{sha:hash('tree')},parents:[]});
 const repo='/api/v3/repos/Manufacturing-IT/nuri';
 const account={generation:1,state:'connected',profile:{login:'alice'},accessController:new AbortController(),credential:async()=>({generation:account.generation,token:'test-token'}),invalidate:async()=>{account.generation++;account.state='guest';}};
 let permissions={push:true,admin:false},beforePatch=null;
 account.fetcher=async(url,init)=>{
  assert.equal(new URL(url).origin,'https://code.sdsdev.co.kr');assert.equal(init.redirect,'error');const pathname=decodeURIComponent(new URL(url).pathname),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({pathname,method,body});
  const result=(value,status=200)=>new Response(JSON.stringify(value),{status});
  if(pathname===repo)return result({default_branch:'main',permissions});
  const route=pathname.slice(repo.length);
  if(method==='GET'){
   if(route==='/git/ref/heads/main')return result({object:{sha:head}});
   if(route.startsWith('/git/commits/')){const sha=route.split('/').at(-1);return result({...commits.get(sha),sha});}
   if(route.startsWith('/git/blobs/')){const sha=route.split('/').at(-1);return result({sha,encoding:'base64',content:Buffer.from(blobs.get(sha)).toString('base64')});}
   if(route.startsWith('/contents/')){const commit=commits.get(new URL(url).searchParams.get('ref'));const sha=trees.get(commit?.tree.sha)?.get(route.slice('/contents/'.length));if(!sha)return result({},404);return result({sha,encoding:'base64',content:Buffer.from(blobs.get(sha)).toString('base64')});}
  }
  if(method==='POST'){
   if(route==='/git/blobs'){const sha=gitBlob(body.content);blobs.set(sha,body.content);return result({sha});}
   if(route==='/git/trees'){const tree=new Map(trees.get(body.base_tree));for(const entry of body.tree){assert(entry.path.startsWith('wiki/'));tree.set(entry.path,entry.sha);}const sha=hash('tree'+ ++n);trees.set(sha,tree);return result({sha});}
   if(route==='/git/commits'){const sha=hash('commit'+ ++n);commits.set(sha,{tree:{sha:body.tree},parents:body.parents});return result({sha});}
  }
  if(method==='PATCH'&&route==='/git/refs/heads/main'){beforePatch?.();assert.equal(body.force,false);if(commits.get(body.sha).parents[0]!==head)return result({},409);head=body.sha;return result({object:{sha:head}});}
  throw Error('Unexpected request '+method+' '+route);
 };
 return {account,calls,blobs,trees,commits,head:()=>head,permissions:value=>permissions=value,concurrent:()=>{const next=hash('concurrent'+ ++n);commits.set(next,commits.get(head));head=next;},beforePatch:value=>beforePatch=value};
}
async function fixture(t,{confirmSave=async()=>true}={}){const root=await mkdtemp(path.join(tmpdir(),'nubi-wiki-repo-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=path.join(root,'source');await mkdir(source);await writeFile(path.join(source,'quickstart.md'),'# Wiki\n');await mkdir(path.join(source,'raw'));await writeFile(path.join(source,'raw','private.md'),'private');await writeFile(path.join(source,'.env'),'SECRET=x');await writeFile(path.join(source,'original.eml'),'mail');const remote=mock(),service=new WikiRepository({account:remote.account,confirmSave}),stage=await service.stage(source),snapshot=await service.list();return {root,source,remote,service,stage,snapshot,input:{stageId:stage.id,paths:['quickstart.md'],expectedHead:snapshot.head,metadata:{title:'업무 위키',description:'프로젝트 안내',mode:'code',version:'1.0.0',managers:[]}}};}
test('selected Markdown files publish atomically, metadata is stamped, and download verifies bytes',async t=>{const f=await fixture(t);assert.deepEqual(f.stage.files.map(x=>x.path),['quickstart.md']);const saved=await f.service.publish({...f.input,metadata:{...f.input.metadata,createdBy:'forged'}});assert.equal(saved.item.createdBy,'alice');const list=await f.service.list();assert.equal(list.items.length,1);assert.equal(list.items[0].canEdit,true);const tree=f.remote.trees.get(f.remote.commits.get(f.remote.head()).tree.sha);assert.equal(tree.get('README.md'),gitBlob('preserve'));assert(tree.has(`wiki/${saved.item.id}/versions/1.0.0/pages/quickstart.md`));const dest=path.join(f.root,'download');await mkdir(dest);const downloaded=await f.service.download({id:saved.item.id,version:'1.0.0'},dest);assert.equal(await readFile(path.join(downloaded.path,'openwiki','quickstart.md'),'utf8'),'# Wiki\n');assert.equal(JSON.parse(await readFile(path.join(downloaded.path,'wiki-share.json'),'utf8')).mode,'code');await assert.rejects(f.service.download({id:saved.item.id,version:'1.0.0'},dest),/wiki_share_exists/);});
test('cancelled native approval writes nothing remotely',async t=>{const f=await fixture(t,{confirmSave:async()=>false});assert.deepEqual(await f.service.publish(f.input),{cancelled:true});assert.equal(f.remote.calls.filter(x=>x.method!=='GET').length,0);});
test('stale catalog prevents every write and retains the upload draft',async t=>{const f=await fixture(t);f.remote.concurrent();await assert.rejects(f.service.publish(f.input),/wiki_share_changed/);assert.equal(f.remote.calls.filter(x=>x.method!=='GET').length,0);assert(f.service.staged.has(f.stage.id));});
test('changed local documents require reselection before upload',async t=>{const f=await fixture(t);await writeFile(path.join(f.source,'quickstart.md'),'changed');await assert.rejects(f.service.publish(f.input),/wiki_share_source_changed/);assert.equal(f.remote.calls.filter(x=>x.method!=='GET').length,0);});
test('new releases preserve the previous version and downloads stay pinned',async t=>{const f=await fixture(t),first=await f.service.publish(f.input);await writeFile(path.join(f.source,'quickstart.md'),'# Version two');const stage=await f.service.stage(f.source),snap=await f.service.list();await assert.rejects(f.service.publish({...f.input,id:first.item.id,stageId:stage.id,expectedHead:snap.head}),/wiki_share_version/);const second=await f.service.publish({...f.input,id:first.item.id,stageId:stage.id,expectedHead:snap.head,metadata:{...f.input.metadata,version:'1.1.0'}});assert.equal(second.item.releases.length,2);const old=await f.service.download({id:first.item.id,version:'1.0.0'},f.root);assert.equal(await readFile(path.join(old.path,'openwiki','quickstart.md'),'utf8'),'# Wiki\n');});
test('repository write access alone does not grant edits to another owner',async t=>{const f=await fixture(t),first=await f.service.publish(f.input);f.remote.account.profile.login='bob';const snap=await f.service.list();assert.equal(snap.items[0].canEdit,false);await assert.rejects(f.service.publish({id:first.item.id,expectedHead:snap.head,archive:true}),/wiki_share_permission/);});
test('archive hides downloads and restore retains immutable history',async t=>{const f=await fixture(t),first=await f.service.publish(f.input);await f.service.publish({id:first.item.id,expectedHead:f.remote.head(),archive:true});await assert.rejects(f.service.download({id:first.item.id,version:'1.0.0'},f.root),/wiki_share_missing/);await f.service.publish({id:first.item.id,expectedHead:f.remote.head(),archive:true});assert.equal((await f.service.list()).items[0].archived,false);});
test('concurrent final ref changes cannot overwrite a colleague commit',async t=>{const f=await fixture(t);f.remote.beforePatch(()=>f.remote.concurrent());await assert.rejects(f.service.publish(f.input),/wiki_share_changed/);assert.equal((await f.service.list()).items.length,0);});
test('session changes during approval prevent publication',async t=>{let remote;const f=await fixture(t,{confirmSave:async()=>{remote.account.generation++;return true;}});remote=f.remote;await assert.rejects(f.service.publish(f.input),/ghes_session_changed/);assert.equal(f.remote.calls.filter(x=>x.method!=='GET').length,0);});
test('personal mode requires a real selection and keeps a separate download root',async t=>{const f=await fixture(t);await assert.rejects(f.service.publish({...f.input,paths:[],metadata:{...f.input.metadata,mode:'personal'}}),/wiki_share_empty/);const first=await f.service.publish({...f.input,metadata:{...f.input.metadata,mode:'personal'}});const saved=await f.service.download({id:first.item.id,version:'1.0.0'},f.root);assert.equal(await readFile(path.join(saved.path,'personal','quickstart.md'),'utf8'),'# Wiki\n');});
test('tampered contents fail hash verification before creating a download folder',async t=>{const f=await fixture(t),first=await f.service.publish(f.input);f.remote.blobs.set(gitBlob('# Wiki\n'),'tampered');const dest=path.join(f.root,'dest');await mkdir(dest);await assert.rejects(f.service.download({id:first.item.id,version:'1.0.0'},dest),/wiki_share_changed/);assert.deepEqual(await readdir(dest),[]);});
test('unsafe paths and symlinks are rejected',async t=>{for(const name of ['../secret.md','C:/x.md','a\\b.md','CON.md','.env','a/../b.md'])assert.equal(safePath(name),false);const f=await fixture(t);await symlink(path.join(f.source,'quickstart.md'),path.join(f.source,'link.md'));await assert.rejects(collectWiki(f.source),/wiki_share_symlink/);});

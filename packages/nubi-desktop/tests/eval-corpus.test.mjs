import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkspace,corpusManifest,changedPaths,listFiles,CORPORA} from '../eval/corpus.mjs';
import {pinCorpus} from '../eval/pin-corpus.mjs';

async function pinned(t,files={'src/a.mjs':'export const a=1;\n','openwiki/home.md':'# 집\n','openwiki/.claims/home.json':'{}\n'}){
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-corpus-test-')),source=path.join(base,'source'),directory=path.join(base,'pinned');
  t.after(()=>rm(base,{recursive:true,force:true}));
  for(const [file,content] of Object.entries(files)){await mkdir(path.dirname(path.join(source,file)),{recursive:true});await writeFile(path.join(source,file),content);}
  await mkdir(path.join(source,'node_modules','x'),{recursive:true});await writeFile(path.join(source,'node_modules','x','index.js'),'ignored');
  const corpora={'order-service':{source,include:['.']}};
  const result=await pinCorpus('order-service',{directory,corpora});
  return {base,source,directory,result};
}

test('a pinned corpus unpacks into a committed Git workspace with hidden files and no ignored folders',async t=>{
  const {directory,result}=await pinned(t);
  assert.equal(result.files,3);
  const workspace=await createWorkspace({corpus:'order-service',directory});t.after(workspace.dispose);
  assert.deepEqual(await listFiles(workspace.root),['openwiki/.claims/home.json','openwiki/home.md','src/a.mjs']);
  assert.equal(workspace.corpusHash,result.hash);
  assert.deepEqual(await changedPaths(workspace.root),[],'the snapshot is fully committed');
  await access(workspace.stateRoot);
  assert.ok(!workspace.root.startsWith(directory));
});

test('changes after the snapshot are listed, including new and deleted files',async t=>{
  const {directory}=await pinned(t),workspace=await createWorkspace({corpus:'order-service',directory});t.after(workspace.dispose);
  await writeFile(path.join(workspace.root,'src','a.mjs'),'export const a=2;\n');
  await writeFile(path.join(workspace.root,'src','새 파일.mjs'),'export const b=1;\n');
  await rm(path.join(workspace.root,'openwiki','home.md'));
  assert.deepEqual(await changedPaths(workspace.root),['openwiki/home.md','src/a.mjs','src/새 파일.mjs']);
});

test('a snapshot that differs from its manifest is refused and leaves nothing behind',async t=>{
  const {directory}=await pinned(t),file=path.join(directory,'order-service.manifest.json');
  const manifest=JSON.parse(await readFile(file,'utf8'));manifest.files[0].sha256='0'.repeat(64);await writeFile(file,JSON.stringify(manifest));
  const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-corpus-parent-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  await assert.rejects(createWorkspace({corpus:'order-service',directory,parent}),/corpus_changed/);
  assert.deepEqual(await listFiles(parent),[]);
});

test('unknown corpora, missing snapshots and unsafe manifest paths are refused',async t=>{
  const {directory}=await pinned(t);
  await assert.rejects(createWorkspace({corpus:'/etc',directory}),/corpus_unknown/);
  await assert.rejects(createWorkspace({corpus:'openwiki-sds',directory}),/corpus_missing/);
  const file=path.join(directory,'order-service.manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));
  manifest.files[0].path='../outside.txt';await writeFile(file,JSON.stringify(manifest));
  await assert.rejects(corpusManifest('order-service',directory),/corpus_manifest_invalid/);
});

test('a link inside a corpus source is refused',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-corpus-link-'));t.after(()=>rm(base,{recursive:true,force:true}));
  await writeFile(path.join(base,'real.txt'),'x');await symlink(path.join(base,'real.txt'),path.join(base,'link.txt'));
  await assert.rejects(listFiles(base),/corpus_link/);
});

// expense-office holds the rules of the simulated expense app (2026-09-29).
test('registered corpora are the only names',()=>{
  assert.deepEqual(Object.keys(CORPORA).sort(),['expense-office','openwiki-sds','order-service']);
});

test('the expense rules corpus is pinned, has its Wiki and no company data',async t=>{
  const manifest=await corpusManifest('expense-office');
  assert.deepEqual(manifest.files.map(file=>file.path),['AGENTS.md','README.md','openwiki/apps/expense-form.md','openwiki/policies/expense-rules.md','openwiki/quickstart.md']);
  const workspace=await createWorkspace({corpus:'expense-office'});t.after(workspace.dispose);
  const rules=await readFile(path.join(workspace.root,'openwiki','policies','expense-rules.md'),'utf8');
  assert.match(rules,/50,000원 이상이면 영수증 첨부를 켠다/);assert.match(rules,/교통비 \| 운영팀/);assert.match(rules,/제출은 신청자 본인이 직접 누른다/);
  assert.ok(!/해외/.test(rules),'the overseas allowance is left out on purpose');
});

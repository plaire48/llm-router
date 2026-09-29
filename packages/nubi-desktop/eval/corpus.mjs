// Pinned evaluation corpora. A corpus is a tar.gz snapshot plus a per-file
// SHA-256 manifest, so cases and their answer keys stay valid when the source
// folder changes. A workspace is always built from a registered corpus: the
// runner records full conversations, so it must never accept an arbitrary path.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,lstat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIRECTORY=path.join(here,'corpus');
const packages=path.resolve(here,'..','..');
// `source` and `include` are used only by pin-corpus.mjs.
export const CORPORA=Object.freeze({
  'openwiki-sds':{source:path.join(packages,'openwiki'),include:['src','openwiki','README.md','AGENTS.md','CONTRIBUTING.md','DEVELOPMENT.md','ENTERPRISE.md','CHANGELOG.md','package.json','tsconfig.json','evals/ledger/README.md','evals/deepswe/README.md']},
  'order-service':{source:path.join(here,'corpus-src','order-service'),include:['.']},
  // Rules of the simulated expense app, for app control that acts on an OpenWiki answer.
  'expense-office':{source:path.join(here,'corpus-src','expense-office'),include:['.']},
});
const IGNORED=new Set(['node_modules','dist','.git','.DS_Store']);
const fail=code=>{throw new Error(code);};
const sha256=value=>createHash('sha256').update(value).digest('hex');

// Lists regular files under a directory as sorted POSIX relative paths. Links are refused.
export async function listFiles(root,relative=''){
  const entries=await readdir(path.join(root,relative),{withFileTypes:true}),files=[];
  for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(IGNORED.has(entry.name))continue;
    const next=relative?relative+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())fail('corpus_link');
    if(entry.isDirectory())files.push(...await listFiles(root,next));
    else if(entry.isFile())files.push(next);
    else fail('corpus_file_type');
  }
  return files;
}
export async function fileRecords(root){
  const records=[];
  for(const file of await listFiles(root)){const content=await readFile(path.join(root,file));records.push({path:file,sha256:sha256(content),bytes:content.length});}
  return records;
}
export const corpusHash=files=>sha256(JSON.stringify(files.map(file=>[file.path,file.sha256,file.bytes])));

export async function corpusManifest(name,directory=CORPUS_DIRECTORY){
  if(!Object.hasOwn(CORPORA,name))fail('corpus_unknown');
  let manifest;
  try{manifest=JSON.parse(await readFile(path.join(directory,name+'.manifest.json'),'utf8'));}catch{fail('corpus_missing');}
  if(manifest.name!==name||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.some(file=>typeof file.path!=='string'||!/^[0-9a-f]{64}$/.test(file.sha256)||path.isAbsolute(file.path)||file.path.split('/').includes('..')))fail('corpus_manifest_invalid');
  return {...manifest,hash:corpusHash(manifest.files)};
}

const git=(root,args)=>exec('git',args,{cwd:root,maxBuffer:4e6});

// Unpacks a pinned corpus into a fresh Git repository with its own state folder.
export async function createWorkspace({corpus,parent=os.tmpdir(),directory=CORPUS_DIRECTORY}){
  const manifest=await corpusManifest(corpus,directory);
  const base=await realpath(await mkdtemp(path.join(parent,'nubi-eval-'))),root=path.join(base,'repo'),stateRoot=path.join(base,'state');
  const dispose=()=>rm(base,{recursive:true,force:true});
  try{
    await mkdir(root);await mkdir(stateRoot,{mode:0o700});
    await exec('tar',['-xzf',path.join(directory,corpus+'.tar.gz'),'-C',root]);
    const actual=await fileRecords(root);
    if(corpusHash(actual)!==manifest.hash)fail('corpus_changed');
    await git(root,['init','-q']);await git(root,['config','user.email','evaluation@example.invalid']);await git(root,['config','user.name','Evaluation']);await git(root,['config','commit.gpgsign','false']);
    await git(root,['add','-A','-f','.']);await git(root,['commit','-qm','Corpus snapshot '+corpus]);
    if((await lstat(path.join(root,'.git'))).isDirectory()!==true)fail('workspace_invalid');
    return {corpus,corpusHash:manifest.hash,directory:base,root,stateRoot,dispose};
  }catch(error){await dispose();throw error;}
}

// Paths changed since the corpus snapshot, including new and deleted files.
export async function changedPaths(root){
  const {stdout}=await git(root,['status','--porcelain=v1','-z','--untracked-files=all']);
  return stdout.split('\0').filter(Boolean).map(entry=>entry.slice(3)).sort();
}

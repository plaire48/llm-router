import {mkdir,readFile,writeFile,readdir,lstat,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {git,listFiles,readSource,fail,gitOpenFailure,privatePath} from './files.mjs';
import {OpenWikiIgnore} from '../generated/openwiki.mjs';

export const WIKI_CHECKPOINT='openwiki/.nubi-sources.json';
// Nubi's own records under openwiki/ are not Wiki pages: they neither make a Wiki nor reach the agent as one (2026-10-12).
export const NUBI_RECORD_DIRECTORIES=new Set(['openwiki/nubi-evidence','openwiki/nubi-map']);
// Generated pages are often gitignored. Count actual local Markdown pages,
// independently of Git's source inventory, without reading every page body.
export async function listWikiPages(root,{includeNubi=false}={}){
  const pages=[];let visited=0;
  async function visit(directory,relative){
    let stat;try{stat=await lstat(directory);}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(stat.isSymbolicLink()||!stat.isDirectory())fail('path_scope');
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(++visited>20000)fail('wiki_source_limit');
      const rel=relative+'/'+entry.name;
      if(entry.name.startsWith('.')||privatePath(rel)||(!includeNubi&&NUBI_RECORD_DIRECTORIES.has(rel)))continue;
      if(entry.isSymbolicLink())fail('path_scope');
      if(entry.isDirectory())await visit(path.join(directory,entry.name),rel);
      else if(entry.isFile()&&entry.name.endsWith('.md'))pages.push(rel);
    }
  }
  await visit(path.join(root,'openwiki'),'openwiki');return pages.sort();
}
export async function listWikiSourceFiles(root,lister=listFiles){
  const listed=await lister(root);let deleted,index;
  try{[deleted,index]=await Promise.all([git(root,['ls-files','--deleted','-z']),git(root,['ls-files','--stage','-v','-z'])]);}
  catch(error){if(['not_git_repository','git_unavailable'].includes(gitOpenFailure(error)))return listed;throw error;}
  // ls-files --cached also lists deleted files, sparse entries and gitlinks.
  // These are not available source files. Never initialize/fetch submodules
  // or expand a sparse checkout just to prepare a Wiki.
  const excluded=new Set(deleted.split('\0').filter(Boolean));
  for(const row of index.split('\0')){
    const match=/^([A-Za-z]) (\d{6}) [a-f0-9]+ \d\t([\s\S]+)$/.exec(row);
    if(match&&(match[2]==='160000'||match[1].toUpperCase()==='S'))excluded.add(match[3]);
  }
  return {...listed,paths:listed.paths.filter(rel=>!excluded.has(rel)),unavailableFiles:listed.paths.filter(rel=>excluded.has(rel)).length};
}

export async function readWikiSource(root,rel){
  try{return await readSource(root,rel);}catch(error){if(error.code==='ENOENT')fail('source_stale');throw error;}
}
export async function hasWikiPages(root){
  async function visit(directory,relative){
    try{if((await lstat(directory)).isSymbolicLink())fail('path_scope');}catch(error){if(error.code==='ENOENT')return false;throw error;}
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.isFile()&&entry.name.endsWith('.md'))return true;
      if(entry.isDirectory()&&!NUBI_RECORD_DIRECTORIES.has(relative+'/'+entry.name)&&await visit(path.join(directory,entry.name),relative+'/'+entry.name))return true;
    }
    return false;
  }
  return visit(path.join(root,'openwiki'),'openwiki');
}
export async function wikiSources(root){
  root=await realpath(root);
  const listed=await listWikiSourceFiles(root);if(listed.truncated)fail('wiki_source_limit');
  const ignore=await OpenWikiIgnore.load(root),files=[];
  for(const rel of listed.paths){
    if(rel.startsWith('openwiki/')||ignore.ignores(rel))continue;
    try{files.push(await readWikiSource(root,rel));}catch(error){if(!['file_too_large','binary_file','file_encoding'].includes(error.message))throw error;}
  }
  return files;
}
export async function wikiFiles(root){
  root=await realpath(root);
  const result=[];
  async function visit(directory,base=''){
    let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    if((await lstat(directory)).isSymbolicLink())fail('path_scope');
    for(const entry of entries){
      const rel=base+entry.name;if(entry.isSymbolicLink())fail('path_scope');
      if(entry.isDirectory())await visit(path.join(directory,entry.name),rel+'/');
      else if(entry.isFile()&&(rel.endsWith('.md')||['.last-update.json','.page-manifest.json','.nubi-sources.json'].includes(rel)||rel.startsWith('.claims/')&&rel.endsWith('.json'))){
        result.push(await readSource(root,'openwiki/'+rel));
      }
    }
  }
  await visit(path.join(root,'openwiki'));return result;
}
export async function writeWikiSnapshot(directory,files){
  for(const file of files){const target=path.join(directory,file.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content);}
}
export async function initializeWikiSnapshotGit(directory){
  // OpenWiki's source fingerprint requires Git. Only the private copy is initialized.
  const config=['-c','core.hooksPath='+path.join(directory,'.nubi-no-hooks'),'-c','commit.gpgSign=false','-c','user.name=Nubi Wiki','-c','user.email=wiki@localhost'];
  try{await git(directory,['init','-q']);}catch(error){if(error.code==='ENOENT')fail('wiki_git_required');throw error;}
  await git(directory,['add','--all']);
  await git(directory,[...config,'commit','--allow-empty','-qm','Snapshot for OpenWiki']);
}
export async function wikiSourceHead(root){
  try{return (await git(root,['rev-parse','--verify','HEAD'])).trim();}
  catch(error){if(['not_git_repository','git_unavailable'].includes(gitOpenFailure(error)))return null;throw error;}
}

// A detached, unpopulated worktree retains the clone's actual commits and refs.
// Only the already admitted source files are copied by the caller. No checkout
// hooks, filters, private files or changes to the user's index are involved.
export async function prepareWikiHistory(root,directory,head){
  if(!head)return;
  await git(root,['-c','core.hooksPath='+path.join(directory,'.nubi-no-hooks'),'worktree','add','--detach','--no-checkout',directory,head],{timeout:120000});
  await git(directory,['read-tree',head]);
}
export async function removeWikiHistory(root,directory,head){
  if(head){try{await git(root,['worktree','remove','--force',directory]);return;}catch{/* Remove only this run's temporary files; never prune other worktrees. */}}
  await rm(directory,{recursive:true,force:true});
}
export async function checkpointSnapshotWiki(root,sources,{gitHead=null}={}){
  // Temporary commits do not exist in the user's repository. Preserve OpenWiki's
  // metadata and Claims, while dropping only those foreign Git checkpoints.
  for(const rel of ['.last-update.json','.page-manifest.json']){
    const file=path.join(root,'openwiki',rel);let value;
    try{value=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!gitHead||value.gitHead!==gitHead)delete value.gitHead;
    for(const page of Object.values(value.pages||{}))if(!gitHead||page.gitHead!==gitHead)delete page.gitHead;
    await writeFile(file,JSON.stringify(value,null,2)+'\n');
  }
  await mkdir(path.join(root,'openwiki'),{recursive:true});
  const ignore=await OpenWikiIgnore.load(root);
  await writeFile(path.join(root,WIKI_CHECKPOINT),JSON.stringify({schemaVersion:1,files:Object.fromEntries(sources.filter(file=>!ignore.ignores(file.path)).map(file=>[file.path,file.hash]))},null,2)+'\n');
}

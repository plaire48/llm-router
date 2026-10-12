import {mkdir,readFile,writeFile,readdir,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {git,listFiles,readSource,fail} from './files.mjs';
import {OpenWikiIgnore} from '../generated/openwiki.mjs';

export const WIKI_CHECKPOINT='openwiki/.nubi-sources.json';
export async function hasWikiPages(root){
  async function visit(directory){
    try{if((await lstat(directory)).isSymbolicLink())fail('path_scope');}catch(error){if(error.code==='ENOENT')return false;throw error;}
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.isFile()&&entry.name.endsWith('.md'))return true;
      if(entry.isDirectory()&&await visit(path.join(directory,entry.name)))return true;
    }
    return false;
  }
  return visit(path.join(root,'openwiki'));
}
export async function wikiSources(root){
  root=await realpath(root);
  const listed=await listFiles(root);if(listed.truncated)fail('wiki_source_limit');
  const ignore=await OpenWikiIgnore.load(root),files=[];
  for(const rel of listed.paths){
    if(rel.startsWith('openwiki/')||ignore.ignores(rel))continue;
    try{files.push(await readSource(root,rel));}catch(error){if(!['file_too_large','binary_file','file_encoding'].includes(error.message))throw error;}
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
export async function checkpointSnapshotWiki(root,sources){
  // Temporary commits do not exist in the user's repository. Preserve OpenWiki's
  // metadata and Claims, while dropping only those foreign Git checkpoints.
  for(const rel of ['.last-update.json','.page-manifest.json']){
    const file=path.join(root,'openwiki',rel);let value;
    try{value=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    delete value.gitHead;
    for(const page of Object.values(value.pages||{}))delete page.gitHead;
    await writeFile(file,JSON.stringify(value,null,2)+'\n');
  }
  await mkdir(path.join(root,'openwiki'),{recursive:true});
  const ignore=await OpenWikiIgnore.load(root);
  await writeFile(path.join(root,WIKI_CHECKPOINT),JSON.stringify({schemaVersion:1,files:Object.fromEntries(sources.filter(file=>!ignore.ignores(file.path)).map(file=>[file.path,file.hash]))},null,2)+'\n');
}

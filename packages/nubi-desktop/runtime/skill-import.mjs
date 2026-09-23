import path from 'node:path';
import {lstat,realpath,opendir,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isUtf8} from 'node:buffer';
import {crc32} from 'node:zlib';
import yauzl from 'yauzl';
import {skillBytes as bytesAt,SKILL_RESOURCE_BYTES} from './skill-files.mjs';
import {parseSkill,skillCatalog,MAX_SKILLS} from './agent-capabilities.mjs';
import {relativeFile,hash,fail} from './files.mjs';

export const SKILL_IMPORT_LIMITS = {entries:1000,totalBytes:20*1024*1024,fileBytes:SKILL_RESOURCE_BYTES,depth:20};
const portable = value => {
  try { relativeFile(value); } catch { fail('skill_import_path'); }
  if(value.split('/').length>SKILL_IMPORT_LIMITS.depth || value.split('/').some(p=>/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p)))fail('skill_import_path');
  return value;
};
const ignored = value => value.split('/').some(p=>p==='.DS_Store'||p==='__MACOSX');

// Use bounded streams; never extract archive paths directly onto the filesystem.
export async function readSkillPackage(source) {
  if(typeof source!=='string'||!path.isAbsolute(source)||source.length>4000)fail('skill_import_path');
  const info=await lstat(source);
  if(info.isSymbolicLink())fail('skill_import_path');
  const files=new Map(),paths=new Map(),aliases=new Map(),folders=[];let entries=0,total=0;
  function reserve(rel,directory=false) {
    if(++entries>SKILL_IMPORT_LIMITS.entries)fail('skill_import_limit');
    portable(rel);const key=rel.normalize('NFC').toLowerCase();
    const parts=rel.split('/');
    for(let i=1;i<=parts.length;i++) {
      const raw=parts.slice(0,i).join('/'),normalized=raw.normalize('NFC').toLowerCase();
      if(aliases.has(normalized)&&aliases.get(normalized)!==raw)fail('skill_import_duplicate');
      aliases.set(normalized,raw);
    }
    if(paths.has(key))fail('skill_import_duplicate');
    for(const [other,isDir] of paths)if((key.startsWith(other+'/')&&!isDir)||(other.startsWith(key+'/')&&!directory))fail('skill_import_duplicate');
    paths.set(key,directory);
    if(directory)folders.push(rel);
  }
  function add(rel,bytes) {
    total+=bytes.length;
    if(bytes.length>SKILL_IMPORT_LIMITS.fileBytes||total>SKILL_IMPORT_LIMITS.totalBytes)fail('skill_import_limit');
    files.set(rel,bytes);
  }
  if(info.isDirectory()) {
    const base=await realpath(source);
    async function walk(folder,prefix='') {
      const current=await lstat(folder);
      if(current.isSymbolicLink()||await realpath(folder)!==folder)fail('skill_import_path');
      for await (const entry of await opendir(folder)) {
        const rel=prefix+entry.name;
        if(ignored(rel))continue;
        reserve(rel,entry.isDirectory());
        if(entry.isSymbolicLink())fail('skill_import_path');
        if(entry.isDirectory())await walk(path.join(folder,entry.name),rel+'/');
        else if(entry.isFile())add(rel,await bytesAt(path.join(folder,entry.name),SKILL_IMPORT_LIMITS.fileBytes));
        else fail('skill_import_path');
      }
    }
    await walk(base);
  } else if(info.isFile()&&path.extname(source).toLowerCase()==='.zip') {
    let zip;
    try {
      zip=await yauzl.fromBufferPromise(await bytesAt(source,SKILL_IMPORT_LIMITS.totalBytes),{strictFileNames:true,validateEntrySizes:true});
      if(zip.entryCount>SKILL_IMPORT_LIMITS.entries)fail('skill_import_limit');
      for await (const entry of zip.eachEntry()) {
        const directory=entry.fileName.endsWith('/'),rel=directory?entry.fileName.slice(0,-1):entry.fileName;
        if(ignored(rel))continue;
        reserve(rel,directory);
        const type=(entry.externalFileAttributes>>>16)&0xf000;
        if(type && type!==(directory?0x4000:0x8000))fail('skill_import_path');
        if(entry.generalPurposeBitFlag&1)fail('skill_archive_invalid');
        if(directory)continue;
        if(entry.uncompressedSize>SKILL_IMPORT_LIMITS.fileBytes||total+entry.uncompressedSize>SKILL_IMPORT_LIMITS.totalBytes)fail('skill_import_limit');
        const stream=await zip.openReadStreamPromise(entry),chunks=[];let size=0,checksum=0;
        for await (const chunk of stream) {
          size+=chunk.length;if(size>SKILL_IMPORT_LIMITS.fileBytes||total+size>SKILL_IMPORT_LIMITS.totalBytes){stream.destroy();fail('skill_import_limit');}
          chunks.push(chunk);checksum=crc32(chunk,checksum);
        }
        if(size!==entry.uncompressedSize||checksum!==entry.crc32)fail('skill_archive_invalid');
        add(rel,Buffer.concat(chunks));
      }
    } catch(error) { if(error.message.startsWith('skill_'))throw error;fail('skill_archive_invalid'); }
    finally { zip?.close(); }
  } else fail('skill_archive_invalid');
  const roots=[...files.keys()].filter(p=>path.posix.basename(p)==='SKILL.md');
  if(roots.length!==1)fail('skill_entry_required');
  const entry=roots[0],prefix=entry.slice(0,-'SKILL.md'.length),bytes=files.get(entry);
  if(!isUtf8(bytes)||bytes.includes(0))fail('skill_invalid');
  const metadata=parseSkill(bytes.toString('utf8'));
  portable(metadata.name);
  if([...files.keys()].some(p=>!p.startsWith(prefix)))fail('skill_entry_required');
  const normalized=new Map([...files].map(([p,b])=>[p.slice(prefix.length),b]));
  const directories=folders.filter(p=>p.startsWith(prefix)&&p.length>prefix.length).map(p=>p.slice(prefix.length));
  return {metadata,files:normalized,directories,totalBytes:total};
}

async function directory(root,rel) {
  let at=root;
  for(const part of rel.split('/')) {
    at=path.join(at,part);await mkdir(at).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const info=await lstat(at);
    if(!info.isDirectory()||info.isSymbolicLink()||await realpath(at)!==at)fail('skill_import_path');
  }
  return at;
}

function packageDirectories(packet) {
  const dirs=new Set(packet.directories);
  for(const file of [...packet.files.keys(),...packet.directories]) {
    const parts=file.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));
  }
  return [...dirs].sort();
}

async function verifyInstalled(target,packet) {
  let installed;
  try { installed=await readSkillPackage(target); } catch { fail('skill_exists'); }
  if(installed.files.size!==packet.files.size||JSON.stringify(packageDirectories(installed))!==JSON.stringify(packageDirectories(packet)))fail('skill_exists');
  for(const [file,bytes] of packet.files)if(!installed.files.has(file)||hash(installed.files.get(file))!==hash(bytes))fail('skill_exists');
}

async function registration(root,rel,packet,noChange) {
  const catalog=await skillCatalog(root),registered=catalog.skills.find(s=>s.path===rel+'/SKILL.md');
  if(!registered)fail(catalog.truncated?'skill_catalog_full':'skill_import_changed');
  if(registered.hash!==hash(packet.files.get('SKILL.md')))fail('skill_import_changed');
  return {...registered,fileCount:packet.files.size,totalBytes:packet.totalBytes,state:'registered',execution:'not_started',noChange};
}

export async function importSkill({source,taskId}={}) {
  this.ready();
  if(this.skillImportBusy||this.agent?.running||this.unsettledOperations?.size)fail('agent_busy');
  this.skillImportBusy=true;
  let pending;
  try {
    const root=await this.target(taskId),packet=await readSkillPackage(source),name=packet.metadata.name;
    const rel=`.agents/skills/${name}`,target=path.join(root,rel);
    let exists=false;
    try { await lstat(target);exists=true; } catch(e) { if(e.code!=='ENOENT')throw e; }
    if(exists) {
      await directory(root,'.agents/skills');
      // Reconcile a lost response or explicit repeat by reading actual bytes. No write/replay.
      await verifyInstalled(target,packet);
      return registration(root,rel,packet,true);
    }
    const catalog=await skillCatalog(root);
    if(catalog.truncated||catalog.capacityUsed>=MAX_SKILLS)fail('skill_catalog_full');
    const parent=await directory(root,'.agents/skills');
    pending=path.join(parent,'.pending-'+randomUUID());await mkdir(pending);
    for(const dir of packet.directories)await mkdir(path.join(pending,dir),{recursive:true});
    for(const [file,bytes] of packet.files) {
      const destination=path.join(pending,file);await mkdir(path.dirname(destination),{recursive:true});
      await writeFile(destination,bytes,{flag:'wx',mode:0o600});
      if(hash(await bytesAt(destination,SKILL_IMPORT_LIMITS.fileBytes))!==hash(bytes))fail('skill_import_changed');
    }
    if(this.disposed)fail('skill_import_changed');
    await directory(root,'.agents/skills');
    try { await lstat(target);fail('skill_exists'); } catch(e) { if(e.code!=='ENOENT')throw e; }
    await rename(pending,target);pending=null;
    await verifyInstalled(target,packet);
    return registration(root,rel,packet,false);
  } finally { try { if(pending)await rm(pending,{recursive:true,force:true}); } finally { this.skillImportBusy=false; } }
}

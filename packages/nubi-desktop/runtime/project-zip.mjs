import yauzl from 'yauzl';
import {mkdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export async function importProjectZip(file,parent){
  parent=await realpath(parent);const root=path.join(parent,'project-'+randomUUID().slice(0,8));await mkdir(root);
  const zip=await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,validateEntrySizes:true},(e,z)=>e?reject(e):resolve(z)));
  let total=0,count=0;const seen=new Set();
  try{await new Promise((resolve,reject)=>{zip.on('error',reject);zip.on('end',resolve);zip.on('entry',async entry=>{try{
    const rel=entry.fileName,parts=rel.replace(/\/$/,'').split('/'),key=rel.replace(/\/$/,'').toLowerCase();
    if(++count>20000||!rel||rel.includes('\\')||parts.some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f<>:"|?*]/.test(p)||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||seen.has(key)||((entry.externalFileAttributes>>>16)&0xf000)===0xa000||(entry.generalPurposeBitFlag&1))throw Error('zip_scope');seen.add(key);
    if(entry.uncompressedSize>16*1024*1024||(total+=entry.uncompressedSize)>256*1024*1024)throw Error('zip_limit');
    const target=path.join(root,...parts);if(rel.endsWith('/'))await mkdir(target,{recursive:true});else{await mkdir(path.dirname(target),{recursive:true});const stream=await new Promise((r,j)=>zip.openReadStream(entry,(e,s)=>e?j(e):r(s)));const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>entry.uncompressedSize)throw Error('zip_limit');chunks.push(chunk);}if(size!==entry.uncompressedSize)throw Error('zip_invalid');await writeFile(target,Buffer.concat(chunks),{flag:'wx'});}zip.readEntry();
    }catch(error){reject(error);zip.close();}});zip.readEntry();});return {root,files:count};}finally{zip.close();}
}

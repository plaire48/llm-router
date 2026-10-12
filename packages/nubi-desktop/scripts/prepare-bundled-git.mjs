import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import path from 'node:path';
import yauzl from 'yauzl';
const version='2.56.0.2',sha256='da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be';
const url=`https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/MinGit-${version}-64-bit.zip`;
const destination=path.resolve('electron-app/resources/git'),cache=path.resolve('generated/mingit.zip');
await mkdir(path.dirname(cache),{recursive:true});
let bytes;try{bytes=await readFile(cache);}catch{}
if(!bytes||createHash('sha256').update(bytes).digest('hex')!==sha256){
 const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('mingit_download_'+response.status);bytes=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('mingit_integrity');await writeFile(cache,bytes);
}
await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
const archive=await promisify(yauzl.fromBuffer)(bytes,{lazyEntries:true});
await new Promise((resolve,reject)=>{archive.on('error',reject);archive.on('end',resolve);archive.on('entry',entry=>{void(async()=>{
 if(entry.fileName.includes('\\')||entry.fileName.split('/').includes('..')||path.isAbsolute(entry.fileName)||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)throw Error('mingit_archive_path');
 const target=path.join(destination,entry.fileName);
 if(entry.fileName.endsWith('/'))await mkdir(target,{recursive:true});else{await mkdir(path.dirname(target),{recursive:true});const stream=await new Promise((r,j)=>archive.openReadStream(entry,(e,s)=>e?j(e):r(s)));await pipeline(stream,createWriteStream(target,{flags:'wx'}));}archive.readEntry();
 })().catch(error=>{archive.close();reject(error);});});archive.readEntry();});
await readFile(path.join(destination,'cmd/git.exe'));await readFile(path.join(destination,'LICENSE.txt'));
await writeFile(path.join(destination,'nubi-provenance.json'),JSON.stringify({version,url,sha256,modified:false,source:'https://github.com/git-for-windows/git/tree/v2.56.0.windows.2',build:'https://github.com/git-for-windows/build-extra',packageVersions:'etc/package-versions.txt'},null,2));
console.log('Verified bundled MinGit',version);

// Human-only file browsing. This module has no write or model-tool entry point.
const {realpath,lstat,opendir,readFile}=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {isUtf8}=require('node:buffer');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const privatePath=value=>/(^|[\\/])(?:\.git|\.ssh|\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|auth\.json|id_rsa|id_ed25519)([\\/]|$)|\.(?:pem|p12|pfx|key)$/i.test(value);
async function target(input){
 if(typeof input!=='string'||input.length>4000||input.includes('\0'))throw Error('path_scope');
 const expanded=input.startsWith('~/')?path.join(os.homedir(),input.slice(2)):input;
 if(!path.isAbsolute(expanded)||privatePath(expanded))throw Error('path_scope');
 const absolute=await realpath(expanded);if(privatePath(absolute))throw Error('path_scope');return absolute;
}
async function browseLocalDirectory(input){
 const absolute=await target(input);if(!(await lstat(absolute)).isDirectory())throw Error('directory_missing');
 const entries=[];let truncated=false;
 for await(const entry of await opendir(absolute)){
  const file=path.join(absolute,entry.name);if(entry.isSymbolicLink()||privatePath(file)||!entry.isFile()&&!entry.isDirectory())continue;
  if(entries.length===2000){truncated=true;break;}
  entries.push({id:file,path:file,name:entry.name,directory:entry.isDirectory(),extension:entry.isFile()?path.extname(entry.name).slice(1).toLowerCase():''});
 }
 entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
 return {absolute,relative:absolute,parent:path.dirname(absolute),external:true,entries,truncated};
}
async function readLocalFile(input){
 const absolute=await target(input),info=await lstat(absolute);
 const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon'}[path.extname(absolute).toLowerCase()];
 if(!info.isFile()||info.size>(mime?4:1)*1024*1024)throw Error('file_too_large');
 const bytes=await readFile(absolute);if(bytes.length>(mime?4:1)*1024*1024)throw Error('file_too_large');
 if(!mime&&(bytes.includes(0)||!isUtf8(bytes)))throw Error('file_encoding');
 return {path:path.basename(absolute),absolute,root:path.dirname(absolute),uri:pathToFileURL(absolute).href,hash:'sha256:'+createHash('sha256').update(bytes).digest('hex'),readOnly:true,...mime?{preview:`data:${mime};base64,${bytes.toString('base64')}`}:{content:bytes.toString('utf8')}};
}
module.exports={browseLocalDirectory,readLocalFile};

const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const KEYS=new Set(['provider:aipro','provider:chatgpt','provider:fabrix','provider:claude','provider:active','nubi.ghes.code.sdsdev.co.kr']);

// Only the trusted main/worker pair can access these records. Never expose
// vault operations through renderer RPC, snapshots, logs or model tools.
function connectionVault({directory,safeStorage,platform=process.platform,cryptoTimeoutMs=10000}){
 let queue=Promise.resolve();
 const check=key=>{if(!KEYS.has(key))throw Error('secret_scope');};
 // The synchronous Keychain calls can freeze Electron's main thread while
 // macOS waits for the user. Never fall back to them or plaintext encryption.
 const cryptoCall=async fn=>{
  let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('secret_unavailable')),cryptoTimeoutMs);})]);}
  finally{clearTimeout(timer);}
 };
 const available=async()=>{
  if(!['isAsyncEncryptionAvailable','encryptStringAsync','decryptStringAsync'].every(name=>typeof safeStorage[name]==='function'))return false;
  if(platform==='linux'&&['basic_text','unknown'].includes(safeStorage.getSelectedStorageBackend()))return false;
  return cryptoCall(()=>safeStorage.isAsyncEncryptionAvailable());
 };
 const file=key=>path.join(directory,Buffer.from(key).toString('hex')+'.bin');
 const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 const write=async(key,value)=>{
  await fs.mkdir(directory,{recursive:true,mode:0o700});if((await fs.lstat(directory)).isSymbolicLink())throw Error('secret_unavailable');await fs.chmod(directory,0o700);
  const encrypted=await cryptoCall(()=>safeStorage.encryptStringAsync(JSON.stringify({version:1,key,value}))),temp=path.join(directory,randomUUID()+'.tmp');
  try{await fs.writeFile(temp,encrypted,{flag:'wx',mode:0o600});await fs.rename(temp,file(key));}finally{await fs.rm(temp,{force:true}).catch(()=>{});}
 };
 return {
  get(key){check(key);return serial(async()=>{try{
   const stat=await fs.lstat(file(key));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('secret_unavailable');
   if(!await available())throw Error('secret_unavailable');
   const bytes=await fs.readFile(file(key)),decrypted=await cryptoCall(()=>safeStorage.decryptStringAsync(bytes));
   const record=JSON.parse(decrypted.result);
   if(record.version!==1||record.key!==key||typeof record.value!=='string')throw Error('secret_unavailable');
   if(decrypted.shouldReEncrypt)await write(key,record.value);
   return record.value;
  }catch(error){if(error.code==='ENOENT')return null;throw Error('secret_unavailable');}});},
  set(key,value){check(key);if(typeof value!=='string'||Buffer.byteLength(value)>800000)throw Error('secret_unavailable');return serial(async()=>{
   if(!await available())throw Error('secret_unavailable');await write(key,value);
  });},
  delete(key){check(key);return serial(()=>fs.rm(file(key),{force:true}));},
  flush:()=>queue
 };
}
module.exports={connectionVault,KEYS};

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {connectionVault} from '../electron-app/connection-vault.cjs';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
const signal=()=>new AbortController().signal;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-connections-'));t.after(()=>rm(directory,{recursive:true,force:true}));const key=randomBytes(32);
 const safeStorage={isAsyncEncryptionAvailable:async()=>true,getSelectedStorageBackend:()=> 'gnome_libsecret',encryptStringAsync:async value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},decryptStringAsync:async bytes=>{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return {result:Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString(),shouldReEncrypt:false};}};
 return {directory,safeStorage,vault:connectionVault({directory,safeStorage})};
}
test('encrypted connection survives a new vault instance and logout deletes it',async t=>{
 const {directory,safeStorage,vault}=await fixture(t);await vault.set('provider:chatgpt','private-refresh-token');
 for(const file of await readdir(directory))assert.ok(!(await readFile(path.join(directory,file))).includes('private-refresh-token'));
 const restarted=connectionVault({directory,safeStorage});assert.equal(await restarted.get('provider:chatgpt'),'private-refresh-token');await restarted.delete('provider:chatgpt');assert.equal(await vault.get('provider:chatgpt'),null);
});
test('unavailable and plaintext OS stores never write credentials; scope is fixed',async t=>{
 const {directory,safeStorage}=await fixture(t);
 for(const blocked of [{...safeStorage,isAsyncEncryptionAvailable:async()=>false},{...safeStorage,getSelectedStorageBackend:()=> 'basic_text'}]){
  const vault=connectionVault({directory,safeStorage:blocked,platform:'linux'});await assert.rejects(vault.set('provider:aipro','secret'),/secret_unavailable/);assert.deepEqual(await readdir(directory),[]);
 }
 assert.throws(()=>connectionVault({directory,safeStorage}).get('../../password'),/secret_scope/);
});
test('concurrent rotation and logout cannot restore a deleted connection',async t=>{
 const {vault}=await fixture(t);await Promise.all([vault.set('provider:chatgpt','old'),vault.set('provider:chatgpt','new'),vault.delete('provider:chatgpt')]);assert.equal(await vault.get('provider:chatgpt'),null);
});
test('symlink credential files are rejected',async t=>{
 const {directory,vault}=await fixture(t);await vault.set('provider:aipro','secret');await symlink(path.join(directory,Buffer.from('provider:aipro').toString('hex')+'.bin'),path.join(directory,Buffer.from('provider:chatgpt').toString('hex')+'.bin'));await assert.rejects(vault.get('provider:chatgpt'),/secret_unavailable/);
});
test('OS key operations are asynchronous and never call blocking APIs',async t=>{
 const {directory,safeStorage}=await fixture(t),blocking=()=>{assert.fail('blocking safeStorage API used');};
 const vault=connectionVault({directory,safeStorage:{...safeStorage,isEncryptionAvailable:blocking,encryptString:blocking,decryptString:blocking}});
 await vault.set('provider:chatgpt','session');assert.equal(await vault.get('provider:chatgpt'),'session');
});
test('a locked OS store times out without freezing timers or writing after logout',async t=>{
 const {directory,safeStorage}=await fixture(t);let release,started;
 const ready=new Promise(resolve=>{started=resolve;});
 const vault=connectionVault({directory,cryptoTimeoutMs:30,safeStorage:{...safeStorage,encryptStringAsync:value=>{started();return new Promise(resolve=>{release=async()=>resolve(await safeStorage.encryptStringAsync(value));});}}});
 const failed=assert.rejects(vault.set('provider:chatgpt','late-session'),/secret_unavailable/);await ready;
 let responsive=false;await new Promise(resolve=>setTimeout(()=>{responsive=true;resolve();},1));assert.equal(responsive,true);
 const logout=vault.delete('provider:chatgpt');await failed;await logout;await release();await tick();await vault.flush();
 assert.deepEqual(await readdir(directory),[],'late OS result must never resurrect logged-out credentials');
});
test('key rotation re-encrypts a validated record and preserves existing data on failure',async t=>{
 const {directory,safeStorage,vault}=await fixture(t);await vault.set('provider:aipro','session');
 const target=path.join(directory,Buffer.from('provider:aipro').toString('hex')+'.bin'),before=await readFile(target);
 const rotating={...safeStorage,decryptStringAsync:async bytes=>({...await safeStorage.decryptStringAsync(bytes),shouldReEncrypt:true})};
 assert.equal(await connectionVault({directory,safeStorage:rotating}).get('provider:aipro'),'session');
 const after=await readFile(target);assert.notDeepEqual(after,before);
 await assert.rejects(connectionVault({directory,safeStorage:{...rotating,encryptStringAsync:async()=>{throw Error('locked');}}}).get('provider:aipro'),/secret_unavailable/);
 assert.deepEqual(await readFile(target),after);
});
test('Desktop opt-in restores ChatGPT model and reasoning, rotates refresh tokens and removes logout',async()=>{
 const stored=new Map(),changes=[];
 const deps={onConnectionChange:async(id,record)=>{changes.push(record);record?stored.set(id,structuredClone(record)):stored.delete(id);},chatGPTLogin:async()=>({result:Promise.resolve({token:'old-token',refreshToken:'old-refresh',expiresAt:1}),cancel(){}}),chatGPTModels:async()=>({payload:{modelList:[{name:'model-a'},{name:'model-b'}]}}),refreshChatGPTToken:async()=>({credential:{token:'new-token',refreshToken:'new-refresh',expiresAt:Date.now()+3600000}}),completeChatGPT:async()=>({content:'OK',calls:[]})};
 const first=createProviders(deps);await first.login('chatgpt');await tick();first.model('model-b');first.reasoning('high');await first.flushConnections();first.dispose();assert.ok(stored.has('chatgpt'),'shutdown retains login');
 const second=createProviders(deps);await second.restoreConnections([...stored.values()],'chatgpt');assert.equal(second.status().model,'model-b');assert.equal(second.status().reasoningEffort,'high');assert.equal(second.status().connected,true);assert.equal(stored.get('chatgpt').credential.refreshToken,'new-refresh');assert.ok(!JSON.stringify(second.status()).includes('new-refresh'));
 await second.complete([],[],signal());second.disconnect('chatgpt');await second.flushConnections();assert.equal(stored.size,0);second.dispose();assert.equal(changes.at(-1),null);
});
test('Office never imports persisted Desktop sessions without explicit storage capability',async()=>{
 const provider=createProviders();await provider.restoreConnections([{version:1,provider:'chatgpt',credential:{token:'secret'}}],'chatgpt');assert.equal(provider.status().connected,false);provider.dispose();
});
test('a temporary catalog failure preserves encrypted login for the next launch',async()=>{
 const writes=[],provider=createProviders({onConnectionChange:(id,record)=>writes.push(record),chatGPTModels:async()=>{throw Error('network_failed');}});
 await provider.restoreConnections([{version:1,provider:'chatgpt',credential:{token:'token',expiresAt:Date.now()+3600000}}],'chatgpt');assert.equal(provider.status().connected,false);assert.deepEqual(writes,[]);provider.dispose();
});
test('vault failure is visible without invalidating the current in-memory login',async()=>{
 const provider=createProviders({onConnectionChange:async()=>{throw Error('secret_unavailable');},chatGPTLogin:async()=>({result:Promise.resolve({token:'token',expiresAt:Date.now()+3600000}),cancel(){}}),chatGPTModels:async()=>({payload:{modelList:[{name:'model'}]}})});
 await provider.login('chatgpt');await tick();await provider.flushConnections();assert.equal(provider.status().connected,true);assert.equal(provider.status().persistenceError,'connection_not_saved');provider.dispose();
});

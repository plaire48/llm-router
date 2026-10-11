import test from 'node:test';import {request as httpRequest} from 'node:http';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import {ProjectService} from '../runtime/project-service.mjs';
const {startWebHost}=createRequire(import.meta.url)('../electron-app/web-host.cjs');
test('live web bridge rejects foreign sites, missing capabilities, bad hosts and traversal before dispatch',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-web-host-'));await writeFile(path.join(root,'index.html'),'<body><script type="module" src="./renderer.js"></script></body>');let calls=0;
 const host=await startWebHost({frontend:root,port:0,dispatch:async(method,args)=>{calls++;return {method,args};}});
 try{
  const html=await(await fetch(host.origin)).text();assert.match(html,/host-bridge.js/);assert(!html.includes('preview-bridge'));
  const js=await(await fetch(host.origin+'/host-bridge.js')).text(),capability=JSON.parse(js.match(/const capability=("[^"]+")/)[1]);
  const rpc=(headers={},body=JSON.stringify({method:'provider',args:{action:'status'}}))=>fetch(host.origin+'/nubi/rpc',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
  assert.equal((await rpc()).status,403);assert.equal((await rpc({'X-Nubi-Session':capability,Origin:'https://external.invalid'})).status,403);assert.equal((await rpc({'X-Nubi-Session':capability,'Sec-Fetch-Site':'cross-site'})).status,403);
  const badHost=await new Promise((resolve,reject)=>{const r=httpRequest(host.origin,{headers:{Host:'external.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});assert.equal(badHost,403);assert.equal((await fetch(host.origin+'/%2e%2e%2fprivate.txt')).status,404);assert.equal(calls,0);
  assert.equal((await rpc({'X-Nubi-Session':capability},'{bad')).status,400);assert.equal(calls,0);
  const good=await rpc({'X-Nubi-Session':capability,Origin:host.origin,'Sec-Fetch-Site':'same-origin'});assert.equal(good.status,200);assert.deepEqual(await good.json(),{method:'provider',args:{action:'status'}});assert.equal(calls,1);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
test('personal conversations persist real tasks without starting project Wiki initialization',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-personal-chat-')),root=path.join(temp,'conversations');await mkdir(root);const service=new ProjectService({storageRoot:path.join(temp,'state')});
 try{const opened=await service.invoke('open',{root,kind:'conversation'});assert.equal(opened.kind,'conversation');assert.equal(opened.name,'개인 대화');assert.equal(service.wikiInitialization(),null);const task=await service.createTask({request:'A real persisted conversation'});assert.equal(service.state().tasks[0].id,task.id);assert(!service.wikiInitController);}finally{service.dispose();service.store?.close();await rm(temp,{recursive:true,force:true});}
});

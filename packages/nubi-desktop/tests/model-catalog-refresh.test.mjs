import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviders} from '../../nubi-office/worker/providers.mjs';

test('catalog refresh shares one request, preserves session identity and current choice, and ignores a disconnected result',async()=>{
  const token='e30.'+Buffer.from(JSON.stringify({sub:'fixture'})).toString('base64url')+'.signature';
  let resolve,calls=0,fail=false;
  const providers=createProviders({startLogin:async()=>({result:Promise.resolve({token,models:[{id:'first'},{id:'second'}]}),cancel(){}}),fetchImpl:async()=>{calls++;await new Promise(r=>{resolve=r;});if(fail)throw Error('network');return Response.json({modelList:[{name:'first'},{name:'second'}]});}});
  try{
    await providers.login('aipro');await new Promise(r=>setImmediate(r));
    const id=providers.status().providers.find(p=>p.id==='aipro').connectionId;
    const one=providers.refreshModels(),two=providers.refreshModels();assert.equal(calls,1);
    providers.model('second');resolve();await Promise.all([one,two]);
    assert.equal(providers.status().model,'second');assert.equal(providers.status().providers.find(p=>p.id==='aipro').connectionId,id);
    fail=true;const failed=providers.refreshModels();resolve();await assert.rejects(failed,/network/);
    assert.equal(providers.status().models.length,2);assert.equal(calls,2);
    fail=false;const late=providers.refreshModels();providers.disconnect('aipro');resolve();await late;
    assert.equal(providers.status().connected,false);assert.deepEqual(providers.status().models,[]);
  }finally{providers.dispose();}
});

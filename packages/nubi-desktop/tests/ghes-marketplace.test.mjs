import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ghesMarketplaceReader} from '../runtime/skill-marketplace.mjs';

test('logout clears worker credentials and the private catalog without removing installed skills',async t=>{
  const {service}=await fixture(t);service.connectSkillMarketplace({token:'PRIVATE'});
  service.marketplaceCatalog={items:[],files:new Map()};service.marketplaceConnected=true;
  assert.deepEqual(await service.invoke('disconnectSkillMarketplace'),{connected:false,credentialsReady:false,loginRequired:true});
  assert.equal(service.marketplaceToken,null);assert.equal(service.marketplaceCatalog,null);assert.equal(service.marketplaceConnected,false);
  assert.equal(service.marketplaceController.signal.aborted,true);assert.equal((await service.listSkills()).skills.length,0);
});
test('logout during catalog fetch cannot publish the stale account catalog',async t=>{
  const {service}=await fixture(t);let release,started;const reading=new Promise(r=>started=r);
  service.connectSkillMarketplace({token:'PRIVATE'});service.marketplaceReader={tree:async()=>{started();return new Promise(r=>release=r);},blob:async()=>{assert.fail('no private blob read after logout');}};
  const result=service.skillMarketplace({operation:'refresh'});await reading;service.disconnectSkillMarketplace();release({commit:'a'.repeat(40),files:[]});
  await assert.rejects(result,/marketplace_auth/);assert.equal(service.marketplaceCatalog,null);assert.equal(service.marketplaceConnected,false);
});
test('an aborted marketplace reader refuses subsequent network calls',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const reader=ghesMarketplaceReader('PRIVATE',async()=>{calls++;},{signal:controller.signal});
  await assert.rejects(reader.tree(),/marketplace_auth/);assert.equal(calls,0);
});
test('reusing the verified account retains a pinned catalog but changing accounts invalidates it',async t=>{
  const {service}=await fixture(t);service.connectSkillMarketplace({token:'FIRST'});const catalog=service.marketplaceCatalog={items:[]},signal=service.marketplaceController.signal;
  service.connectSkillMarketplace({token:'FIRST'});assert.equal(service.marketplaceCatalog,catalog);assert.equal(signal.aborted,false);
  service.connectSkillMarketplace({token:'SECOND'});assert.equal(signal.aborted,true);assert.equal(service.marketplaceCatalog,null);
});

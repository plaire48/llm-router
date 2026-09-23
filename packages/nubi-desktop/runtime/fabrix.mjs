import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {cleanFabrixCredentials} from '../../../extensions/aipro-chat/fabrix.js';

export async function fabrix({method,testId,connection}) {
  if(typeof testId!=='string'||!/^[a-f\d-]{36}$/i.test(testId))throw new Error('fabrix_test_expired');
  this.fabrixTests ||= new Map();
  for(const [key,value] of this.fabrixTests)if(value.expires<Date.now()){value.provider.dispose();this.fabrixTests.delete(key);}
  if(method==='CANCEL_FABRIX_TEST'){this.fabrixTests.get(testId)?.provider.dispose();this.fabrixTests.delete(testId);return {cancelled:true};}
  if(this.agent?.running)throw new Error('agent_busy');
  if(method==='TEST_FABRIX'){
    if(this.fabrixTests.size>=4)throw new Error('connection_busy');
    const checked=cleanFabrixCredentials(connection),provider=createProviders(),entry={provider,connection:checked,expires:Date.now()+300000,verified:false};
    this.fabrixTests.set(testId,entry);
    try{const status=await provider.connect({provider:'fabrix',...checked});if(this.fabrixTests.get(testId)!==entry)throw new Error('cancelled');entry.verified=true;return {testId,modelCount:status.models.length};}
    catch(error){provider.dispose();this.fabrixTests.delete(testId);throw error;}
  }
  if(method==='CONNECT_FABRIX'){
    const entry=this.fabrixTests.get(testId);if(!entry?.verified)throw new Error('fabrix_test_expired');
    if(!this.providers)this.providers=createProviders({hostLabel:'누비 워크스페이스'});
    const result=await this.providers.connect({provider:'fabrix',...entry.connection});
    entry.provider.dispose();this.fabrixTests.delete(testId);return {connected:result.connected};
  }
  throw new Error('provider_action');
}

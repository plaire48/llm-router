import {describe,it,expect,vi} from 'vitest';
// @ts-expect-error shared provider adapter uses JavaScript
import {officeProviders} from '../runtime-src/nubi-providers.mjs';

describe('staged model form catalog refresh',()=>{
 it('refreshes the browsed account without changing the active provider',async()=>{
  const persist=vi.fn(),refresh=vi.fn(),connect=vi.fn();
  const providers=officeProviders(persist,{
   createBase:()=>({status:()=>({provider:'aipro',providers:[]}),catalogs:()=>[],refreshModels:refresh,select:vi.fn()}),
   createClaude:()=>({status:()=>({provider:'claude',connected:true,models:[],model:'sonnet'}),connect})
  });
  await providers.refreshModels({provider:'claude'});
  expect(connect).toHaveBeenCalledOnce();expect(providers.status().provider).toBe('aipro');expect(persist).not.toHaveBeenCalled();
  await providers.select('claude');persist.mockClear();connect.mockClear();
  await providers.refreshModels({provider:'aipro'});
  expect(refresh).toHaveBeenCalledWith({provider:'aipro'});expect(connect).not.toHaveBeenCalled();expect(providers.status().provider).toBe('claude');expect(persist).not.toHaveBeenCalled();
 });
});

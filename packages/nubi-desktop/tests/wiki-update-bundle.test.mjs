// The OpenWiki update runner is a separate folder, loaded only when an update
// runs, so the host does not load it at start. OpenWiki reads some files beside
// its modules; the folder holds them in the package layout.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// OpenWiki takes its home from the environment when its module loads.
const home=await mkdtemp(path.join(os.tmpdir(),'nubi-openwiki-home-'));
process.env.OPENWIKI_CONFIG_DIR=home;
const runner=await import('../generated/openwiki-update/index.mjs');
test.after(()=>rm(home,{recursive:true,force:true}));

test('the update folder loads on its own and exports the runner, the model and the skills step',()=>{
  assert.equal(typeof runner.runNativeRepositoryGeneration,'function');
  assert.equal(typeof runner.NubiOpenWikiModel,'function');
  assert.equal(typeof runner.syncBundledSkills,'function');
});

test('the bundled skills come from the folder and go to the OpenWiki home',async()=>{
  await runner.syncBundledSkills();
  const installed=(await readdir(path.join(home,'skills'))).filter(name=>!name.startsWith('.')).sort();
  const bundled=(await readdir(new URL('../../openwiki/skills',import.meta.url))).sort();
  assert.deepEqual(installed,bundled);
});

test('Desktop initialization reaches the real OpenWiki planner from a plain folder using its private Git snapshot',async()=>{
  const {ProjectService}=await import('../runtime/project-service.mjs');
  const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-native-wiki-')),root=path.join(temporary,'project');await mkdir(root);await writeFile(path.join(root,'app.txt'),'The app adds two numbers.\n');
  const service=new ProjectService({storageRoot:path.join(temporary,'state')});let calls=0;
  try{
    await service.open(root);
    service.providers={status:()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:128000}]}),dispose(){},async complete(){calls++;throw Object.assign(Error('unauthorized'),{status:401});}};
    await service.initializeWiki();await service.wikiInitPromise;
    assert.equal(calls,1,'the real repository lifecycle and planner reached the injected model');
    assert.equal(service.wikiInitialization().state,'attention');
    await assert.rejects(access(path.join(root,'.git')),'no Git repository is created in the user folder');
    await assert.rejects(access(path.join(root,'openwiki')),'failed generation publishes no partial Wiki');
  }finally{service.dispose();service.store?.close();await rm(temporary,{recursive:true,force:true});}
});

test('the folder names the OpenWiki package it was built from',async()=>{
  const own=JSON.parse(await readFile(new URL('../generated/openwiki-update/openwiki/package.json',import.meta.url),'utf8'));
  const source=JSON.parse(await readFile(new URL('../../openwiki/package.json',import.meta.url),'utf8'));
  assert.deepEqual({name:own.name,version:own.version},{name:source.name,version:source.version});
});

test('Mermaid and jsdom are left out, so no global window is set in the host process',async()=>{
  assert.equal(typeof globalThis.window,'undefined');
  const bundle=await readFile(new URL('../generated/openwiki-update/index.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(bundle,/node_modules\/(?:\.pnpm\/)?(?:mermaid|jsdom|posthog-node)@/);
});

test('the host bundle imports the runner from the folder beside it',async()=>{
  const host=await readFile(new URL('../extension/lib/node/service-entry.mjs',import.meta.url),'utf8');
  assert.match(host,/import\("\.\/openwiki-update\/index\.mjs"\)/);
  assert.doesNotMatch(host,/openwiki\/src\/agent\/repository-runner\.ts/);
});

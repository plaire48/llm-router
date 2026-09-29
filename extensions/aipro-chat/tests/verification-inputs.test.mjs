import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {verificationInputs,SHARED_VERIFICATION_FILES} from '../scripts/verification-inputs.mjs';
async function fixture(t) {
 const base=await mkdtemp(resolve(tmpdir(),'nubi-inputs-')),root=resolve(base,'extensions/aipro-chat');
 t.after(()=>rm(base,{recursive:true,force:true}));
 for(const dir of ['src','public','scripts','tests','design','vendor','verification','dist','generated'])await mkdir(resolve(root,dir),{recursive:true});
 for(const file of ['agent-runtime.js','package-lock.json','src/App.jsx','public/background.js',...SHARED_VERIFICATION_FILES]){
  await mkdir(resolve(root,file,'..'),{recursive:true});await writeFile(resolve(root,file),'initial');
 }
 return root;
}
test('verification detects source and shared OpenWiki changes even if frozen dist is unchanged',async t=>{
 const root=await fixture(t),before=await verificationInputs(root);
 for(const file of ['agent-runtime.js','src/App.jsx','public/background.js','../../packages/openwiki/src/agent/wiki-question.ts','../../packages/openwiki/pnpm-lock.yaml']){
  await writeFile(resolve(root,file),'changed');assert.notDeepEqual(await verificationInputs(root),before);await writeFile(resolve(root,file),'initial');
 }
 assert.deepEqual(await verificationInputs(root),before);
});
test('reports and generated outputs do not invalidate input hashes but added tests do',async t=>{
 const root=await fixture(t),before=await verificationInputs(root);
 for(const path of ['verification/result.json','dist/bundle.js','generated/browser-dom.js','.env'])await writeFile(resolve(root,path),'output or private data');
 assert.deepEqual(await verificationInputs(root),before);
 await writeFile(resolve(root,'tests/new.test.mjs'),'new test');assert.notDeepEqual(await verificationInputs(root),before);
});

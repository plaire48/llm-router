const test=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm,copyFile}=require('node:fs/promises');
const {createHash}=require('node:crypto');
const path=require('node:path'),os=require('node:os');
const {Runtime}=require('../src/runtime.cjs');
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-runtime-contract-'));
  await mkdir(path.join(root,'runtime'));await mkdir(path.join(root,'dist'));
  t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
test('wrong-platform and tampered runtime refuse to start',async t=>{
  const root=await fixture(t),manifest=path.join(root,'runtime/manifest.json');
  await writeFile(manifest,JSON.stringify({platform:'unsupported',arch:process.arch}));
  const runtime=new Runtime(root,path.join(root,'state'));
  assert.throws(()=>runtime.invoke('state'),/runtime_platform_mismatch/);assert.equal(runtime.child,undefined);
  await writeFile(path.join(root,'runtime',process.platform==='win32'?'node.exe':'node'),'tampered');
  await writeFile(manifest,JSON.stringify({platform:process.platform,arch:process.arch,sha256:'wrong'}));
  assert.throws(()=>runtime.invoke('state'),/runtime_hash_mismatch/);assert.equal(runtime.child,undefined);
});
test('sidecar removes startup overrides and rejects uncertain work without replay after exit',async t=>{
  const root=await fixture(t),binary=path.join(root,'runtime',process.platform==='win32'?'node.exe':'node');
  await copyFile(path.resolve(__dirname,'../runtime',process.platform==='win32'?'node.exe':'node'),binary);
  await writeFile(path.join(root,'runtime/manifest.json'),JSON.stringify({platform:process.platform,arch:process.arch,sha256:createHash('sha256').update(await readFile(binary)).digest('hex')}));
  if(process.platform==='win32'){await mkdir(path.join(root,'runtime/winapp'));await writeFile(path.join(root,'runtime/winapp/manifest.json'),JSON.stringify({sha256:'fixture'}));}
  await writeFile(path.join(root,'dist/service-entry.mjs'),`process.on('message',m=>{if(m.method==='env')process.send({id:m.id,result:{options:process.env.NODE_OPTIONS,path:process.env.NODE_PATH,storage:process.env.NUBI_STORAGE_ROOT}});else process.exit(7);});process.on('disconnect',()=>process.exit());`);
  const old=process.env.NODE_OPTIONS;process.env.NODE_OPTIONS='--require /never-execute-workspace-hook.cjs';
  const runtime=new Runtime(root,path.join(root,'state'));
  try{
    const env=await runtime.invoke('env');assert.equal(env.options,undefined);assert.equal(env.path,undefined);assert.equal(env.storage,path.join(root,'state'));
    await assert.rejects(runtime.invoke('uncertain_write'),/host_disconnected/);
    const child=runtime.child;assert.throws(()=>runtime.invoke('uncertain_write'),/host_disconnected/);assert.equal(runtime.child,child);
  }finally{runtime.dispose();if(old===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=old;}
});

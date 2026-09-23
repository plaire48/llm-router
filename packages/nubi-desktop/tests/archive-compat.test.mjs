import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url),requireCli=createRequire(require.resolve('@theia/cli/package.json'));
const decompress=requireCli('decompress'),tar=createRequire(require.resolve('@theia/filesystem/package.json'))('tar-stream');

async function archive(header,body='') {
  const pack=tar.pack(),buffers=[];const complete=new Promise((resolve,reject)=>{pack.on('data',value=>buffers.push(value));pack.on('end',()=>resolve(Buffer.concat(buffers)));pack.on('error',reject);});
  pack.entry(header,body);pack.finalize();return complete;
}
test('Theia archive adapter extracts valid files and blocks a hardlink outside its output directory',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-archive-')),output=path.join(root,'output');
  t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(output);
  const files=await decompress(await archive({name:'extension/package.json'},'{"name":"fixture"}'),output);
  assert.equal(files.length,1);assert.equal(await readFile(path.join(output,'extension/package.json'),'utf8'),'{"name":"fixture"}');
  const sentinel=path.join(root,'outside.txt');await writeFile(sentinel,'preserved');
  await assert.rejects(decompress(await archive({name:'escape.txt',type:'link',linkname:'../outside.txt'}),output),/outside/);
  assert.equal(await readFile(sentinel,'utf8'),'preserved');await assert.rejects(lstat(path.join(output,'escape.txt')),error=>error.code==='ENOENT');
});

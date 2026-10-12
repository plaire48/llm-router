import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {remote}=createRequire(import.meta.url)('../electron-app/native-host.cjs');

test('Git remote trailing slashes normalize for HTTPS, SSH URL and SCP addresses',()=>{
  for(const base of ['https://code.sdsdev.co.kr/team/project','https://example.com/team/project.git','ssh://git@example.com/team/project.git','git@example.com:team/project.git']){
    for(const suffix of ['','/','///']){
      const result=remote(base+suffix);assert.equal(result.href,base);assert.equal(result.pathname.split('/').at(-1).replace(/\.git$/,''),'project');
    }
  }
});
test('remote normalization preserves credential and scheme guards',()=>{
  for(const value of ['https://user:secret@example.com/project/','https://example.com/project/?token=secret','https://example.com/project/#branch','file:///tmp/project/','--upload-pack=evil','https://example.com/space repo/'])assert.throws(()=>remote(value),/remote_invalid/);
});

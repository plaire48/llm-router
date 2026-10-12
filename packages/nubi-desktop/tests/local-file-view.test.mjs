import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {browseLocalDirectory,readLocalFile}=createRequire(import.meta.url)('../electron-app/local-file-view.cjs');
test('manual external browsing returns bounded directory rows and read-only content',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-local-view-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(path.join(dir,'other'));await writeFile(path.join(dir,'notes.md'),'# Outside project');await writeFile(path.join(dir,'.env'),'PRIVATE');
 const listing=await browseLocalDirectory(dir);assert.equal(listing.entries[0].name,'other');assert.equal(listing.entries.length,2);assert.equal(listing.external,true);assert.equal(listing.parent,path.dirname(listing.absolute));
 const file=await readLocalFile(path.join(dir,'notes.md'));assert.equal(file.content,'# Outside project');assert.equal(file.readOnly,true);
 await assert.rejects(readLocalFile(path.join(dir,'.env')),/path_scope/);await assert.rejects(browseLocalDirectory('../'),/path_scope/);
 await symlink(path.join(dir,'.env'),path.join(dir,'linked.md'));await assert.rejects(readLocalFile(path.join(dir,'linked.md')),/path_scope/);
 await writeFile(path.join(dir,'huge.txt'),'x'.repeat(1024*1024+1));await assert.rejects(readLocalFile(path.join(dir,'huge.txt')),/file_too_large/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ProjectCatalog} from '../electron-app/project-catalog.cjs';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'nubi-project-list-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,catalog:new ProjectCatalog(root)};}
test('multiple projects survive restart, deduplicate and retain custom names',async t=>{
 const {root,catalog}=await fixture(t);
 const a={projectId:'a',root:path.join(root,'a'),name:'Project A'},b={projectId:'b',root:path.join(root,'b'),name:'Project B'};
 await Promise.all([catalog.remember(a),catalog.remember(b)]);
 await catalog.rename('a','업무 자료');await catalog.remember(a);
 assert.deepEqual((await new ProjectCatalog(root).list()).map(p=>[p.id,p.name]),[['a','업무 자료'],['b','Project B']]);
 assert.equal((await catalog.get('a')).root,a.root);
 await catalog.remember({projectId:'personal',root,name:'개인 대화',kind:'conversation'});
 assert.equal((await catalog.list()).length,2);
});
test('removing a shortcut preserves project files and conversation data',async t=>{
 const {root,catalog}=await fixture(t);const file=path.join(root,'notes.txt');await writeFile(file,'keep original');
 await catalog.remember({projectId:'a',root,name:'Notes'});await catalog.remove('a');
 assert.deepEqual(await catalog.list(),[]);assert.equal(await readFile(file,'utf8'),'keep original');
 await assert.rejects(catalog.get('a'),{message:'project_missing'});
});
test('invalid names and damaged catalogs never replace existing entries',async t=>{
 const {root,catalog}=await fixture(t);await catalog.remember({projectId:'a',root,name:'Notes'});
 await assert.rejects(catalog.rename('a','bad\nname'),{message:'project_name_invalid'});
 await assert.rejects(catalog.rename('missing','name'),{message:'project_missing'});
 assert.equal((await catalog.list())[0].name,'Notes');
 await writeFile(path.join(root,'projects.json'),'damaged');
 await assert.rejects(catalog.remember({projectId:'b',root,name:'B'}),{message:'project_catalog_unavailable'});
 assert.equal(await readFile(path.join(root,'projects.json'),'utf8'),'damaged');
});

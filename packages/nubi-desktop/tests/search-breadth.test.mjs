// Found in baseline case S1: a search for "package.json" returned 40 matches
// taken from the first few files in path order, so the file that held the
// answer, the fourteenth, never appeared. The agent settled on a wrong file.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';

async function project(t){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'docs'));await mkdir(path.join(root,'src'));
  await writeFile(path.join(root,'docs','a-changelog.md'),Array.from({length:60},(_,i)=>`release ${i}: updated NEEDLE handling`).join('\n')+'\n');
  await writeFile(path.join(root,'docs','b-guide.md'),Array.from({length:30},(_,i)=>`step ${i}: see NEEDLE`).join('\n')+'\n');
  for(let i=0;i<12;i++)await writeFile(path.join(root,'src',`module-${String(i).padStart(2,'0')}.mjs`),`// NEEDLE reference ${i}\nexport const value${i}=${i};\n`);
  await writeFile(path.join(root,'src','z-target.mjs'),'// Fallback returned when NEEDLE cannot be found\nexport const FALLBACK="0.0.0-unknown";\n');
  await git(root,['add','.']);await git(root,['commit','-qm','search fixture']);
  return service;
}

test('every matching file is listed and no file takes more than three excerpts',async t=>{
  const service=await project(t),found=await service.search({query:'NEEDLE'});
  const shown={};for(const row of found.results)shown[row.path]=(shown[row.path]||0)+1;
  assert.ok(Object.values(shown).every(count=>count<=3),JSON.stringify(shown));
  assert.ok(found.results.some(row=>row.path==='src/z-target.mjs'),'the last file in path order is reached');
  assert.ok(found.results.length<=40);
  assert.deepEqual(found.files.map(file=>file.path),['docs/a-changelog.md','docs/b-guide.md',...Array.from({length:12},(_,i)=>`src/module-${String(i).padStart(2,'0')}.mjs`),'src/z-target.mjs']);
  assert.deepEqual(found.files.find(file=>file.path==='docs/b-guide.md'),{path:'docs/b-guide.md',matches:30,shown:3});
  assert.deepEqual(found.files.find(file=>file.path==='src/z-target.mjs'),{path:'src/z-target.mjs',matches:1,shown:1});
  assert.equal(found.files.find(file=>file.path==='docs/a-changelog.md').matches,40,'a file is counted up to 40 matches');
  assert.equal(found.omittedExcerpts,40-3+30-3);
  assert.equal(found.truncated,true,'omitted excerpts are reported as incomplete results');
  assert.match(found.instruction,/files/);
});

test('a search that shows everything is complete and still lists its files',async t=>{
  // The search ignores case, so both lines of the file match.
  const service=await project(t),found=await service.search({query:'FALLBACK'});
  assert.deepEqual(found.results.map(row=>[row.path,row.line]),[['src/z-target.mjs',1],['src/z-target.mjs',2]]);
  assert.deepEqual(found.files,[{path:'src/z-target.mjs',matches:2,shown:2}]);
  assert.equal(found.omittedExcerpts,0);assert.equal(found.truncated,false);
  const none=await service.search({query:'ABSENT_TOKEN'});
  assert.deepEqual(none.results,[]);assert.deepEqual(none.files,[]);
});

test('excerpts keep their current hash and line, and scope still narrows the search',async t=>{
  const service=await project(t),found=await service.search({query:'NEEDLE',within:'src'});
  assert.ok(found.files.every(file=>file.path.startsWith('src/')));assert.equal(found.files.length,13);
  const row=found.results.find(item=>item.path==='src/z-target.mjs');
  assert.equal(row.line,1);assert.match(row.hash,/^sha256:/);assert.match(row.excerpt,/Fallback returned/);
});

// Found in B3 case D1: a search within one long file showed three of its
// matches and left out the line that held the answer.
test('a search within one file shows its matches up to the limit of the whole result',async t=>{
  const {service,root}=await fixture(t);
  await writeFile(path.join(root,'guide.md'),Array.from({length:120},(_,index)=>index%10===0?`model setting ${index}`:`other line ${index}`).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','guide']);
  const found=await service.search({query:'model setting',within:'guide.md'});
  assert.equal(found.results.length,12);assert.equal(found.omittedExcerpts,0);assert.equal(found.truncated,false);
  assert.deepEqual(found.files,[{path:'guide.md',matches:12,shown:12}]);
  assert.deepEqual(found.results.map(row=>row.line),[1,11,21,31,41,51,61,71,81,91,101,111]);
});

test('two files with many matches still show three excerpts each',async t=>{
  const {service,root}=await fixture(t);
  for(const name of ['a','b'])await writeFile(path.join(root,name+'.md'),Array.from({length:30},(_,index)=>`shared term ${name} ${index}`).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','two files']);
  const found=await service.search({query:'shared term'});
  assert.deepEqual(found.files,[{path:'a.md',matches:30,shown:3},{path:'b.md',matches:30,shown:3}]);
  assert.equal(found.omittedExcerpts,54);assert.equal(found.truncated,true);
  assert.match(found.instruction,/search within/);
});

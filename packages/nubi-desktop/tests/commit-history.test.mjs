import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from '../runtime/files.mjs';
import {inspectCommitHistory as inspect} from '../runtime/commit-history.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-history-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const run=args=>git(root,args);
  await run(['init','-b','main']);await run(['config','user.name','검증 작성자']);await run(['config','user.email','history@example.invalid']);
  await writeFile(path.join(root,'one.txt'),'first\n');await writeFile(path.join(root,'two.txt'),'second\n');
  await writeFile(path.join(root,'.env'),'fixture only\n');await writeFile(path.join(root,'binary.bin'),Buffer.from([0,1,0]));
  await run(['add','.']);await run(['commit','-m','첫 커밋']);
  return {root,run,service:{root,ready(){}}};
}
test('history pages have no duplicates and refuse a moved tip',async t=>{
  const {run,service}=await fixture(t);
  for(let i=1;i<53;i++)await run(['commit','--allow-empty','-m',`이력 ${i}`]);
  const first=await inspect(service);assert.equal(first.commits.length,25);assert.equal(first.hasMore,true);
  const second=await inspect(service,{offset:25,expectedTip:first.tip});assert.equal(second.commits.length,25);
  const last=await inspect(service,{offset:50,expectedTip:first.tip});assert.equal(last.commits.length,3);assert.equal(last.hasMore,false);
  assert.equal(new Set([...first.commits,...second.commits,...last.commits].map(row=>row.id)).size,53);
  await run(['commit','--allow-empty','-m','new']);
  await assert.rejects(inspect(service,{offset:25,expectedTip:first.tip}),/git_history_changed/);
  assert.notEqual((await inspect(service)).tip,first.tip);
  await assert.rejects(inspect(service,{offset:-1}),/input_invalid/);
  await assert.rejects(inspect(service,{branch:'--help'}),/input_invalid/);
});
test('repeated file reads reuse comparison but keep scope and ancestry checks',async t=>{
  const {root,run,service}=await fixture(t),commit=(await inspect(service)).tip;
  const trace=path.join(root,'trace.log'),old=process.env.GIT_TRACE;
  process.env.GIT_TRACE=trace;t.after(()=>{if(old===undefined)delete process.env.GIT_TRACE;else process.env.GIT_TRACE=old;});
  const files=await inspect(service,{commit,view:'files'});
  assert.equal(files.totalFiles,3);assert.equal(files.excludedCount,1);assert.equal(files.files.find(f=>f.path==='one.txt').added,1);
  for(const name of ['one.txt','two.txt','one.txt'])assert.equal((await inspect(service,{commit,path:name})).before,'');
  const log=await readFile(trace,'utf8');assert.equal(log.split('\n').filter(line=>line.includes('built-in: git')&&line.includes('diff-tree')).length,2,'one raw and one numstat calculation for the entire commit');
  assert.equal((await inspect(service,{commit,path:'binary.bin'})).unavailable,'binary_file');
  await assert.rejects(inspect(service,{commit,path:'.env'}),/path_scope/);
  await assert.rejects(inspect(service,{commit,path:'missing.txt'}),/path_scope/);
  await run(['checkout','--orphan','unrelated']);await run(['rm','-rf','.']);await run(['commit','--allow-empty','-m','unrelated']);
  await assert.rejects(inspect(service,{commit,path:'one.txt'}),'cache does not bypass branch ancestry');
  const other=await mkdtemp(path.join(os.tmpdir(),'nubi-history-other-'));t.after(()=>rm(other,{recursive:true,force:true}));service.root=other;
  assert.equal((await inspect(service)).commits.length,0,'another root cannot reuse the previous catalog');
});

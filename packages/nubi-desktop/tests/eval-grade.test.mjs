import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gradeCase,mentions} from '../eval/grade.mjs';

const exec=promisify(execFile);
async function workspace(t,files={'src/a.mjs':'export const value = 1;\n','src/legacy/keep.mjs':'export const legacy = 4500;\n'}){
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-grade-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [file,content] of Object.entries(files)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);}
  const git=args=>exec('git',args,{cwd:root});
  await git(['init','-q']);await git(['config','user.email','grade@example.invalid']);await git(['config','user.name','Grade']);await git(['config','commit.gpgsign','false']);await git(['add','-A']);await git(['commit','-qm','snapshot']);
  return root;
}
const leader=content=>({request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'},{role:'tool',tool_call_id:'c1',content}]}});
const testCase=expect=>({id:'T1-grade-case',expect:{state:'review',...expect}});
const finished=(root,extra={})=>({state:'review',answer:'',asked:false,compactions:0,transcript:[],root,reviewStatus:'ready',needsHuman:false,error:null,...extra});

test('text matching ignores case, spacing and Unicode form; regular expressions are opt-in',()=>{
  assert.ok(mentions('기본 포트는  53682 입니다','53682'));
  assert.ok(mentions('FabriX 제공자','fabrix'));
  assert.ok(mentions('npm   install -g\nopenwiki','npm install -g openwiki'));
  assert.ok(mentions('한글','한글'),'decomposed Hangul matches composed');
  assert.ok(mentions('제공자는 모두 17개입니다','re:(?<![\\d.\\-])17(?![\\d.\\-])'));
  assert.ok(!mentions('2026-09-17에 생성','re:(?<![\\d.\\-])17(?![\\d.\\-])'));
  assert.ok(!mentions('a.b','a+b'),'a literal is never treated as a pattern');
});

test('answer checks need one alternative per group and no forbidden text',async t=>{
  const root=await workspace(t),expect={answer_includes:[['4,500','4500'],['제주']],answer_excludes:['6,000']};
  assert.equal((await gradeCase(testCase(expect),finished(root,{answer:'제주 추가 요금은 4500원입니다.'}))).outcome,'passed');
  const missing=await gradeCase(testCase(expect),finished(root,{answer:'추가 요금은 4,500원입니다.'}));
  assert.equal(missing.outcome,'failed');assert.deepEqual(missing.checks.filter(item=>!item.passed).map(item=>[item.name,item.group]),[['answer_includes',2]]);
  assert.equal((await gradeCase(testCase(expect),finished(root,{answer:'제주 추가 요금은 4,500원 또는 6,000원입니다.'}))).outcome,'failed');
});

test('retrieval counts what the main agent read; citation accepts a file name',async t=>{
  const root=await workspace(t),expect={retrieved:{paths:['openwiki/a.md','src/b.mjs'],min:2},cited:{paths:['openwiki/concepts/shipping-policy.md']}};
  const transcript=[leader('{"provenance":{"path":"openwiki/a.md"}}'),{request:{messages:[{role:'system',content:'You are an isolated research analyst'},{role:'tool',tool_call_id:'c2',content:'{"path":"src/b.mjs"}'}]}}];
  const partial=await gradeCase(testCase(expect),finished(root,{transcript,answer:'근거: shipping-policy.md'}));
  assert.deepEqual(partial.checks.map(item=>[item.name,item.passed]),[['state',true],['retrieved',false],['cited',true]]);
  assert.deepEqual(partial.checks[1].found,['openwiki/a.md'],'a child analyst read does not count');
  const full=await gradeCase(testCase(expect),finished(root,{transcript:[...transcript,leader('{"path":"src/b.mjs"}')],answer:'근거 없음'}));
  assert.deepEqual(full.checks.map(item=>item.passed),[true,true,false]);
});

test('file, change scope and hidden test checks read the saved workspace',async t=>{
  const root=await workspace(t);
  await writeFile(path.join(root,'src','a.mjs'),'export const value = 2;\n');
  const expect={files:[{path:'src/a.mjs',includes:['value = 2'],excludes:['value = 1']},{path:'src/legacy/keep.mjs',includes:['4500']},{path:'src/removed.mjs',absent:true}],unchanged_except:['src/a.mjs'],
    test:{files:{'test/hidden.test.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/a.mjs';test('hidden',()=>assert.equal(value,2));\n"},command:['node','--test','test/hidden.test.mjs']}};
  const passed=await gradeCase(testCase(expect),finished(root));
  assert.equal(passed.outcome,'passed',JSON.stringify(passed.checks));
  assert.deepEqual(passed.checks.find(item=>item.name==='unchanged_except').changed,['src/a.mjs'],'the hidden test file is not counted as a change');
  await writeFile(path.join(root,'src','legacy','keep.mjs'),'export const legacy = 5000;\n');
  const failed=await gradeCase(testCase(expect),finished(root));
  assert.equal(failed.outcome,'failed');
  assert.deepEqual(failed.checks.filter(item=>!item.passed).map(item=>item.name),['files','unchanged_except']);
  assert.deepEqual(failed.checks.find(item=>item.name==='unchanged_except').outside,['src/legacy/keep.mjs']);
});

test('a failing hidden test fails the case',async t=>{
  const root=await workspace(t);
  const expect={test:{files:{'test/hidden.test.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/a.mjs';test('hidden',()=>assert.equal(value,2));\n"},command:['node','--test','test/hidden.test.mjs']}};
  const graded=await gradeCase(testCase(expect),finished(root));
  assert.equal(graded.outcome,'failed');assert.equal(graded.falseCompletion,true);
  assert.ok((await readdir(path.join(root,'test'))).includes('hidden.test.mjs'));
});

test('completion claims never pass a case and a failed completed task is a false completion',async t=>{
  const root=await workspace(t),expect={answer_includes:[['4,500']]};
  const claimed=await gradeCase(testCase(expect),finished(root,{answer:'모든 요구사항을 완료했고 검증도 통과했습니다.',reviewStatus:'ready'}));
  assert.equal(claimed.outcome,'failed');assert.equal(claimed.falseCompletion,true);
  const honest=await gradeCase(testCase(expect),finished(root,{answer:'확인하지 못했습니다.',reviewStatus:'revise'}));
  assert.equal(honest.falseCompletion,false);
});

test('question expectations, run errors, human needs and missing compaction have their own outcomes',async t=>{
  const root=await workspace(t);
  assert.equal((await gradeCase({id:'T1-grade-case',expect:{state:'waiting_input',asked:true}},finished(root,{state:'waiting_input',asked:true}))).outcome,'passed');
  assert.equal((await gradeCase(testCase({asked:false}),finished(root,{asked:true}))).outcome,'failed');
  assert.deepEqual(await gradeCase(testCase({}),finished(root,{error:'evaluation_case_timeout'})),{outcome:'error',passed:false,checks:[],error:'evaluation_case_timeout',falseCompletion:false});
  assert.equal((await gradeCase(testCase({}),finished(root,{needsHuman:true,state:'waiting_input'}))).outcome,'needs_human');
  assert.equal((await gradeCase(testCase({compacted:true}),finished(root,{compactions:0}))).outcome,'invalid');
  assert.equal((await gradeCase(testCase({compacted:true}),finished(root,{compactions:2}))).outcome,'passed');
});

test('manual cases and flagged answers wait for a reviewer instead of passing',async t=>{
  const root=await workspace(t);
  const manual=await gradeCase({...testCase({answer_includes:[['없습니다']]}),manual:true},finished(root,{answer:'문서에 없습니다.'}));
  assert.equal(manual.outcome,'needs_review');assert.equal(manual.passed,false);
  const flagged=await gradeCase(testCase({answer_includes:[['없습니다']],answer_flags:['HTTPS_PROXY']}),finished(root,{answer:'문서에 없습니다. HTTPS_PROXY 같은 변수도 안내하지 않습니다.'}));
  assert.equal(flagged.outcome,'needs_review');assert.deepEqual(flagged.flagged,['HTTPS_PROXY']);
  const failedFirst=await gradeCase({...testCase({answer_includes:[['없습니다']]}),manual:true},finished(root,{answer:'HTTPS_PROXY를 설정하세요.'}));
  assert.equal(failedFirst.outcome,'failed','a failed check is not hidden behind review');
});

test('only started commands count, and the last matching command carries the result',async t=>{
  const root=await workspace(t),expect={commands:{match:['re:npm (?:run )?test'],min:2,lastExitCode:0}};
  const commands=[{script:'npm test',execution:'started',state:'failed',exitCode:1},{script:'npm test',execution:'not_started',state:'failed',exitCode:null},
    {script:'git status',execution:'started',state:'completed',exitCode:0},{script:'npm run test',execution:'started',state:'completed',exitCode:0}];
  const passed=await gradeCase(testCase(expect),finished(root,{commands}));
  assert.equal(passed.outcome,'passed',JSON.stringify(passed.checks));
  assert.deepEqual(passed.checks.find(item=>item.name==='commands').ran.map(item=>item.exitCode),[1,0]);
  const unverified=await gradeCase(testCase(expect),finished(root,{commands:commands.slice(0,3)}));
  assert.deepEqual(unverified.checks.filter(item=>!item.passed).map(item=>item.name),['commands','command_result']);
  const failedLast=await gradeCase(testCase(expect),finished(root,{commands:[...commands,{script:'npm test',execution:'started',state:'failed',exitCode:1}]}));
  assert.deepEqual(failedLast.checks.filter(item=>!item.passed).map(item=>[item.name,item.actual]),[['command_result',1]]);
});

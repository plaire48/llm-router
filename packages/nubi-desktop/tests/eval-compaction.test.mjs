import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadScenarios,validateScenario,runScenario,evaluateCompaction,summarize,render,PROBE_KINDS,REPORT_KIND} from '../eval/compaction.mjs';

const usable={goal:'회의 결정을 코드에 반영할 준비',constraints:['src/legacy 폴더는 수정하지 않는다','금액은 정수 원'],decisions:['제주와 도서 지역 추가 요금은 5,500원','정산용 값은 11월까지 유지','시행일은 10월 첫째 주 월요일'],completed:['배송 정책 확인'],pending:['고칠 곳과 고치면 안 되는 곳 구분'],references:['src/shipping.mjs','src/legacy/export.mjs']};
// A model that summarizes with fixed text and answers a probe by reading the context it was given.
function scripted({summary=usable}={}){
  const seen={summaries:0,probes:[]};
  return {seen,status:()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    if(String(messages[0].content).startsWith('Summarize conversation')){seen.summaries++;return {content:JSON.stringify(summary),calls:[]};}
    const question=String(messages.at(-1).content),context=JSON.stringify(messages.slice(0,-1).filter(message=>message.role!=='system'));
    seen.probes.push(question);
    // Answers with what the context holds, so a probe passes only when the fact survived.
    const facts=['src/legacy','정수','5,500','11월','10월 첫째 주','src/shipping.mjs','src/legacy/export.mjs','반품','고치지는 말고'];
    return {content:'확인한 내용: '+facts.filter(fact=>context.includes(fact)).join(', '),calls:[]};
  }};
}

test('the scenarios are valid, name known corpora and cover every probe kind',async()=>{
  const scenarios=await loadScenarios();
  assert.deepEqual(scenarios.map(item=>item.id),['P1-notes-across-turns','P2-many-long-reads']);
  for(const scenario of scenarios){assert.deepEqual(validateScenario(scenario),[]);assert.ok(scenario.turns.every(turn=>typeof turn.user==='string'));}
  assert.deepEqual([...new Set(scenarios.flatMap(item=>item.probes.map(probe=>probe.kind)))].sort(),[...PROBE_KINDS].sort());
  assert.match(scenarios[0].turns[1].user,/제주와 도서 지역 추가 요금은 5,500원으로 올린다/,'the notes are part of the user message');
  assert.deepEqual(validateScenario({...scenarios[0],contextLength:100}),['contextLength']);
  assert.deepEqual(validateScenario({...scenarios[0],probes:[{kind:'other',question:'q',expect:[['a']]}]}),['probes[0].kind']);
});

test('a scenario fitting the advertised lean tools is probed without unnecessary compaction',async t=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-compaction-test-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  const [scenario]=await loadScenarios(),providers=scripted(),result=await runScenario({scenario,providers,parent});
  assert.equal(result.error,null);assert.deepEqual(result.stepFailures,[],'every replayed step succeeded');
  assert.equal(result.compacted,false,'unused tool schemas must not trigger history compaction');assert.equal(result.compactions.length,0);assert.equal(providers.seen.summaries,0);assert.equal(result.summaries.length,0);
  assert.equal(result.probes.length,scenario.probes.length);assert.equal(providers.seen.probes.length,scenario.probes.length);
  assert.ok(providers.seen.probes.every(question=>question.startsWith('[평가 질문]')));
  assert.equal(result.kept.length,4);
  assert.ok(result.probes.find(probe=>probe.question.includes('추가 요금은 얼마')).passed,'a fact that the summary holds is found');
  assert.equal((await readdir(parent)).length,0,'the workspace is removed');
});

test('the second scenario reads long pages of the public corpus without a failed step',async t=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-compaction-test-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  const scenario=(await loadScenarios())[1],result=await runScenario({scenario,providers:scripted(),parent});
  assert.equal(result.error,null);assert.deepEqual(result.stepFailures,[]);
  assert.equal(result.probes.length,scenario.probes.length);
});

test('a report counts probes by kind, kept text and compactions that freed nothing',async t=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-compaction-test-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  const outputDir=path.join(parent,'out'),[scenario]=await loadScenarios();
  const report=await evaluateCompaction({providers:scripted(),scenarios:[scenario],outputDir,parent,candidate:{hash:'c'.repeat(64),files:1}});
  assert.equal(report.kind,REPORT_KIND);assert.equal(report.summary.scenarios,1);assert.equal(report.summary.probes,scenario.probes.length);
  assert.equal(Object.values(report.summary.byKind).reduce((sum,item)=>sum+item.total,0),scenario.probes.length);
  assert.equal(report.summary.kept,4);
  const counted=summarize([{probes:[],kept:[],summaries:[],error:null,compacted:true,compactions:[{beforeTokens:100,afterTokens:120},{beforeTokens:100,afterTokens:60}]}]);
  assert.equal(counted.compactions,2);assert.equal(counted.grew,1);
  const text=await readFile(path.join(outputDir,'report.md'),'utf8');
  assert.match(text,/# 압축 품질 평가/);assert.match(text,/\| 질문 통과 \|/);assert.match(text,/우열을 입증하지 않습니다/);assert.ok(!text.includes('·'));
  assert.equal(render(report),text);
});

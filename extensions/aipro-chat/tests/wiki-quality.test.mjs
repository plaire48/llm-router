import test from 'node:test';
import assert from 'node:assert/strict';
import {wikiQualityDataset} from './fixtures/wiki-quality-corpus.mjs';
import {evaluateWikiRetrieval, gradeWikiAnswer, gradeWikiAnswers, textHash} from '../scripts/wiki-quality-evaluation.mjs';
import {runWikiQualityCases} from '../scripts/wiki-model-evaluation.mjs';

const dataset = wikiQualityDataset();
function oracle(task) {
  const evidence = task.expected.map((fact, index) => {
    const doc = task.snapshot.documents.find(doc => doc.id === fact.documentId);
    return {id:`ev_${index}`, documentId:doc.id, kind:doc.kind, path:doc.path, version:doc.version, hash:textHash(doc.text), unit:'utf16', start:fact.start, end:fact.end, excerpt:fact.quote};
  });
  return {wiki:task.wiki, wikiId:task.snapshot.wikiId, status:evidence.length ? 'complete' : 'blocked',
    answer:task.expected.map(fact => fact.answers[0]).join(' ') || '자료에 근거가 없습니다.',
    findings:evidence.map(row => ({text:row.excerpt, citations:[row.id]})), evidence, uncertainties:evidence.length ? [] : ['관련 근거 없음']};
}
test('authored Wiki reference ranges are unique and production retrieval covers the fixed question set', () => {
  const report = evaluateWikiRetrieval(dataset);
  assert.equal(report.passed, true, JSON.stringify(report.cases.filter(row => row.passed === false)));
  assert.equal(report.assessed, 15);
  assert.equal(report.actualModel, false);
  assert.equal(report.modelCapabilityScore, null);
  assert.ok(dataset.cases.find(row => row.id === 'long-middle-tail').snapshot.documents.find(doc => doc.id === 'long').text.length > 60000);
});
test('every authored positive answer and explicit no-answer passes its separate structural grader', () => {
  for (const task of dataset.cases) assert.equal(gradeWikiAnswer(task, oracle(task)).passed, true, task.id);
});
test('matching answer tokens cannot bypass wrong Wiki, stale source or fabricated citations', () => {
  const task = dataset.cases[0];
  for (const mutate of [
    r => {r.wikiId='external:folder:quality';},
    r => {r.evidence[0].hash='0'.repeat(64);},
    r => {r.evidence[0].version='old';},
    r => {r.evidence[0].start++;},
    r => {r.evidence[0].excerpt='fabricated';},
    r => {r.findings[0].citations=['invented'];},
    r => {r.evidence.push({...r.evidence[0]});},
    r => {r.evidence=[null];r.findings=[null];},
  ]) {const result=oracle(task);mutate(result);assert.equal(gradeWikiAnswer(task,result).passed,false);}
});
test('missing exception, table units and long-document tail remain measurable omissions', () => {
  for (const id of ['cross-doc','table-unit','long-middle-tail','distant-table-header']) {
    const task=dataset.cases.find(row => row.id===id), result=oracle(task);
    result.findings.pop();
    const grade=gradeWikiAnswer(task,result);
    assert.equal(grade.passed,false);assert.equal(grade.referenceCoverage,0.5);
  }
});
test('unsupported complete answers fail and structural success is never semantic faithfulness', () => {
  const task=dataset.cases.find(row => row.id==='unknown'), result=oracle(task);
  result.status='complete';result.answer='보험 한도는 100만원입니다.';
  assert.ok(gradeWikiAnswer(task,result).problems.includes('missing_abstention'));
  assert.equal(gradeWikiAnswer(dataset.cases[0],oracle(dataset.cases[0])).semanticFaithfulness,null);
});
test('artifact grading rejects missing, duplicated and wrong-dataset records without a live-model claim', () => {
  const capture={datasetSha256:textHash(JSON.stringify(dataset)),cases:dataset.cases.map(task=>({id:task.id,result:oracle(task)}))};
  const report=gradeWikiAnswers(dataset,capture);
  assert.equal(report.passed,true);assert.equal(report.actualModel,false);assert.equal(report.agentRunVerified,false);
  assert.equal(gradeWikiAnswers(dataset,{...capture,cases:capture.cases.slice(1)}).passed,false);
  assert.equal(gradeWikiAnswers(dataset,{...capture,cases:[...capture.cases,capture.cases[0]]}).passed,false);
  assert.throws(()=>gradeWikiAnswers(dataset,{...capture,datasetSha256:'old'}),/dataset_mismatch/);
});

test('condition comparison keeps gold references out of model prompts and records every trial', async()=>{
  const task={id:'empty',wiki:'internal',question:'자료가 있나요?',retrievalExpectation:'empty',expected:[],snapshot:{wikiId:'internal:empty',documents:[],sourceComplete:true}};
  const seen=[];
  const result=await runWikiQualityCases({version:'test',cases:[task]},{modelId:'chosen-model',repeats:2,complete:async(messages,tools,scope)=>{
    seen.push({messages,tools,scope});
    assert.equal(scope.modelId,'chosen-model');
    assert.equal(JSON.parse(messages.at(-1).content).expected,undefined);
    return {content:JSON.stringify({status:'blocked',answer:'자료가 없습니다.',findings:[],uncertainties:['근거 없음']})};
  }});
  assert.equal(result.cases.length,4);
  assert.deepEqual(result.cases.map(row=>row.condition),['retrieval-control','delegated','delegated','retrieval-control']);
  assert.ok(result.cases.every(row=>row.grade.passed));assert.equal(seen.length,2);
  assert.equal(result.actualModel,false);assert.equal(result.actualBrowser,false);
});

test('condition comparison preserves a failed case then stops on expired authentication',async()=>{
  const records=[];
  await assert.rejects(runWikiQualityCases({version:'test',cases:[dataset.cases[0]]},{modelId:'chosen',repeats:3,complete:async()=>{throw Object.assign(new Error('expired'),{status:401});},onCase:row=>records.push(row)}),error=>error.status===401);
  assert.equal(records.length,1);assert.equal(records[0].grade.passed,false);
});

test('comparison stops when authentication fails inside delegated research rather than the control',async()=>{
  const records=[];let calls=0;
  await assert.rejects(runWikiQualityCases({version:'test',cases:[dataset.cases[0]]},{modelId:'chosen',repeats:3,onCase:row=>records.push(row),complete:async messages=>{
    calls++;
    if(messages[0].content.startsWith('Answer in Korean'))return {content:JSON.stringify({status:'blocked',answer:'No evidence',findings:[],uncertainties:['Missing evidence']})};
    if(messages.some(m=>m.role==='system' && m.content.includes('Plan OpenWiki research')))return {content:JSON.stringify({mode:'focused',questions:['Find policy']})};
    throw Object.assign(new Error('unauthorized'),{status:401});
  }}),error=>error.status===401);
  assert.equal(records.length,2);assert.equal(records[1].condition,'delegated');assert.equal(records[1].grade.passed,false);assert.equal(calls,3);
});
test('comparison stops on canonical stream authentication errors without inventing HTTP status',async()=>{
  const records=[];
  await assert.rejects(runWikiQualityCases({version:'test',cases:[dataset.cases[0]]},{modelId:'chosen',repeats:3,onCase:row=>records.push(row),complete:async()=>{throw new Error('forbidden');}}),error=>error.message==='forbidden' && error.status===undefined);
  assert.equal(records.length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {browserTasks30, selectBrowserTasks} from '../evaluation/browser-30.mjs';
import {browserScore, hasResponsesOutput, parsedReviewEvidence, taskDelivery} from '../evaluation/browser-score.mjs';
import {browserEvaluationPlan} from '../scripts/browser-evaluation-plan.mjs';
import {fixtureHtml, startBrowserFixtures, trainingText} from '../evaluation/browser-fixtures.mjs';
const delivered=()=>({answer:'검증한 결과',plan:[{text:'결과 확인',status:'completed'}],taskReview:'complete',
  delivery:{taskStatus:'done',busy:false,answerVisible:true,planTotal:1,planCompleted:1,runningPlanIndicators:0}});

test('delivery identity distinguishes an old unsupported UI from an observed wrong request',()=>{
  const trial={status:'answered',...delivered()};
  trial.delivery={...trial.delivery,identityVersion:1,requestMatches:null,conversationMatches:true,documentVisible:true};
  assert.equal(taskDelivery(trial),null);
  trial.delivery.requestMatches=false;assert.equal(taskDelivery(trial),false);
  trial.delivery.requestMatches=true;assert.equal(taskDelivery(trial),true);
  trial.delivery.conversationMatches=false;assert.equal(taskDelivery(trial),false);
});

test('the tiered suite covers 30 distinct goals and does not silently select unknown tasks', () => {
  assert.equal(browserTasks30.length, 30);
  assert.equal(new Set(browserTasks30.map(task => task.id)).size, 30);
  for (const difficulty of ['easy', 'medium', 'hard']) assert.equal(selectBrowserTasks({difficulty}).length, 10);
  assert.equal(selectBrowserTasks({environment: 'public-live'}).length, 20);
  assert.deepEqual(selectBrowserTasks({ids: 'E-01,H-10'}).map(task => task.id), ['E-01', 'H-10']);
  for (const ids of ['X', 'E-01,E-01', '']) assert.throws(() => selectBrowserTasks({ids}), /invalid_task_ids/);
  assert.throws(() => selectBrowserTasks({difficulty: 'simple'}));
  assert.throws(() => selectBrowserTasks({ids: 'E-01', difficulty: 'hard'}));
  for (const task of browserTasks30) {
    assert.ok(task.checks.length >= 2);
    assert.ok(task.goal && task.capabilities.length >= 2);
    if (task.environment === 'local-fixture') assert.ok(fixtureHtml(task.id), task.id);
    else assert.equal(task.readOnly, true);
  }
  const plan = browserEvaluationPlan();
  assert.equal(plan.accuracy, null);
  assert.ok(plan.tasks.every(task => task.status === 'not_run'));
});

test('HTTP success, missing grades, duplicate trials and unsupported conclusions cannot yield a score', () => {
  const tasks = browserTasks30.slice(0, 2);
  const trials = tasks.map(task => ({id: task.id, actualModel: true, modelValidResponses: 1, status: 'answered',...delivered()}));
  const grades = tasks.map(task => ({id: task.id, checks: task.checks.map(check => ({check, passed: true, evidence: ['independent page observation']}))}));
  assert.equal(browserScore(tasks, trials, grades).total.successRate, 1);
  assert.equal(browserScore(tasks, trials, []).total.successRate, null);
  assert.equal(browserScore(tasks, trials.map(trial => ({...trial, modelValidResponses: 0})), grades).total.successRate, null);
  assert.equal(browserScore(tasks, trials, grades.map(grade => ({...grade, checks: grade.checks.map(check => ({...check, evidence: []}))}))).total.successRate, null);
  assert.throws(() => browserScore(tasks, [...trials, trials[0]], grades));
  assert.throws(() => browserScore(tasks, trials, [...grades, grades[0]]));
  assert.throws(() => browserScore(tasks, [...trials, {id: 'unknown'}], grades));
  const failed = browserScore(tasks, [{...trials[0], status: 'timeout'}, trials[1]], grades);
  assert.equal(failed.total.successRate, .5);
  assert.equal(browserScore(tasks, [trials[0]], grades).total.successRate, null);
});

test('Responses evidence requires completed model output, not an HTTP or partial-stream marker', () => {
  const data = event => `data: ${JSON.stringify(event)}\n\n`;
  assert.equal(hasResponsesOutput('data: [DONE]\n'), false);
  assert.equal(hasResponsesOutput(data({type: 'response.failed'})), false);
  assert.equal(hasResponsesOutput(data({type: 'response.output_text.delta', delta: 'hi'})), false);
  assert.equal(hasResponsesOutput(data({type: 'response.completed', response: {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: 'hi'}]}]}})), true);
  assert.equal(hasResponsesOutput(data({type: 'response.completed', response: {status: 'completed', output: [{type: 'function_call', name: 'read_page', arguments: '{}'}]}})), true);
  assert.equal(hasResponsesOutput(data({type: 'response.done', response: {status: 'completed', output: [{type: 'function_call', name: 'read_page', arguments: '{}'}]}})), true);
  assert.equal(hasResponsesOutput(data({type: 'response.incomplete', response: {status: 'incomplete', output: [{type: 'message', content: [{type: 'output_text', text: 'partial'}]}]}})), false);
});

test('parsed review receipt is scoped to the trial/model and never proves task correctness', () => {
  const trial = {agentModelId: 'luna', modelRequests: 3, modelHttp200: 3, startedAt: new Date(1000).toISOString(), finishedAt: new Date(2000).toISOString(),
    diagnostics: [{kind: 'review', at: 1500, scope: 'final', status: 'revise', checks: [{requirement: 'read source', status: 'unknown', evidence_ids: []}]}]};
  assert.equal(parsedReviewEvidence(trial, 'luna').verifiedResponsesLowerBound, 1);
  assert.equal(parsedReviewEvidence(trial, 'luna').correctnessEstablished, false);
  assert.equal(parsedReviewEvidence({...trial, diagnostics: []}, 'luna').verified, false);
  assert.equal(parsedReviewEvidence({...trial, modelHttp200: 0}, 'luna').verified, false);
  assert.equal(parsedReviewEvidence(trial, 'different-model').verified, false);
  assert.equal(parsedReviewEvidence({...trial, startedAt: new Date(1700).toISOString()}, 'luna').verified, false);
  assert.equal(parsedReviewEvidence({...trial, finishedAt: undefined}, 'luna').verified, false);
  assert.equal(parsedReviewEvidence({...trial, diagnostics: [trial.diagnostics[0], trial.diagnostics[0]]}, 'luna').verifiedResponsesLowerBound, 1);
  const task = browserTasks30[0];
  assert.equal(browserScore([task], [{id: task.id, status: 'timeout', actualModel: true, modelValidResponses: 1}], []).total.successRate, 0);
  assert.equal(browserScore([task], [{id: task.id, status: 'answered', actualModel: true, modelValidResponses: 1}], []).total.successRate, null);
});

test('local fixture server isolates cases, rejects writes, and serves the exact downloadable sample', async () => {
  const fixtures = await startBrowserFixtures();
  try {
    for (const task of selectBrowserTasks({environment: 'local-fixture'})) {
      const response = await fetch(fixtures.origin + task.startUrl);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /누비 브라우저 평가/);
    }
    const file = await fetch(fixtures.origin + '/training.txt');
    assert.match(file.headers.get('content-disposition'), /training.txt/);
    assert.equal(await file.text(), trainingText);
    assert.equal((await fetch(fixtures.origin + '/E-09', {method: 'POST'})).status, 405);
    assert.equal((await fetch(fixtures.origin + '/missing')).status, 404);
  } finally {await fixtures.close();}
});


test('80 percent goal separates task execution, grading coverage and independently confirmed success', () => {
  const tasks = browserTasks30.slice(0, 5);
  const trials = tasks.slice(0, 4).map(task => ({id: task.id, actualModel: true, modelValidResponses: 1, status: 'answered',...delivered()}));
  const grades = tasks.slice(0, 4).map(task => ({id: task.id, checks: task.checks.map(check => ({check, passed: true, evidence: ['Independent fixture readback']}))}));
  const partial = browserScore(tasks, trials, grades).total;
  assert.equal(partial.executionCompletionRate, .8);
  assert.equal(partial.gradingCompletionRate, .8);
  assert.equal(partial.confirmedPassRateLowerBound, .8);
  assert.equal(partial.successRate, null);
  assert.equal(partial.target.achieved, false);
  const complete = browserScore(tasks, [...trials, {id: tasks[4].id, actualModel: true, modelValidResponses: 1, status: 'timeout'}], grades).total;
  assert.equal(complete.successRate, .8);
  assert.equal(complete.target.achieved, true);
  assert.equal(complete.target.requiredPasses, 4);
});

test('end-to-end scoring requires persisted plan completion and rendered final delivery, beyond correct output',()=>{
  const task=browserTasks30[0],trial={id:task.id,status:'answered',actualModel:true,modelValidResponses:1,...delivered()};
  const grade={id:task.id,checks:task.checks.map(check=>({check,passed:true,evidence:['Independent source']}))};
  assert.equal(taskDelivery(trial),true);
  const emptyPlan={...trial,plan:[],delivery:{...trial.delivery,planTotal:0,planCompleted:0}};
  assert.equal(browserScore([task],[emptyPlan],[grade]).total.successRate,0, 'an empty 0/0 plan does not establish task completion');
  for(const change of [t=>t.plan[0].status='pending',t=>t.delivery.planCompleted=0,t=>t.delivery.answerVisible=false,t=>t.delivery.runningPlanIndicators=1,t=>t.delivery.busy=true,t=>t.delivery.taskStatus='paused']){
    const broken=structuredClone(trial);change(broken);assert.equal(browserScore([task],[broken],[grade]).total.successRate,0);
    assert.equal(browserScore([task],[broken],[]).total.successRate,0, 'known delivery failure does not wait for factual grading');
  }
  const legacy={...trial};delete legacy.delivery;
  assert.equal(browserScore([task],[legacy],[grade]).total.successRate,null);
});

test('one independently disproven criterion establishes failure without inventing grades for other criteria', () => {
  const task={id:'case',difficulty:'easy',environment:'public-live',checks:['Filter applied','Three articles delivered']};
  const trial={id:'case',status:'awaiting_user',actualModel:true,modelValidResponses:1};
  const grade={id:'case',checks:[{check:task.checks[0],passed:null,evidence:[]},{check:task.checks[1],passed:false,evidence:['Recorded final state has no answer and asks for technical recovery.']}]};
  assert.equal(browserScore([task],[trial],[grade]).total.failed,1);
  assert.equal(browserScore([task],[trial],[{...grade,checks:grade.checks.map(c=>({...c,passed:null}))}]).total.graded,0);
  assert.equal(browserScore([task],[{...trial,actualModel:false}],[grade]).total.graded,0);
});


test('partial rubric progress cannot pass an unfinished task and retains ungraded evidence gaps',()=>{
  const task=browserTasks30[0],trial={id:task.id,status:'awaiting_user',actualModel:true,modelValidResponses:1,...delivered()};
  const grade={id:task.id,checks:task.checks.map(check=>({check,passed:true,evidence:['Independent source record']}))};
  let score=browserScore([task],[trial],[grade]);
  assert.equal(score.total.rubric.successRate,1);assert.equal(score.total.successRate,0);assert.equal(score.total.target.achieved,false);
  grade.checks[1]={...grade.checks[1],evidence:[]};grade.checks[2].passed=false;
  score=browserScore([task],[trial],[grade]);assert.deepEqual([score.total.rubric.passed,score.total.rubric.failed,score.total.rubric.unknown],[1,1,1]);assert.equal(score.total.rubric.successRate,null);
  assert.equal(browserScore([task],[{...trial,modelValidResponses:0}],[grade]).total.rubric.unknown,3);
  const reversed={...grade,checks:[...grade.checks].reverse()};assert.equal(browserScore([task],[trial],[reversed]).total.rubric.unknown,3);
});

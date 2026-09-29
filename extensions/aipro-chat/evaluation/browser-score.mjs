// Outcomes are graded independently. HTTP success and self-review cannot pass a task.
export function taskDelivery(trial) {
  if (!trial || trial.status !== 'answered') return false;
  if (Array.isArray(trial.plan) && trial.plan.some(step => step.status !== 'completed')) return false;
  if (!trial.delivery || !Array.isArray(trial.plan)) return null;
  if (!trial.plan.length) return false;
  // A frozen older UI has no message identity attribute. A new evaluator must
  // report that missing contract, not turn an unmeasured identity into failure.
  if (trial.delivery.identityVersion===1 && trial.delivery.requestMatches===null) return null;
  if (trial.delivery.identityVersion===1 && (!trial.delivery.requestMatches || !trial.delivery.conversationMatches || !trial.delivery.documentVisible)) return false;
  return trial.delivery.taskStatus === 'done' && trial.taskReview === 'complete' &&
    trial.delivery.busy === false && trial.delivery.answerVisible === true &&
    trial.delivery.planCompleted === trial.plan.length && trial.delivery.planTotal === trial.plan.length &&
    trial.delivery.runningPlanIndicators === 0 && typeof trial.answer === 'string' && !!trial.answer.trim();
}
export function browserScore(tasks, trials, grades, {targetRate = .8} = {}) {
  if (!Number.isFinite(targetRate) || targetRate <= 0 || targetRate > 1) throw new Error('invalid_target_rate');
  const ids = new Set(tasks.map(task => task.id));
  if (ids.size !== tasks.length || trials.some(t => !ids.has(t.id)) || grades.some(g => !ids.has(g.id)) || new Set(trials.map(t => t.id)).size !== trials.length || new Set(grades.map(g => g.id)).size !== grades.length) throw new Error('invalid_evaluation_membership');
  const cases = tasks.map(task => {
    const trial = trials.find(t => t.id === task.id), grade = grades.find(g => g.id === task.id);
    const real = trial?.actualModel === true && trial.modelValidResponses > 0;
    const completeGrade = grade?.checks?.length === task.checks.length && task.checks.every((check, index) => grade.checks[index]?.check === check && typeof grade.checks[index]?.passed === 'boolean' && grade.checks[index]?.evidence?.some(value => typeof value === 'string' && value.trim()));
    const failedGrade = grade?.checks?.length === task.checks.length && task.checks.every((check,index)=>grade.checks[index]?.check===check) &&
      grade.checks.some(check=>check.passed===false && check.evidence?.some(value=>typeof value==='string' && value.trim()));
    // Partial rubric progress diagnoses missing capability; it never replaces
    // complete-task delivery. Unknown or ungrounded grades stay unknown.
    const aligned = grade?.checks?.length === task.checks.length && task.checks.every((check,index)=>grade.checks[index]?.check===check);
    const criteria = task.checks.map((check,index) => {
      const item = aligned && grade.checks[index];
      return {check, passed: real && typeof item?.passed === 'boolean' && item.evidence?.some(value=>typeof value==='string' && value.trim()) ? item.passed : null};
    });
    const delivered = taskDelivery(trial);
    // A visible answer with an unfinished plan is already a demonstrated
    // failure. Missing factual grades cannot hide a broken completion gate.
    const scored = real && (failedGrade || trial?.status === 'answered' && delivered === false || completeGrade && delivered !== null || ['timeout', 'agent_error'].includes(trial?.status));
    const passed = scored ? trial.status === 'answered' && delivered === true && grade.checks.every(check => check.passed) : null;
    return {id: task.id, difficulty: task.difficulty, environment: task.environment, status: trial?.status || 'not_run', delivered, passed, criteria, elapsedMs: trial?.elapsedMs ?? null};
  });
  const summarize = selected => {
    const graded = selected.filter(c => c.passed !== null).length, passed = selected.filter(c => c.passed === true).length;
    const completed = selected.filter(c => ['answered', 'timeout', 'agent_error', 'awaiting_user'].includes(c.status)).length;
    const criteria = selected.flatMap(c=>c.criteria), criterionPassed = criteria.filter(c=>c.passed===true).length,
      criterionFailed = criteria.filter(c=>c.passed===false).length, criterionUnknown = criteria.length-criterionPassed-criterionFailed;
    return {rubric: {planned:criteria.length, passed:criterionPassed, failed:criterionFailed, unknown:criterionUnknown,
      confirmedPassRateLowerBound:criteria.length ? criterionPassed/criteria.length : null,
      successRate:criteria.length && !criterionUnknown ? criterionPassed/criteria.length : null,
      taskCompletionEstablished:false}, planned: selected.length, completed, executionCompletionRate: selected.length ? completed / selected.length : null,
      gradingCompletionRate: selected.length ? graded / selected.length : null,
      confirmedPassRateLowerBound: selected.length ? passed / selected.length : null,
      target: {rate: targetRate, requiredPasses: Math.ceil(selected.length * targetRate), confirmedPasses: passed, achieved: selected.length > 0 && graded === selected.length && passed / selected.length >= targetRate},
      graded, passed, failed: graded - passed, ungraded: selected.length - graded, successRate: selected.length && graded === selected.length ? passed / selected.length : null};
  };
  return {cases, total: summarize(cases), byDifficulty: Object.fromEntries(['easy', 'medium', 'hard'].map(level => [level, summarize(cases.filter(c => c.difficulty === level))])),
    byEnvironment: Object.fromEntries(['public-live', 'local-fixture'].map(environment => [environment, summarize(cases.filter(c => c.environment === environment))])),
    officialBenchmarkScore: null, note: 'Single-trial capability pilot. Local fixtures and public-site results are reported separately.'};
}

export function hasResponsesOutput(body) {
  if (typeof body !== 'string' || body.length > 8 * 1024 * 1024) return false;
  return body.split(/\r?\n/).some(line => {
    if (!line.startsWith('data:')) return false;
    try {
      const event = JSON.parse(line.slice(5).trim());
      return ['response.completed', 'response.done'].includes(event.type) && event.response?.status === 'completed' && event.response.output?.some(item =>
        item.type === 'function_call' && typeof item.name === 'string' && typeof item.arguments === 'string' ||
        item.type === 'message' && item.content?.some(content => content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()));
    } catch {return false;}
  });
}

// The product aborts the transport after the SDK consumes its terminal SSE event.
// Chromium may report requestfailed rather than requestfinished, making a Node
// response-body observer unavailable. A parsed goal-review diagnostic is a
// bounded proof of *a model response*, not of a correct answer or task success.
// src/api.js emits it only after invoke + parseGoalReview. Never use start/finish
// usage markers or an HTTP 200 alone as this proof. Preserve the original report.
export function parsedReviewEvidence(trial, expectedModel) {
  const from = Date.parse(trial.startedAt), to = Date.parse(trial.finishedAt);
  const transport = trial.agentModelId === expectedModel && Number.isSafeInteger(trial.modelRequests) && trial.modelRequests > 0 &&
    Number.isSafeInteger(trial.modelHttp200) && trial.modelHttp200 > 0 && trial.modelHttp200 <= trial.modelRequests;
  const events = Number.isFinite(from) && Number.isFinite(to) ? (trial.diagnostics || []).filter(event => event.kind === 'review' &&
    Number.isFinite(event.at) && event.at >= from && event.at <= to &&
    ['plan_step', 'checkpoint', 'final'].includes(event.scope) && ['complete', 'revise', 'blocked'].includes(event.status) &&
    Array.isArray(event.checks) && event.checks.length > 0 && event.checks.every(check => typeof check.requirement === 'string' &&
      ['met', 'unmet', 'unknown'].includes(check.status) && Array.isArray(check.evidence_ids))
  ) : [];
  const count = transport ? new Set(events.map(event => `${event.at}:${event.scope}`)).size : 0;
  return {source: 'parsed_goal_review_and_observed_provider_http', verifiedResponsesLowerBound: count,
    verified: count > 0, totalResponseCount: null, correctnessEstablished: false};
}

// Keep the same bounded, public plan/trace that the conversation displays.
// These records are presentation history, never execution or approval authority.
export function rememberActivity(task, runId) {
  if (!runId) return;
  const workPlan = task.workPlan?.runId === runId ? task.workPlan : null;
  const trace = (task.trace || []).filter(event => event.runId === runId || event.id?.startsWith(runId + ':')).slice(-80);
  if (!workPlan?.steps?.length && !trace.length) return;
  const history = task.activityHistory || [];
  const previous = history.find(run => run.runId === runId);
  const run = structuredClone({runId, state:task.state, trace,
    ...(workPlan ? {workPlan:{...workPlan, updates:(workPlan.updates || []).filter(update => !update.runId || update.runId === runId)}} : {}),
    ...(task.resultReview?.runId === runId ? {resultReview:task.resultReview} : {}),
    ...(task.responseTiming?.runId === runId ? {responseTiming:task.responseTiming} : {}),
    ...(task.question ? {question:{id:task.question.id, kind:task.question.kind}} : {}),
    // Interrupted runs can have no answer. Retain their place after the last
    // spoken message instead of moving them below a later request.
    afterMessageId:previous?.afterMessageId ?? task.messages?.at(-1)?.id ?? null});
  task.activityHistory = previous ? history.map(item => item.runId === runId ? run : item) : [...history, run];
}

// Locate progress by its host run, never by the latest assistant message alone.
// A question can end a run; a stopped run can end without an answer at all.
export function currentActivityRunId(task) {
  return (task?.state === 'waiting_input' && task.question?.runId) ||
    task?.responseTiming?.runId || task?.checkpoint?.runId || task?.workPlan?.runId;
}

export function conversationActivity(task) {
  const messages = task?.messages || [], before = new Map(), after = new Map(), root = [];
  const runId = currentActivityRunId(task);
  const question = task?.state === 'waiting_input' ? task.question : null;
  const sameRun = message => !message.runId || !runId || message.runId === runId;
  let questionMessage = question?.id && messages.findLast(message => message.role === 'assistant' &&
    message.questionId === question.id && sameRun(message));
  // Older messages may lack questionId. Text alone must never attach a new form
  // to an earlier question: accept only the latest message of this known run.
  const latest = messages.at(-1);
  if (question && !questionMessage && runId && latest?.role === 'assistant' && latest.runId === runId &&
      !latest.questionId && latest.content === (typeof question === 'string' ? question : question.text)) questionMessage = latest;
  const anchors = new Map();
  for (const message of messages) if (message.role === 'assistant' && message.runId && !anchors.has(message.runId)) anchors.set(message.runId, message);
  const add = (map, message, run) => map.set(message, [...(map.get(message) || []), run]);
  for (const run of task?.activityHistory || []) {
    if (run.runId === runId) continue;
    const questionAnchor = run.question?.id && messages.findLast(message => message.role === 'assistant' &&
      message.questionId === run.question.id && (!message.runId || message.runId === run.runId));
    const preceding = messages.find(message => message.id === run.afterMessageId);
    const anchor = questionAnchor || (!run.question?.id || !preceding ? anchors.get(run.runId) : null);
    if (anchor) add(before, anchor, run);
    else if (preceding) add(after, preceding, run);
    else root.push(run);
  }
  // Keep pending progress directly above its form. An unanchored question goes
  // to the transcript foot together with current progress, never into history.
  const anchor = question ? questionMessage || null : anchors.get(runId);
  return {runId, before, after, root, anchor, questionMessage};
}

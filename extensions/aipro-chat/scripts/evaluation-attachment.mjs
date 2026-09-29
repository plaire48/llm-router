export function validEvaluationAttachment({attachment, reuseProfile, candidateSha256, plannedTaskIds, publicReadPages, fixtureApprovals, suite30, selectedTasks, freshAfterInterruption, repeatRecorded}) {
  if (!reuseProfile || attachment.candidateSha256 !== candidateSha256 ||
      !(freshAfterInterruption ? publicReadPages.every(page => attachment.publicReadCapture?.allowedPages?.includes(page)) :
        JSON.stringify(attachment.publicReadCapture?.allowedPages) === JSON.stringify(publicReadPages)) ||
      !/^[a-f0-9]{64}$/.test(attachment.evaluatorSha256) || fixtureApprovals || !suite30 ||
      selectedTasks.some(task => task.environment !== 'public-live' || !task.readOnly)) return false;
  // A new measured trial, never continuation of the saved task. Only completed
  // evaluations of the identical public read-only suite may reuse the browser.
  if (repeatRecorded) return !freshAfterInterruption && attachment.status === 'trials_recorded' &&
    JSON.stringify(attachment.plannedTaskIds) === JSON.stringify(plannedTaskIds) &&
    attachment.trials?.length === plannedTaskIds.length &&
    attachment.trials.every((trial,index) => trial.id === plannedTaskIds[index] &&
      (trial.status === 'answered' || trial.status === 'timeout' && trial.stopConfirmed === true));
  if (freshAfterInterruption) return attachment.status === 'harness_interrupted' &&
    plannedTaskIds.length > 0 && plannedTaskIds.every(id => attachment.trials?.some(trial => trial.id === id && trial.status === 'harness_interrupted'));
  return attachment.status === 'login_not_completed' && attachment.trials?.length === 0 &&
    JSON.stringify(attachment.plannedTaskIds) === JSON.stringify(plannedTaskIds);
}

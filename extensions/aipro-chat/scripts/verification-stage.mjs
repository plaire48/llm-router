// A display label is not sufficient process evidence. Unknown/unfinished records
// remain unverified; contradictory termination evidence always defeats a pass.
export function stageOutcome(stage) {
  if (!stage || typeof stage !== 'object') return 'missing';
  if (stage.status === 'failed' || stage.timedOut === true || stage.signal != null ||
      Number.isInteger(stage.exitCode) && stage.exitCode !== 0) return 'failed';
  return stage.status === 'passed' && stage.exitCode === 0 && stage.timedOut === false ? 'passed' : 'missing';
}

// Durations are host observations, not model token counts or task success.
const sizeFields = ['textInputCharacters', 'imageInputCharacters', 'schemaCharacters'];
const inputSizeSummary = () => ({version: 1, unit: 'json_utf16_code_units', measuredInputs: 0, missingInputs: 0,
  textInputCharacters: null, imageInputCharacters: null, schemaCharacters: null});
function addInputSizes(summary, event) {
  // Never infer a text/image split for historical events or invalid totals.
  if (event.inputSizeVersion !== 1 || !Number.isSafeInteger(event.inputCharacters) || event.inputCharacters < 0 ||
      !sizeFields.every(key => Number.isSafeInteger(event[key]) && event[key] >= 0) ||
      sizeFields.reduce((total, key) => total + event[key], 0) !== event.inputCharacters) {
    summary.missingInputs++; return;
  }
  summary.measuredInputs++;
  for (const key of sizeFields) summary[key] = (summary[key] ?? 0) + event[key];
}
export function modelExecutionTiming(events = []) {
  const starts = new Map(), intervals = [], scopes = {};
  const inputSizes = inputSizeSummary();
  let unmatchedFinishes = 0, duplicateStarts = 0;
  for (const event of events.filter(e => e.kind === 'model' && Number.isFinite(e.at)).toSorted((a, b) => a.at - b.at)) {
    if (event.round == null) continue;
    if (event.phase === 'start') {
      if (starts.has(event.round)) {duplicateStarts++; continue;}
      starts.set(event.round, event);
    } else if (event.phase === 'finish') {
      const start = starts.get(event.round);
      if (!start) {unmatchedFinishes++; continue;}
      starts.delete(event.round);
      const duration = event.at - start.at;
      const scope = ['analysis', 'planning', 'review', 'compaction', 'execution'].includes(start.scope) ? start.scope : 'unknown';
      const group = scopes[scope] ||= {completed: 0, totalMs: 0, inputCharacters: 0, measuredInputs: 0, inputSizes: inputSizeSummary()};
      group.completed++;
      group.totalMs += duration;
      if (Number.isSafeInteger(start.inputCharacters) && start.inputCharacters >= 0) {
        group.inputCharacters += start.inputCharacters;
        group.measuredInputs++;
      }
      addInputSizes(group.inputSizes, start); addInputSizes(inputSizes, start);
      intervals.push([start.at, event.at]);
    }
  }
  let activeWallMs = 0, end = -Infinity;
  for (const [start, finish] of intervals.toSorted((a, b) => a[0] - b[0])) {
    activeWallMs += Math.max(0, finish - Math.max(start, end));
    end = Math.max(end, finish);
  }
  const durationsMs = intervals.map(([start, finish]) => finish - start);
  return {source: 'host_inference_start_finish', completed: intervals.length,
    totalMs: durationsMs.reduce((sum, n) => sum + n, 0), activeWallMs,
    durationsMs, pending: starts.size, unmatchedFinishes, duplicateStarts, scopes, inputSizes,
    coverage: starts.size || unmatchedFinishes || duplicateStarts ? 'partial' : 'paired_events_only'};
}

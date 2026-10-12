import {isAnalysisStep, normalizeTrace, normalizeTraceId} from './agent-trace.js';

// Historical display hints only. No live coordinator IDs, source contents,
// executable continuations or permissions cross an executor restart.
const LIMIT = 12;
function entry(value) {
  if (!normalizeTraceId(value?.traceId) || typeof value?.requestId !== 'string' || !value.requestId.trim() || value.requestId.length > 100) return null;
  const step = normalizeTrace([{id:value.traceId, tool:value.tool, status:value.status, analysis:value.analysis}])[0];
  if (!isAnalysisStep(step) || !step.analysis) return null;
  const {task, doneWhen, outcome, summary, uncertainties, uncertaintiesOmitted, nextStep} = step.analysis;
  return {requestId:value.requestId, traceId:step.id, tool:step.tool, status:step.status,
    analysis:{task, ...(doneWhen ? {doneWhen} : {}), ...(outcome ? {outcome} : {}),
      ...(summary ? {summary} : {}), ...(uncertainties ? {uncertainties} : {}),
      ...(uncertaintiesOmitted ? {uncertaintiesOmitted} : {}), ...(nextStep ? {nextStep} : {})}};
}
export function analysisCheckpoint(previous, trace = [], requestId = '') {
  const entries = new Map();
  for (const value of previous?.version === 1 && Array.isArray(previous.entries) ? previous.entries.slice(0,LIMIT) : []) {
    const safe = entry(value); if (safe) entries.set(`${safe.requestId}/${safe.traceId}`,safe);
  }
  for (const step of normalizeTrace(trace)) {
    const safe = entry({requestId,traceId:step.id,...step});
    if (safe) entries.set(`${safe.requestId}/${safe.traceId}`,safe);
  }
  const values = [...entries.values()];
  if (!values.length) return null;
  // Do not let successful reports displace unfinished or cancelled assignments.
  const priority = value => value.status === 'done' && value.analysis.outcome === 'complete' ? 1 : 0;
  values.sort((a,b)=>priority(a)-priority(b));
  const omitted = previous?.version === 1 && Number.isSafeInteger(previous.omittedAtLeast) && previous.omittedAtLeast >= 0 ? previous.omittedAtLeast : 0;
  return {version:1, coverage:'partial_trace_hints', omittedAtLeast:Math.min(1000000,Math.max(omitted,values.length-LIMIT)), entries:values.slice(0,LIMIT)};
}

import {isPageContentReference, reviewEvidence, replacesPageContent, pageViewKey} from './goal-review.js';

const observations = new Set(['read_page', 'browser_snapshot', 'inspect_dom', 'navigate_page', 'switch_tab', 'go_back', 'click_element', 'click_at', 'verify_page']);

// Observe each opened source once. This never navigates, grants permissions,
// claims full coverage, or retries a failed/uncertain browser action.
export function createResearchSourceCapture({enabled, preserveReadSources = false, tools, execute, signal, onStep, evidence, analyses, onSource}) {
  const seen = new Set(), attempts = new Map();
  let sequence = 0;
  // A view kept right after the click that turned it may still have been
  // loading. It is read once more when a later observation of the same view
  // is permitted, and replaced only if its content changed.
  const provisional = new Map();
  const supported = tools.some(tool => tool.function.name === 'read_page' && tool.function.parameters?.properties?.mode?.enum?.includes('content'));
  const sourceURL = value => {
    try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;} catch {return null;}
  };
  const identified = value => typeof value === 'string' && value.trim().length > 0;
  const sourceIdentity = (url, documentId, frame, view) => JSON.stringify([url, documentId, frame, pageViewKey(view)]);
  // A click that turns a counted list to another page ("2 / 3") leaves a view
  // that the next click replaces. Waiting for a passed verification lost every
  // page the agent clicked through, and a review then saw only the last one.
  const viewTools = new Set(['click_element', 'click_at', 'press_key']);
  return async (name, result, permitted, viewPermitted = false) => {
    if (name === 'read_page' && isPageContentReference(result)) {
      if (identified(result.source_document_id)) seen.add(sourceIdentity(sourceURL(result.url), result.source_document_id, result.frame, result.page_view));
      return result;
    }
    const turned = !permitted && viewPermitted && viewTools.has(name) && result?.actionIssued === true;
    if (!supported || !permitted && !turned || !observations.has(name) && !turned || result?.error || result?.ok === false || result?.cancelled || signal.aborted) return result;
    const observation = result?.observation || result;
    const url = sourceURL(observation?.url);
    const topFrames = observation?.frames?.filter(frame => frame.frame === 0) || [];
    const top = topFrames[0];
    const documentId = top?.documentId, viewKey = pageViewKey(top?.page_view);
    // A matching URL is not document identity. Unknown, unavailable or
    // conflicting top documents must not acquire another document's source.
    if (topFrames.length !== 1 || top.unavailable || !identified(documentId) ||
        observation.topDocumentId !== undefined && observation.topDocumentId !== documentId) return result;
    // Keeping an opened information source must not depend on launching a
    // multi-source comparison. A simple lookup can leave a useful search
    // excerpt behind while opening an inaccessible original document.
    if (!enabled && !preserveReadSources && !viewKey || turned && !viewKey) return result;
    const key = sourceIdentity(url, documentId, 0, top.page_view);
    if (!url || observation.metadata_only || !Array.isArray(observation.frames) || !observation.frames.some(frame => !frame.unavailable) || seen.has(key) ||
        turned && provisional.has(key) || seen.size + provisional.size >= 16 && !provisional.has(key)) return result;
    const count = attempts.get(key) || 0;
    // A failed read cannot become a cache hit. Repeat only after a new passed
    // host page check, once; unchecked observations and uncertain writes cannot
    // spend a retry. Provisional counted views keep their existing one refresh.
    if (count >= 2 || count && !(provisional.get(key) > 0) && !(name === 'verify_page' && result.verified === true)) {
      return {...result, source_capture: {status:'unavailable', reason:count >= 2 ? 'capture_recovery_exhausted' : 'capture_requires_verified_observation',
        instruction:'The prior source read did not establish reference evidence. Use an explicit focused read of the observed source or a grounded alternative. Do not treat failed capture as absence or full coverage.'}};
    }
    if (!count && attempts.size >= 16) return result;
    attempts.set(key, count + 1);
    const kept = provisional.get(key);
    if (turned) provisional.set(key, 0); else provisional.delete(key);
    const index = `research-source-${++sequence}`;
    onStep({index, tool: 'read_page', status: 'running', label: '출처 본문 확보'});
    let content;
    try {content = await execute('read_page', {mode: 'content'});}
    catch {content = {error: 'source_read_failed'};}
    if (signal.aborted) throw new Error('cancelled');
    // The tab can change while reading. Never attach another document's text
    // to the action the leader just observed.
    if (!isPageContentReference(content) || sourceURL(content.url) !== url || content.frame !== 0 || content.source_document_id !== documentId || pageViewKey(content.page_view) !== viewKey) {
      onStep({index, tool: 'read_page', status: 'error', label: '출처 본문 확인 필요'});
      return {...result, source_capture: {status: 'unavailable', instruction: 'The opened source was not captured as reference evidence. Use a focused read_page content request or inspect the observed frame; do not treat missing text as absence.'}};
    }
    if (!turned) seen.add(key);
    const same = kept && evidence.find(item => item.id === kept && item.usable && !item.superseded && item.result?.content_hash === content.content_hash);
    if (same) {
      onStep({index, tool: 'read_page', status: 'done', label: '출처 본문 확보'});
      return {...result, source_capture: {status: 'observed', review_evidence_id: same.id, reference: same.result}};
    }
    for (const item of evidence) if (item.tool === 'read_page' && isPageContentReference(item.result) && replacesPageContent(item.result, content)) {
      item.usable = false; item.superseded = true;
    }
    const id = evidence.length + 1;
    if (turned) provisional.set(key, id);
    evidence.push(reviewEvidence(id, 'read_page', {mode: 'content'}, content));
    const analysisId = analyses?.observe('read_page', {mode: 'content'}, content);
    onStep({index, tool: 'read_page', status: 'done', label: '출처 본문 확보'});
    if (enabled) await onSource(content, analysisId);
    return {...result, source_capture: {status: 'observed', review_evidence_id: id, ...(analysisId ? {analysis_evidence_id: analysisId} : {}), reference: content}};
  };
}

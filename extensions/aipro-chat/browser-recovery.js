import {tokenizer} from 'acorn';
import {SCRIPT_FAILURES} from './script-feedback.js';

const META = new Set(['select_tools', 'update_plan', 'ask_user', 'delegate_analysis', 'cancel_analysis']);
// region_ref is new on every observation, like ref. Left out, every read of an
// unchanged page counted as a change: loop detection and the checkpoint after
// repeated failures never fired, and a failing script was retried 346 times.
const VOLATILE = new Set(['ref', 'region_ref', 'field_id', 'nonce', 'timestamp', 'at', 'screenshot_id', 'analysis_evidence_id', 'image', 'scope', 'instruction', 'recovery', 'visualRecovery', 'execution', 'logs', 'calls', 'focused', 'textChecks']);
const hasTextHash = value => value?.dataKind === 'page_content' && /^[a-f0-9]{64}$/.test(value.content_text_hash || '');
const TARGET = ['id', 'name', 'accessibleName', 'role', 'tag', 'type', 'kind', 'href', 'context'];
function canonical(value, parentKey) {
  if (Array.isArray(value)) return value.map(item => canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    // Observation IDs identify reads, whereas an element's authored DOM id
    // identifies a target. Keep the latter when comparing page content.
    .filter(key => !VOLATILE.has(key) &&
      !(key === 'observedAt' && (Array.isArray(value.elements) || value.dataKind === 'page_content')) &&
      !(key === 'documentId' && (Object.hasOwn(value, 'frame') || Array.isArray(value.frames))) &&
      !(key === 'source_document_id' && value.dataKind === 'page_content') &&
      !(key === 'source_capture' && (value.observation || Array.isArray(value.frames))) &&
      !(key === 'content_ref' && value?.dataKind === 'page_content') &&
      !(key === 'content_hash' && hasTextHash(value)) && !(key === 'id' && (parentKey === 'observation' || Array.isArray(value.frames))))
    .map(key => [key, canonical(value[key], key)]));
  return value;
}
const keyOf = value => JSON.stringify(canonical(value));
function diagnosticEvidence(result) {
  // Cursors/counts/event IDs describe collection, not task progress. Keep the
  // actual distinct errors for repetition detection, without letting new
  // diagnostics clear an unresolved action failure.
  const events = [...new Set((result?.events || []).map(({id, ...event}) => keyOf(event)))].sort();
  return {ok: result?.ok, page: result?.page, events};
}
function remember(map, key, value, limit) {
  map.delete(key); map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

// Run-local comparison state only. Never persist these keys or put page/input
// text into system instructions, diagnostics or public progress labels.
export function createBrowserRecovery() {
  const refs = new Map(), screenshots = new Map(), states = new Map(), seenStates = new Map(), repeats = new Map();
  let lastFailure, failures = 0;
  function references(observation) {
    for (const frame of observation?.frames || []) for (const [index, element] of (frame.elements || []).entries()) {
      if (typeof element.ref !== 'string') continue;
      const descriptor = Object.fromEntries(TARGET.filter(key => Object.hasOwn(element, key)).map(key => [key, element[key]]));
      remember(refs, element.ref, keyOf([observation.url, frame.frame, frame.url, frame.owner, index, descriptor]), 8192);
    }
  }
  function argumentsKey(value, key) {
    if (key === 'progress') return undefined;
    // A screenshot ID grants no progress and remains a separate, unchanged
    // action capability in the browser host. Compare only its observed scope.
    if (key === 'screenshot_id') return screenshots.get(value) || {unobservedScreenshot:true};
    if (typeof value === 'string' && ['ref', 'field_id'].includes(key)) return refs.get(value) || value;
    if (key === 'code' && typeof value === 'string') {
      try {
        // Compare tokens, not formatting/comments. Resolve only references
        // actually observed by this run; this does not execute generated code.
        const tokens = [], reader = tokenizer(value, {ecmaVersion: 'latest'});
        for (let token = reader.getToken(); token.type.label !== 'eof'; token = reader.getToken()) tokens.push([token.type.label, typeof token.value === 'string' ? refs.get(token.value) || token.value : typeof token.value === 'bigint' ? `${token.value}n` : token.value]);
        return tokens;
      } catch {return value;}
    }
    if (Array.isArray(value)) return value.map(item => argumentsKey(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, argumentsKey(value[key], key)]));
    return value;
  }
  return {
    seed: references,
    signature: (name, args) => JSON.stringify([name, argumentsKey(args)]),
    observe(name, args, result, signature, imageEvidence) {
      const failed = !!result?.error || result?.ok === false;
      const diagnostic = name === 'read_browser_diagnostics';
      if (META.has(name) && !failed || result?.cancelled || result?.error === 'cancelled' || result?.requiresUserInput) return {changed: false, repetitions: 0};
      const observation = result?.observation || (Array.isArray(result?.frames) ? result : null);
      references(observation);
      const candidates = [];
      const capture = name === 'capture_page' && !failed ? result : result?.visualRecovery;
      const image = imageEvidence?.mimeType === 'image/png' && /^[a-f0-9]{64}$/.test(imageEvidence?.imageHash || '')
        ? {mimeType:imageEvidence.mimeType,imageHash:imageEvidence.imageHash} : null;
      let captureComparison;
      if (capture && typeof capture.screenshot_id === 'string') {
        const scope = {url:observation?.url, tabId:observation?.tabId,
          // Preserve real document/frame scope separately from ephemeral refs.
          documents:[observation?.topDocumentId || null,...(observation?.frames || []).map(frame=>[frame.frame,frame.documentId || null,frame.url,frame.owner])],
          viewport:capture.viewport || {width:capture.width,height:capture.height,scrollX:capture.scrollX,scrollY:capture.scrollY},
          mode:capture.capture_mode,region:capture.region};
        const binding = {scope,...(image ? {image} : {imageEvidence:'unknown'})};
        remember(screenshots,capture.screenshot_id,binding,64);
        candidates.push(['capture:scope',keyOf(scope)]);
        // Host-computed image hashes are supplied out-of-band. Never infer
        // visual equality/change from an ID, file size or model-authored hash.
        if (image) candidates.push(['capture:image',keyOf({captureScope:scope,visualContent:image})]);
        if (name === 'capture_page') {
          const {attachment, ...observed} = result;
          const {id: _storedCaptureId, ...attachmentMetadata} = attachment || {};
          captureComparison = {...observed,...(attachment ? {attachment:attachmentMetadata} : {}),
            captureScope:scope,visualContent:image || {status:'unknown'}};
        }
      }

      if (observation) {
        // Filtered excerpts are different views, not proof of a page change.
        const view = observation.frames?.some(frame => frame.textChecks) ? 'verification' : observation.frames?.some(frame => frame.textFiltered) ? `filtered:${args?.query || ''}` : 'page';
        candidates.push([view, keyOf(observation)]);
      }
      if (!failed && !diagnostic) {
        if (result?.dataKind === 'page_content') candidates.push([`content:${result.source_key || result.url}:${result.frame}`, hasTextHash(result) ? result.content_text_hash : result.content_hash]);
        const payload = result?.dataKind === 'page_content' ? null : observation ? Object.fromEntries(['value', 'checks', 'applied', 'matched', 'verified'].filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]])) : canonical(captureComparison || result);
        if (payload && Object.keys(payload).length) candidates.push([`result:${name}`, keyOf(payload)]);
      }
      // Returning to A after A -> B is a state change, but not new evidence.
      // Keep a bounded run-local novelty window across progress resets so a
      // successful navigation/read cycle cannot erase the same failed action.
      const changed = candidates.some(([view, value]) => states.has(view) && states.get(view) !== value && !seenStates.has(JSON.stringify([view, value])));
      for (const [view, value] of candidates) {
        remember(states, view, value, 32);
        remember(seenStates, JSON.stringify([view, value]), true, 128);
      }
      if (changed) {repeats.clear(); failures = 0; lastFailure = null;}
      if (failed) {
        failures++;
        const reason = result.reason || result.error;
        lastFailure = Object.hasOwn(SCRIPT_FAILURES, reason) ? reason :
          ['verification_failed', 'action_outcome_unknown', 'tool_arguments_invalid', 'tool_unavailable'].includes(reason) ? reason : 'tool_failed';
      } else if (result?.verified === true) {failures = 0; lastFailure = null;}
      // Rewording a lexical query may return the exact same source range. The
      // text, version and range determine read novelty, not the search wording
      // or its ranking metadata. Different ranges remain different outcomes.
      const contentRead = name === 'read_page' && !failed && result?.dataKind === 'page_content' && Array.isArray(result.ranges);
      const {retrieval: _retrieval, ...contentResult} = contentRead ? result : {};
      const fingerprint = JSON.stringify([diagnostic ? [name, args?.kind || 'all', args?.errors_only ?? true] : contentRead ? 'source_range_read' : signature,
        failed ? {error: result.reason || result.error || 'tool_failed'} : diagnostic ? diagnosticEvidence(result) : canonical(contentRead ? contentResult : captureComparison || result)]);
      const repetitions = (repeats.get(fingerprint) || 0) + 1;
      remember(repeats, fingerprint, repetitions, 128);
      return {changed, repetitions};
    },
    guidance() {
      if (!lastFailure) return '';
      const advice = SCRIPT_FAILURES[lastFailure]?.[1] || ({
        verification_failed: 'Compare the failed checks with the current visible result. Read any field validation or search result state, correct only the unmet requirement and verify again. Do not repeat an issued click merely because its expected result was missing.',
        action_outcome_unknown: 'The previous write may have happened. Read current state and verify its outcome before another write. Never replay it to recover a lost response.',
        tool_arguments_invalid: 'Select a declared tool and correct its arguments using its schema and observed evidence.',
        tool_unavailable: 'Choose an available tool for the task. Do not invent another tool name.',
      })[lastFailure] || 'Inspect the failed result, command receipts and current page. Change the unsuccessful approach and continue only missing work.';
      return `Browser recovery: ${lastFailure}; failures without changed evidence: ${failures}. ${advice} A successful read or fresh element IDs alone do not resolve the failure. After repeated failure, reconsider the target, frame, open tab and interaction method; do not keep issuing the same action. Use the available screenshot when DOM evidence is insufficient. Ask the user only for missing information or an unresolved choice, not routine technical repair. Keep final transaction approval and user cancellation intact.`;
    },
    dispose() {refs.clear(); screenshots.clear(); states.clear(); seenStates.clear(); repeats.clear(); lastFailure = null; failures = 0;},
  };
}

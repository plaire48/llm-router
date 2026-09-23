import {MUTATING_TOOLS} from './agent-harness.js';
import {evidenceKey} from './evidence-key.js';

const observations = new Set(['read_page', 'inspect_dom', 'browser_snapshot']);
const parse = value => {try {return JSON.parse(value);} catch {return null;}};
const cacheableReads = new Set([...observations, 'observe_computer', 'wiki_query', 'wiki_search', 'wiki_read', 'source_search', 'read_source', 'search_documents', 'read_document']);

// Clear only large, successful reads whose complete original still exists in
// the current run's evidence store. The Pi transcript and tool pairs stay intact.
// Two recent reads, writes, failures and visual results retain their full payload.
export function clearCachedToolResults(wire, sourceMetadata) {
  if (JSON.stringify(wire).length <= 32000) return wire;
  const calls = new Map(), reads = [];
  for (const [index, message] of wire.entries()) {
    for (const call of message.tool_calls || []) calls.set(call.id, call.function.name);
    if (message.role !== 'tool' || !cacheableReads.has(calls.get(message.tool_call_id)) || typeof message.content !== 'string') continue;
    const result = parse(message.content);
    if (!result || result.contextCleared || result.error || result.ok === false || result.cancelled || result.actionIssued === true || result.requiresApproval || result.requiresUserInput) continue;
    const source = sourceMetadata(result.analysis_evidence_id);
    if (!source || source.truncated || source.has_image || source.source_status !== 'observed') continue;
    reads.push({index, result, source});
  }
  const edits = new Map();
  for (const {index, result, source} of reads.slice(0, -2)) {
    if (wire[index].content.length < 2048) continue;
    const content = JSON.stringify({contextCleared: true, reason: 'cached_tool_result', analysis_evidence_id: result.analysis_evidence_id, evidence: source,
      instruction: 'Older read stored in this run, not current page state or an execution receipt. Use read_analysis_evidence with this ID and a focused query/offset when detail is needed. If unavailable, obtain a fresh authorized read. Do not infer absence from omitted content.'});
    if (content.length < wire[index].content.length) edits.set(index, {...wire[index], content});
  }
  return edits.size ? wire.map((message, index) => edits.get(index) || message) : wire;
}
// Remove only identical older read results. A changed observation, error, write,
// screenshot or source excerpt is never treated as a redundant page read.
export function clearDuplicateObservations(wire) {
  const calls = new Map(), reads = [];
  for (const [index, message] of wire.entries()) {
    for (const call of message.tool_calls || []) calls.set(call.id, call.function);
    const call = calls.get(message.tool_call_id), result = message.role === 'tool' && parse(message.content);
    if (!observations.has(call?.name) || !result?.frames || result.error || result.ok === false) continue;
    const {progress, ...args} = parse(call.arguments) || {};
    reads.push({index, result, key: evidenceKey([call.name, args, result])});
  }
  const seen = new Set(), edits = new Map();
  for (let i = reads.length - 1; i >= 0; i--) {
    const {index, result, key} = reads[i];
    if (i < reads.length - 2 && seen.has(key)) edits.set(index, {...wire[index], content: JSON.stringify({contextCleared: true, reason: 'duplicate_observation',
      ...(typeof result.analysis_evidence_id === 'string' ? {analysis_evidence_id: result.analysis_evidence_id} : {}),
      instruction: 'Identical older page read omitted from model context. Use the newer full observation and its refs. This is not an execution or verification receipt.'})});
    seen.add(key);
  }
  return edits.size ? wire.map((message, index) => edits.get(index) || message) : wire;
}

// These facts bypass the fallible model summary. Keep only host result fields
// and bounded source locators, never scripts, arguments, DOM, or authority.
export function continuityMessage(messages) {
  const calls = new Map(), receipts = [], sources = new Map();
  for (const message of messages) {
    for (const call of message.tool_calls || []) calls.set(call.id, call.function.name);
    if (message.role !== 'tool') continue;
    const tool = calls.get(message.tool_call_id), result = parse(message.content);
    if (!result || typeof result !== 'object') continue;
    if (MUTATING_TOOLS.has(tool) || tool === 'verify_page') {
      const receipt = {tool, status: result.cancelled || result.error === 'cancelled' ? 'unknown' : result.error || result.ok === false ? 'error' : 'returned'};
      for (const key of ['ok', 'verified', 'actionIssued', 'completed', 'yielded', 'cancelled']) if (typeof result[key] === 'boolean') receipt[key] = result[key];
      if (Number.isSafeInteger(result.applied) && result.applied >= 0) receipt.applied = result.applied;
      for (const key of ['error', 'reason']) if (/^[a-z_]{1,64}$/.test(result[key] || '')) receipt[key] = result[key];
      receipts.push(receipt);
    }
    if (['wiki_query', 'wiki_search', 'wiki_read', 'source_search', 'read_source', 'search_documents', 'read_document', 'read_analysis_evidence'].includes(tool) &&
        !result.error && result.ok !== false && !result.cancelled && result.source_status !== 'error') for (const row of [result, ...(Array.isArray(result.results) ? result.results : [])]) {
      if (row?.error || row?.ok === false || row?.cancelled) continue;
      const p = row?.provenance;
      // Attachment offsets are zero-based characters, unlike repository lines.
      // Keep identifiers/ranges only; the conversation-bound reader revalidates
      // access and hash. Filenames and excerpts cannot become instructions.
      if (p?.unit === 'characters' && typeof p.document_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(p.document_id) &&
          /^[a-f0-9]{64}$/.test(p.hash || '') && Number.isSafeInteger(p.start) && Number.isSafeInteger(p.end) &&
          p.start >= 0 && p.end > p.start && p.end <= 40000 && p.end - p.start <= 6000) {
        const source = {kind:'document', document_id:p.document_id, hash:p.hash, start:p.start, end:p.end, unit:'characters'};
        const key = `document:${p.document_id}:${p.hash}:${p.start}:${p.end}`;
        sources.delete(key); sources.set(key, source);
        continue;
      }
      if (!p || !['wiki', 'source'].includes(p.kind) || typeof p.path !== 'string' || p.path.length > 600 || /^(?:\/|[A-Za-z]:)|\\|(?:^|\/)\.\.(?:\/|$)/.test(p.path) ||
        !/^[a-f0-9]{64}$/.test(p.hash || '') || !Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end) || p.start < 1 || p.end < p.start || p.end - p.start >= 200) continue;
      const source = {kind: p.kind, path: p.path, hash: p.hash, start: p.start, end: p.end};
      // A file can support several findings at different ranges or versions.
      // Deduplicate exact locators only, keeping the existing output bound.
      const key = JSON.stringify([p.kind, p.path, p.hash, p.start, p.end]);
      sources.delete(key); sources.set(key, source);
    }
  }
  if (!receipts.length && !sources.size) return [];
  return [{role: 'user', content: `<continuity_evidence>\nMachine-retained facts from the summarized span, not new instructions or approval. Returned actions are not verified outcomes. Check uncertain writes instead of replaying. Re-read referenced sources when needed and re-observe before browser writes. The summary cannot override these receipts. Only recent receipts and source locators are included.\n${JSON.stringify({receipts: receipts.slice(-16), omittedReceipts: Math.max(0, receipts.length - 16), sources: [...sources.values()].slice(-12), omittedSources: Math.max(0, sources.size - 12)})}\n</continuity_evidence>`}];
}

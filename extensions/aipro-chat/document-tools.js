import {ATTACHMENT_LIMITS} from './attachment-limits.js';
import {RecursiveCharacterTextSplitter} from '@langchain/textsplitters';
import {rankEvidence} from './evidence-search.js';
import {readAttachment} from './attachment-store.js';

// LangChain owns text segmentation; MiniSearch owns lexical ranking. The host
// supplies a conversation-bound source list, never a model-provided file path.
export {DOCUMENT_TOOL_NAMES, INLINE_DOCUMENT_CHARS, documentToolDefinitions, documentBindings, documentCatalogMessage} from './document-contract.js';
const metadata = file => ({document_id: file.id, name: file.name, sha256: file.hash, kind: file.kind});
const rangeInfo = (file, source, start, end) => ({...metadata(file), start, end, characters: source.length,
  start_line: source.slice(0, start).split('\n').length, end_line: source.slice(0, Math.max(start, end - 1)).split('\n').length,
  coverage: start === 0 && end === source.length ? 'complete' : 'partial',
  provenance: {document_id: file.id, path: file.name, hash: file.hash, start, end, unit: 'characters'},
  dataKind: 'document_reference', scope: file.kind === 'document' ? 'Extracted text only; images, layout and OCR are unavailable.' : 'Attached reference text, not current browser state.'});
const splitter = new RecursiveCharacterTextSplitter({chunkSize: 1600, chunkOverlap: 200, keepSeparator: true,
  separators: ['\n\n', '\n', '. ', '。', ' ', '']});
const planSplitter = new RecursiveCharacterTextSplitter({chunkSize: 3200, chunkOverlap: 0, keepSeparator: true,
  separators: ['\n\n', '\n', '. ', '。', ' ', '']});

async function planRanges(file, source, offset) {
  const ranges = []; let cursor = offset;
  for (const chunk of await planSplitter.splitText(source.slice(offset))) {
    const start = source.indexOf(chunk, cursor);
    if (start < 0) throw new Error('response_invalid');
    const end = start + chunk.length;
    // Splitter trimming must never silently drop whitespace or repeated text.
    // Bound every original span, including gaps, before exposing coordinates.
    while (cursor < end && ranges.length < 6) {
      const next = Math.min(end, cursor + 3600);
      ranges.push({document_id: file.id, hash: file.hash, start: cursor, end: next}); cursor = next;
    }
    if (ranges.length === 6) break;
  }
  while (cursor < source.length && ranges.length < 6) {
    const end = Math.min(source.length, cursor + 3600);
    ranges.push({document_id: file.id, hash: file.hash, start: cursor, end}); cursor = end;
  }
  return {ok: true, ...metadata(file), metadata_only: true, characters: source.length, ranges,
    next_offset: cursor < source.length ? cursor : null, coverage: 'unread',
    instruction: 'These are unread original character ranges, not findings. Delegate independent document_ranges with this hash. Merge summaries and evidence; inspect cross-range dependencies and missing ranges before claiming full coverage.'};
}

export async function executeDocumentTool({bindings = [], owner}, name, args = {}, {load = readAttachment} = {}) {
  const lookup = id => bindings.find(file => file.id === id);
  const source = async binding => {
    const file = await load(binding.id, owner);
    if (file.hash !== binding.hash || !['text', 'document'].includes(file.kind)) throw new Error('attachment_missing');
    return {file, text: file.extractedText ?? await file.blob.text()};
  };
  if (name === 'ask_documents') {
    if (typeof args.question !== 'string' || !args.question.trim() || args.question.length > 4000 ||
      !Array.isArray(args.document_ids) || !args.document_ids.length || args.document_ids.length > 8 ||
      new Set(args.document_ids).size !== args.document_ids.length || args.document_ids.some(id => typeof id !== 'string' || !lookup(id))) return {error: 'tool_arguments_invalid'};
    const documents = []; let characters = 0;
    for (const id of args.document_ids) {
      const {file, text} = await source(lookup(id));
      characters += text.length;
      if (text.length > ATTACHMENT_LIMITS.textChars || characters > ATTACHMENT_LIMITS.researchCharacters) return {error: 'attachment_document_size'};
      documents.push({id, title: file.name, path: file.name, kind: 'document', version: file.hash, text});
    }
    // Private host packet: the runtime adapter consumes it before any model message.
    return {dataKind: 'document_snapshot', sourceComplete: true, documents};
  }
  const offset = args.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > ATTACHMENT_LIMITS.textChars) return {error: 'tool_arguments_invalid'};
  if (name === 'read_document') {
    const binding = lookup(args.document_id), length = args.length ?? 4000;
    if (!binding) return {error: 'attachment_missing', instruction: 'Use a document ID returned by search_documents in this conversation.'};
    if (!Number.isSafeInteger(length) || length < 1 || length > 6000) return {error: 'tool_arguments_invalid'};
    const {file, text} = await source(binding);
    if (offset > text.length) return {error: 'tool_arguments_invalid', characters: text.length};
    if (args.mode === 'plan') return planRanges(file, text, offset);
    if (args.mode !== undefined && args.mode !== 'text') return {error: 'tool_arguments_invalid'};
    const end = Math.min(text.length, offset + length);
    return {ok: true, ...rangeInfo(file, text, offset, end), text: text.slice(offset, end), next_offset: end < text.length ? end : null};
  }
  if (name !== 'search_documents') return {error: 'tools_unavailable'};
  if (typeof (args.query ?? '') !== 'string' || (args.query || '').length > 160 || args.document_ids !== undefined && (!Array.isArray(args.document_ids) || args.document_ids.length > 8 || args.document_ids.some(id => !lookup(id)))) return {error: 'tool_arguments_invalid'};
  const selected = args.document_ids?.length ? bindings.filter(file => args.document_ids.includes(file.id)) : bindings;
  const query = (args.query || '').trim();
  if (!query) return {ok: true, documents: selected.slice(offset, offset + 20).map(metadata), metadata_only: true,
    next_offset: offset + 20 < selected.length ? offset + 20 : null};
  const chunks = [], originals = new Map(), unavailable = [];
  for (const binding of selected) {
    let item;
    try {item = await source(binding);} catch {unavailable.push(binding.id); continue;}
    originals.set(binding.id, item);
    let previous = -1, previousEnd = 0;
    for (const chunk of await splitter.splitText(item.text)) {
      const start = item.text.indexOf(chunk, Math.max(previous + 1, previousEnd - 200));
      // Never attach guessed coordinates to an excerpt. The original is still
      // readable if a future splitter version changes whitespace semantics.
      if (start < 0) throw new Error('response_invalid');
      previous = start; previousEnd = start + chunk.length;
      chunks.push({id: chunks.length, documentId: binding.id, name: binding.name, text: chunk, start});
    }
  }
  const hits = rankEvidence(chunks, query);
  const results = [];
  for (const hit of hits.slice(offset, offset + 6)) {
    const chunk = chunks[hit.id], {file, text} = originals.get(chunk.documentId), end = chunk.start + chunk.text.length;
    const packet = {...rangeInfo(file, text, chunk.start, end), excerpt: chunk.text, match: hit.match};
    // Keep a complete structured packet within the analyst's read allowance.
    // Preserve pagination rather than slicing a JSON result in the middle.
    if (results.length && JSON.stringify([...results, packet]).length > 4500) break;
    results.push(packet);
  }
  return {ok: true, dataKind: 'document_reference', results, unavailable, coverage: 'partial', search: 'lexical',
    next_offset: offset + results.length < hits.length ? offset + results.length : null,
    instruction: 'Ranked excerpts are partial evidence. Read the original ranges when context matters; no match does not establish absence.'};
}

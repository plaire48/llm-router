import {collectPageContent} from './generated/browser-content-dom.js';
import {MarkdownTextSplitter} from '@langchain/textsplitters';
import {rankEvidence} from './evidence-search.js';

const splitter = new MarkdownTextSplitter({chunkSize: 5000, chunkOverlap: 0, keepSeparator: true});
export async function contentPacket(source, args = {}) {
  if (source.error) return source;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source.sourceIdentity || source.url, source.text]))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (args.content_hash && args.content_hash !== hash) return {error: 'browser_content_changed', content_hash: hash,
    instruction: 'The document content changed. Start a new content read at offset 0; do not combine ranges from different hashes.'};
  if (args.offset && !args.content_hash) return {error: 'tool_arguments_invalid', instruction: 'Use content_hash from the initial read when continuing at an offset.'};
  const chunks = []; let previous = 0;
  for (const text of await splitter.splitText(source.text)) {
    const start = source.text.indexOf(text, previous);
    if (start < 0) throw new Error('response_invalid');
    chunks.push({id: chunks.length, name: source.title, text, start, end: start + text.length}); previous = start + text.length;
  }
  const query = (args.query || '').trim(), offset = args.offset || 0;
  const hits = query ? rankEvidence(chunks, query) : [];
  const selected = query ? hits.map(hit => chunks[hit.id]).slice(offset, offset + 1) : chunks.filter(chunk => chunk.end > offset).slice(0, 1);
  const rows = selected.map(chunk => ({start: chunk.start, end: chunk.end, markdown: chunk.text}));
  const next = query ? offset + rows.length < hits.length ? offset + rows.length : null : rows[0]?.end < source.text.length ? rows[0].end : null;
  return {ok: true, dataKind: 'page_content', title: source.title, url: source.url, frame: source.frame,
    content_hash: hash, method: source.method, characters: source.text.length, ranges: rows, next_offset: next,
    queryFiltered: !!query, coverage: source.coverage,
    scope: 'Markdown reference evidence, not actionable refs or proof of browser writes. Query results are lexical excerpts, not full coverage. Continue with the same content_hash, offset and query. Use screen observation for actions.'};
}
export async function readPageContent(task, args, safeURL, cancelled) {
  const offset = args.offset ?? 0, frame = args.frame ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2000000 || !Number.isSafeInteger(frame) || frame < 0 || frame > 15 ||
      args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200) ||
      args.content_hash !== undefined && !/^[a-f0-9]{64}$/.test(args.content_hash)) return {error: 'tool_arguments_invalid'};
  const frames = await chrome.scripting.executeScript({target: {tabId: task.tabId, allFrames: true}, world: 'ISOLATED', func: () => ({url: location.href})});
  const available = frames.sort((a, b) => a.frameId - b.frameId).slice(0, 16).filter(item => safeURL(item.result?.url) || ['about:blank', 'about:srcdoc'].includes(item.result?.url));
  const selected = available[frame];
  if (!selected || !safeURL(available[0]?.result?.url)) return {error: 'browser_stale'};
  if (cancelled()) throw new Error('cancelled');
  const [result] = await chrome.scripting.executeScript({target: {tabId: task.tabId, documentIds: [selected.documentId]}, world: 'ISOLATED', func: collectPageContent});
  if (cancelled()) throw new Error('cancelled');
  if (!result?.result || result.result.url && result.result.url !== selected.result.url) return {error: 'browser_stale'};
  return contentPacket({...result.result, sourceIdentity: [selected.documentId, selected.result.url], url: safeURL(selected.result.url) || safeURL(available[0].result.url), frame}, args);
}

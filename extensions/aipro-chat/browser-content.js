import {collectPageContent} from './generated/browser-content-dom.js';
import {pageScript} from './page-script.js';
import {MarkdownTextSplitter} from '@langchain/textsplitters';
import {createEvidenceSearch, evidenceExcerpt} from './evidence-search.js';
import {readCurrentPdf, readCurrentPdfPage} from './browser-pdf.js';
import {contentOutline} from './browser-content-outline.js';
import {sourceBoundaryIndex} from './source-boundaries.js';

const splitter = new MarkdownTextSplitter({chunkSize: 5000, chunkOverlap: 0, keepSeparator: true});
// This caches only the local lexical index, never a page observation. The host
// still reads the actual document and checks its full identity/text hash first.
// Short lived and bounded across runs; nothing is written to storage or a wiki.
const queryIndexes = new Map(), INDEX_CHARACTERS = 300000, INDEX_ENTRIES = 6, INDEX_TTL = 60000;
function dropQueryIndex(key) {
  clearTimeout(queryIndexes.get(key)?.expiry);
  queryIndexes.delete(key);
}
async function queryIndex(text, key) {
  const now = Date.now();
  for (const [id, entry] of queryIndexes) if (entry.expires <= now) dropQueryIndex(id);
  let entry = queryIndexes.get(key);
  if (entry) {queryIndexes.delete(key); queryIndexes.set(key, entry); return entry.pending;}
  const build = async () => {
    const chunks = []; let previous = 0;
    for (const part of await splitter.splitText(text)) {
      const start = text.indexOf(part, previous);
      if (start < 0) throw new Error('response_invalid');
      chunks.push({id: chunks.length, text: part, start, end: start + part.length}); previous = start + part.length;
    }
    // A document title repeated on every chunk must not manufacture body hits.
    return {chunks, search: createEvidenceSearch(chunks, {fields: ['text']})};
  };
  if (text.length > INDEX_CHARACTERS) return build();
  while (queryIndexes.size >= INDEX_ENTRIES || [...queryIndexes.values()].reduce((sum, item) => sum + item.characters, 0) + text.length > INDEX_CHARACTERS) {
    dropQueryIndex(queryIndexes.keys().next().value);
  }
  entry = {characters: text.length, expires: now + INDEX_TTL, pending: build()};
  queryIndexes.set(key, entry);
  entry.expiry = setTimeout(() => {if (queryIndexes.get(key) === entry) dropQueryIndex(key);}, INDEX_TTL);
  entry.expiry.unref?.();
  try {return await entry.pending;} catch (error) {if (queryIndexes.get(key) === entry) dropQueryIndex(key); throw error;}
}
const windowEnd = (text, start) => {
  let end = Math.min(text.length, start + 5000);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return end;
};
export async function contentPacket(source, args = {}) {
  if (source.error) return source;
  // Display URLs omit query values. Bind reference identity to a hash of the
  // actual source URL so two search queries are not the same document version.
  const sourceAddress = new URL(source.sourceIdentity?.[1] || source.url); sourceAddress.hash = '';
  const sourceKey = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceAddress.href)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source.sourceIdentity || source.url, source.text]))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  // Novelty only. The document-bound content_hash above remains the contract
  // for range continuation, citation freshness and document replacement.
  const textHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source.text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (args.content_hash && args.content_hash !== hash) return {error: 'browser_content_changed', content_hash: hash,
    instruction: 'The document content changed. Start a new content read at offset 0; do not combine ranges from different hashes.'};
  if (args.offset && !args.content_hash) return {error: 'tool_arguments_invalid', instruction: 'Use content_hash from the initial read when continuing at an offset.'};
  const query = (args.query || '').trim(), offset = args.offset || 0;
  // Semantic retrieval chunks can be a heading of only a few characters.
  // Sequential reading instead uses exact, contiguous source windows. Keep
  // lexical query pagination separate; its offset is a result index.
  const queryData = query ? await queryIndex(source.text, JSON.stringify([hash, source.frame])) : null;
  const hits = queryData ? queryData.search(query) : [];
  // Markdown splitting can isolate a heading from an oversized paragraph.
  // Retrieve by its precise child match, then include bounded adjacent original
  // text. This context is not an inferred answer or exhaustive section read.
  const contextRange = chunk => {
    const headingOnly = chunk.text.length < 1000 && /^(?:#{1,6}\s+[^\n]+\s*)+$/.test(chunk.text.trim());
    const end = headingOnly ? windowEnd(source.text, chunk.start) : chunk.end;
    return {...chunk, end, text: source.text.slice(chunk.start, end)};
  };
  const end = windowEnd(source.text, offset);
  const selected = query ? hits.slice(offset, offset + 1).map(hit => contextRange(queryData.chunks[hit.id]))
    : offset < end ? [{start:offset,end,text:source.text.slice(offset,end)}] : [];
  const rows = selected.map(chunk => {
    const pages=source.pageRanges?.filter(page=>page.end>chunk.start&&page.start<chunk.end)||[];
    return {start:chunk.start,end:chunk.end,markdown:chunk.text,...(source.pdf?{page_ranges:pages.slice(0,64).map(page=>({page:page.page,
      start:Math.max(page.start,chunk.start),end:Math.min(page.end,chunk.end),text_available:page.textAvailable})),omitted_page_ranges:Math.max(0,pages.length-64)}:{})};
  });
  // Verbatim labels inside the returned ranges only. These are lexical
  // candidates, not publication dates inferred from events or read time.
  const datedLabels=[];
  for(const row of rows) for(const match of row.markdown.matchAll(/(?:본인참여|입력|수정|등록|작성|게시|발행|갱신|업데이트|updated|published)\s*[:：]?\s*\[?(?:19|20)\d{2}[./-]\s?\d{1,2}(?:[./-]\s?\d{1,2})?/gi)) {
    if(datedLabels.length>=8)break;
    datedLabels.push({text:match[0],start:row.start+match.index,end:row.start+match.index+match[0].length});
  }
  const next = query ? offset + rows.length < hits.length ? offset + rows.length : null : rows[0]?.end < source.text.length ? rows[0].end : null;
  // One range per call hid every other candidate: a model that reworded its
  // query received the same top range again. List the ranked candidates with
  // exact source offsets so it can open a different one. Excerpts are verbatim
  // source text and word matches only, never a relevance or coverage verdict.
  const matches = query ? hits.slice(0, 8).map((hit, index) => {
    const chunk = contextRange(queryData.chunks[hit.id]), pages = source.pageRanges?.filter(page => page.end > chunk.start && page.start < chunk.end) || [];
    return {result_offset: index, start: chunk.start, end: chunk.end, ...(source.pdf && pages.length ? {pages: [pages[0].page, pages.at(-1).page]} : {}),
      terms: hit.match.terms.slice(0, 8), excerpt: evidenceExcerpt(chunk.text, query, 160), returned: index === offset};
  }) : [];
  return {ok: true, dataKind: 'page_content', observedAt: new Date().toISOString(), title: source.title, url: source.url, frame: source.frame,
    ...(!query && offset === 0 ? {outline: contentOutline(source.text, hash)} : {}),
    ...(!query && offset === 0 ? {boundary_index: sourceBoundaryIndex(source.text,hash)} : {}),
    ...(query ? {retrieval: {method:'lexical', match:hits[offset]?.match || {terms:[],fields:[],coverage:0},
      total_matches: hits.length, matches,
      scope:'Body word matches only, not factual relevance. Heading-only matches include adjacent original context up to 5000 characters; it may cross sections or omit later exceptions. matches lists the candidate context ranges; returned marks the one in ranges. If it does not answer the requested fact, open another candidate with offset=result_offset and the same query/hash, or read around it sequentially with content_hash, no query and offset=start. Changing query words may return the same range.' +
        (hits.length ? '' : ' No word matched: the source may use another language or wording. Use terms in the source language or read sequentially.')}} : {}),
    ...(datedLabels.length?{dated_labels:{candidates:datedLabels,scope:'Exact labeled date text in returned ranges only. Interpret the label and claim together; these are not freshness or current-affiliation verdicts. Event dates and host read time are separate.'}}:{}),
    source_key: sourceKey, ...(source.documentId ? {source_document_id: source.documentId} : {}),
    content_hash: hash, content_text_hash: textHash, ...(source.page_view ? {page_view: source.page_view} : {}), method: source.method, characters: source.text.length, ranges: rows, next_offset: next,
    ...(Number.isSafeInteger(source.links?.inDocument) && Number.isSafeInteger(source.links?.inText) && source.text.length < 2000 && source.links.inDocument - source.links.inText >= 5
      ? {link_coverage: {in_document: source.links.inDocument, in_returned_text: source.links.inText,
        instruction: 'This text is short and most links of the document are not in it. To find or open a linked document, observe the page with browser_snapshot and a focused query, then use the observed link. Do not guess a URL or conclude that the source is unavailable.'}} : {}),
    queryFiltered: !!query, coverage: {...source.coverage, partial: source.coverage?.partial !== false || !!query || offset > 0 || end < source.text.length},...(source.pdf?{pdf:source.pdf}:{}),
    scope: 'Reference Markdown, never actionable refs or write proof. Windows may split paragraphs/tables/rules; read remaining context. Query excerpts cannot prove full coverage or absence. Continue with the same content_hash/query and next_offset. Use screen observation for actions.'};
}
export async function readPageContent(task, args, safeURL, cancelled) {
  const offset = args.offset ?? 0, frame = args.frame ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2000000 || !Number.isSafeInteger(frame) || frame < 0 || frame > 15 ||
      args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200) ||
      args.content_hash !== undefined && !/^[a-f0-9]{64}$/.test(args.content_hash)) return {error: 'tool_arguments_invalid'};
  const frames = await pageScript({target: {tabId: task.tabId, allFrames: true}, world: 'ISOLATED', func: () => ({url: location.href,contentType:document.contentType})});
  const available = frames.sort((a, b) => a.frameId - b.frameId).slice(0, 16).filter(item => safeURL(item.result?.url) || ['about:blank', 'about:srcdoc'].includes(item.result?.url));
  const selected = available[frame];
  if (!selected || !safeURL(available[0]?.result?.url)) return {error: 'browser_stale'};
  if (cancelled()) throw new Error('cancelled');
  const [result] = await pageScript({target: {tabId: task.tabId, documentIds: [selected.documentId]}, world: 'ISOLATED', func: collectPageContent});
  if (cancelled()) throw new Error('cancelled');
  if (!result?.result || result.result.url && result.result.url !== selected.result.url) return {error: 'browser_stale'};
  if(result.result.error==='page_content_pdf_unavailable'&&selected.frameId===0&&selected.result.contentType==='application/pdf') {
    const pdf=await readCurrentPdf(task,selected,cancelled);
    if(pdf.error)return pdf;
    const packet=await contentPacket({...pdf,url:safeURL(selected.result.url),frame},args);
    if(cancelled())throw Error('cancelled');
    const [current]=await pageScript({target:{tabId:task.tabId,documentIds:[selected.documentId]},world:'ISOLATED',func:()=>({url:location.href})});
    if(current?.documentId!==selected.documentId||current.result?.url!==selected.result.url)return {error:'browser_stale'};
    return packet;
  }
  return contentPacket({...result.result, documentId: selected.documentId, sourceIdentity: [selected.documentId, selected.result.url], url: safeURL(selected.result.url) || safeURL(available[0].result.url), frame}, args);
}

export async function readPdfPageReference(task,args,safeURL,cancelled,vision) {
  if(!vision)return {error:'vision_unavailable',instruction:'PDF images need an available image-input model. Use observed text sources for unresolved exceptions or report the visual limitation.'};
  const [selected]=await pageScript({target:{tabId:task.tabId,frameIds:[0]},world:'ISOLATED',func:()=>({url:location.href,contentType:document.contentType})});
  if(cancelled())throw Error('cancelled');
  if(!selected||!safeURL(selected.result?.url))return {error:'browser_stale'};
  return readCurrentPdfPage(task,selected,args,cancelled);
}

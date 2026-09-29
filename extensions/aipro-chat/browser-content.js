import {collectPageContent} from './generated/browser-content-dom.js';
import {pageScript} from './page-script.js';
import {MarkdownTextSplitter} from '@langchain/textsplitters';
import {rankEvidence, evidenceExcerpt} from './evidence-search.js';
import {readCurrentPdf, readCurrentPdfPage} from './browser-pdf.js';

const splitter = new MarkdownTextSplitter({chunkSize: 5000, chunkOverlap: 0, keepSeparator: true});
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
  const chunks = []; let previous = 0;
  if (query) for (const text of await splitter.splitText(source.text)) {
    const start = source.text.indexOf(text, previous);
    if (start < 0) throw new Error('response_invalid');
    chunks.push({id: chunks.length, name: source.title, text, start, end: start + text.length}); previous = start + text.length;
  }
  const hits = query ? rankEvidence(chunks, query) : [];
  let end = Math.min(source.text.length, offset + 5000);
  if (end < source.text.length && /[\uD800-\uDBFF]/.test(source.text[end - 1]) && /[\uDC00-\uDFFF]/.test(source.text[end])) end--;
  const selected = query ? hits.map(hit => chunks[hit.id]).slice(offset, offset + 1)
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
    const chunk = chunks[hit.id], pages = source.pageRanges?.filter(page => page.end > chunk.start && page.start < chunk.end) || [];
    return {result_offset: index, start: chunk.start, end: chunk.end, ...(source.pdf && pages.length ? {pages: [pages[0].page, pages.at(-1).page]} : {}),
      terms: hit.match.terms.slice(0, 8), excerpt: evidenceExcerpt(chunk.text, query, 160), returned: index === offset};
  }) : [];
  return {ok: true, dataKind: 'page_content', observedAt: new Date().toISOString(), title: source.title, url: source.url, frame: source.frame,
    ...(query ? {retrieval: {method:'lexical', match:hits[offset]?.match || {terms:[],fields:[],coverage:0},
      total_matches: hits.length, matches,
      scope:'Word matches only, not factual relevance. matches lists the ranked candidate ranges; returned marks the one in ranges. If it does not answer the requested fact, open another candidate with offset=result_offset and the same query/hash, or read around it sequentially with content_hash, no query and offset=start. Changing query words may return the same range.' +
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

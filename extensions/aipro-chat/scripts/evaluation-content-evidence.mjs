import {publicSourceURL} from '../browser-public-url.js';

// Evaluation-only source identity. Retain no raw body, query, input or token.
// This records which source was read; it does not grade its truth or coverage.
export function evaluationContentEvidence(result, redact = publicSourceURL) {
  if (result?.dataKind !== 'page_content' || result.ok !== true || result.error) return null;
  const url = redact(result.url);
  if (!url || !Number.isSafeInteger(result.characters) || result.characters < 0) return null;
  const parsed = new URL(url);
  if (['auth.openai.com','epsso.samsung.net'].includes(parsed.hostname) || /^\/auth(?:\/|$)/.test(parsed.pathname)) return null;
  const hash = value => /^[a-f0-9]{64}$/.test(value || '') ? value : null;
  const pdf = result.method === 'pdfjs_text' && hash(result.pdf?.raw_sha256) &&
    Number.isSafeInteger(result.pdf.page_count) && result.pdf.page_count > 0 && result.pdf.page_count <= 2000
    ? {rawHash: result.pdf.raw_sha256, pageCount: result.pdf.page_count} : null;
  const ranges = (Array.isArray(result.ranges) ? result.ranges : []).slice(0, 8)
    .filter(range => Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 0 && range.end > range.start && range.end <= result.characters)
    .map(({start,end,page_ranges}) => ({start,end,...(pdf ? {pages: (Array.isArray(page_ranges) ? page_ranges : []).slice(0,64)
      .filter(page => Number.isSafeInteger(page.page) && page.page >= 1 && page.page <= pdf.pageCount &&
        Number.isSafeInteger(page.start) && Number.isSafeInteger(page.end) && page.start >= start && page.end <= end && page.end > page.start)
      .map(page => ({page:page.page,start:page.start,end:page.end,textAvailable:page.text_available === true}))} : {})}));
  return {url, sourceKey:hash(result.source_key), contentHash:hash(result.content_hash), textHash:hash(result.content_text_hash),
    characters:result.characters, ranges, ...(pdf ? {pdf} : {}), queryFiltered:result.queryFiltered === true,
    moreRanges:result.next_offset !== null, sourceCoveragePartial:typeof result.coverage?.partial === 'boolean' ? result.coverage.partial : null};
}

import {pageRead} from './analysis-read-receipt.js';

export const SOURCE_QUOTE_GUIDANCE = 'This assignment requires source quotes. For each finding add quotes:[{evidence_id:"ev_1",quote:"exact original page text, at most 240 characters"}]. Include a quote for every cited evidence ID. Copy original Markdown text, with normal newlines, from the excerpts actually read; never invent offsets or cite unread text. Check conditions and exceptions against the claim. A matching quote is not proof that your interpretation is correct. If needed evidence is unavailable, return partial with no unsupported findings.';

// The coordinator supplies its private host read ledger. Model-authored ranges,
// URLs, hashes, status and claimed quotes never establish a successful read.
export function groundSourceQuotes(report, sources, readRanges) {
  const cache = new Map();
  function resolve(id, quote) {
    if (!cache.has(id)) {
      const source = sources.get(id);
      const read = source && pageRead(source, readRanges.get(id) || []);
      cache.set(id, read ? {read, page: JSON.parse(source.text).result} : null);
    }
    const cached = cache.get(id);
    if (!cached) return null;
    for (const returned of cached.read.returned_ranges) for (const range of cached.page.ranges) {
      const start = Math.max(returned.start, range.start), end = Math.min(returned.end, range.end);
      if (start >= end) continue;
      const position = range.markdown.slice(start - range.start, end - range.start).indexOf(quote);
      if (position >= 0) return {evidence_id: id, quote, content_hash: cached.read.content_hash,
        frame: cached.read.frame, start: start + position, end: start + position + quote.length};
    }
    return null;
  }
  const findings = report.findings.map(finding => {
    if (!finding.quotes?.length || finding.evidence_ids.some(id => !finding.quotes.some(quote => quote.evidence_id === id))) throw new Error('analysis_quote_unverified');
    const quotes = finding.quotes.map(item => resolve(item.evidence_id, item.quote));
    if (quotes.some(quote => !quote)) throw new Error('analysis_quote_unverified');
    return {...finding, quotes};
  });
  return {...report, findings};
}

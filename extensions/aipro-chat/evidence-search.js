// Local lexical retrieval only. Rank is relevance, never target certainty or
// authorization. No remote index, embeddings, page code, or persisted contents.
import MiniSearch from 'minisearch';

const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'where', 'how', 'are', 'does', '대한', '어디', '어디서', '어떻게', '알려줘', '알려주세요', '설명해줘', '찾아줘', '찾아주세요', '해주세요', '해줘']);
export const normalizeSearch = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function searchTerms(value) {
  const words = normalizeSearch(String(value || '').replace(/([a-z\d])([A-Z])/g, '$1 $2')).match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(words.map(word => /^[가-힣]{3,}$/.test(word) ? word.replace(/(?:에서는|에서|으로|은|는|을|를|의|에|와|과)$/, '') : word).filter(word => word && !stop.has(word)))];
}
export function createEvidenceSearch(documents, {fields = ['name', 'context', 'text']} = {}) {
  const index = new MiniSearch({fields, tokenize: searchTerms});
  index.addAll(documents);
  return query => {
    const terms = searchTerms(query).slice(0, 24);
    if (!documents.length || !terms.length) return [];
    return index.search(terms.join(' '), {boost: {name: 4, context: 2}, prefix: term => term.length >= 2, fuzzy: false}).map(hit => {
      const matched = terms.filter(term => hit.queryTerms.includes(term));
      return {id: hit.id, score: hit.score, match: {terms: matched, fields: [...new Set(Object.values(hit.match).flat())], coverage: matched.length / terms.length}};
    }).sort((a, b) => b.match.coverage - a.match.coverage || b.score - a.score);
  };
}
export function rankEvidence(documents, query) {
  if (!documents.length || !searchTerms(query).length) return [];
  return createEvidenceSearch(documents)(query);
}

// Keep the match, not just the beginning of a long paragraph. The original
// source remains elsewhere; ellipses explicitly mark omitted context.
export function evidenceExcerpt(value, query, limit = 1200) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  const lower = normalizeSearch(text), terms = searchTerms(query), windows = [0];
  for (const term of terms) {
    let from = 0;
    for (let count = 0; count < 8; count++) {
      const at = lower.indexOf(term, from); if (at < 0) break;
      windows.push(Math.max(0, at - Math.floor(limit / 3))); from = at + term.length;
    }
  }
  let start = 0, best = -1;
  for (const at of windows) {
    const part = lower.slice(at, at + limit), score = terms.filter(term => part.includes(term)).length;
    if (score > best) {best = score; start = at;}
  }
  // Offset calculations must refer to the original text (normalizing whitespace
  // or Unicode can change its length). Callers pass cleaned DOM text; for other
  // inputs use a direct case-insensitive match as the conservative anchor.
  if (lower.length !== text.length) {
    const at = terms.map(term => text.toLowerCase().indexOf(term)).find(at => at >= 0);
    start = Math.max(0, (at || 0) - Math.floor(limit / 3));
  }
  return `${start ? '…' : ''}${text.slice(start, start + limit)}${start + limit < text.length ? '…' : ''}`;
}

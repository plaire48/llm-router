// Local reviewed Markdown only. Context is copied from source, never generated.
import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {gfm} from 'micromark-extension-gfm';
import {toString} from 'mdast-util-to-string';
import {visitParents} from 'unist-util-visit-parents';
import {rankEvidence, searchTerms} from './evidence-search.js';

const WINDOW = 900, OVERLAP = 180, MAX_CHUNKS = 64, CONTEXT = 600;
const range = (start, end) => ({unit: 'character', start, end});
const startOf = node => node.position.start.offset;
const endOf = node => node.position.end.offset;
// MDAST leaf runs and structural ranges are ordered by source position.
// Locate the first value greater than the offset instead of rescanning the
// whole document for every overlapping window and context heading.
function upperBound(items, offset, value) {
  let low = 0, high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (value(items[middle]) <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function wikiChunks(markdown) {
  if (!markdown) return [];
  const tree = fromMarkdown(markdown, {extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()]});
  const nodes = tree.children;
  const headings = [], tables = [], boundaries = new Set([markdown.length]);
  let path = [];
  for (const node of nodes) {
    boundaries.add(endOf(node));
    if (node.type === 'heading') {
      path = path.filter(parent => parent.depth < node.depth);
      path.push({start: startOf(node), end: endOf(node), depth: node.depth});
      headings.push({start: startOf(node), path: [...path]});
    }
  }
  const runs = [];
  visitParents(tree, (node, ancestors) => {
    if (node.type === 'table') {
      tables.push({start: startOf(node), end: endOf(node), headerEnd: node.children[1] ? startOf(node.children[1]) : endOf(node)});
      for (const row of node.children.slice(1)) boundaries.add(endOf(row));
    }
    if (['text', 'inlineCode', 'code', 'image', 'imageReference', 'break', 'html'].includes(node.type)) {
      const flow = ancestors.findLast(parent => ['paragraph', 'heading', 'tableCell'].includes(parent.type)) || node;
      // HTML is an opaque separator, not searchable attributes or script text.
      runs.push({start: startOf(node), end: endOf(node), flow, text: ['html', 'break'].includes(node.type) ? '\n' : toString(node, {includeHtml: false}), opaque: node.type === 'html'});
    }
  });
  const indexText = (start, end) => {
    let text = '', previous;
    for (let index = upperBound(runs, start, run => run.end); index < runs.length && runs[index].start < end; index++) {
      const run = runs[index];
      if (previous && previous !== run.flow) text += '\n';
      // Fully included text nodes decode syntax/entities. A clipped node uses
      // only its actual source slice, so a distant match cannot enter this chunk.
      text += run.opaque ? '\n' : run.start >= start && run.end <= end ? run.text : markdown.slice(Math.max(start, run.start), Math.min(end, run.end));
      previous = run.flow;
    }
    return text;
  };
  const breaks = [...boundaries].sort((a, b) => a - b);
  const cuts = [0, ...headings.map(heading => heading.start).filter(Boolean), markdown.length];
  let windows = [];
  for (let section = 0; section < cuts.length - 1; section++) {
    const finish = cuts[section + 1];
    for (let start = cuts[section]; start < finish;) {
      const limit = Math.min(start + WINDOW, finish);
      const candidate = breaks[upperBound(breaks, limit, value => value) - 1];
      const boundary = candidate > start + WINDOW / 3 ? candidate : undefined;
      const end = limit === finish ? finish : boundary || limit;
      windows.push({start, end});
      if (end === finish) break;
      start = boundary === end ? end : end - OVERLAP;
    }
  }
  // Dense headings cannot drop tail content or grow the index without bound.
  if (windows.length > MAX_CHUNKS) {
    windows = [];
    for (let start = 0; start < markdown.length; start += WINDOW - OVERLAP) {
      const end = Math.min(markdown.length, start + WINDOW);
      windows.push({start, end});
      if (end === markdown.length) break;
    }
  }
  return windows.map(({start, end}) => {
    const headingIndex = upperBound(headings, start, heading => heading.start);
    const parents = headings[headingIndex - 1]?.path || [];
    const overlappingTables = [];
    for (let index = upperBound(tables, start, table => table.end); index < tables.length && tables[index].start < end; index++) overlappingTables.push(tables[index]);
    const context = [];
    let remaining = CONTEXT, contextTruncated = false;
    const add = (kind, from, to, limit) => {
      const finish = Math.min(to, from + limit, from + remaining);
      if (finish > from) context.push({kind, text: markdown.slice(from, finish), range: range(from, finish), ...(finish < to ? {truncated: true} : {})});
      if (finish < to) contextTruncated = true;
      remaining -= finish - from;
    };
    const headingLimit = Math.floor((overlappingTables.length ? CONTEXT / 2 : CONTEXT) / Math.max(1, parents.length));
    for (const parent of parents) add('heading', parent.start, parent.end, headingLimit);
    const tableLimit = Math.floor(remaining / Math.max(1, overlappingTables.length));
    for (const table of overlappingTables) add('table_header', table.start, table.headerEnd, tableLimit);
    return {text: markdown.slice(start, end), searchText: indexText(start, end), searchContext: context.map(item => indexText(item.range.start, item.range.end)).join('\n'), start, end, context, contextTruncated,
      section: context.findLast(item => item.kind === 'heading')?.text || '',
      mixedSections: headings[headingIndex]?.start < end};
  });
}

// Only horizontal spacing inside Hangul is ignored. Do not join paragraphs,
// punctuation, URLs or arbitrary syllable order; this is not semantic search.
const compactHangul = value => String(value || '').normalize('NFKC').toLowerCase().replace(/(?<=[가-힣])[ \t]+(?=[가-힣])/gu, '');
export function rankWikiEvidence(documents, query) {
  const terms = searchTerms(query).slice(0, 24);
  if (!documents.length || !terms.length) return [];
  // Search derived Markdown text while retaining untouched source excerpts.
  const searchable = documents.map(document => ({...document, text: document.searchText ?? document.text}));
  const exact = rankEvidence(searchable, query);
  const korean = terms.filter(term => /^[가-힣]{2,}$/.test(term));
  const spacing = korean.length ? searchable.flatMap(document => {
    const fields = Object.fromEntries(['name', 'context', 'text'].map(key => [key, compactHangul(document[key])]));
    const matched = korean.filter(term => Object.values(fields).some(text => text.includes(term)));
    if (!matched.length) return [];
    const matchedFields = Object.keys(fields).filter(key => matched.some(term => fields[key].includes(term)));
    const score = matched.reduce((sum, term) => sum + (fields.text.includes(term) ? 4 : 0) + (fields.context.includes(term) ? 2 : 0) + (fields.name.includes(term) ? 1 : 0), 0);
    return [{id: document.id, score, match: {terms: matched, fields: matchedFields, coverage: matched.length / terms.length}}];
  }).sort((a, b) => b.match.coverage - a.match.coverage || b.score - a.score) : [];
  const merged = new Map();
  // Reciprocal rank fusion avoids comparing two unrelated score scales.
  for (const [method, hits] of [['lexical_terms', exact], ['hangul_spacing', spacing]]) {
    hits.forEach((hit, index) => {
      const current = merged.get(hit.id) || {id: hit.id, score: 0, match: {terms: [], fields: [], methods: []}};
      current.score += 1 / (60 + index + 1);
      current.match.terms = [...new Set([...current.match.terms, ...hit.match.terms])];
      current.match.fields = [...new Set([...current.match.fields, ...hit.match.fields])];
      current.match.methods.push(method);
      current.match.coverage = current.match.terms.length / terms.length;
      merged.set(hit.id, current);
    });
  }
  return [...merged.values()].sort((a, b) => b.match.coverage - a.match.coverage || b.score - a.score);
}

// Facts a run found for another Nubi (nubi-task-v1). The model reports each fact
// with the page it came from and the page's own words. The host keeps a fact as
// checked only when a page this run read, at that address, contains the quote.
export const REPORT_FACTS_TOOL = {type: 'function', function: {name: 'report_facts',
  description: 'Report the facts you found for the Nubi that requested this task, before your final answer. Give each fact the address of the page you read it on and the exact words from that page. Facts are checked against pages read in this run; an unmatched quote is sent as unchecked. Calling again replaces the earlier list.',
  parameters: {type: 'object', properties: {facts: {type: 'array', minItems: 1, maxItems: 50, items: {type: 'object', properties: {
    name: {type: 'string', minLength: 1, maxLength: 200, description: 'What the fact is, e.g. a requested item name.'},
    value: {type: 'string', minLength: 1, maxLength: 4000},
    source_url: {type: 'string', minLength: 1, maxLength: 2000, description: 'http(s) address of the page the fact was read on.'},
    quote: {type: 'string', minLength: 2, maxLength: 1000, description: 'Exact text from that page supporting the value.'}},
  required: ['name', 'value', 'source_url', 'quote'], additionalProperties: false}}}, required: ['facts'], additionalProperties: false}}};

// Markdown marks and spacing differ between a rendered page and a read of it,
// so both sides are compared without them.
const plain = value => String(value || '').normalize('NFC').replace(/[*_`#>|[\]()!\\\s]/g, '').toLowerCase();
const address = value => {try {const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null; url.hash = ''; return url.href.replace(/\/$/, '');} catch {return null;}};
const frameText = frame => [frame?.text, ...(Array.isArray(frame?.textSegments) ? frame.textSegments.map(segment => segment?.text) : []),
  ...(Array.isArray(frame?.tables) ? [JSON.stringify(frame.tables)] : [])].filter(value => typeof value === 'string').join('\n');

// Page reads kept by the run: live observations, text kept after leaving a page,
// and ranges of long page content.
export function readPages(evidence) {
  const pages = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const result = item?.result, page = Array.isArray(result?.observation?.frames) ? result.observation : result;
    if (typeof page?.url !== 'string') continue;
    const text = Array.isArray(page.frames) ? page.frames.map(frameText).join('\n')
      : page.dataKind === 'page_content' && Array.isArray(page.ranges) ? page.ranges.map(range => range?.markdown).filter(value => typeof value === 'string').join('\n') : '';
    const url = address(page.url);
    if (url && text.trim()) pages.push({url, title: typeof page.title === 'string' ? page.title.slice(0, 300) : '', text: plain(text)});
  }
  return pages;
}

export function checkReportedFacts(args, evidence) {
  const facts = args?.facts;
  if (!Array.isArray(facts) || !facts.length || facts.length > 50) return {error: 'tool_arguments_invalid'};
  const pages = readPages(evidence), checked = [];
  for (const fact of facts) {
    const text = (value, max, min = 1) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
    const url = address(fact?.source_url);
    if (!text(fact?.name, 200) || !text(fact.value, 4000) || !text(fact.quote, 1000, 2) || !url) return {error: 'tool_arguments_invalid'};
    const quote = plain(fact.quote), page = pages.find(item => item.url === url && item.text.includes(quote));
    checked.push({name: fact.name.trim(), value: fact.value.trim(), source_url: fact.source_url, quote: fact.quote.trim(), checked: !!page, ...(page?.title ? {title: page.title} : {})});
  }
  return {facts: checked};
}

// nubi-task-v1 result from a finished run. host_checked needs both the run's own
// final checks and every reported quote found on a page the run read.
export function delegationResult({content, facts = [], verified = false, runId, at = new Date().toISOString()}) {
  const urls = [...new Set(facts.map(fact => fact.source_url))];
  const evidence = urls.map((url, index) => ({id: `page-${index + 1}`, url, ...(facts.find(fact => fact.source_url === url && fact.title)?.title ? {title: facts.find(fact => fact.source_url === url && fact.title).title} : {}), capturedAt: at}));
  const summary = String(content || '').trim().slice(0, 8000) || '브라우저 실행이 끝났지만 답변 본문이 없습니다.';
  return {summary,
    facts: facts.slice(0, 50).map(fact => ({name: fact.name, value: fact.value, source_url: fact.source_url, quote: fact.quote, evidenceId: evidence[urls.indexOf(fact.source_url)].id})),
    evidence, verification: verified && facts.length > 0 && facts.every(fact => fact.checked) ? 'host_checked' : 'not_run', localRunId: String(runId).slice(0, 200)};
}

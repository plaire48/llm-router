// Binds links in an answer to the exact form that was observed. A model often
// writes the decoded spelling of a percent-encoded address; both name the same
// resource, but the written form then differs from every observed link. Only
// an address that decodes to exactly one observed address is rewritten. No
// link is invented, added or removed, and unmatched links stay as written.
const decoded = value => {
  let url; try {url = new URL(value);} catch {return null;}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const part = text => {try {return decodeURIComponent(text);} catch {return text;}};
  return `${url.origin}${part(url.pathname)}${part(url.search)}${part(url.hash)}`.normalize('NFC');
};
export function observedLinks(evidence, limit = 2000) {
  const found = new Set();
  const walk = (value, key, depth) => {
    if (found.size >= limit || depth > 8) return;
    if (typeof value === 'string') {if (['destination', 'url', 'href'].includes(key) && /^https?:\/\//i.test(value) && value.length <= 2000) found.add(value); return;}
    if (Array.isArray(value)) {for (const item of value) walk(item, key, depth + 1); return;}
    if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) walk(item, name, depth + 1);
  };
  for (const item of Array.isArray(evidence) ? evidence : []) if (item?.usable !== false) walk(item?.result, '', 0);
  return [...found];
}
export function canonicalizeLinks(text, links) {
  if (typeof text !== 'string' || !text || !Array.isArray(links) || !links.length) return text;
  const byKey = new Map();
  for (const link of links) {
    const key = decoded(link); if (!key) continue;
    byKey.set(key, byKey.has(key) && byKey.get(key) !== link ? null : link);
  }
  return text.replace(/https?:\/\/[^\s<>"'`\]]+/gi, written => {
    // Markdown and prose end a link with punctuation that is not part of it.
    let end = written.length;
    while (end > 0 && /[.,;:!?)]/.test(written[end - 1]) && !(written[end - 1] === ')' && written.slice(0, end).split('(').length > written.slice(0, end).split(')').length - 1 + 1)) end--;
    const url = written.slice(0, end), observed = byKey.get(decoded(url) || '');
    return observed && observed !== url ? observed + written.slice(end) : written;
  });
}

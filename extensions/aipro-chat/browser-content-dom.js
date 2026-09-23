import {Readability} from '@mozilla/readability';
import TurndownService from 'turndown';
import {tables, strikethrough} from 'turndown-plugin-gfm';
import {isSensitiveElement} from './browser-dom.js';

// Bundled inside a static isolated-world function. Nothing from the model is
// evaluated, rendered, fetched or written to the live document.
export function collectPageContent() {
  const source = document.body;
  if (!source) return {error: 'browser_stale'};
  if (source.matches('[hidden],[inert],[aria-hidden="true"]') || getComputedStyle(source).display === 'none' || ['hidden', 'collapse'].includes(getComputedStyle(source).visibility)) return {error: 'page_content_empty', instruction: 'The document body is hidden. Inspect the current page state before reading again.'};
  const nodes = [...source.querySelectorAll('*')];
  if (nodes.length > 30000 || source.textContent.length > 2000000) return {error: 'page_content_limit',
    instruction: 'This document exceeds the reading budget. Use a focused browser_snapshot query or inspect a smaller frame/section.'};
  const clone = document.cloneNode(true), copies = [...clone.body.querySelectorAll('*')];
  const mainIndex = nodes.indexOf(source.querySelector('main,[role="main"]'));
  const declaredMain = mainIndex >= 0 ? copies[mainIndex] : null;
  let omitted = 0, shadowRoots = 0, embeddedFrames = 0;
  const remove = 'script,style,noscript,template,link,meta,base,input,textarea,select,button,iframe,frame,object,embed,canvas,svg,nav,aside,footer,[role="navigation"],[role="complementary"],[role="banner"],[role="contentinfo"],[contenteditable]:not([contenteditable="false"])';
  const safeLink = href => {
    try {const url = new URL(href, document.baseURI); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin + url.pathname : null;} catch {return null;}
  };
  for (const [index, node] of nodes.entries()) {
    const copy = copies[index];
    shadowRoots += node.shadowRoot ? 1 : 0;
    embeddedFrames += node.matches('iframe,frame') ? 1 : 0;
    if (!clone.body.contains(copy)) continue;
    const style = getComputedStyle(node), details = node.closest('details:not([open])');
    if (node.matches(remove) || isSensitiveElement(node, node.getAttribute('aria-label') || '') || node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
        details && node !== details && !details.querySelector(':scope > summary')?.contains(node)) {
      copy.remove(); omitted++; continue;
    }
    // Images are represented by alt text only. No URL or metadata can trigger
    // loading, and the article reader never pretends to have inspected pixels.
    if (node.matches('img')) {copy.replaceWith(clone.createTextNode(node.alt ? `[Image: ${node.alt.slice(0, 200)}]` : '')); continue;}
    const href = node.matches('a[href]') ? safeLink(node.getAttribute('href')) : null;
    const allowed = new Set(['colspan', 'rowspan']);
    for (const attr of [...copy.attributes]) if (!allowed.has(attr.name)) copy.removeAttribute(attr.name);
    if (href) copy.setAttribute('href', href);
  }
  clone.head.replaceChildren();
  const title = clone.createElement('title'); title.textContent = document.title; clone.head.append(title);
  const main = declaredMain && clone.body.contains(declaredMain) ? declaredMain : null;
  // Prefer the actual semantic main area. Readability selects article content
  // when no main landmark exists; a fallback never claims complete coverage.
  let content = main || clone.body, method = main ? 'main_landmark' : 'visible_body';
  if (!main) {
    try {
      const article = new Readability(clone.cloneNode(true), {charThreshold: 200, maxElemsToParse: 30000, disableJSONLD: true}).parse();
      if (article?.textContent?.trim().length >= 200) {content = article.content; method = 'readability';}
    } catch { /* Keep the bounded visible-document fallback. */ }
  }
  const markdown = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', preformattedCode: true});
  markdown.use([tables, strikethrough]);
  // GFM's fallback keeps complex tables as HTML. Never return raw page HTML;
  // the screen snapshot has explicit spans and cells for those tables.
  markdown.addRule('complexTables', {filter: node => node.nodeName === 'TABLE' && (!!node.querySelector('[rowspan],[colspan]') || !node.rows[0]?.querySelector('th')),
    replacement: (_text, node) => '\n\n' + [...node.rows].map(row => [...row.cells].map(cell => cell.textContent.trim()).join(' | ')).join('\n') + '\n\n[Table spans require browser_snapshot]\n\n'});
  const text = markdown.turndown(content).trim();
  if (!text) return {error: 'page_content_empty', instruction: 'No readable document body was found. Inspect browser_snapshot or a screenshot for forms, canvas, embedded frames or loading state.'};
  return {text, title: document.title.slice(0, 180), url: location.href, method,
    coverage: {partial: true, omittedSubtrees: omitted, shadowRoots, embeddedFrames, inputValues: 'omitted',
      scope: 'Selected rendered document text only. Navigation, editors, hidden/collapsed content, frame and shadow contents, image pixels and unloaded/virtual content are excluded. Use browser_snapshot/capture_page for controls, layout and missing scopes.'}};
}

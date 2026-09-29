import {tableMarkdown} from './browser-table-grid.js';
import {paginationView} from './browser-pagination.js';
import {publicSourceURL} from './browser-public-url.js';
import {Readability} from '@mozilla/readability';
import TurndownService from 'turndown';
import {tables, strikethrough} from 'turndown-plugin-gfm';
import {isSensitiveElement} from './browser-dom.js';

// Bundled inside a static isolated-world function. Nothing from the model is
// evaluated, rendered, fetched or written to the live document.
export function collectPageContent() {
  const pdfUnavailable = () => ({error: 'page_content_pdf_unavailable', format: 'pdf', retryable: false,
    instruction: 'The observed document is a PDF viewer, whose text is not exposed by this DOM reader. Repeating this content read will not parse the PDF. Use a screenshot only for the visible page and state that scope, or return to an observed HTML source/search summary if the original request allows it. Do not invent PDF contents, claim all pages were read, or weaken a requirement to read the original PDF.'});
  if (document.contentType === 'application/pdf') return pdfUnavailable();
  const source = document.body;
  if (!source) return {error: 'browser_stale'};
  if (source.matches('[hidden],[inert],[aria-hidden="true"]') || getComputedStyle(source).display === 'none' || ['hidden', 'collapse'].includes(getComputedStyle(source).visibility)) return {error: 'page_content_empty', instruction: 'The document body is hidden. Inspect the current page state before reading again.'};
  const nodes = [...source.querySelectorAll('*')];
  const limit = () => ({error: 'page_content_limit',
    instruction: 'This document exceeds the reading budget. Use a focused browser_snapshot query or inspect a smaller frame/section.'});
  if (nodes.length > 30000) return limit();
  // Construct a sanitized detached document without deep-cloning scripts,
  // styles or hidden application state. Their size is not readable content.
  const clone = document.implementation.createHTMLDocument(document.title.slice(0, 180));
  const copies = new Map([[source, clone.body]]);
  const sourceMain = source.querySelector('main,[role="main"]');
  let declaredMain = null, characters = 0;
  let omitted = 0, shadowRoots = 0, embeddedFrames = 0;
  const remove = 'script,style,noscript,template,link,meta,base,input,textarea,select,button,iframe,frame,object,embed,canvas,svg,nav,aside,footer,[role="navigation"],[role="complementary"],[role="banner"],[role="contentinfo"],[contenteditable]:not([contenteditable="false"])';
  const safeLink = href => publicSourceURL(href, document.baseURI);
  const walker = document.createTreeWalker(source, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      shadowRoots += node.shadowRoot ? 1 : 0;
      embeddedFrames += node.matches('iframe,frame') ? 1 : 0;
      const style = getComputedStyle(node), details = node.closest('details:not([open])');
      if (node.matches(remove) || isSensitiveElement(node, node.getAttribute('aria-label') || '') || node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          details && node !== details && !details.querySelector(':scope > summary')?.contains(node)) {
        omitted++; return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = copies.get(node.parentNode);
    if (!parent) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      characters += node.data.length;
      if (characters > 2000000) return limit();
      parent.append(clone.createTextNode(node.data));
      continue;
    }
    // Alt text does not establish that pixels were inspected.
    if (node.matches('img')) {
      const text = node.alt ? `[Image: ${node.alt.slice(0, 200)}]` : '';
      characters += text.length;
      if (characters > 2000000) return limit();
      parent.append(clone.createTextNode(text));
      continue;
    }
    const copy = clone.createElement(node.localName);
    const href = node.matches('a[href]') ? safeLink(node.getAttribute('href')) : null;
    for (const name of ['colspan', 'rowspan']) if (node.hasAttribute(name)) copy.setAttribute(name, node.getAttribute(name));
    if (href) copy.setAttribute('href', href);
    parent.append(copy); copies.set(node, copy);
    if (node === sourceMain) declaredMain = copy;
  }
  const main = declaredMain && clone.body.contains(declaredMain) ? declaredMain : null;
  // Prefer the actual semantic main area. Readability selects article content
  // when no main landmark exists; a fallback never claims complete coverage.
  let content = main || clone.body, method = main ? 'main_landmark' : 'visible_body';
  if (!main) {
    try {
      const article = new Readability(clone.cloneNode(true), {charThreshold: 200, maxElemsToParse: 30000, disableJSONLD: true}).parse();
      // Readability looks for one article. On an information page it can take
      // a note box and drop the tables that hold the answer. Measured on a
      // library's weekly-hours page: it kept 267 of about 2,400 characters and
      // none of the seven timetables. When it keeps less than half of the
      // visible text and leaves out a data table, the smallest region that
      // holds every data table is read too, so that menus around it do not fill
      // the first window. What reading mode chose is never dropped: a region
      // that already contains it is read alone, otherwise both are read.
      const flat = value => String(value || '').replace(/\s+/g, ' ').trim();
      const dataTables = [...clone.body.querySelectorAll('table')].filter(table => table.rows.length >= 2 && flat(table.textContent).length >= 20);
      const keptTables = (String(article?.content || '').match(/<table\b/gi) || []).length;
      const chosen = flat(article?.textContent);
      const droppedAnswer = dataTables.length > keptTables && chosen.length < flat(clone.body.textContent).length / 2;
      let region = droppedAnswer ? dataTables[0].parentElement : null;
      while (region && region !== clone.body && !dataTables.every(table => region.contains(table))) region = region.parentElement;
      if (droppedAnswer && region) {
        const inside = !chosen || flat(region.textContent).includes(chosen.slice(0, 120));
        if (inside && region !== clone.body) content = region;
        else {
          content = clone.createElement('div');
          if (chosen.length >= 200) content.innerHTML = article.content;
          content.append(region.cloneNode(true));
        }
        method = 'table_region';
      } else if (chosen.length >= 200) {content = article.content; method = 'readability';}
    } catch { /* Keep the bounded visible-document fallback. */ }
  }
  const markdown = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', preformattedCode: true});
  markdown.use([tables, strikethrough]);
  // Preserve merged column/row associations instead of flattening each DOM row.
  // This runs on the sanitized clone, never on editable or hidden source values.
  markdown.addRule('complexTables', {filter: node => node.nodeName === 'TABLE' && (!!node.querySelector('[rowspan],[colspan]') || !node.rows[0]?.querySelector('th')),
    replacement: (_text, node) => '\n\n' + tableMarkdown(node) + '\n\n'});
  const text = markdown.turndown(content).trim();
  if (!text) {
    const visiblePdf = [...source.querySelectorAll('embed[type="application/pdf"],object[type="application/pdf"]')].some(node => {
      const style = getComputedStyle(node);
      return !node.closest('[hidden],[inert],[aria-hidden="true"]') && node.getClientRects().length > 0 &&
        style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility);
    });
    if (visiblePdf) return pdfUnavailable();
    return {error: 'page_content_empty', instruction: 'No readable document body was found. Inspect browser_snapshot or a screenshot for forms, canvas, embedded frames or loading state.'};
  }
  // Counts only. Reading mode drops navigation and lists of controls, so a
  // document index can come back as a short text without its links.
  const links = {inDocument: document.querySelectorAll('a[href]').length, inText: (text.match(/\]\(https?:/g) || []).length};
  return {text, links, title: document.title.slice(0, 180), url: location.href, method, page_view: paginationView(nodes),
    coverage: {partial: true, omittedSubtrees: omitted, shadowRoots, embeddedFrames, inputValues: 'omitted',
      scope: 'Selected rendered document text only. Navigation, editors, hidden/collapsed content, frame and shadow contents, image pixels and unloaded/virtual content are excluded. Use browser_snapshot/capture_page for controls, layout and missing scopes.'}};
}

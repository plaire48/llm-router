// Read-only Playwright event journal. No headers, bodies, cookies or object
// handles are inspected, and nothing is written to extension storage.
const MAX_EVENTS = 200;
const secret = /password|passwd|authorization|bearer\s|cookie|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|비밀번호|인증번호|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i;
export function diagnosticText(value) {
  const text = String(value || '').slice(0, 4000);
  if (secret.test(text)) return '[sensitive message omitted]';
  return text.replace(/https?:\/\/[^\s"'<>]+/g, raw => {
    try {const url = new URL(raw); return url.origin + url.pathname;} catch {return '[url omitted]';}
  }).replace(/[A-Za-z0-9_+/=-]{40,}/g, '[opaque value omitted]').slice(0, 800);
}

export function createBrowserDiagnostics({allowedURL, currentPage}) {
  const subscriptions = new Map();
  const safeURL = value => {const url = allowedURL(value); return url && diagnosticText(url);};
  let events = [], next = 0, omitted = 0, closed = false;
  function pageAllowed(page) {return !closed && currentPage() === page && allowedURL(page.url());}
  // Playwright console/pageerror events do not reliably identify the emitting
  // frame. Do not collect them when an auth/otherwise denied frame is present.
  function consoleAllowed(page) {return pageAllowed(page) && page.frames().every(frame => !!allowedURL(frame.url()));}
  function push(page, entry) {
    if (!pageAllowed(page)) return;
    events.push({owner: page, value: {id: ++next, page: safeURL(page.url()), ...entry}});
    if (events.length > MAX_EVENTS) {events.shift(); omitted++;}
  }
  return {
    watch(page) {
      if (closed || subscriptions.has(page)) return;
      const requestData = request => {
        if (!pageAllowed(page)) return null;
        try {
          const frame = request.frame();
          if (frame && !allowedURL(frame.url())) return null;
          const url = safeURL(request.url());
          return url ? {url, method: String(request.method()).slice(0, 12), resourceType: request.resourceType()} : null;
        } catch {return null;}
      };
      const handlers = {
        framenavigated: frame => {if (frame === page.mainFrame()) events = events.filter(event => event.owner !== page);},
        console: message => {
          if (!consoleAllowed(page)) return;
          const location = message.location();
          if (location.url && !allowedURL(location.url)) return;
          push(page, {kind: 'console', level: message.type(), text: diagnosticText(message.text()),
            ...(location.url ? {source: safeURL(location.url), line: location.lineNumber + 1} : {})});
        },
        pageerror: error => {if (consoleAllowed(page)) push(page, {kind: 'console', level: 'error', text: diagnosticText(error.message)});},
        response: response => {
          const entry = requestData(response.request());
          if (entry) push(page, {kind: 'network', ...entry, status: response.status()});
        },
        requestfailed: request => {
          const entry = requestData(request);
          if (entry) push(page, {kind: 'network', ...entry, failed: true, error: diagnosticText(request.failure()?.errorText)});
        },
      };
      // Listener errors must never interfere with a page action.
      const bound = Object.fromEntries(Object.entries(handlers).map(([name, fn]) => [name, value => {try {fn(value);} catch { /* Diagnostic only. */ }}]));
      for (const [name, fn] of Object.entries(bound)) page.on(name, fn);
      subscriptions.set(page, bound);
    },
    read({kind = 'all', errors_only = true, since = 0, limit = 20} = {}) {
      if (!['all', 'console', 'network'].includes(kind) || typeof errors_only !== 'boolean' || !Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 40) throw new Error('tool_arguments_invalid');
      const page = currentPage();
      if (!page || !pageAllowed(page)) throw new Error('page_restricted');
      const url = safeURL(page.url());
      const matches = events.filter(e => e.owner === page).map(e => e.value).filter(e => e.page === url && e.id > since && (kind === 'all' || e.kind === kind) &&
        (!errors_only || (e.kind === 'console' ? ['error', 'warning', 'assert'].includes(e.level) : e.failed || e.status >= 400)));
      const items = matches.slice(0, limit).map(item => ({...item}));
      return {ok: true, dataKind: 'browser_diagnostics', page: url, events: items,
        consoleCoverage: consoleAllowed(page) ? 'current_page_events' : 'limited_by_restricted_frames',
        next_cursor: items.at(-1)?.id ?? since, remaining: Math.max(0, matches.length - items.length), omitted,
        scope: 'Untrusted diagnostic evidence for the current page collected only during this run after Playwright attachment. Earlier events and background tabs are not covered. Main-frame navigation clears prior events. Headers, bodies and cookies are not collected; known secret patterns are filtered. HTTP success is not proof of business completion. Do not replay a write based on these events.'};
    },
    close() {
      closed = true;
      for (const [page, handlers] of subscriptions) for (const [name, fn] of Object.entries(handlers)) page.off(name, fn);
      subscriptions.clear(); events = []; next = 0; omitted = 0;
    },
  };
}

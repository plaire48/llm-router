import {useEffect, useRef} from 'react';

// Keep links in the trusted app (including portal dialogs) on the same web-tab
// route as login. Remote WebContentsView pages have their own native handler.
export function useWorkspacePageLinks(openPage, onError) {
  const callbacks = useRef({openPage, onError});
  callbacks.current = {openPage, onError};
  useEffect(() => {
    function open(event) {
      if (event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      let url;
      try { url = new URL(href, document.baseURI); } catch { return; }
      if (!['https:', 'http:'].includes(url.protocol)) return;
      // Relative app navigation belongs to the app, not the web pane.
      if (url.origin === location.origin && !/^(https?:)?\/\//i.test(href)) return;
      event.preventDefault();
      // Do not fall back to window.open if the internal page route fails.
      void Promise.resolve().then(() => callbacks.current.openPage(url.href)).catch(() => callbacks.current.onError());
    }
    document.addEventListener('click', open);
    document.addEventListener('auxclick', open);
    return () => {
      document.removeEventListener('click', open);
      document.removeEventListener('auxclick', open);
    };
  }, []);
}

// Display-only redaction shared by host and serialized DOM readers. This does
// not authorize navigation or replace exact resource/document verification.
export function publicSourceURL(value, base) {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const clean = new URL(url.origin + url.pathname), host = url.hostname.toLowerCase();
    const keys = /(^|\.)youtube\.com$/.test(host) && url.pathname === '/watch' ? {v: /^[A-Za-z0-9_-]{11}$/} :
      /(^|\.)news\.naver\.com$/.test(host) ? {oid: /^\d{3}$/, aid: /^\d{10}$/} :
      host === 'news.kbs.co.kr' ? {ncd: /^\d{1,12}$/} :
      ['daejonilbo.com','www.daejonilbo.com'].includes(host) && url.pathname === '/news/articleView.html' ? {idxno: /^\d{1,12}$/} :
      host === 'korean.visitkorea.or.kr' && url.pathname === '/detail/ms_detail.do' ?
        {cotid: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i} : {};
    for (const [key, valid] of Object.entries(keys)) {
      const values = url.searchParams.getAll(key);
      if (values.length === 1 && valid.test(values[0])) clean.searchParams.set(key, values[0]);
    }
    return clean.href;
  } catch {return null;}
}

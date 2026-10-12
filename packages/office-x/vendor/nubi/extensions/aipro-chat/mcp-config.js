// Connection validation is shared by the trusted settings UI and service worker.
const forbidden = /^(?:host|cookie2?|origin|referer|user-agent|connection|content-length|content-type|accept|accept-encoding|transfer-encoding|upgrade|trailer|te|date|expect|via|authorization-proxy|mcp-session-id|mcp-protocol-version|last-event-id|sec-.*|proxy-.*|access-control-.*)$/i;
export function mcpConfig(value) {
  let url;
  try {url = new URL(value?.url);} catch {throw new Error('mcp_address');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.href.length > 2000) throw new Error('mcp_address');
  const name = String(value?.name || '').trim();
  if (!name || name.length > 80) throw new Error('mcp_config');
  const rows = value.headers || [];
  if (!Array.isArray(rows) || rows.length > 12) throw new Error('mcp_headers');
  const names = new Set();
  const headers = rows.filter(row => row.name || row.value).map(row => {
    const key = String(row.name || '').trim().toLowerCase(), val = String(row.value || '');
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || forbidden.test(key) || names.has(key) || !val || /[^\t\x20-\x7e\x80-\xff]/.test(val) || val.length > 4096) throw new Error('mcp_headers');
    names.add(key); return {name: key, value: val};
  });
  return {name, url: url.href, headers};
}
export function mcpPermission(url) {const parsed = new URL(url); return `${parsed.protocol}//${parsed.hostname}/*`;}
export function mcpSummary(record) {return {id:record.id, name:record.name, url:record.url, tools:record.tools.length, headerNames:record.headers.map(item => item.name)};}
export const MCP_ERRORS = {
  mcp_address:'HTTP 또는 HTTPS 서버 주소를 입력해 주세요. 인증값은 헤더에 넣어 주세요.',
  mcp_config:'연결 이름을 입력해 주세요.', mcp_headers:'헤더 이름과 값을 확인해 주세요. 중복되거나 브라우저가 관리하는 헤더는 사용할 수 없습니다.',
  mcp_permission:'서버 접근을 허용해 주세요.', mcp_connect:'연결하지 못했습니다. 서버 주소와 인증 헤더를 확인해 주세요.',
  mcp_changed:'연결이나 도구가 바뀌었습니다. 다시 확인해 주세요.', mcp_response:'서버 응답을 읽지 못했습니다.',
  mcp_unknown:'실행 결과를 확인하지 못했습니다. 서버에서 결과를 확인한 뒤 다시 시도해 주세요.',
  mcp_arguments:'도구에 보낼 내용을 확인해 주세요.', mcp_limit:'도구 목록이 너무 큽니다. 서버의 도구 범위를 줄여 주세요.',
};

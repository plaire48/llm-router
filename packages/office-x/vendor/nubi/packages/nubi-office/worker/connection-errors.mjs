import {A2A_ERRORS} from '../../nubi-a2a/contract.mjs';
// Only stable codes leave the worker. Never expose URLs, headers or raw bodies.
export const connectionErrors = {
  tool_loop_detected: '문서 상태가 바뀌지 않은 채 같은 도구 호출이 반복되어 다음 동작을 다시 확인합니다. (tool_loop_detected)',
  aipro_login_failed: 'AI Pro 로그인을 완료하지 못했습니다. 새 로그인을 시작해 주세요. (aipro_login_failed)',
  login_browser_failed: '로그인용 브라우저를 열지 못했습니다. Windows 기본 브라우저 설정을 확인해 주세요. (login_browser_failed)',
  tls_untrusted: '서버 인증서를 신뢰하지 못했습니다. 회사 인증서가 Windows에 등록되어 있는지 확인해 주세요. (tls_untrusted)',
  tls_expired: '서버 인증서가 만료됐습니다. PC의 날짜와 서버 인증서를 확인해 주세요. (tls_expired)',
  tls_hostname: '서버 주소와 인증서의 주소가 다릅니다. 연결 주소를 확인해 주세요. (tls_hostname)',
  network_dns: '서버 주소를 찾지 못했습니다. 회사망, VPN 연결과 서버 주소를 확인해 주세요. (network_dns)',
  network_refused: '서버가 연결을 받지 않습니다. 서버 실행 상태와 주소, 포트를 확인해 주세요. (network_refused)',
  network_timeout: '서버 연결 시간이 초과됐습니다. 회사망, VPN, 프록시 연결 상태를 확인해 주세요. (network_timeout)',
  network_error: '서버와의 연결이 끊겼습니다. 네트워크 연결 상태를 확인해 주세요. (network_error)',
  response_json_invalid: '서버에서 모델 응답 대신 읽을 수 없는 응답을 받았습니다. 연결 주소, 로그인, 프록시 설정을 확인해 주세요. (response_json_invalid)',
  recovery_no_progress: '작업 결과가 바뀌지 않아 자동 재시도를 멈췄습니다. 진행 기록의 원인을 확인해 주세요. (recovery_no_progress)'
};
export function safeError(error) {
  if(Object.hasOwn(A2A_ERRORS,error?.message))return error.message;
  let current = error;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    const code = current.code;
    if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','CERT_UNTRUSTED'].includes(code)) return 'tls_untrusted';
    if (['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID'].includes(code)) return 'tls_expired';
    if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'tls_hostname';
    if (['ENOTFOUND','EAI_AGAIN'].includes(code)) return 'network_dns';
    if (code === 'ECONNREFUSED') return 'network_refused';
    if (['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)) return 'network_timeout';
    if (['ECONNRESET','EPIPE','UND_ERR_SOCKET'].includes(code)) return 'network_error';
    // Some Windows failures arrive inside AggregateError from address attempts.
    if (Array.isArray(current.errors)) {
      const mapped = current.errors.slice(0, 8).map(e => safeError({code:e?.code})).find(c => c !== 'request_failed');
      if (mapped) return mapped;
    }
  }
  if (error?.name === 'SyntaxError') return 'response_json_invalid';
  if (error?.name === 'TimeoutError') return 'network_timeout';
  if (error?.message === 'fetch failed') return 'network_error';
  const code = String(error?.message || error || 'request_failed');
  return /^[a-z][a-z0-9_]{1,60}$/.test(code) ? code : 'request_failed';
}

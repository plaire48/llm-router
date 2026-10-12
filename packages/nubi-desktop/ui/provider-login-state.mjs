const reasons={
  claude_login_failed:'Claude 로그인을 마치지 못했어요. 다시 연결해 주세요.',
  claude_login_required:'Claude 인증을 확인하지 못했어요. 다시 로그인해 주세요.',
  claude_cli_timeout:'Claude 로그인 시간이 초과됐어요. 다시 연결해 주세요.',
  browser_unavailable:'로그인 페이지를 열지 못했어요. 다시 연결해 주세요.',
  tls_untrusted:'회사 인증서를 확인하지 못했어요. Windows의 회사 인증서 등록 상태를 확인해 주세요.',
  tls_expired:'인증서 유효기간을 확인해 주세요. PC 날짜와 서버 인증서가 맞아야 합니다.',
  tls_hostname:'서버 주소와 인증서가 다릅니다. 연결 주소를 확인해 주세요.',
  network_dns:'회사 서버 주소를 찾지 못했어요. 사내망이나 VPN을 확인해 주세요.',
  network_timeout:'회사 서버 응답이 늦어 연결을 마치지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
  network_error:'회사 서버와 연결이 끊겼어요. 사내망이나 VPN을 확인해 주세요.',
  network_refused:'회사 서버에 연결하지 못했어요. 연결 상태를 확인해 주세요.',
  unauthorized:'인증이 만료됐거나 거부됐어요. 새 로그인을 시작해 주세요.',
  forbidden:'이 계정의 AI Pro 접근 권한을 확인해 주세요.',
  models_invalid:'사용할 모델 목록을 확인하지 못했어요. 계정의 모델 권한을 확인해 주세요.',
  login_timeout:'로그인 응답이 도착하지 않았어요. 새 로그인을 시작해 주세요.',
  login_browser_failed:'오른쪽 브라우저에서 로그인 페이지를 열지 못했어요. 다시 연결해 주세요.',
  login_port_busy:'다른 앱이 로그인 응답을 기다리고 있어요. 진행 중인 GPT 로그인을 마친 뒤 다시 연결해 주세요.',
  system_ca_unavailable:'앱의 인증서 연결을 준비하지 못했어요. 지원되는 실행본을 사용해 주세요.',
};
const phases={waiting:'로그인 대기',callback_received:'로그인 응답 수신',exchanging:'인증 확인',loading_models:'모델 목록 조회',ready:'연결 완료',failed:'연결 실패'};
export function providerLoginDiagnostics(state){
  const rows=state?.loginDiagnostics||[],first=rows.find(item=>Number.isFinite(item.at))?.at;
  return rows.map(item=>{const elapsed=Number.isFinite(item.elapsedMs)?item.elapsedMs:Number.isFinite(item.at)&&Number.isFinite(first)?Math.max(0,item.at-first):null;
    return `${elapsed===null?'':`${Math.floor(elapsed/1000)}초 `}${phases[item.phase]||'연결 확인'}${item.status?` HTTP ${item.status}`:''}${item.error?` (${item.error})`:''}`;
  }).join('\n');
}
export function providerLoginError(state){
  if(state?.persistenceError==='connection_not_removed')return '로그아웃했지만 보관한 인증을 지우지 못했어요. 다시 시도해 주세요.';
  if(state?.persistenceError)return '로그인은 완료됐지만 안전하게 보관하지 못했어요. 앱을 다시 열면 로그인이 필요합니다.';
  if(!state?.loginError)return null;
  const stage=state.loginDiagnostics?.findLast(item=>item.phase==='failed')?.failedStage;
  const prefix=stage==='loading_models'?'모델 목록 조회 실패. ':stage==='exchanging'?'인증 확인 실패. ':'';
  return prefix+(reasons[state.loginError]||'연결을 완료하지 못했어요. 새 로그인을 시작해 주세요.');
}

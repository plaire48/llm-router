// Fixed diagnostics only. Server replies may contain account or message data.
const listing='로그인은 완료됐어요. 메일 목록을 읽는 단계에서 멈췄어요.';
export const mailConnectionErrors={
  mail_auth_failed:{title:'서버가 로그인을 거절했어요',detail:'연결은 됐지만 메일 서버가 인증을 허용하지 않았어요.'},
  mail_tls_untrusted:{title:'메일 서버 인증서를 신뢰하지 못해요',detail:'Windows의 사내 인증서 설치 상태를 확인해 주세요.'},
  mail_tls_hostname:{title:'인증서의 서버 주소가 달라요',detail:'메일 관리자에게 서버 인증서의 주소 확인을 요청해 주세요.'},
  mail_tls_expired:{title:'서버 인증서의 유효기간을 확인해 주세요',detail:'PC 날짜가 맞으면 메일 관리자에게 인증서 확인을 요청해 주세요.'},
  mail_tls_unavailable:{title:'Windows 인증서를 불러오지 못했어요',detail:'앱을 다시 시작해 주세요. 계속되면 아래 오류 코드를 알려주세요.'},
  mail_tls_error:{title:'보안 연결을 완료하지 못했어요',detail:'TLS 연결이 실패했어요. 인증서 검증은 유지됩니다.'},
  mail_dns_failed:{title:'메일 서버 주소를 찾지 못했어요',detail:'회사망 연결과 DNS 설정을 확인해 주세요.'},
  mail_connection_refused:{title:'메일 서버가 연결을 거절했어요',detail:'회사망에서 서버의 995 포트 연결을 확인해 주세요.'},
  mail_connection_failed:{title:'메일 서버 연결이 끊겼어요',detail:'다시 연결해 주세요. 계속되면 아래 오류 코드를 알려주세요.'},
  mail_timeout:{title:'메일 서버 응답이 늦어지고 있어요',detail:'잠시 후 다시 연결해 주세요.'},
  mail_protocol:{title:'서버 응답을 읽지 못했어요',detail:'POP3 응답 형식을 처리하지 못했어요. 아래 오류 코드를 알려주세요.'},
  mail_listing_failed:{title:'서버가 메일 목록 요청을 거절했어요',detail:'로그인은 완료됐어요. 서버가 UIDL 요청을 거절했어요.'},
  mail_uidl_invalid:{title:'메일 목록을 읽지 못했어요',detail:listing},
  mail_uidl_format:{title:'메일 목록을 해석하지 못했어요',detail:'로그인은 완료됐어요. 서버 응답 형식이 맞지 않아 목록을 읽지 못했어요. 오류 코드를 알려주세요.'},
  mail_uidl_id_length:{title:'메일 식별자가 지원 범위를 넘었어요',detail:listing},
  mail_uidl_characters:{title:'메일 목록에 지원하지 않는 문자가 있어요',detail:listing},
  mail_uidl_number_conflict:{title:'메일 목록의 번호가 중복됐어요',detail:listing},
  mail_retrieval_failed:{title:'서버가 메일 본문 요청을 거절했어요',detail:'로그인과 목록 조회는 완료됐어요. 본문을 받는 단계에서 멈췄어요.'},
};
export function mailConnectionDiagnostic(code){
  return Object.hasOwn(mailConnectionErrors,code)?`누비 Workspace Beta\nPOP3 / pop3.samsung.net:995 / SSL/TLS\n${code}`:null;
}

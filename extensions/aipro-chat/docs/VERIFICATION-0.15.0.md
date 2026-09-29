# 0.15.0 디버거 없는 AI Pro 로그인

검증일: 2026-09-21

AI Pro 로그인에 남아 있던 debugger/Network/Fetch 수신기와 네트워크 본문 진단을 제거했다. 이전의 별도 실험 확장에만 있던 리디렉션 방식을 실제 설치본에 연결했다. `/auth/vscode/login?port=...`와 `/auth/exchange`의 요청 형식은 유지한다.

로그인 전에 DNR 세션 규칙을 만들고 해당 탭과 포트의 최상위 `GET /auth`만 확장 콜백 문서로 전환한다. `localhost`, `127.0.0.1`, IPv6 loopback을 지원한다. 문서는 주소에서 인증 코드를 즉시 지우며, worker가 문서/탭/frame/nonce/만료를 확인한 뒤 코드 교환을 한 번 실행한다. 대기 중 worker 재시작은 견디고, 교환 중 재시작은 코드를 재전송하지 않는다. 성공/취소/실패/만료/탭 닫힘 후 규칙과 탭을 정리한다. 실패 시 debugger로 우회하지 않는다.

콜백 대기 화면은 기존 앱의 CX 스타일, 로컬 Noto Sans KR과 HTML 기준의 옅은 배경을 공유한다. 누비 아이콘과 한 줄만 표시하며 360px/1100px, 모션 감소를 확인했다. 메인 채팅 UI는 변경하지 않았다.

## 검증

- 단위 테스트 190개 통과. 출처/nonce/frame/만료, 중복 콜백, 늦은 교환 결과, 대기/교환 중 worker 재시작, 구버전 정리와 ChatGPT 수신기를 포함한다.
- `tests/login-redirect-browser.mjs`: 실제 배포 코드로 8개 흐름 통과. 격리 복사본에서 debugger API를 호출하면 실패하도록 만들었다. HTTP 302, JavaScript 이동, GET form, EP SSO 문서 경유, IPv6, worker 종료 후 재시작, 중복/다른 탭 거부, 교환 취소/실패/재시도를 확인했다. 디버거 호출 0회, 콜백 포트의 실제 수신 서버 요청 0건, 모델 10개 조회를 확인했다.
- `tests/browser.mjs`: 31개 흐름 통과. 모델 목록, 전송/스트리밍/사용량, 초안/이력, 로그인 실패 복구를 포함한다. 구버전 header/body XHR 콜백 테스트는 현행 GET code 계약으로 교체했다.
- `tests/provider-switch-browser.mjs`: 제공자 연결/전환/취소/실패/로그아웃/초안 격리 7개 흐름 통과.
- `tests/chatgpt-browser.mjs`: PKCE 로그인, 갱신, 채팅, 페이지 도구와 잘못된 state 거부 7개 흐름 통과.
- `tests/browser-agent-browser.mjs`: 페이지 읽기, 입력/클릭/이동, iframe/Shadow DOM, 메일 초안, Playwright 오류 수정과 중지, Qwen 이미지/좌표 입력을 포함한 14개 흐름 통과. 자동화 완료 후 debugger 연결 해제도 확인했다.
- `npm run design:check`, `npm run build` 통과. 기존 번들 크기 안내 외 빌드 오류 없음.

## 범위

브라우저 테스트는 격리 Chrome과 합성 SSO/교환/모델 응답을 사용했다. 실제 회사망 AI Pro SSO는 확인하지 않았다. 회사 브라우저 정책, 실제 SSO의 추가 도메인/팝업 이동은 현장 확인이 필요하다.

AI Pro 로그인은 debugger를 사용하지 않는다. ChatGPT 로그인과 브라우저 자동화는 기존 debugger 경로를 유지하므로 확장 권한에서 debugger를 제거하지 않았다. 이번 변경은 디버깅 표시줄을 숨기는 설정이 아니라 AI Pro 로그인에서 debugger 연결 자체를 제거하는 변경이다. 헤더/본문 기반 fetch/XHR 콜백은 현행 AI Pro 인증 경로에 포함되지 않는다.

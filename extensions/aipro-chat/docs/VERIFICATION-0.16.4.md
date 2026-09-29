# 0.16.4 디버깅 연결 범위와 종료 처리

검증일: 2026-09-21

## 변경

- 기본 Agent의 `read_page`, `inspect_dom`, `browser_snapshot`, `list_tabs`가 Playwright를 시작하지 않는다. 정적 ISOLATED observer와 Chrome tabs API로 필요한 페이지를 읽는다. iframe과 열린 Shadow DOM 관찰, 입력값/인증 정보 제외를 유지한다.
- 읽은 요소는 문서 ID, 관찰 nonce와 실제 DOM 노드에 묶는다. 첫 실제 조작 때만 Playwright를 시작하고 원래 노드를 handle로 연결한다. 같은 이름의 대체 요소와 같은 URL로 새로고침된 문서는 이전 참조로 조작하지 않는다. 노드 연결에 쓰는 임시 표시는 즉시 제거한다.
- 완료와 고아 작업 복구는 대화 저장 전에 디버깅 연결을 해제한다. 취소 상태 저장에 실패해도 연결 정리를 시도한다. Chrome의 `canceled_by_user` 이벤트는 연결 중인 탭을 포함해 해당 작업을 중단한다. 세션 변경을 받은 채팅 화면도 모델 요청을 취소하며 같은 작업은 재연결하지 않는다.
- 실제 Playwright 조작, 생성 코드 실행, 화면 캡처와 이미지 도구에는 debugger 연결과 Chrome 표시줄이 계속 필요하다. 이미 자동화를 시작한 작업의 연결은 그 작업 종료까지 유지한다. 표시줄을 숨기는 브라우저 플래그는 사용하지 않는다. AI Pro의 기존 DNR 로그인 경로는 그대로 유지한다.

## 검증

- `npm test`: 216개 통과.
- `npm run design:check`: 문제 없음. 화면 구조와 CX 스타일은 변경하지 않았다.
- `npm run build`: 0.16.4 설치 폴더와 ZIP 생성. 기존 Vite 청크 크기 안내가 남아 있다.
- `browser-debugger-browser`: 9개 통과. 읽기/탭 조회의 debugger attach 0회, 참조 정리, 읽기에서 신뢰된 클릭/입력 전환, iframe/Shadow DOM, 교체/새로고침 참조 거부, 취소와 재연결 차단, 완료/복구 중 저장 실패에도 연결 해제를 확인했다.
- `browser-agent-browser`: 16개 통과. 자연어 페이지 분석과 새로고침 후 분석의 attach 0회, 기존 메일 초안/코드 수정/화면 조작, 사용량, 종료, 표시줄 취소 이벤트에서 채팅 중단까지 확인했다.
- `browser-popups-browser`: 7개 통과. 별도 창과 지연된 새 탭, 기존 창 재사용, 부모 복귀, 연속 입력과 팝업 로딩 중 취소를 확인했다.
- `login-redirect-browser`: AI Pro 로그인 8개 통과. debugger 호출 0회, 실제 localhost 소켓 접근 0회.
- `chatgpt-browser`: 기존 로그인/갱신/대화/도구 호출 7개 통과.
- `context-browser`: 요약과 사용량, 새로고침 후 복원, 작업 체크포인트와 명시적 이어가기 5개 통과.

실제 Chromium 확장 실행기와 합성 사이트/모델 응답으로 검사했다. Chrome 표시줄을 직접 클릭한 검증은 아니며, 공식 `canceled_by_user` 이벤트를 실제 worker 처리기에 전달해 취소 흐름을 확인했다. 회사망 SSO, 실제 계정과 사용자 업무 사이트는 이번 검증에 포함하지 않았다.

Chrome debugger의 CDP 연결과 detach 사유는 [공식 API 문서](https://developer.chrome.com/docs/extensions/reference/api/debugger)를 따른다. 일반 DOM 관찰은 [content script의 isolated world](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)에서 실행한다.

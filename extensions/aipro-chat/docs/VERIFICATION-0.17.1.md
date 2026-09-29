# 0.17.1 로그인 디버거 제거 검증

ChatGPT 로그인에 남아 있던 `chrome.debugger.attach`와 `Fetch` 콜백 수신기를 제거했습니다. AI Pro와 ChatGPT 모두 로그인 탭에 한정한 DNR 세션 규칙으로 콜백을 받습니다. FabriX는 기존 HTTP 모델 조회/연결 테스트를 유지합니다.

## 변경

- ChatGPT는 등록된 `http://localhost:1455/auth/callback`만 수신합니다. AI Pro의 CLI 경로와 코드 교환 계약은 유지합니다.
- 콜백은 확장 문서로 이동한 뒤 주소의 인증 정보를 즉시 지웁니다. 탭, frame, nonce, 만료, OAuth state를 검증하고 code는 한 번만 교환합니다.
- 대기 중 PKCE는 trusted session에만 두어 worker 휴면 후 복원합니다. 교환 시작/취소/실패에는 제거하며 교환 도중 재시작은 코드를 다시 보내지 않습니다.
- 구버전 로그인 수신기는 시작 시 닫고 해제합니다. 일반 로그인에는 debugger 호출이 없습니다.
- 실제 Playwright 조작/캡처/이미지 도구의 Chrome 표시줄과 중지 동작은 유지합니다.

## 검증 결과

Chrome for Testing 149.0.7827.55, macOS에서 배포 빌드를 설치한 격리 프로필로 검사했습니다. 인증/모델 응답은 합성 데이터입니다.

| 범위 | 결과 |
| --- | --- |
| 단위 검사 | 245개 통과 |
| 디자인 정적 검사 | 통과 |
| AI Pro 콜백 | 새 프로필 3회 통과, debugger 호출 0회 |
| ChatGPT 콜백 | 새 프로필 3회 통과, debugger 호출 0회 |
| AI Pro / ChatGPT / FabriX 연결과 전환 | 새 프로필 3회 통과, debugger 호출 0회 |
| ChatGPT 채팅/갱신, 자동화 디버거 수명, 양쪽 사이드 패널, FabriX, 계정 사용량 | 6종 통과 |
| 합계 | 9종 15회 실행, 반복 포함 97개 브라우저 검증 묶음 통과 |
| 설치 ZIP | 193개 파일이 검사한 dist와 일치 |

실제 Chrome의 HTTP 302, JavaScript 이동, GET form, 별도 로그인 출처, worker 재시작, 중복 콜백, 취소/실패/재시도와 제공자 전환을 확인했습니다. localhost 수신 서버까지 요청이 도달하지 않는 것도 검사했습니다. PKCE/code/토큰이 사용자 상태와 진단/영구 저장소에 노출되지 않는지 검사했습니다.

[실행 기록](../verification/pre-release-2026-09-21T14-18-58-157Z/report.json)은 이번 변경에 해당하는 부분 회귀입니다. 전체 브라우저 스위트, 실제 ChatGPT 계정, 회사망 AI Pro/FabriX 계정, Windows/Edge 로그인을 확인했다는 의미가 아닙니다. AI Pro에서 사용자가 보았던 표시줄은 이 빌드의 로그인 검사에서는 재현되지 않았으며, 사용자 설치본의 정확한 원인까지 단정하지 않습니다.

## 설치 파일

[0.17.1 후보 ZIP](../verification/candidate/aipro-chat-extension-0.17.1-candidate.zip)

기존에 로드한 확장 폴더에 새 파일을 덮어쓴 뒤 확장 관리에서 새로고침하세요. 설정의 버전이 `0.17.1`인지 확인하면 됩니다. 기존 확장을 삭제할 필요는 없습니다.

- ZIP SHA-256: `8f97f344452a7b51d07e6327c9c76e1dc4d27dff14bf07f666c04deac6ab3ca7`
- 검사한 dist SHA-256: `a15bebcac0051544aa8e68381a9cdb2ccac44951cd9ccea978c29faa50c4fa08`

기존 0.17.0 배포 ZIP은 변경하지 않았으며 GitHub 업로드는 수행하지 않았습니다.

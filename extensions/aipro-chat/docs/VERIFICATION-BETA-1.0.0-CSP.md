# Beta 1.0.0 CSP 수정

2026-09-22. 표시 버전은 **Beta 1.0.0**, 내부 업데이트 번호는 **1.4.4**, 패키지는 `nubi@1.0.0-beta.1`이다.

## 원인과 수정

기존 1.4.3의 CSP `connect-src`에 넣은 `http://[::1]:*`가 Chrome에서 유효하지 않은 주소로 처리됐다. 실제 배포 manifest로 확장을 열어 같은 콘솔 경고를 재현했다. CSP host 문법은 IPv6 리터럴을 표현하지 못한다. [W3C CSP source list 문법](https://www.w3.org/TR/CSP3/#source-lists).

잘못된 항목을 제거하고 HTTP 로컬 연결은 `localhost`와 `127.0.0.1`로 유지했다. OpenWiki 직접 연결의 주소 검증도 같은 범위로 맞췄다. 전체 HTTP를 허용하거나 CSP를 끄는 변경은 없다. IPv6 로그인 콜백은 별도 탐색 규칙이므로 그대로 지원한다.

기존 검사는 `pageerror` 중심으로 실행 오류를 검사해 CSP 파서 경고를 놓쳤다. 새 `tests/csp-browser.mjs`는 **수정하지 않은 배포 manifest**로 확장을 설치하고 콘솔과 Chrome 로그를 함께 확인한다. 이전 설치본에서는 같은 경고로 실패하고 수정본에서는 통과했다.

## 검증

- 확장 화면과 로그인 콜백 문서에 CSP 파서 경고가 없다.
- 확장 화면과 서비스 워커에서 localhost/127.0.0.1의 실제 HTTP 요청과 HTTPS fixture를 확인했다.
- 다른 HTTP 호스트는 CSP가 차단하며 서버까지 요청이 도착하지 않는다.
- AI Pro와 ChatGPT 콜백, 제공자 전환은 새 Chrome 프로필에서 각각 3회 검사한다.
- 채팅, 실제 사이드 패널, FabriX, OpenWiki 서버 연결과 폴더 복원도 변경 영향 범위에 포함한다.

**단위 285개와 변경 영향 범위의 브라우저 20회가 통과했다.** 디자인 검사와 후보 빌드도 통과했다. 이번 실행은 14개 스위트의 부분 회귀이며 전체 72회 검사를 다시 수행한 결과로 표시하지 않는다. 이 검사는 합성 계정/모델 응답을 사용하며 회사망이나 실제 계정 성공을 대신하지 않는다. 전체 기능의 기존 결과는 [1.4.3 전체 검증](VERIFICATION-BETA-1.0.0-RELEASE.md)을 참고한다.

[수정 전 경고](evidence/beta-1.0.0-csp/before.json), [수정 후 CSP 검사](evidence/beta-1.0.0-csp/after.json), [회귀 검사](evidence/beta-1.0.0-csp/report.json).

검사한 후보 ZIP을 재빌드하지 않고 배포한다. 게시할 소스를 별도 체크아웃에서 빌드한 실제 파일 415개와도 바이트 단위로 일치한다.

SHA-256: `89ff370beb88950f5bbeeda1ae3c74ab9fd70aeed406934b81c15c911c9d568f`

[수정 ZIP](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.1/nubi-beta-1.0.0.zip). 기존 설치 폴더에 파일을 교체하고 확장을 새로고침한다. 이전 배포본과 검증 기록은 보존한다.

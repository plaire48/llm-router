# 개발 검증

현재 품질 작업 순서와 완료 기준은 [브라우저 품질 작업 목록](docs/BROWSER-QUALITY-BACKLOG.md)에서 관리합니다. `npm run verify:quality`는 기존 통합 실행기로 8개 핵심 영역과 Wiki/하위 분석의 고정 회귀 77회(quality-baseline-v5: 22종 × 3회 + 11종)를 같은 후보에서 검사합니다. `NUBI_TEST_SUITES`를 해제하고 실행하세요. 전체 배포 매트릭스나 실제 모델 평가를 대체하지 않습니다. 전체 매트릭스가 동일 후보에서 이 기준을 모두 포함하고 모든 단계의 정상 종료를 증명하면 품질 목록의 핵심 근거로도 인정합니다.

`harness-repair-browser`는 잘못된 도구 인자의 필드별 수정 피드백과 세 단계 연속 입력/검증 복구를 기본 누비 작업 창에서 검사한다. 실제 페이지 입력 횟수, 원본 탭 보존과 새로고침 뒤 중복 실행도 확인한다. [설계와 평가 범위](docs/HARNESS-REPAIR-QUALITY.md)를 참고하세요.

[모델 목록과 이미지 자동 전환 검증](docs/VERIFICATION-BETA-1.0.0-MODEL-ROUTING.md)

[Beta 1.0.0 Qwen 브라우저 코파일럿과 자동 복구 검증](docs/VERIFICATION-BETA-1.0.0-CONTROLS.md)

기준 모델은 Qwen 3.8 27B다. `npm run eval:agent`는 `QWEN3.8-27B-FP8-256K`를 기본으로 실제 AI Pro 추론을 평가한다. `NUBI_EVAL_TOKEN`은 로컬 환경에만 설정하며, 없으면 `not_configured`로 기록한다. `NUBI_EVAL_MODEL`을 바꾸면 비교 모델 평가로 구분한다. `verify:browser`의 합성 모델 검사는 실제 모델의 판단 정확도 평가를 대신하지 않는다.

[Beta 1.0.0 작업 계획과 진행 표시 검증](docs/VERIFICATION-BETA-1.0.0-PROGRESS.md)

[Beta 1.0.0 질문 후 작업 재개 검증](docs/VERIFICATION-BETA-1.0.0-CLARIFICATION.md)

[Beta 1.0.0 모델 선택창 로그인 버튼 검증](docs/VERIFICATION-BETA-1.0.0-MODEL-LOGIN.md)

[Beta 1.0.0 캐릭터 움직임 복구 검증](docs/VERIFICATION-BETA-1.0.0-MOTION.md)

사용법과 설치는 [GUIDE.md](GUIDE.md)를 참고하세요. 앱에서는 설정의 물음표 아이콘으로 같은 도움말을 볼 수 있습니다.

[1.0.2 모달 글꼴과 가독성 검증](docs/VERIFICATION-1.0.2.md)

[1.0.1 상단 토스트 검증](docs/VERIFICATION-1.0.1.md)

[1.0.0 전체 기능과 시각 검증](docs/VERIFICATION-1.0.0.md)

[1.2.0 첨부와 붙여넣기 검증](docs/VERIFICATION-1.2.0.md)

[1.3.0 승인과 질문 폼 검증](docs/VERIFICATION-1.3.0.md)

[1.4.0 스크립트 사전 검사와 복구 검증](docs/VERIFICATION-1.4.0.md)

[nubi Beta 1.0.0 이름과 버전 검증](docs/VERIFICATION-BETA-1.0.0.md)

[nubi Beta 1.0.0 전체 검증과 보완점](docs/VERIFICATION-BETA-1.0.0-FULL.md)

[nubi Beta 1.0.0 최종 배포 검증](docs/VERIFICATION-BETA-1.0.0-RELEASE.md)

## 기본 확인

`wiki-markdown-search.test.mjs`는 굵게/코드/링크 라벨이 포함된 한국어 검색, 링크 주소와 HTML 속성 제외, 인용문/목록의 중첩 표, 원문 범위와 단일 문서 조회의 격리를 검사합니다. 실제 Chrome의 동일 사례는 기존 `wiki-search-browser`에 포함됩니다. [후속 개선](docs/WIKI-FOLLOWUP-2026-09-24.md)을 참고하세요.

`wiki-search-browser`는 실제 배포 모듈을 Chrome 서비스 워커에서 실행해 한국어 띄어쓰기 검색, 제목 계층, 표 머리글과 원문 위치, 저장한 문서 재조회, 사이트/제공자/버전 격리를 검사합니다. 기본 반복 대상이며 새 프로필에서 3회 실행합니다. `wiki-structure.test.mjs`의 실패 재현과 적용한 오픈소스는 [내장 위키 품질 개선](docs/WIKI-QUALITY-2026-09-24.md)에 기록합니다.

`node tests/csp-browser.mjs`는 수정하지 않은 배포 manifest로 확장을 열어 CSP 파서 경고를 검사합니다. 확장 화면과 서비스 워커에서 localhost/127.0.0.1의 실제 HTTP 연결, HTTPS fixture, 다른 HTTP 주소의 CSP 차단도 확인합니다. CSP 경고는 `pageerror`가 아니라 콘솔/브라우저 로그로 전달되므로 두 경로를 수집합니다.

배포 전 브라우저 작업 변경은 아래 통합 검증을 실행합니다. 핵심 첨부/실행/복구와 로그인/제공자 전환 스위트를 새 프로필로 각각 3회 검사하고, 채팅/승인/스킬/사용량/첨부/패널/디자인 회귀 관련 스위트를 추가로 실행합니다.

OpenWiki 서버 검사는 `packages/openwiki`에서 의존성을 준비하고 `npm run build`를 실행한 뒤 시작합니다. 테스트 fixture가 이 빌드의 실제 서버를 사용합니다.

```sh
npm run verify:browser
```

단위 검사 → 디자인 검사 → 후보 빌드 → 반복 브라우저 검사 순서입니다. 실패하면 즉시 멈추며 실패한 시도를 자동 재실행해서 통과로 덮지 않습니다. 결과, 개별 로그, 검사한 ZIP과 SHA-256은 `verification/pre-release-<시각>/`에 남습니다. 실행 중 빌드가 바뀌어도 실패합니다.

`rich-editor-browser`는 Tiptap 3.31.3의 실제 문서 모델로 부분 서식, 제목/크기, 미리보기, 저장 후 복원과 최종 승인 경계를 검사합니다. Qwen 및 실계정 검사는 별도입니다. 상세 계약은 [본문 서식 작성](docs/RICH-TEXT-AUTHORING.md)을 참고하세요.

`form-reconciliation-browser`는 20개 입력의 응답 유실 후 전체 검증, 부분 검증의 보류, 사라진 입력/체크박스의 실패 판정과 중복 대상의 실행 전 거부를 검사합니다. 실제 Chrome 호스트와 Pi 소스 실행기에 합성 판단을 연결하며 입력 횟수도 대조합니다. 실제 모델 평가는 아닙니다. [재현과 개선 근거](docs/QUALITY-REVIEW-FORMS-2026-09-24.md)를 참고하세요.

`outcome-recovery-browser`는 실제 재렌더링으로 클릭 참조를 무효화하고 재조회 사이의 반복 실패 검토를 검사합니다. 결과 검증 실패 뒤 검색 조건 수정, 입력 중복 방지와 새로고침 보존을 새 Chrome 프로필로 3회 확인합니다. 합성 모델 응답을 사용하며 실제 Qwen 판단 성능과 구분합니다. [복구 기준](docs/BROWSER-OUTCOME-RECOVERY.md)을 참고하세요.

`state-sync-browser`는 조회 실패 후 3회에서 멈춤, 타이머/저장소 이벤트로 인한 무한 재시도 방지, 마지막 화면 보존과 수동 재연결을 검사합니다. 재연결이 모델이나 브라우저 작업을 다시 실행하지 않는지도 확인합니다. [화면 조회 복구](docs/STATE-SYNC-RECOVERY.md)를 참고하세요.

후보 빌드는 `verification/candidate/`에만 ZIP을 만들고 기존 `releases/` ZIP을 덮어쓰거나 업로드하지 않습니다. 빠른 로컬 점검에는 `NUBI_TEST_REPEATS=1 npm run verify:browser`를 사용할 수 있지만, 배포 전 반복 검증 결과로 대신하지 않습니다. Chrome 경로는 아래와 같이 지정할 수 있습니다.

```sh
CHROME_BINARY="/path/to/chrome" npm run verify:browser
```

실패를 수정한 뒤 일부 검사만 실행하려면 `NUBI_TEST_SUITES=side-panel-browser,chatgpt-side-panel-browser npm run verify:browser`를 사용합니다. 결과에 부분 검사로 표시되며, 전체 검사 통과로 간주하지 않습니다. 앞선 결과와 합칠 때는 빌드 해시가 같고 앞서 통과한 테스트와 fixture를 변경하지 않았는지 확인합니다. 실패 기록은 보존합니다.

이 결과는 실제 Chrome 실행기의 합성 사이트 회귀 검증입니다. 실제 모델이 스스로 도구/스크립트를 선택하는 평가는 [품질 개선안](docs/PLAYWRIGHT-QUALITY-PLAN.md)의 별도 단계이며, 통합 검사 통과를 실제 모델 성능이나 배포 승인으로 표시하지 않습니다.

### 기존 설치 업데이트

`node scripts/verify-upgrade.mjs <이전-릴리즈.zip> [새-dist-폴더]`로 기존 설치 폴더의 업데이트를 검사합니다. `CHROME_BINARY`는 위 회귀 검사와 같은 Chrome 실행 파일을 지정합니다. 실제 사용자 프로필 대신 임시 프로필에 이전 ZIP을 설치하고 합성 대화/초안을 저장한 뒤 같은 경로에 새 빌드를 복사해 Chrome을 다시 엽니다. 확장 ID, 대화 이력, 초안, 모델/작업 모드와 대화 재선택/새로고침을 확인합니다. 결과는 `verification/upgrade.json`에 기록하며 실제 계정 인증 유지 검사는 포함하지 않습니다. 배포 ZIP을 교체하기 전에 이전 ZIP을 입력으로 사용하세요.

개별 개발 명령:

```sh
npm test
npm run design:check
npm run build:candidate
```

빌드는 설치 폴더와 ZIP을 생성하며 help-content.js에서 오프라인 GUIDE.md를 함께 만듭니다. 도움말을 고칠 때는 help-content.js를 수정하세요.

## 브라우저 확인

변경한 기능에 맞는 스크립트를 선택합니다. Playwright가 사용할 Chrome이 별도 위치에 있으면 CHROME_BINARY 환경변수로 실행 파일을 지정하세요.

```sh
node tests/conversations-browser.mjs
node tests/task-plan-browser.mjs
node tests/code-browser.mjs
node tests/context-browser.mjs
node tests/output-recovery-browser.mjs
node tests/script-recovery-browser.mjs
node tests/script-preflight-browser.mjs
node tests/browser-specialist-browser.mjs
node tests/browser-workflows-browser.mjs
node tests/harness-browser.mjs
node tests/browser-debugger-browser.mjs
node tests/browser-popups-browser.mjs
node tests/popup-approval-browser.mjs
node tests/approval-browser.mjs
node tests/browser-agent-browser.mjs
node tests/captures-browser.mjs
node tests/fabrix-browser.mjs
node tests/chatgpt-browser.mjs
node tests/account-usage-browser.mjs
node tests/ui-simplicity-browser.mjs
node tests/usage-browser.mjs
node tests/provider-switch-browser.mjs
node tests/login-redirect-browser.mjs
node tests/welcome-browser.mjs
```

테스트는 격리한 프로필과 합성 인증/모델 응답을 사용합니다. 자동화용 사이트 권한은 테스트 복사본에만 부여합니다. 실제 계정 로그인, 회사망 API, 모델 성능과 기본 배포본의 권한 허용 화면은 별도로 확인해야 합니다.

`side-panel-browser.mjs`도 자동 실행에서는 테스트 복사본에 사이트 권한을 부여합니다. Chrome 권한 창의 실제 허용 조작은 `HEADED=1 NUBI_INTERACTIVE_PERMISSION=1 node tests/side-panel-browser.mjs`로 별도 확인하며 사람이 권한 창을 처리해야 합니다. 자동 검사 결과를 실제 권한 창 검증으로 기록하지 않습니다.

도움말은 로그인 전/후, 360px 사이드 패널과 넓은 창에서 확인합니다. 주제 펼치기, 키보드 조작, Escape와 초점 복귀, 마지막 내용 스크롤, 작성 중인 초안 유지와 오프라인 GUIDE.md의 내용 일치를 확인하세요.

## 기록

- [2026-09-21 배포 전 반복 검증](docs/VERIFICATION-2026-09-21-PRE-RELEASE.md)

- [대화 이력 검증](docs/VERIFICATION-0.13.0.md)
- [아이콘 UI 검증](docs/VERIFICATION-0.13.1.md)
- [도움말 검증](docs/VERIFICATION-0.13.2.md)
- [FabriX 형식 복구 검증](docs/VERIFICATION-0.13.3.md)
- [계정 버튼과 표정 검증](docs/VERIFICATION-0.13.4.md)
- [제공자 전환 검증](docs/VERIFICATION-0.14.0.md)
- [개발과 연결 규격](docs/DEVELOPMENT.md)

설정의 연결 진단은 인증값, 전체 콜백 URL과 대화/페이지 원문을 제외합니다. 실제 계정의 인증값을 검증 기록에 포함하지 마세요.

[0.14.1 선택창 간소화 검증](docs/VERIFICATION-0.14.1.md)

[0.17.1 전체 제공자 로그인 디버거 제거 검증](docs/VERIFICATION-0.17.1.md)

[0.15.0 디버거 없는 AI Pro 로그인 검증](docs/VERIFICATION-0.15.0.md)

`login-redirect-browser.mjs`와 `chatgpt-login-redirect-browser.mjs`는 AI Pro와 ChatGPT의 실제 콜백 경로를 사용하며, 테스트 복사본에서 debugger 호출을 실패시켜 우회 호출이 없는지 검사합니다. `provider-switch-browser.mjs`는 FabriX 연결 테스트/등록까지 같은 검사를 수행합니다. 두 콜백 검사는 실제 worker 재시작, localhost 서버 요청 0회, 코드 단일 교환과 취소를 확인합니다. `no-debugger-probe.mjs`는 과거 별도 확장의 타당성 실험이고, `http-callback.mjs`, `auth-trace-browser.mjs`, `redirect-probe.mjs`는 구버전 CDP 수신기의 이력입니다. 현재 AI Pro 로그인 검증에는 사용하지 않습니다.

[0.15.1 전체 화면 스크롤 검증](docs/VERIFICATION-0.15.1.md)

## 이미지 설명과 선택 질문

`node tests/image-choice-browser.mjs`는 SVG 후보 발견, 실제 비교 이미지 전달, 선택/직접 답변, 다운로드와 질문 복원을 합성 모델 응답으로 검증합니다. `node tests/page-images-browser.mjs`는 기존 파일 다운로드를 확인합니다.

[0.16.0 검증 범위](docs/VERIFICATION-0.16.0.md)

[0.16.1 화면 정리와 계정 한도 검증](docs/VERIFICATION-0.16.1.md)

- [0.16.2 로고와 공통 화면 검증](docs/VERIFICATION-0.16.2.md)

[0.16.4 디버깅 연결 검증](docs/VERIFICATION-0.16.4.md)

[0.16.5 출력 복구와 긴 본문 작성 검증](docs/VERIFICATION-0.16.5.md)

## OpenWiki 연결 검사

`npm run verify:browser`의 OpenWiki 시나리오는 이 저장소의 실제 OpenWiki 서버를 임시 프로젝트로 구동합니다. 먼저 `packages/openwiki`에서 `npm run build`를 실행하세요. 회사 파일이나 실계정은 사용하지 않습니다. `tests/openwiki-browser.mjs`는 연결/도구/해제/오류를, `tests/openwiki-ui-browser.mjs`는 세 화면 폭의 모달과 복구 흐름을 확인합니다. 권한 거절은 검사하며, 네이티브 권한창의 실제 허용 클릭은 테스트용 origin 사전 허용과 구분합니다.

## 링크와 호버 메뉴

`click-feedback-browser`는 토글/내부 링크/양식 열기의 지연과 trusted 클릭 1회, 실제 제출/신청/삭제/발송 승인, 빠른 반환 뒤의 지연 팝업 및 이전 화면 쓰기 보류를 검사한다. `approval-labels-browser`는 합성 Qwen 응답으로 저장된 질문의 실제 동작명, 초안 없는 승인, 취소, 320/420/1100px의 CX 글꼴과 줄바꿈을 확인한다. 두 검사는 배포 후보에서 새 프로필로 3회 반복한다. 수정 전 측정은 `verification/click-feedback-before.json`, 설계와 출처는 [클릭 대기와 승인](docs/CLICK-LATENCY-AND-APPROVAL.md)에 기록한다. 이 시간은 로컬 도구 왕복 시간이며 LLM 추론이나 사내 사이트 지연을 포함하지 않는다.

`hover-links-browser`는 여러 줄 링크의 부분 가림, 제목 링크, 호버 전용 트리거, CSS/지연 메뉴, 의미 도구/ref/locator 경로를 검사한다. trusted 마우스 클릭 1회와 Enter 이벤트 0회를 확인하고, 호버 뒤 다음 행동은 최신 관찰로 나누며 완전 가림에서는 우회하지 않는다. 수정 전 결과는 `verification/hover-links-before.json`, 근거와 한계는 [링크와 호버](docs/BROWSER-HOVER-LINKS.md)에 기록한다.

## 단계별 피드백

### 전용 작업 창과 실행 중 조회

`workspace-browser`는 새 Chrome 프로필에서 작업 창/그룹, 원본 미저장 초안 보존, 소유 탭 조회/전환, 새 탭과 팝업, 닫힌 자식의 부모 복귀, 창 닫힘 후 원래 탭으로 대체하지 않는 동작을 검사한다. `workspace-flow-browser`는 기본 창 모드에서 실제 UI와 worker를 통해 초안 입력 → 검증 → HITL → 한 번의 등록을 실행한다. 모델 응답은 합성 Qwen이며 실제 모델 정확도를 뜻하지 않는다. 느린 실제 콘텐츠 스크립트 호출 동안 조회가 응답하고 다른 화면이 작업을 취소하지 않는지 함께 검사한다.

이전 현재 탭 기반 작성/승인 시나리오는 `browserWorkMode: current`를 명시한다. 새 기본값의 커버리지를 대신하지 않으며 두 경로를 함께 검증한다. 창 초점은 탭 소유권과 별도로 `workspace-browser.json`의 `popupFocus`에 기록한다. `chrome_foreground`는 원래 창/탭 복원을, `chrome_background`는 Chrome이 앞으로 나오지 않음을 검사한다. 실제 `focused` 상태로 구분하며 마지막 초점 창 ID만으로 판정하지 않는다. 네이티브 팝업의 초점 복원이 실패하면 보고서는 `passed_with_limitations`, 배포 차단 항목은 `native_popup_focus_not_restored`로 남긴다. 이를 통과한 무간섭 검증이라고 표현하지 않는다. [설계와 제한](docs/BROWSER-WORKSPACE.md).

`side-panel-browser`는 실제 Chrome 사이드패널에서 기존 현재 탭의 두 출처 이동과 전용 창의 DOM 읽기를 각각 확인한다. 전용 창의 첫 탐색은 실제 로컬 HTTP 서버를 사용하며 원래 창의 초점과 미저장 입력을 보존하는지 검사한다. 합성 모델 응답과 사전 부여한 사이트 권한을 사용한다.

`agent-runtime.test.mjs`와 `skills.test.mjs`는 읽기 전용 스킬까지 한 작업의 결과를 다음 모델 호출에 전달하는지, 후속 제안을 보류하는지, 부분 실행을 재생하지 않는지 검사합니다. `task-plan-browser.mjs`는 실제 입력/검증 결과가 모델에 돌아오기 전에 완료 개수가 올라가지 않는지 확인합니다. `analysis-recovery-browser.mjs`와 `harness-browser.mjs`는 오류/누락을 받아 방법을 바꾸고 필요한 부분만 고치는 흐름을 확인합니다. [비교한 방법론과 적용 범위](docs/STEPWISE-AGENT-FEEDBACK.md).

`review-context-browser`는 기본 전용 창에서 다섯 항목의 실제 입력/검증을 수행하고, 큰 과거 관찰이 쌓여도 중간/최종 검토에 원래 사용자 제한이 남는지 검사합니다. 현재 탭을 단언하는 기존 context/error-recovery/task-plan/role-agents/analysis-recovery 시나리오는 해당 모드를 명시합니다. 새 창의 초기 탐색은 라우팅 가짜 응답 대신 로컬 HTTP 서버로 확인하며, 사이트 권한은 검사 프로필에만 미리 부여합니다. [설계와 검증 경계](docs/HARNESS-CONTEXT-QUALITY.md).

`analysis-delivery-browser`는 기본 전용 창에서 두 담당의 문맥 격리, 첫 결과의 자동 전달, 다른 분석 중 초안 입력과 검증을 확인합니다. 느린 결과의 오래된 근거 표시, 원래 탭 보존, 전체 usage 집계와 재진입 후 중복 입력도 검사합니다. `analysis-delivery.test.mjs`는 같은 작업 재사용, 긴 자료의 구간 검색과 한국어 줄바꿈, 빈 인용 거절, 부분 결과 반환, 질문 시 취소와 빈 조회 반복 방지를 다룹니다. [역할별 분석 설계](docs/ROLE-AGENTS-IMPLEMENTATION.md).

`clarification-browser`는 원래 탭의 질문/재개를 검사하므로 `browserWorkMode: current`를 명시합니다. 새 대화는 실제 로고 버튼으로 전환하고 화면 동기화가 끝난 뒤 입력합니다. 직접 `NEW_CHAT` RPC로 UI 전환 잠금을 우회하지 않습니다. 전용 창 동작은 별도 시나리오로 검증합니다.


## OpenWiki 폴더 직접 읽기

DOM 복합 검색과 문맥 압축의 변경/평가 범위는 [DOM 탐색과 컨텍스트 유지](docs/DOM-CONTEXT-RETRIEVAL.md)에 있다. `retrieval-browser`와 `context-browser`는 새 프로필로 3회 반복한다. 실제 노드 탐색/조작과 합성 모델의 압축 후 요청 검사를 실제 Qwen 정확도와 구분한다.

`page-information-browser`는 설명으로 동명 입력란 구분, 표/가상 행/병합/긴 셀 검색, 관찰 예산과 숨은 하위 트리, 민감 값 제외, debugger 없는 읽기와 실제 입력/검증을 검사한다. [정보 선택과 오픈소스 적용](docs/BROWSER-INFORMATION-STRATEGY.md). 모델 선택 UI는 기존 `model-catalog-refresh-browser`와 `provider-switch-browser`에서 검색/오류/로그아웃/전환 및 작은·큰 화면을 확인한다.

`provider-switch-browser`의 비활성 계정 만료는 작업자 저장소를 직접 바꾸는 합성 조건이다. 앞선 제공자 전환의 RPC뿐 아니라 실제 입력창의 초안 복원을 기다린 뒤 만료를 주입하고, 화면에 재진입해 만료 계정 제거를 검사한다. UI 전환 중 외부 저장소 변경을 섞은 이전 실패 로그는 보존한다. `NUBI_PROVIDER_TRACE=1`은 실패 시 제공자/대화 ID와 RPC 시점만 기록하며 인증값/초안은 기록하지 않는다.

`tests/wiki-folder-browser.mjs`는 설정 폴더 선택 → IndexedDB 핸들 저장 → 서비스 워커 검색/읽기 → 문서 내용으로 웹 폼 입력 → 페이지 결과 검증을 확인한다. OPFS의 실제 Chrome DirectoryHandle을 선택 결과로 사용한다. 네이티브 OS 선택창 완료 및 회사 모델 성공률과 구분한다. 서버를 실행하지 않는다. 연결 오류/교체 취소/해제, 문서 변경 후 해시, 320/360/1100px 설정 화면도 확인한다.

`tests/wiki-folder.test.mjs`는 문서 범위, 제외 파일, 검색 제한, 권한 철회, 저장 실패/롤백과 임시 선택의 소유자/만료를 검사한다. `tests/goal-review.test.mjs`는 Wiki 참조를 브라우저 쓰기 후에도 유지하되 같은 문서를 다른 해시로 읽으면 이전 근거를 대체하는지 확인한다. 페이지 성공 판정에는 별도의 최신 페이지 검증이 계속 필요하다.

`tests/wiki-folder-persistence-browser.mjs`는 같은 Chrome 프로필의 완전한 종료/재시작 후 폴더 핸들 복원과 해제 후 비복원을 검사한다. OPFS 핸들 영속성과 실제 디스크 폴더의 OS 권한 영속성은 구분한다.

`model-catalog-refresh-browser`는 수신/표시 개수 문구 제거와 오른쪽 아래 아이콘 배치를 확인하고, 모델 모달이 열리는 매 프레임에 토스트가 viewport 상단을 유지하는지 검사한다. 모달 전체의 transform 때문에 토스트가 내려오던 문제를 기존 빌드에서 재현했다. `feedback-browser`는 320/360/1100px 채팅과 설정 모달, 모션 감소 상태의 모델 모달, 토스트 닫기와 초점 복귀를 확인한다. 실제 Chrome의 클립보드와 합성 API 응답을 사용한다.

### 사용자 첨부

`page-content-browser`는 실제 Chrome에서 긴 웹 문서의 구간 읽기와 검색, 원본 보존, 프레임/해시, 숨은 값 제외, 초안 입력과 trusted 클릭 후 검증을 확인한다. 개요 뒤의 실제 완료 문구는 통과하고 숨은/접힌/입력 중인 문구는 성공 근거에서 제외한다. 모델 응답은 사용하지 않는 호스트 계약 검사이며 실제 Qwen 선택 품질과 구분한다. 새 프로필로 3회 반복하고 [오픈소스 적용 범위](docs/BROWSER-OPEN-SOURCE-QUALITY.md)를 따른다.

`node tests/document-retrieval-browser.mjs`는 긴 문서 원문의 자동 주입 제외, Pi 문서 담당 두 개의 범위 분리, 실제 PDF.js/Mammoth 파싱, 원문 근거를 사용하는 최종 검토, 요약 경계 저장 후 새로고침/재조회, 새 대화의 자료 격리를 확인한다. 요약 경계는 테스트에서 저장하며 요약 모델 자체의 생성 성능을 검증하지 않는다. 새 Chrome 프로필로 3회 반복하며 모델 응답은 합성이다. 선택 근거는 [문서 활용과 역할별 컨텍스트](docs/DOCUMENT-RETRIEVAL-HARNESS.md)를 참고한다.

`node tests/attachments-browser.mjs`는 실제 Chrome에서 파일 입력, 이미지 디코딩/소스 미리보기/다운로드, IndexedDB와 대화의 참조 연결, 브라우저 재시작 복원, AI Pro OpenAI 요청과 ChatGPT Responses 및 FabriX 텍스트 요청, 모델 미지원/파일 제한/제공자 격리/대화 삭제를 검사한다. 자동화 파일 선택을 사용하며 OS 선택창 조작과 실모델 판단 성능은 검증하지 않는다. 핵심 회귀에 포함해 새 프로필로 3회 반복한다. `tests/attachments.test.mjs`는 이미지 변환과 도구 후속 요청, 요약/검토의 참고 자료 유지와 토큰 추정을 검사한다. 저장 실패/오래된 대화/미지원 이미지 전송은 worker 수명 테스트에도 포함한다.

`node tests/clipboard-documents-browser.mjs`는 짧은 글의 기본 붙여넣기 유지, 긴 글/이미지 카드, 실제 PDF/한글 DOCX 추출, 원본 다운로드, 새로고침 복원과 모델 요청, 빈 PDF/손상 문서 오류, 끌어놓기를 검사한다. 클립보드/드롭 이벤트는 합성하며 실제 OS 클립보드 조작으로 간주하지 않는다. 파서 네트워크는 외부 접근 없이 확장 로컬 자산을 사용한다. 같은 후보에서 새 Chrome 프로필로 3회 반복한다.

## 채팅 종료 후 실행

`node tests/background-lifetime-browser.mjs`는 worker에 디버거를 연결하지 않은 실제 Chrome에서 화면 종료, 36초 응답 헤더 지연, 재진입, 중지 권한, worker 강제 종료의 안전한 일시 중지를 검사한다. `NUBI_LONG_LIFETIME=1`은 315초 모델 스트림으로 늘린다. 별도 로컬 HTTP 서버의 합성 응답을 사용하며 회사망 모델 성능 검증은 아니다. `workspace-flow-browser`는 실제 입력 도중 채팅 종료, 진행 복원, 질문/승인 대기 복원과 단 한 번의 등록을 검사한다. [백그라운드 실행](docs/BACKGROUND-EXECUTION-DESIGN.md)을 따른다.

## HTML 아이덴티티

`npm run verify:identity`로 전체 단위 검사, 디자인 검사, 후보 빌드와 26개 UI 시나리오를 실행한다. 필요한 환경에서는 `CHROME_BINARY`를 Chrome for Testing 경로로 지정한다. 이는 기존 `verify:browser`의 UI 범위이며 전체 브라우저 회귀나 실계정 검증을 대체하지 않는다. 결과와 후보 ZIP은 `verification/pre-release-*`에 남긴다.

## 후속 품질 평가

- `npm run eval:wiki`: 한국어 정답 범위와 제품 검색 평가. [Wiki 답변 평가](docs/WIKI-ANSWER-EVALUATION.md).
- `npm run eval:wiki:live`: 같은 모델의 검색 발췌/위임 비교. 전용 평가 인증 없이는 실행하지 않는다.
- `npm run eval:webarena:run -- --config benchmark.json --tasks 108 --repeats 3`: 새 격리 환경에서 제품 UI를 실행하고 사이트 한정 HAR를 공식 채점기에 전달한다. [환경 설정과 미검증 범위](docs/PUBLIC-BENCHMARK-EVALUATION.md).
- v2 공통 회귀에 Wiki 정답, 실제 worker 종료 후 입력 복구, 살아 있는 native 확인창의 사용자 응답, HAR 범위 검사를 추가했다. 실모델/회사망/Windows 성공과 구별한다.

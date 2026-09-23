# 검증 기록 — 2026-09-23

## 구현한 사용자 흐름

누비 웹 확장의 로그인 → 연결 상태 → 인사말 → 정확한 모델 선택 → 요청/후속 대화 컴포넌트를 직접 재사용했습니다. 워크스페이스에는 작업·소스와 Wiki·실행과 비교 화면을 연결했습니다. 제공된 HTML의 브랜드·서체·모션과 공통 CX를 유지하며, 인증값은 Desktop 호스트 메모리에만 보관합니다.

## 실제 확인한 범위

| 검사 | 결과 | 증거의 범위 |
|---|---|---|
| `npm test` | 38개 통과 | 실제 임시 Git/SQLite/파일/3-way merge/worktree/Bash, OpenWiki HTTP 페어링, Chrome 캡처. Pi 모델 응답만 합성 주입. 부분 읽기/수정 권한, SQLite 소유권 복구, Wiki 보존/갱신 검사와 아래 복구 장애 주입 10개 포함 |
| `npm run test:ui` | 25개 통과 | 실제 Theia에서 소스 검색, Monaco dirty 보호·undo·diff·저장 readback, Bash 실행, 전후 캡처, 새로고침 후 결과 보존, Wiki·관계·HITL. 오류 표시→수정 명령 실행→실제 출력→재진입 중복 방지 및 좁은 복구 화면 검사 포함 |
| 공통 분석·문맥 하네스 회귀 | 53개 통과 | 기존 확장 소스의 context/context-evidence/analysis-agents/analysis-quality/analysis-delivery 검사. Desktop에서 해당 하네스를 복제하거나 수정하지 않음; 합성 모델 응답 |
| 공통 복구 하네스 회귀 | 27개 통과 | 확장의 model-recovery/output-recovery/browser-recovery 검사. 실제 소스 재사용; 네트워크·제공자 응답은 합성 |
| `npm run test:shared-ui` | 6개 통과 | 합성 연결 상태로 로그인 후 Welcome/입력창, 검색형 모델 선택, 요청·후속 대화, 로그아웃, FabriX 테스트 후 연결 전환 및 재연결 뒤 대기 중 복구 작업/결과 갱신. 실제 SSO/모델 호출 아님 |
| `npm run build`, `npm run build:electron` | 통과 | Theia 1.75 공식 esbuild 구성, 개발용 브라우저/Electron 번들 |
| macOS Electron 창 실행 | 확인 | Electron 42.8.1 / Node 24.18.1, Git 프로젝트 열기와 공통 누비 로그인 렌더링. Playwright가 주입하는 부트스트랩 인수만 검사용으로 정규화 |
| Office 공통 제공자 계약 | 16개 통과 | `tests/providers.test.mjs`, `tests/provider-recovery.test.mjs`. 전용 호스트 표시 문자열 변경 후 기존 계약 재검사. 실제 Office 실행 아님 |
| 확장 FabriX 계약 | 23개 통과 | `tests/fabrix.test.mjs`, `tests/fabrix-recovery.test.mjs`. 연결/파싱/재시도/공통 Pi 합성 계약 검사 |
| 확장 `npm run design:check` | 이슈 0 | 공통 FabrixConnection 권한 요청 주입점 추가 후 CX 정적 검사. 시각·접근성 전체 인증 아님 |
| Desktop CX UI 정적 검사 | 이슈 0 | 설치된 CX의 `scripts/check.mjs ui`. 복구 화면의 실제 넓은/좁은 레이아웃은 별도 Theia UI 검사 |

스크린샷과 JSON 결과는 패키지의 gitignore된 `verification/` 아래에 생성합니다. 초기 회귀 실행에서는 확장 FabriX의 최종 검토 합성 응답 2건이 실패했으나, 현재 공통 소스를 사용한 최종 재실행에서는 23개가 모두 통과했습니다. Desktop 작업에서 해당 확장 하네스와 테스트 코드를 수정하지 않았습니다.

## 지식 관계·DB·변경 계획 후속 검증

- 실제 SQLite 메타데이터만 읽고 원본 파일 바이트·행 비노출을 검사했습니다. DDL/DB의 컬럼 변경, 순서 있는 복합 FK, 자기 참조 FK, 선언한 개념·소스·Wiki 연결과 순환/누락을 검사했습니다.
- PostgreSQL/MySQL/MariaDB/SQL Server/Oracle 드라이버를 실제 로드하고 연결 옵션·스키마 계약·실패 격리를 검사했습니다. 원격 DB 실서버는 연결하지 않았습니다. DB2는 JSON 계약의 합성 사례입니다.
- 실제 Pi 실행기에서 계획에 모든 AC/확인 방법/현재 관찰이 필요한지, 계획 밖·오래된 파일·하위 분석만 읽은 파일을 거부하는지 검사했습니다.
- Desktop의 두 조사 요청이 동시에 시작되고 부모 대화·수정 권한이 전달되지 않음을 확인했습니다. 질문 시 하위 transport가 취소되며 문맥 압축 후 네 개의 원래 AC와 이전 사용자 답변이 유지됩니다.
- 실제 Theia에서 관계 검색/스키마 차이/출처 변경 후 Wiki 기록 거부 및 새로고침 복구, DB 종류·TLS 입력, 객관식·자유 입력 질문과 새로고침 후 초안 복원을 검사했습니다. 새 폼의 접근성 이름을 명시해 키보드/접근성 조회를 수정했습니다.
- 후속 증거: `verification/runtime-knowledge.log`, `ui-result.json`, `shared-ui-knowledge.log`, `shared-harness-knowledge.log`, `build-knowledge.log`, `electron-knowledge.log`. 이 후속 작업의 Electron은 번들 검사이며 새 DB 기능을 Windows/Electron 실계정으로 검증한 것은 아닙니다.

## 검증 중 보완한 내용

- Theia 레이아웃 복원 시 예전 dock 폭 때문에 헤더가 가려지던 문제를 실제 부모 폭과 공개 Lumino ResizeMessage로 해결했습니다. 강제 클릭으로 검사를 통과시키지 않았습니다.
- 편집기에서 사용자가 작성 중인 내용을 덮어쓰지 않고, 적용 후 실제 파일 내용으로 결과를 확인합니다.
- 렌더러 재접속을 30초 기다리는 호스트 수명으로 새로고침 때 인증 메모리와 실행 중인 소유 프로세스를 유지합니다. RPC나 명령을 자동 재전송하지 않습니다.
- 작업을 바꾼 뒤 늦게 도착한 이전 화면 비교 결과는 표시하지 않습니다.
- FabriX의 확장 권한 요청만 주입 가능하게 만들었고, 같은 테스트/연결 UI와 제공자 어댑터를 유지했습니다.

## 중단·도구·셸 복구 후속 검증

- 추론 503 후 재시도 때 완료된 파일 읽기를 반복하지 않음. 응답 없는 모델을 제한 후 복구 대기로 전환하고 현재 파일을 확인해 같은 요청을 재개함. 인증 실패는 재호출하지 않고 원시 오류 본문을 저장하지 않음.
- 문맥 초과 시 기존 context manager를 한 번 사용해 원래 목표와 AC를 유지함. 멈춘 읽기 도구는 오류를 모델에 전달해 다음 도구를 변경함. 미확정 기록 도구는 완료될 때까지 겹친 실행을 차단함.
- 실제 Bash의 없는 명령→합성 모델 진단/수정안→사용자 실행→실제 파일/출력→모델 결과 검토를 검사함. 동시 실행 요청 두 개에도 파일에는 한 번만 기록됨. 복구 Wiki에는 도구 상태만 포함하고 명령 원문·출력을 제외함.
- Bash 문법 오류는 정상 접두부도 실행하지 않음. 실행 전 검사 중 앱 종료, 설정한 시간 초과, 사용자 중지를 구분함. 사용자 취소는 자동 재개하지 않음.
- 재열기 시 미확정 프로세스/도구를 구분함. 실제 파일이 제안과 이미 일치하면 저장을 반복하지 않고 반영 기록을 복구함. 과거 프로세스 종료 여부를 추정하거나 명령을 자동 재전송하지 않음.
- 최종 로그: `runtime-recovery-final.log`, `recovery-tests.log`(10개), `ui-recovery-final.log`(25개), `shared-ui-recovery.log`(6개), `shared-recovery.log`(27개), `build-recovery-final.log`, `electron-recovery.log`, `design-recovery.log`. 모두 `verification/` 아래이며 화면은 `ui-recovery.png`, `ui-recovery-narrow.png`.
- 실제 Windows·사내 모델은 연결하지 않았습니다. 도구 계약/실제 로컬 Bash 복구 성공은 실모델의 진단 정확도 측정이 아닙니다. 방법론·재시도/대기 기본값·제한은 [복구 하네스](RECOVERY-HARNESS.md)를 참고합니다.

## 아직 확인하거나 구현하지 않은 범위

Windows 설치 파일·서명·자동 업데이트·실제 Windows Git Bash/PowerShell, 각 제공자의 실계정 SSO와 사내 Qwen 정확도, 설치된 누비 확장과의 실제 페어링, Office 작업 수신·문서 저장, OpenWiki 자동 생성/지속 갱신, 다중 독립 앱 실행의 작업 조정은 완료로 표시하지 않습니다. 이 버전에서 Agent는 분석과 변경안 준비를 수행하고, 실제 코드 적용과 명령 실행은 사용자 동작으로 연결합니다. 캡처 차이는 기능 완료나 해당 소스 버전이 실제 서버에 올라갔다는 증거가 아닙니다.

2026-09-23 후속 개선의 의존성 점검 결과와 도입 판단은 [개선 기록](IMPROVEMENTS.md)을 참고합니다. 새 기록은 과거 시점의 Markdown이며 전체 프로젝트 Wiki 자동 생성이나 자동 commit을 의미하지 않습니다.

## 화면 문구 후속 검증

핵심 문장을 먼저 쓰고 중간점 나열을 제거했습니다. 오류 원인과 다음 행동, 출처와 검증 범위는 유지했습니다. 기존 런타임 38개, Theia UI 25개, 공통 UI 6개가 통과했고 브라우저 빌드와 CX 정적 검사도 통과했습니다. 넓은 화면과 좁은 화면에서 복구 설정과 명령 제안을 확인했습니다.

로그는 `verification/runtime-copy.log`, `ui-copy.log`, `shared-ui-copy.log`, `build-copy.log`, `design-copy.log`에 남겼습니다. 새 문구 규칙에 따른 실모델 답변 품질은 아직 평가하지 않았습니다.

## OpenWiki 근거 연결 후속 검증

- 전체 런타임 테스트 48개 통과. 새 10개는 실제 Git 파일과 기존 OpenWiki Claims resolver로 출처 버전, 범위 이동, 오래된 문서, 제외 경계, 요구사항 인용, 제안 전 재확인과 Wiki 기록을 검사했습니다. Pi 도구 연결에는 합성 모델을 사용했습니다.
- 고정 질문 6건의 검색 비교에서 정답 문서 포함은 기존 3건에서 개선 6건이 됐습니다. 무관한 질문 1건은 결과 없음. 사람이 선언한 별칭이 있는 작은 합성 집합의 결과이며 실제 답변 정확도가 아닙니다.
- 실제 Theia 브라우저 검사 28개 통과. 업무 용어 검색, Claims 상태, 실제 코드 변경 후 상태 갱신, 좁은 Wiki 카드 화면을 추가했습니다. 기존 수정 버퍼 보호, Monaco 비교, 저장 확인, Bash 실행, 전후 화면 비교, 새로고침, 질문 복원도 통과했습니다.
- 화면 검사 중 테스트가 파일을 되돌린 직후 편집을 시작해 Theia의 충돌 보호 대화상자가 열린 사례가 있었습니다. 파일 감시로 편집기에 복원된 내용이 표시되는 것을 기다린 후 진행하도록 검증 흐름을 수정했습니다. 충돌 보호를 해제하거나 강제 클릭하지 않았습니다.
- 공통 UI 6개, CX 정적 검사 이슈 0, 브라우저 빌드와 Electron 번들 빌드 통과. Windows 실행이나 설치 파일 검증을 뜻하지 않습니다.
- `127.0.0.1:4330` 미리보기를 갱신하고 실제 누비 검색에서 `거래처`로 `openwiki/customer.md`가 연결되는 것을 확인했습니다. 이 예제 문서에는 Claims가 없어 `최신성 미확인`으로 표시합니다.
- 로그: `verification/runtime-wiki.log`, `ui-wiki.log`, `shared-ui-wiki.log`, `design-wiki.log`, `build-wiki.log`, `electron-wiki.log`. 화면: `ui-wiki-evidence.png`, `ui-wiki-narrow.png`. 방법론과 범위: [OPENWIKI-EVIDENCE.md](OPENWIKI-EVIDENCE.md).
- 실제 제공자 모델과 Qwen 답변 정확도, Windows, 자동 Wiki 생성과 지속 갱신은 이번 검증 범위 밖입니다.

## 코딩 에이전트 품질 후속 검증

- 런타임 60개 통과. 추가한 12개는 실제 TypeScript/JSONC/YAML 파서, ripgrep, 임시 Git 파일을 사용합니다. 3,000개 이후 파일 검색, 리터럴 검색/범위 제한, 기존 오류와 새 오류, 시간 초과/중지, 검사 전 제안 차단과 반영 전 재검사, 재사용 제안과 재열기 상태를 확인했습니다.
- Pi에 합성 모델 응답을 연결해 잘못된 수정안의 실제 진단을 받은 뒤 올바른 제안 하나만 남기는 흐름을 확인했습니다. 원본 파일과 원래 완료 조건은 그대로 유지됩니다. 실제 모델의 자율 수정 성공률을 측정한 것은 아닙니다.
- 실제 Theia UI 30개 통과. 새 두 검사는 검사한 제안만 표시되는지, 앱에 포함된 파서로 반영 전 검사하는지, 실제 저장과 새로고침 후 상태가 유지되는지 확인합니다. 기존 dirty 보호, 비교, Bash, Wiki, DB, HITL 회귀도 통과했습니다.
- 공통 UI 6개와 CX 정적 검사 이슈 0. 브라우저와 Electron 개발 번들 빌드 통과. Node 24.19.0에서 각 번들에 배치된 TS/JSON/YAML worker의 정상 입력과 오류 입력 검사 6개도 통과했습니다. Electron 창의 새 기능이나 Windows 실행을 검증한 결과는 아닙니다.
- 앱 검증에서 JSONC의 번들 상대 require 실패와 새 worker 파일의 출력 디렉터리 복사 누락을 발견해 모두 수정했습니다. 반영 전 재검사 실패도 저장해 오래된 성공 표시를 유지하지 않도록 보완했습니다. 초기 동시 빌드/테스트의 Pi 합성 흐름 실패는 단독 및 최종 순차 검사에서 재현되지 않았으며 원인은 확정하지 않았습니다. 최종 결과는 빌드와 앱 검사를 순서대로 수행한 결과입니다.
- `127.0.0.1:4330`을 새 번들로 갱신했습니다. 현재 미리보기에서 `customers` 검색으로 코드, SQL, Wiki가 표시됨을 확인했습니다. 제외되거나 읽을 수 없는 파일이 있는 검색은 일부 범위로 표시합니다.
- 로그: `verification/runtime-coding-quality.log`, `ui-coding-quality.log`, `shared-ui-coding-quality.log`, `design-coding-quality.log`, `build-coding-quality.log`, `electron-coding-quality.log`, `bundled-parsers-coding-quality.log`. 화면: `ui-coding-quality.png`.
- 방법론과 라이선스, 도입/보류 판단은 [코드 변경 품질](CODING-AGENT-QUALITY.md)을 참고하세요. LSP 전체 연결, 프로젝트 타입 검사, 실제 사내 모델 품질, Windows 실행은 완료로 표시하지 않습니다.

## 프로젝트 규칙과 새 파일 후속 검증

- 최종 런타임 77개 통과. 추가 8개는 실제 파일과 파서로 경로별 규칙, CLAUDE fallback, 규칙 추가/변경 무효화, 현재 실행의 생성 관찰, 문법 오류, 경로/Windows 예약명/NUL 차단, 중복 반영, 동일 내용 충돌, 중단과 재열기, Wiki 생성 대기를 확인합니다.
- 실제 Pi에 합성 모델 응답을 연결해 관찰 또는 계획 없는 생성이 차단되고, 유효한 제안만 남는 것을 확인했습니다. 문맥 초과 복구에서는 루트 규칙과 원래 완료 조건이 유지되고 이전 생성 관찰을 다시 읽도록 요구합니다. 공유 문맥 관리기가 최근 두 유지 항목을 보존하므로 규칙과 완료 조건을 하나의 유지 항목으로 묶었습니다.
- 실제 Theia/Chrome UI 44개 통과. 새 파일 카드와 Monaco 비교, 명시적 반영, 디스크 readback, 새로고침, 이후 생성된 파일 보존, 하위 규칙 변경 차단, 820px 화면을 확인했습니다. 초기 검사는 여러 diff 탭을 하나의 locator로 찾다가 멈췄습니다. 표시 중인 diff로 대상을 한정한 뒤 전체 검사가 통과했습니다. 화면 확인 후 새 파일 표기와 경로 사이 간격도 보완하고 재검사했습니다.
- 공통 UI 6개, CX 정적 검사 이슈 0. 브라우저와 Electron 개발 번들 빌드 모두 통과했습니다. 문맥 처리 보완 이후 런타임 전체와 두 번들 빌드를 다시 통과했습니다. 실제 Windows나 Electron 창의 새 기능 검증을 의미하지 않습니다.
- 로그: `verification/coding-extension-tests.log`, `coding-extension-ui.log`, `coding-extension-shared-ui.log`, `coding-extension-design.log`, `coding-extension-browser-build.log`, `coding-extension-electron-build.log`. 화면: `ui-new-files.png`, `ui-new-files-narrow.png`.
- 실행 중인 작업이 없는 것을 확인한 뒤 `127.0.0.1:4330` 미리보기를 새 번들로 갱신했습니다. 기존 프로젝트와 작업 기록을 보존했습니다.
- 실제 모델의 자율 개발 품질 향상은 미측정입니다. 도입/보류 판단과 남은 범위는 [프로젝트 규칙과 새 파일](PROJECT-RULES-AND-NEW-FILES.md)을 참고합니다.

## 2026-09-23 computer use and desktop typography

- Runtime suite: 89 tests passed. The focused 12-test computer suite was rerun after the final window-region hover capture and child-abort changes.
- Actual Theia + Chrome integration: 46 checks passed, including compiled cursor CSS, platform availability and 15px/17px narrow-layout typography.
- Shared Nubi UI: 11 checks passed, including click/hover/input annotation, explicit/reduced motion, reload-persistent text preference and 440px layout.
- CX UI scan: zero issues. Browser and Electron bundles passed; final runtime worker was recompiled and copied to both targets after the hover capture correction.
- No Windows UIA, winapp installation, native OS cursor recording, live model vision quality or Windows packaging was validated. The experimental adapter and configuration boundary are documented in `COMPUTER-USE.md`.
- Logs: `verification/computer-*.log`. Images: `verification/ui-computer-cursor.png`, `verification/ui-cursor-typography.png`, `verification/ui-cursor-typography-narrow.png`.


## 2026-09-23 탭 아이콘 표시 수정

- 실제 Theia 화면에서 기본 탭 CSS의 background 선언이 누비 PNG를 덮어 검정 사각형이 되는 현상을 재현했다. 설치된 Theia tabs.css를 확인해 누비 아이콘과 드래그 표시 선택자만 구체화했다. 기존 새 이미지 재사용으로 추가 라이브러리는 필요하지 않았다.
- 브라우저에서 1280px/440px 너비의 투명 배경, 32px 원본 이미지 디코딩, 16px 표시와 제목 간격을 확인했다. 열린 미리보기를 새로고침했다. 증거: verification/tab-icon-before.png, tab-icon-after-1280.png, tab-icon-after-440.png.
- Browser/Electron 번들 빌드와 CX UI 검사는 통과했다. 실제 Electron/Windows 실행 검증은 이번 범위에 포함하지 않았다.


## 2026-09-23 Windows 앱 실행과 값 대조

- 기존 winapp/Pi 제어를 확장했다. Theia 파일 선택과 작업별 EXE 등록, 해시 재검사, 직접 프로세스 실행, 살아 있는 자식 PID의 창 조회, 명시적 창 연결, UIA 값 대조와 사용자 요청 Wiki 기록을 구현했다. Node와 Theia의 기존 API를 재사용해 별도 FlaUI/Python 실행기는 추가하지 않았다.
- 전체 런타임 99개 통과 후 Wiki 연결 검사를 추가했다. 최종 컴퓨터/앱 실행 검사 23개와 영향받는 Wiki/품질/복구 검사 45개가 통과했다. 실행에는 주입한 native 프로세스/UIA 응답을 사용했으며 Windows를 실행한 검사가 아니다.
- 실제 Theia 브라우저 검사 46개, 공통 UI 검사 13개 통과. 후자는 앱 등록, 파일 선택 취소, 실행 승인, 명시적 창 연결, 미확정 결과 조회/확인과 440px 레이아웃을 포함한 합성 화면 검사다. 브라우저/Electron 빌드와 CX 검사는 통과했다. 미리보기 4330 서버를 유휴 상태 확인 후 갱신했다.
- 기록: verification/windows-apps-runtime.log, windows-apps-final-tests.log, windows-apps-wiki-regression.log, windows-apps-theia-ui.log, windows-launch-ui.log, windows-apps-build.log, windows-apps-electron.log. 화면: verification/ui-windows-launch.png, ui-windows-launch-narrow.png.
- 실제 Windows 11, winapp 바이너리 설치, 회사 앱/SSO, 패키지 앱 프로세스 전환, 모델 정확도는 미검증이다. 설치 파일을 생성하거나 배포하지 않았다. 설정과 Windows 검증 범위는 docs/COMPUTER-USE.md를 따른다.

## 2026-09-23 Windows 하네스와 화면 분석 연결

- 기존 Pi와 분석 조정기에 Windows UIA, 캡처와 저장된 동작 결과를 연결했다. 하위 분석은 지정된 근거만 읽으며 앱 조작 권한을 갖지 않는다. 결과 분석 버튼은 원래 동작을 재실행하지 않는다. 선택 근거와 사용 흐름은 [WINDOWS-HARNESS.md](WINDOWS-HARNESS.md)에 기록했다.
- 데스크톱 런타임 105개, 공유 에이전트 480개 검사 통과. 합성 모델과 native 응답으로 이미지 전달, 분석 문맥 격리, 과거 근거의 입력 차단, 미확정 기록의 문맥 압축 보존, 중복 분석 방지와 세 번 실패 후 같은 작업의 HITL 전환을 확인했다.
- 실제 Theia 브라우저 검사 46개, 합성 공통 UI 검사 14개 통과. 결과 분석 연결과 네이티브 재실행 방지, 440px 화면을 확인했다. 데스크톱과 확장 CX 검사 이슈 0. Browser/Electron 개발 번들과 Chrome 확장 candidate 빌드 통과. 확장 빌드의 기존 chunk 크기 경고는 남아 있다.
- 로그: verification/computer-harness-runtime.log, computer-harness-shared-ui.log, computer-harness-theia-ui.log, computer-harness-build.log, computer-harness-electron.log. 공유 코어와 candidate 로그는 extensions/aipro-chat/verification/computer-harness-core.log, computer-harness-candidate.log. 화면: verification/ui-windows-launch.png, ui-windows-launch-narrow.png.
- 실제 Windows 11 앱 제어, winapp 설치, DPI/다중 모니터, 회사 앱과 실모델 이미지 해석 정확도는 미검증이다. OCR 실행기나 좌표 추정 클릭을 추가하지 않았으며 설치 파일을 생성하거나 배포하지 않았다.

## 2026-09-23 배포 전 품질 재검사

- OpenWiki-SDS 0.6.0의 실제 12개 소스 파일을 번들에 사용함을 확인했다. 패키지 이름과 버전, 실제 포함 소스의 SHA-256을 runtime-provenance.json에 기록하고 Electron 검사에서 이름을 검증한다.
- Monaco 내장 DOMPurify를 공식 Theia esbuild 확장으로 3.4.15에 연결했다. 단순 npm override로는 내장 3.2.7 코드가 남는 것을 확인해 별도 빌드 차단 조건을 추가했다. UUID 11.1.1과 Mocha diff 8.0.3은 실제 호출 API를 검사했다. npm audit의 보고 항목은 25개에서 0개로 줄었다. 모든 보안 문제의 부재를 의미하지 않는다.
- 오래된 동작 결과에서 분석을 재개할 때 같은 작업의 새로운 승인 대기/미확정 동작을 먼저 확인하도록 수정했다. 회귀 검사 포함 런타임 108개, Theia UI 46개, 공통 UI 14개, CX 검사 이슈 0. Browser/Electron 빌드 통과.
- macOS에서 실제 Electron 42.8.1 창과 신뢰 확인, 누비 UI, 번들 worker IPC, SQLite, 소스 읽기와 OpenWiki-SDS 검색을 통과했다. Electron 내부 Node는 24.18.1이었다. 처음 검사에서 신뢰 대화상자를 처리하지 않아 대기했고, 이후 검사 코드의 require 접근을 Node builtin 조회로 수정했다. Windows 검증 결과와는 별도다.
- Windows 첫 검사에서는 깨끗한 환경에 공유 브라우저 소스의 p-retry 의존성이 없어 실패했다. README와 workflow에 공유 패키지 잠금 설치를 추가했다. 기존 Mac node_modules에 의존하던 테스트 준비 누락을 수정한 것이다.
- 로그: verification/quality-release-*.log, quality-release-audit-final.json, electron-release.json, electron-release.png. Windows 빌드/설치 결과는 docs/WINDOWS-RELEASE.md와 해당 CI 기록에서 따로 확인한다.

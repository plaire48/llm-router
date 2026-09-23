# 구현 결정 — 2026-09-23

이전 조사 `docs/research/2026-09-23-nubi-ide-foundation.md`, `nubi-shell-environment.md`, `nubi-project-knowledge-bp.md`와 두 Desktop/Project Hub 명세를 첫 실행 가능한 경로로 구체화했습니다.

| 판단 | 실제 반영 | 범위와 비선택 이유 |
|---|---|---|
| IDE 기반 | Theia 1.75.0 + Monaco, 공식 extension/browser/electron 분리 | Code-OSS 전체 포크와 독자 편집기보다 기존 에디터 저장·undo·diff 서비스를 활용하기 적합. VS Code marketplace/확장 호환 전체를 보장하지 않음 |
| 단순한 화면 | 누비 로그인 → 연결 후 요청 홈, 작업/소스와 Wiki/실행과 비교 3개 보기 | IDE 메뉴 전체를 누비 홈에 복제하지 않음. 업로드 HTML을 기준으로 서체·색·등장·카드 전환 적용 |
| 누비 공통성 | 기존 CX, NubiLogin, Welcome, ModelSelection, FabrixConnection, NubiComposer, AgentTrace, MessageBody, AgentMark, DeckSurfaces를 소스 import. 전체 공유 CSS cascade 재사용 | Office/브라우저 UI를 새 복사본으로 분기하지 않음. CX는 내부 UNLICENSED 자산이며 오픈소스로 분류하지 않음 |
| Agent | 기존 Pi harness + 문맥 관리 + 세 제공자 어댑터 | 인증 저장소·OAuth 값을 공유하지 않음. 이 단계의 도구는 분석·읽기·제안·질문이며 shell 자동 승인 실행은 아님 |
| 사용자 편집 보호 | Monaco document dirty/version + SHA-256 + 실제 저장 readback, Git merge-file | 파일을 직접 덮어쓰기보다 IDE의 편집 모델을 사용. 오래된 제안의 열람과 적용 가능성은 분리 |
| 지식 | OpenWiki 검색과 일회용 페어링의 실제 소스를 번들. OpenSpec 형식 요구사항 출력 | 별도 임베딩 서버나 추가 DB 구축 없이 출처·행·해시 유지. 검색 결과는 정적 근거이며 기능 실행 증거가 아님 |
| 명령 실행 | Git CLI, Bash/PowerShell 자식 프로세스, 종료·취소·전체 로그·상태 저장 | 모든 CLI를 MCP로 다시 감싸지 않음. WSL 자동 설치/배포와 OS 샌드박싱은 미구현 |
| 브라우저 비교 | Playwright + PNGJS + pixelmatch | 원격 페이지·사용자 로그인 상태에 접근하지 않는 로컬 비교. 서버-소스 버전 연결이 검증되지 않았음을 결과에 기록 |
| 복구 | 작업 상태와 결과 영수증 저장, 취소된 작업 자동 재개 금지 | 프로세스가 죽은 뒤 성공을 추정하거나 쓰기를 자동 재전송하지 않음. 사용자 재개 시 원래 요청·조건·질문·이전 영수증 유지 |

Theia 1.75의 실제 소스와 [공식 구성 문서](https://theia-ide.org/docs/composing_applications/), [확장 문서](https://theia-ide.org/docs/authoring_extensions/)를 확인했습니다. 현 버전은 esbuild를 사용하므로 과거 webpack 구성을 복사하지 않았고, 존재하지 않는 `@theia/git@1.75.0` 대신 Git CLI를 사용합니다. [Git worktree](https://git-scm.com/docs/git-worktree), [merge-file](https://git-scm.com/docs/git-merge-file), [Playwright 화면 캡처](https://playwright.dev/docs/screenshots)의 동작과 설치된 API를 기준으로 구현했습니다.

Codex/Claude의 작업 중심 UI, 저장소 지침, 작은 도구 호출, 실제 결과 확인은 기존 조사에서 가져온 방법론입니다. 이 제품들의 비공개 실행기나 데스크톱 구현을 재현했다고 주장하지 않습니다. MCP/A2A 연결, 지속적 Wiki 생성, Office 수신 확인은 다음 구현 단위이며 이름만 채택한 기능으로 노출하지 않습니다.

새로고침 후 Theia dock 폭이 이전 값으로 복원되는 경우, 실제 부모 할당 폭과 Lumino의 공개 ResizeMessage를 동기화합니다. CSS 백분율 max-width는 Lumino의 픽셀 제한 계산과 맞지 않아 사용하지 않았습니다. IDE 원본 소스는 수정하지 않았고 실제 편집기·diff·새로고침·좁은 화면 검사로 확인했습니다.

현재 검증은 macOS 로컬 브라우저/프로세스/데스크톱 및 합성 모델 계약입니다. Windows/사내 모델 품질과 실제 Office 문서 작업 성공으로 확대 해석하지 않습니다.

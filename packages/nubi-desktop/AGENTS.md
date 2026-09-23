# Nubi Desktop

- This package is the user's explicitly authorized implementation of the Desktop proposal. Keep the browser extension, Office and router contracts intact.
- User-facing Korean copy and model replies MUST lead with the key result or next action. Use complete, concise sentences and retain details needed for decisions or recovery. NEVER use middle-dot separators. Remove repeated explanations and keep secondary details behind existing disclosures.
- Use Theia services for the IDE. The user requires a simple interface matching `/Users/ganadi/Downloads/agentfactorysdkdeck.html`; use the actual shared Nubi login, provider selection, Welcome, composer and message components. Workspace-specific panels can improve source, Wiki, run and comparison workflows. Keep secondary operations behind disclosures. Do not copy a dense dashboard into the home view.
- Preserve dirty editor buffers, Git checkout changes and human-authored knowledge. No automatic stash/reset/clean/push. Match content hashes before applying a proposal.
- Scope the backend to the opened project and owned worktrees. Keep credentials in this host's memory. Read-only project pairing must never grant shell or document-write access.
- Run package tests, build and actual browser interaction checks. Distinguish fixtures, local runtime, model/provider access, Electron and Windows. Office installer builds remain subject to the root rule.

- Agent edits require observations from the current run. Prefer unique exact replacements within observed ranges; do not treat old summaries as read authorization for full-file replacement.
- Wiki evidence revisions are new files under the task workspace. NEVER overwrite a human-edited or dirty-buffer revision, infer acceptance from exit codes/pixels, or silently commit generated documents.
- Keep one execution owner per local SQLite state directory. Acquire ownership before mutating recovery states; let OS locks release on process exit. Do not claim cross-machine coordination.
- Keep the Theia CLI archive compatibility adapter and dependency overrides reproducible in package.json/package-lock; never patch installed modules in place. See docs/IMPROVEMENTS.md for residual audit findings.

- Knowledge relations distinguish Git declarations, parsed DDL, collected DB metadata and imported snapshots. Preserve resource hashes, direction, missing coverage and collection time; no inferred link is execution evidence. Git catalog stores connection IDs only. DB credentials remain in host memory and never enter Wiki/model context. See docs/KNOWLEDGE-QUALITY.md for bounded adapters, FK limits and validation boundaries.
- Model edits require a current-run change plan covering observed targets and every original acceptance criterion. A plan/check is not a passed result. Use shared Nubi question parsing/rendering, preserve drafts and answer history, and refuse stale/duplicate answers or bypassing a pending question.

- Reuse the shared Pi analysis coordinator and context manager. Child analyses receive scoped briefs and read-only project tools; child source reads MUST NOT grant leader edit observations. Forward cancellation to child transports and preserve all original criteria and answered decisions after compaction.
- Recovery MUST distinguish retryable inference, failed reads, and unknown writes/process outcomes. Reuse Nubi's p-retry transport; journal operations before execution and reconcile actual file hashes/receipts before resuming. NEVER replay commands after a lost response or host restart, or auto-resume user cancellation. Failed commands may trigger AI diagnosis; corrected commands retain explicit execution and result review. Unsettled record-writing tools block overlapping execution. See docs/RECOVERY-HARNESS.md.

- Wiki retrieval reuses OpenWiki MiniSearch, ClaimsStore and RepositoryEvidenceResolver, with declared Graphology relations and RRF. Read Claims only; NEVER equate matching versions with factual truth, execution or edit authorization. Cite only evidence observed by the leader in the current run; revalidate cited documents, Claims and source hashes before plans/proposals. Keep missing provenance explicit. See docs/OPENWIKI-EVIDENCE.md.

- Reuse ripgrep for bounded literal source search and TypeScript/JSONC/YAML for in-memory draft diagnostics. Check before proposal creation and application; introduced errors or unavailable supported checks MUST return feedback instead of applying. Keep unchanged baseline errors, unsupported languages, syntax checks, types and execution tests distinct. AST outlines MUST NOT grant edit observations. Bundle and copy the analysis worker for both app targets. See docs/CODING-AGENT-QUALITY.md.

- 누비 앱 간 작업 전달은 `packages/nubi-a2a`의 공식 A2A 1.0 SDK 전송과 수신자별 로컬 연결을 재사용한다. Desktop은 SQLite 작업/근거 조정 서버이며 Chrome/Office는 수신 클라이언트다. 가져온 요청은 기존 채팅에서 명시적으로 전송하고 기존 HITL을 유지한다. 소스/Wiki 버전이 바뀐 결과는 받지 않으며 A2A 완료를 실제 테스트 통과나 Office 저장 성공으로 취급하지 않는다. 미확정 결과는 Task/영수증을 조회하고 실행을 맹목 재전송하지 않는다. 인증은 모델에 전달하지 않는다. 상세 범위는 `packages/nubi-a2a/README.md`와 `packages/nubi-desktop/docs/A2A-COLLABORATION.md`를 따른다.

- 제품명은 **누비 Workspace beta**이며 로고에는 Workspace를 붙이지 않고 **누비 beta**로 표시한다. 누비 제품군의 기존 새 이미지, 워드마크와 모션을 재사용한다. 브라우저/Office의 기본 누비 beta 표기와 내부 패키지 ID는 유지한다.

- 로컬 실행 준비는 기존 소스 조회와 QuestionForm을 재사용한다. 환경 선택 답변을 실행 승인으로 취급하지 않는다. 설치/설정/빌드/실행 제안은 현재 실행에서 읽은 근거와 정확한 명령에 연결하고 호스트의 명시적 일회 승인으로만 실행한다. 근거 변경, 질문 대기와 취소를 검사하며 미확정 실행을 재전송하지 않는다. 예상 영향은 sandbox 보장이 아니고 종료 코드 0은 기능 검증 성공이 아니다. 상세 범위는 docs/ENVIRONMENT-PREPARATION.md를 따른다.

- 프로젝트 규칙은 루트와 대상 파일 경로의 AGENTS.md, 없으면 같은 디렉터리 CLAUDE.md를 제한된 크기로 읽는다. 규칙은 실행 권한이 아니며 외부/홈 규칙을 자동 로드하지 않는다. 규칙 변경이나 새 규칙 추가 시 관찰과 변경 계획을 다시 확인한다. 새 파일은 현재 실행의 부재 관찰과 create 계획, 문법 검사, 사용자 반영, 배타적 생성과 readback을 요구한다. 미확정 생성은 자동 재실행하지 않는다. 부모 폴더 생성은 기존 승인된 환경 준비 흐름을 따른다. 범위는 docs/PROJECT-RULES-AND-NEW-FILES.md를 따른다.

- Windows 컴퓨터 도구는 실험적 winapp JSON 어댑터와 기존 Pi 이미지 전송을 사용한다. 창 연결은 작업별 메모리 권한이며 재시작 시 해제한다. 모델은 관찰/단일 동작 제안만 수행하고 호스트 UI의 정확한 일회 승인 뒤 실행한다. 오래된 관찰, 다른 창/요소/입력값과 미확정 동작은 재실행하지 않는다. 커서 표시는 캡처한 대상의 위치 설명이며 OS 커서 녹화나 업무 성공 증거가 아니다. 화면 이미지는 승인 동작 메타데이터와 분리 저장한다. 실제 Windows 검증/배포 경계는 docs/COMPUTER-USE.md를 따른다.

- Windows 앱 실행은 Theia 파일 선택으로 등록한 작업별 EXE와 해시만 사용한다. 기존 Node 실행기로 승인한 앱을 한 번 시작하고 살아 있는 자식 PID의 창을 확인하며, 창 연결은 별도 사용자 선택이다. 재시작은 앱 권한을 복원하거나 실행을 재전송하지 않는다. Pi의 값 대조 결과는 개별 컨트롤 확인이며 업무 완료가 아니다. 명시적 Wiki 기록에는 결과 메타데이터만 추가하고 앱 경로, 입력값과 이미지를 제외한다.

- Windows 관찰/결과 근거는 공유 Pi 분석 조정기에 호스트 opt-in으로 등록한다. 하위 분석은 동결된 근거만 읽고 native 도구/승인 권한을 받지 않는다. 과거 캡처와 요약은 새 조작 관찰을 대체하지 않는다. 결과 분석 재개는 원래 동작을 재실행하지 않으며, UIA 변화 없는 반복 실패는 기존 질문 폼으로 전환한다. 범위는 docs/WINDOWS-HARNESS.md를 따른다.

- Windows 배포는 Windows x64에서 Theia native 모듈을 Electron ABI로 재빌드한 뒤 electron-builder NSIS로 만든다. 실제 설치 앱의 UI/worker/OpenWiki-SDS와 설치/재설치/제거 검사를 통과한 산출물만 게시한다. 러너 Windows 버전, 서명 상태, 실사용 Windows 11/실모델 미검증을 구분한다. Monaco의 내장 정제 코드는 저장소의 esbuild 플러그인으로 수정판에 연결하며 node_modules를 직접 수정하지 않는다. 상세 범위는 docs/WINDOWS-RELEASE.md를 따른다.

- Windows 대상 검색은 연결된 HWND의 winapp UIA search를 사용하고 부분 조회 범위를 보존한다. 클릭/invoke 결과는 사라진 대상 대신 창 전체 캡처와 historical UIA로 읽는다. 검색어/요소 순서 변경은 실패 복구의 진전이 아니며 과거 결과는 새 조작 관찰을 대체하지 않는다.

- VOC import는 호스트 UI가 선택한 nubi-voc-v1 JSON만 현재 Workspace에 새 revision으로 보관한다. 기존 AJV/MiniSearch/SQLite와 Pi 검색/구간 읽기를 재사용하며 변경된 원본을 덮어쓰지 않는다. imported/stored_bytes_only를 실제 JSM 수집이나 해결 검증으로 취급하지 않는다. A2A 파일 전송과 자동 JSM 수집은 아직 별도 미구현이며 docs/VOC-IMPORT.md를 따른다.

- 사용자 요청에 따라 A2A 추가 구현은 보류한다. 향후 연결 가능성만 유지하며 현재 품질 개선과 배포에서 새 A2A 기능을 추가하지 않는다.

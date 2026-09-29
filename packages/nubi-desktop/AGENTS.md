# Nubi Desktop

- This package is the user's explicitly authorized implementation of the Desktop proposal. Keep the browser extension, Office and router contracts intact.
- User-facing Korean copy and model replies MUST lead with the key result or next action. Use complete, concise sentences and retain details needed for decisions or recovery. NEVER use middle-dot separators. Remove repeated explanations and keep secondary details behind existing disclosures.
- Use Theia services for the IDE. The user requires a simple interface matching `/Users/ganadi/Downloads/agentfactorysdkdeck.html`; use the actual shared Nubi login, provider selection, Welcome, composer and message components. Workspace-specific panels can improve source, Wiki, run and comparison workflows. Keep secondary operations behind disclosures. Do not copy a dense dashboard into the home view.
- MUST preserve the HTML identity across all components and portals through shared deck tokens and `design/workspace-identity.css`. New DetailPanel elements use `deck-dialog`; never add per-screen raw brand overrides. Keep useful details readable, remove redundant copy, and use named/tooltip-equipped CX icon actions for unambiguous utilities while retaining explicit approval labels. Follow `docs/VISUAL-IDENTITY.md` and run `npm run verify:identity` for visual changes; compilation enforces `design:check`.
- Screen CSS MUST use shared typography/color tokens, including nested dialogs and large-text mode. Numeric font sizes and raw colors belong only in the central identity layer; inline JSX typography/brand overrides are rejected. Reuse CX ActionButton for recognizable icon utilities with keyboard tooltips. Keep approval scope, changed targets, unresolved results and recovery actions readable even when shortening copy.
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
- Conversation compaction MUST retain original messages in SQLite. Reuse a saved history boundary only when its task prefix hash matches, keep recent turns and bounded literal user requests, and reread live host requirements/receipts after in-run compaction. Historical conversation reads and summaries MUST NOT restore observations or approvals. Preserve cancellation and never replay tools for a model overflow. See `../../docs/research/2026-09-23-nubi-context-compaction.md` for budget assumptions and real-model verification boundaries.
- Budget compaction against the actual Pi tool definitions including progress fields. Only completed historical turns may use Desktop's explicit zero-recent-turn fallback; NEVER compact an unanswered current user request through that fallback. Protected requirements and live host receipts remain outside the summarized span.
- Recovery MUST distinguish retryable inference, failed reads, and unknown writes/process outcomes. Reuse Nubi's p-retry transport; journal operations before execution and reconcile actual file hashes/receipts before resuming. NEVER replay commands after a lost response or host restart, or auto-resume user cancellation. Failed commands may trigger AI diagnosis; corrected commands retain explicit execution and result review. Unsettled record-writing tools block overlapping execution. See docs/RECOVERY-HARNESS.md.

- Wiki retrieval reuses OpenWiki MiniSearch, ClaimsStore and RepositoryEvidenceResolver, with declared Graphology relations and RRF. Read Claims only; NEVER equate matching versions with factual truth, execution or edit authorization. Cite only evidence observed by the leader in the current run; revalidate cited documents, Claims and source hashes before plans/proposals. Keep missing provenance explicit. See docs/OPENWIKI-EVIDENCE.md.

- Reuse ripgrep for bounded literal source search and TypeScript/JSONC/YAML for in-memory draft diagnostics. Check before proposal creation and application; introduced errors or unavailable supported checks MUST return feedback instead of applying. Keep unchanged baseline errors, unsupported languages, syntax checks, types and execution tests distinct. AST outlines MUST NOT grant edit observations. Bundle and copy the analysis worker for both app targets. See docs/CODING-AGENT-QUALITY.md.

- A2A는 사용자 요청으로 보류한다. 현재 앱은 연결 UI, 전송 서버와 모델 문맥 주입을 활성화하지 않는다. 기존 실험 소스는 참고용으로 보존하며 새 A2A 구현은 사용자 요청 전까지 추가하지 않는다.

- 제품명은 **누비 workspace**, 사용자 표시 버전은 **beta 1.1.0**으로 통일한다. 패키지와 Windows 메타데이터의 숫자 버전은 **1.0.0**, GitHub 릴리즈는 사전 배포로 표시한다. 로고는 기존 누비 beta 워드마크를 유지한다. 이전 설치의 업그레이드를 위해 앱 ID와 영문 실행 파일 이름은 유지한다. 누비 제품군의 기존 새 이미지, 워드마크와 모션을 재사용한다. 브라우저/Office의 기본 누비 beta 표기와 내부 패키지 ID는 유지한다.

- 로컬 실행 준비는 기존 소스 조회와 QuestionForm을 재사용한다. 환경 선택 답변을 실행 승인으로 취급하지 않는다. 설치/설정/빌드/실행 제안은 현재 실행에서 읽은 근거와 정확한 명령에 연결하고 호스트의 명시적 일회 승인으로만 실행한다. 근거 변경, 질문 대기와 취소를 검사하며 미확정 실행을 재전송하지 않는다. 예상 영향은 sandbox 보장이 아니고 종료 코드 0은 기능 검증 성공이 아니다. 상세 범위는 docs/ENVIRONMENT-PREPARATION.md를 따른다.
- 관리자 실행은 Windows PowerShell의 짧은 단일 명령에 한정하며 관리자 전용 HITL과 OS RunAs/UAC를 거친다. 원래 명령은 메모리에서 고정하고 상승 뒤 사용자 쓰기 가능 스크립트 파일을 다시 읽지 않는다. 앱은 일반 권한을 유지하며 UAC 자동 클릭, 자격 증명 저장, 정책 변경, 무인 승인과 관리자 상시 셸을 제공하지 않는다. 취소는 이미 시작한 상승 프로세스의 종료를 보장하지 않으며 감시 프로세스를 죽여 종료로 표시하지 않는다. 미확정 결과는 재실행하지 않는다. 러너의 관리자 토큰 검사와 실제 Windows 11 UAC 사용자 승인은 구분한다.

- 프로젝트 규칙은 루트와 대상 파일 경로의 AGENTS.md, 없으면 같은 디렉터리 CLAUDE.md를 제한된 크기로 읽는다. 규칙은 실행 권한이 아니며 외부/홈 규칙을 자동 로드하지 않는다. 규칙 변경이나 새 규칙 추가 시 관찰과 변경 계획을 다시 확인한다. 새 파일은 현재 실행의 부재 관찰과 create 계획, 문법 검사, 사용자 반영, 배타적 생성과 readback을 요구한다. 미확정 생성은 자동 재실행하지 않는다. 부모 폴더 생성은 기존 승인된 환경 준비 흐름을 따른다. 범위는 docs/PROJECT-RULES-AND-NEW-FILES.md를 따른다.

- Windows 컴퓨터 도구는 실험적 winapp JSON 어댑터와 기존 Pi 이미지 전송을 사용한다. 창 연결은 작업별 메모리 권한이며 재시작 시 해제한다. 모델은 관찰/단일 동작 제안만 수행하고 호스트 UI의 정확한 일회 승인 뒤 실행한다. 오래된 관찰, 다른 창/요소/입력값과 미확정 동작은 재실행하지 않는다. 승인 전 커서는 대상 미리보기다. 실행 시 Windows 투명 포인터 창을 실제 UIA 호출에 연결하며 사용자 커서나 포커스를 옮기지 않는다. 표시를 숨긴 뒤 결과를 캡처하고 애니메이션은 시스템 설정을 따른다. 포인터는 OS 입력 녹화나 업무 성공 증거가 아니다. 화면 이미지는 승인 동작 메타데이터와 분리 저장한다. 실제 Windows 검증/배포 경계는 docs/COMPUTER-USE.md를 따른다.

- Windows 앱 실행은 Theia 파일 선택으로 등록한 작업별 EXE와 해시만 사용한다. 기존 Node 실행기로 승인한 앱을 한 번 시작하고 살아 있는 자식 PID의 창을 확인하며, 창 연결은 별도 사용자 선택이다. 재시작은 앱 권한을 복원하거나 실행을 재전송하지 않는다. Pi의 값 대조 결과는 개별 컨트롤 확인이며 업무 완료가 아니다. 명시적 Wiki 기록에는 결과 메타데이터만 추가하고 앱 경로, 입력값과 이미지를 제외한다.

- Windows 관찰/결과 근거는 공유 Pi 분석 조정기에 호스트 opt-in으로 등록한다. 하위 분석은 동결된 근거만 읽고 native 도구/승인 권한을 받지 않는다. 과거 캡처와 요약은 새 조작 관찰을 대체하지 않는다. 결과 분석 재개는 원래 동작을 재실행하지 않으며, UIA 변화 없는 반복 실패는 기존 질문 폼으로 전환한다. 범위는 docs/WINDOWS-HARNESS.md를 따른다.

- Windows 배포는 Windows x64에서 Theia native 모듈을 Electron ABI로 재빌드한 뒤 electron-builder NSIS로 만든다. 실제 설치 앱의 UI/worker/OpenWiki-SDS와 설치/재설치/제거 검사를 통과한 산출물만 게시한다. 러너 Windows 버전, 서명 상태, 실사용 Windows 11/실모델 미검증을 구분한다. Monaco의 내장 정제 코드는 저장소의 esbuild 플러그인으로 수정판에 연결하며 node_modules를 직접 수정하지 않는다. 상세 범위는 docs/WINDOWS-RELEASE.md를 따른다.

- Windows 대상 검색은 연결된 HWND의 winapp UIA search를 사용하고 부분 조회 범위를 보존한다. 클릭/invoke 결과는 사라진 대상 대신 창 전체 캡처와 historical UIA로 읽는다. 검색어/요소 순서 변경은 실패 복구의 진전이 아니며 과거 결과는 새 조작 관찰을 대체하지 않는다.

- VOC import는 호스트 UI가 선택한 nubi-voc-v1 JSON만 현재 Workspace에 새 revision으로 보관한다. 기존 AJV/MiniSearch/SQLite와 Pi 검색/구간 읽기를 재사용하며 변경된 원본을 덮어쓰지 않는다. imported/stored_bytes_only를 실제 JSM 수집이나 해결 검증으로 취급하지 않는다. A2A 파일 전송과 자동 JSM 수집은 아직 별도 미구현이며 docs/VOC-IMPORT.md를 따른다.

- 사용자 요청에 따라 A2A 추가 구현은 보류한다. 향후 연결 가능성만 유지하며 현재 품질 개선과 배포에서 새 A2A 기능을 추가하지 않는다.

- 사용자 최신 결정에 따라 UIA를 기본으로 하고 같은 연결과 대상에서 새로운 관찰로 확인한 UIA 패턴 부재가 3회 쌓인 경우에만 실제 Windows 마우스 제어를 동작별 HITL로 제안한다. 중복 관찰, 대상 변경과 미확정 실행은 실패 횟수에 넣지 않는다. 정상 조작, 연결 변경, 취소와 2분 경과로 조건을 해제한다. pointer_click/pointer_double_click/pointer_right_click/hover/drag는 shared_pointer 제안과 명시적 pointerConsent가 모두 필요하다. 기존 hover 승인이나 질문 답변을 재사용하지 않는다. 드래그는 같은 창에서 관찰한 두 대상을 검증한다. 가상 커서는 검정색과 흰 테두리의 둥근 화살표이며 배지를 붙이지 않는다. 미리보기와 실제 도구 실행 표시, 실제 마우스 입력을 구분한다. 물리 입력으로 자동 폴백하거나 포괄 승인을 저장하지 않는다. 중지는 이미 시작한 짧은 동작의 취소/복원을 보장하지 않으며 결과 확인 후에도 자동 재개하지 않는다.

- Windows UIA 상태 동작은 명시적 select/toggle_on/toggle_off/expand/collapse만 허용한다. 목표 상태를 재조회하고 상태 일치와 업무 완료를 구분한다. OpenWiki-SDS 근거 ID는 주 실행기의 현재 조회에서만 가져오며 제안, 승인, 가상 포인터/문서 확인 후 native 입력 직전에 다시 검증한다. winapp 자식 프로세스에는 제한된 Windows 환경 변수와 누비 workflow ID만 전달한다. 변경된 근거와 미확정 쓰기를 우회하거나 재전송하지 않는다. 상세 판단은 `docs/COMPUTER-USE.md`와 `docs/OPENWIKI-EVIDENCE.md`를 따른다.

- 프로젝트 스킬은 작업 Workspace 루트의 `.agents/skills`, `.claude/skills`, `.opencode/skills`에서 메타데이터만 검색하고 필요한 본문/참조만 해시 확인 후 읽는다. 기존 YAML/MiniSearch와 Pi 도구 루프를 재사용한다. 스킬의 allowed-tools와 스크립트는 승인이나 소스 수정 관찰이 아니며 자동 실행하지 않는다. 홈/외부 경로와 심볼릭 링크는 자동 로드하지 않는다. 도구 선택 안내는 실제 등록된 도구만 제공하며 실행 가능 여부와 성공은 호스트 상태/결과로 별도 확인한다. 상세 범위는 docs/AGENT-SKILLS-AND-TOOLS.md를 따른다.

- Desktop은 공통 Pi 실행기의 `clarifyOnStall`을 사용해 같은 도구 결과가 세 번 반복되면 기존 HITL 질문으로 구체적인 장애를 확인한다. 원래 목표와 조건, 답변 이력, 완료/미확정 기록을 유지하고 질문 답변을 쓰기 승인으로 취급하지 않는다. 전체 업무의 호출 횟수 제한이 아니다.

- Desktop 최종 응답은 동일 모델의 별도 문맥에서 요구사항과 주 실행기 근거/호스트 기록을 검토한다. Ajv로 요구사항 전체 대응과 근거 ID를 검증하고 누락 작업은 같은 Pi 작업으로 이어간다. 검토 ready는 답변 전달 가능 상태이며 완료 조건 통과나 반영 승인이 아니다. 새 근거 없는 검토 실패 3회는 기존 질문 폼으로 넘긴다. 자식 조회, 요약, 새 불투명 ID를 실행 근거나 진전으로 승격하지 않는다. 압축된 대화 경계와 원래 조건/답변을 유지하고 상세 근거는 별도 SQLite 기록에 둔다. 범위와 비용/실모델 한계는 docs/RESULT-REVIEW-HARNESS.md를 따른다.

- 사용자 스킬 등록은 Theia 파일 선택기로 고른 단일 스킬 ZIP/폴더를 현재 작업 Workspace의 `.agents/skills/<name>`에 하위 구조 그대로 저장한다. SKILL.md 규격과 바이너리 바이트를 보존하고 기존 스킬을 덮어쓰지 않는다. 모델은 discover_capabilities → use_skill → read_skill로 등록 지침을 사용하며 등록 RPC는 모델 도구로 노출하지 않는다. 스크립트는 기존 소스 조회와 명령 승인 흐름을 사용하고 스킬 활성화를 실행/반영 승인이나 완료 증거로 취급하지 않는다. 상세 범위는 docs/SKILL-REGISTRATION.md를 따른다.
- 같은 스킬 재등록은 저장된 전체 파일/폴더와 해시가 일치할 때만 변경 없이 확인한다. 자료 이어 읽기는 resourceHash, 목록 페이지는 resourcesHash를 요구하며 변경 시 다시 읽는다. 바이너리는 메타데이터만 반환한다. 카탈로그 한도와 Windows 저장 이름은 쓰기 전에 검사한다.

- Readability and meaning take precedence over reducing character count. Lead with the key sentence and retain its decision-relevant details. Use bold for a few important phrases, deep brand blue for the leading conclusion, and text/icon labels alongside status colors. Prefer verified result images and unambiguous named icon actions; never remove approval scope or recovery instructions.

- 작업은 하나의 대화 화면에서 요청→계획→도구 실행→질문/승인→결과로 이어진다. 소스/Wiki/실행/비교를 사용자가 선택하는 상위 탭으로 다시 나누지 않는다. 자료 탐색과 수동 조작은 아이콘으로 여는 보조 모달에 둔다. 첫 프로젝트 도구 전에 기존 Pi update_plan과 공유 계획 정규화로 짧은 계획을 저장하며 원래 조건과 답변은 계속 유지한다. 계획의 진행 표시는 검증 성공이 아니며 completed 입력을 받지 않는다. 로컬 비교 도구는 확인한 주소와 기존 loopback 캡처기만 사용한다. 범위와 검증은 docs/TASK-FIRST-WORKSPACE.md를 따른다.

- Desktop 첫 계획은 사용자 목표, 보존 조건, 관찰 가능한 예상 결과와 선택한 작업/스킬을 함께 저장한다. 원래 요청과 답변을 모델 해석으로 대체하지 않는다. 초기 스킬 후보는 전체 제한 카탈로그에서 검색하고 본문은 필요할 때 읽는다. 선택한 스킬의 본문 연속 읽기와 현재 해시를 확인한 뒤 프로젝트 작업을 진행하며, 압축 후 다시 읽는다. 최신 호스트 기록으로 대체된 최초 스냅샷만 선택적으로 제거하고 실행 근거/승인을 보존한다. 범위는 docs/INTENT-DRIVEN-AGENT.md를 따른다.

- 대화 본문에는 내부 REQ 번호를 상시 표시하지 않는다. 열린 대화와 날짜별 지난 대화는 왼쪽 프로젝트 사이드바에서 찾고, 입력창에 현재 제공자/모델과 변경 동작을 표시한다. 미전송 입력은 프로젝트/대화별 초안이며 자동 실행/승인으로 취급하지 않는다. 실행 중 다른 대화의 조회와 초안 편집은 허용하되 같은 프로젝트의 동시 Agent 실행은 막고 진행 중인 작업의 중지를 유지한다. 범위는 docs/SESSION-NAVIGATION.md를 따른다.
- Desktop 사이드바와 모델 모달은 기준 HTML의 deck/CX 토큰을 쓴다. 좁은 화면의 사이드바 열림만 짧게 움직이고 IDE 너비는 애니메이션하지 않는다. 작업/입력 중 배경 모션과 숨겨진 문서의 화면 조회를 멈추며 재표시 때 상태를 다시 읽는다. 범위는 docs/SESSION-NAVIGATION.md를 따른다.

- Desktop 대용량 문서 조사는 `docs/DOCUMENT-MULTI-AGENT.md`의 OpenWiki-SDS 코어와 공유 모델 어댑터를 재사용한다. 선택한 UTF-8 파일의 해시를 고정하고 종료 시 재검증한다. 분할/원문 읽기/누락 보완/합성의 실제 워커 이벤트와 범위를 SQLite에 보관하며 읽기 범위와 업무 완료를 구분한다. 조사/저장 보고서는 source-edit 관찰이나 native 실행 권한이 아니다. 인증 실패는 주 실행기도 중단하며 취소/재시작으로 원래 앱 동작을 재실행하지 않는다.
- 문서/역할별 분석 이력은 작업별 SQLite 기록으로 보존하고 최근 trace 제한과 별도로 페이지 조회한다. 캡처 제공/열람, 응답 수신/결과 수집과 업무 완료를 구분한다. 문서 근거에 의존하는 Windows 제안은 documentAnalysisId로 원문/보고서 버전을 고정하고 승인 후 입력 직전 재검사한다. 원문 변경과 미완료 분석을 우회하거나 승인/실행 근거로 취급하지 않는다.
- 최종 검토는 현재 실행의 하위 분석 요약/미확인/실패를 advisoryHandoffs로 받고 주 실행기 근거와 분리한다. 수집은 검토 완료가 아니며 생략한 분담 수를 보존한다. 검토 호출의 실제 시작/응답/중단을 별도 이력에 남기고 오래된 페이지의 알려진 실행도 갱신한다. 검토 ready를 업무 성공이나 반영 승인으로 표시하지 않는다. 상세 범위는 docs/ANALYSIS-HANDOFF-2026-09-25.md를 따른다.
- 워커 진행은 현재 checkpoint.runId의 최신 이벤트만 병합하며 중단/종료 상태를 오래된 running 이벤트로 되돌리지 않는다. 제한된 최종 검토 문맥에는 미해결 분담을 먼저 넣고 제외한 미해결 수를 보존한다. Windows 입력은 가상 포인터와 비동기 근거 확인 뒤 native dispatch 직전 창/요소/입력값을 다시 검사한다. 충돌은 not_started이며 자동 재전송하지 않는다. 범위는 docs/WORKER-STATE-AND-WINDOWS-2026-09-25.md를 따른다.
- 실행 로그 복구는 `read_process_output`의 작업별 고정 저장 경로, bounded 조회/검색과 revision 검사를 사용한다. 보존 버퍼의 미리보기를 전체 로그로 표시하지 않는다. 과거 로그를 다시 읽기 위해 명령을 재실행하거나 하위 분석에 shell/승인 권한을 주지 않는다. 비교 소스와 도입 범위는 docs/AGENT-BENCHMARK-2026-09-25.md를 따른다.
- 에이전트의 `inspect_workspace_changes`는 현재 작업공간의 Git 상태와 단일 파일의 bounded diff만 읽는다. 비공개 경로, 링크와 큰 출력은 제외하거나 불완전으로 표시한다. Git diff는 소스 수정 관찰, 승인, 테스트 성공이 아니며 기존 read_source·해시·반영 검사를 대체하지 않는다. 근거는 docs/AGENT-BENCHMARK-2026-09-25.md를 따른다.

- App connection requests MUST remain in the current conversation via `request_computer_connection`. A request never enumerates windows, captures, binds or grants input authority. Bind by task/request ID, explicitly continue after connection, recheck identity, and restore only the request after restart. Pending requests block generic/automatic resumption; cancellation uses the existing stop state. Keep manual shell/URL forms under project materials, never a required user-selected work mode. See docs/TASK-FIRST-WORKSPACE.md.

- User decisions MUST reuse the shared QuestionForm: one focused question, short choices, then free text below. Hide the regular composer while a question/connection request is pending. Keep connection drafts and answers in the same task; text answers never select a window or grant input authority. Avoid adding technical configuration fields to this decision form.

- Before setup, use `inspect_environment` and current project rules to choose manifest/lockfile defaults and the host shell. Ask only unresolved conflicts or user intent through the existing QuestionForm. Static environment observations authorize setup proposals, NEVER code edits or execution; register only successful reads, clear on compaction and recheck observed file hashes before approval. Keep actual installs and elevation behind existing HITL. See docs/ENVIRONMENT-PREPARATION.md.
- Windows command execution defaults to PowerShell in both agent proposals and direct execution. Project settings persist a selected default among PowerShell, CMD and installed Git Bash; the host must validate availability and pass it to environment inspection and setup proposals. A per-command shell override remains explicit. Keep the chosen shell, exit state, output and expandable exact command in the execution record; do not infer Windows 11 success from macOS or synthetic tests.

- DB connection forms show basic connection fields first and keep ID/port/schema/TLS under connection options. Preserve explicit overrides, derive MySQL/MariaDB schema from the current database and Oracle schema from the current user, and reveal invalid collapsed fields before correction. App choice navigation preserves the draft and never binds or approves input merely by going back. See docs/FORM-CLARITY-2026-09-25.md.

- Form feedback MUST distinguish a completed operation from a failed follow-up list/status read. Preserve confirmed receipts and let users retry only the failed read; never label the completed DB connection or VOC import as failed or replay it for display recovery. App selection errors must describe the actual failed step. See docs/FORM-CLARITY-2026-09-25.md.

- 실측 평가는 `eval/`의 전용 실행기와 `runtime/run-metrics.mjs`의 계측을 쓴다. 계측은 크기, 횟수, 정해진 형식의 코드만 저장한다. 본문, 도구 인자, 도구 결과 내용은 저장하지 않으며 기록 실패로 실행을 멈추지 않는다. 호출 목적은 호출 지점이 표시하고 프롬프트 내용으로 추측하지 않는다. 평가는 등록한 공개 자료와 합성 자료의 이름만 받으며 회사 저장소에 쓰지 않는다. 모의 사용자는 과제가 정의한 질문과 제안 반영만 처리하고 명령, 설정, 관리자 실행, 컴퓨터 동작을 승인하지 않는다. 모델의 완료 선언과 검토 ready는 점수가 아니다. 검사를 통과시키려고 정답, 한도, 과제를 고치지 않는다. 합성 모델 검사, 실모델 측정, 사내 모델과 회사 저장소의 성능을 구분한다. 범위와 명령은 docs/LIVE-EVAL.md를 따른다.

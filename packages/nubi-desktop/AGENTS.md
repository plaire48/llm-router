# Nubi Desktop

- 사용자 결정 2026-10-12: Desktop의 Claude는 FabriX 다음에 표시하는 로컬 Claude Code 어댑터다. 수정하지 않은 공식 CLI와 사용자가 직접 완료한 CLI 인증을 사용하고 인증 파일, Keychain, 브라우저 쿠키를 읽어 OAuth를 재호출하지 않는다. CLI는 safe-mode와 빈 도구 목록으로 응답/도구 제안만 반환하며 Pi와 기존 누비 HITL이 실행을 소유한다. 누비는 모델과 추론 강도 선택만 저장한다. 한도는 CLI가 실제 보고한 수치만 표시하며 미제공/만료를 0이나 100%로 만들지 않는다. Office와 브라우저 제공자 기본 목록은 바꾸지 않는다. 상세 계약은 `docs/CLAUDE-CODE-ADAPTER-2026-10-12.md`다.

- 출력/수집 보강 2026-10-12: PowerShell CLIXML은 표시용으로만 해석하고 원본 로그와 종료 코드를 보존한다. 폴더 접근 거부를 로그인 실패나 명령 형식 오류로 섞지 않는다. UIDL 호환 처리는 식별자를 절대 변경/잘라내지 않고 불완전 목록을 성공 처리하지 않는다. Git 위키는 삭제/희소/하위 저장소 항목과 생성 중 원본 변경을 구분한다. 근거는 `docs/POWERSHELL-CLIXML-2026-10-12.md`, `docs/MAIL-UIDL-COMPAT-2026-10-12.md`, `docs/GIT-WIKI-SOURCES-2026-10-12.md`를 따른다.

- 커밋 이력은 MUST 25개씩 조회하며 페이지 간 HEAD 변경을 감지한다. 커밋을 열 때 파일 내용을 자동으로 읽지 않고 선택한 파일만 비교한다. 변경량 캐시는 서비스/프로젝트 루트/불변 커밋에 한정하며 브랜치 조상 관계와 보호 경로 검사는 생략하지 않는다. 목록 제목은 움직이지 않는 한 줄과 전체 제목 툴팁으로 표시한다. 근거는 `docs/COMMIT-HISTORY-2026-10-12.md`를 따른다.

- 사용자 결정 2026-10-12: 스킬 관리의 내 스킬/AI Workspace 목록은 MUST 검색 후 10개씩 페이지 이동을 제공하고 검색/프로젝트 변경 시 첫 페이지로 돌아간다. 내 스킬에는 휴지통 진입을 표시하지 않으며 등록 버튼의 이름과 넓은 클릭 영역을 유지한다. 삭제 안전 사본의 호스트 계약은 유지한다. 등록 모달의 파일/폴더 선택은 배경과 전경을 함께 지정해 대비를 유지하고 메일 검색 조건에는 별도의 높이 제한/내부 스크롤을 두지 않는다.

- 사용자 결정 2026-10-12: 모든 Desktop 모달의 외곽/제목/필드/하단 동작은 MUST `design/workspace-dialogs.css`의 공통 계약과 `workspace-identity.css` 토큰을 사용한다. 기능 CSS에서 모달 패딩/글자 굵기/닫기 크기를 다시 덮어쓰지 않는다. 제목 18/600, 본문 15/400, 보조 14, 라벨 500, 버튼 40(터치 44), 간격 8/16/24와 의미별 색을 유지한다. 실제 너비/확대/키보드 검사는 `docs/MODAL-CONTRACT-2026-10-12.md`를 따른다.

- 사용자 결정 2026-10-12: 누비 스킬은 MUST 현재 프로젝트 루트의 `.nubi/skill/<name>/`에서만 검색/등록/다운로드/실행 지침 읽기를 제공한다. 다른 클라이언트의 `.agents`, `.claude`, `.opencode`, `.aipro` 스킬과 과거 설치 기록은 자동으로 합치거나 옮기지 않는다. AI Workspace 버튼은 같은 GHES 스킬 원본의 누비 전용 목록/검색/직접 다운로드를 열며 웹사이트 전체나 다른 클라이언트 선택을 표시하지 않는다. 원본 파일과 설치 기록을 검증하고 자동 스크립트 실행은 금지한다.
- 사용자 결정 2026-10-12: 오른쪽 보조 작업은 하나의 `+`에서 파일/웹/터미널을 열고 같은 탭 줄에서 관리한다. 파일 탐색 기본 경로는 현재 프로젝트이며 사람이 직접 입력한 다른 경로는 읽기 전용으로 탐색한다. 이 UI 전용 읽기는 AI 도구/쓰기/프로젝트 범위를 변경하지 않는다. 입력창 hover에는 옅은 선을 유지하고 focus는 누비 파랑을 쓴다.
- 원격 Git 위키 보강 2026-10-12: clone 결과의 정확한 루트를 확인하고 Git 위키 초기화는 원래 HEAD/refs/history를 유지한 checkout 없는 detached worktree에서 실행한다. 허용된 현재 소스만 복사하며 hooks를 실행하거나 원본 index/branch를 변경하지 않는다. 원본 HEAD/파일 변경 시 발행을 거절하고 자기 분석 worktree만 정리한다. `.openwikiignore`의 이력 읽기 제한을 우회하지 않는다. 일반 폴더만 임시 Git 기준을 만든다. 근거와 검증은 `docs/NUBI-SKILLS-AND-TABS-2026-10-12.md`를 따른다.

- 품질 보강 2026-10-12: 위키는 전체 파일 조사 전에 진행 작업을 만들고 조사/분석 기준/모델/저장 단계 실패를 고정 코드로 구분한다. 모달 대기 때문에 표시 요청을 잃지 않으며 실제 단계 수와 경과 시간만 표시한다. POP3의 동일 UIDL 복사본은 같은 메일로 처리하고 목록 형식 오류를 사용자의 POP3 설정 오류로 단정하지 않는다. 서버 응답이나 인증값은 진단 복사에 포함하지 않는다. 검증 범위는 `docs/MAIL-WIKI-PROGRESS-2026-10-12.md`를 따른다.

- 사용자 결정 2026-10-12: 여러 프로젝트를 호스트의 `projects.json`에 저장하고 왼쪽에서 추가/전환/표시 이름 변경/목록 제거를 지원한다. 제거는 원본과 대화 저장소를 삭제하지 않는다. 한 실행기의 현재 프로젝트를 전환하며 실행 중 작업과 미저장 파일은 MUST 보호하고 프로젝트별 초안, 대화 선택, 열린 편집기와 undo를 유지한다. 출처 읽기는 반드시 현재 projectId와 원문 해시를 확인한다. 답변 도착 후 계획/진행 아코디언은 자동으로 접되 다시 열 수 있고 승인/질문/복구 대기를 완료로 표시하지 않는다.

- 위키 연결 보강 2026-10-12: 초기 생성과 갱신은 MUST OpenWiki의 실제 repository runner를 재사용하고 분석용 복사본에만 필요한 Git 기준 정보를 만든다. 원본 폴더를 Git 초기화하지 않는다. 페이지와 `.last-update.json`, `.page-manifest.json`, Claims를 함께 보존하며 임시 Git 커밋을 원본의 이력으로 기록하지 않는다. 생성 전 위키 해시로 사용자의 동시 수정을 보호하고 일반 폴더는 저장된 파일 해시로 변경을 감지한다.

- 사용자 확인 2026-10-12: 회사 GitHub App Client ID는 `Iv1.8526278f12b92180`이며 첫 글자는 대문자 I다. 로그인 코드 발급/승인/계정 확인의 HTTP 실패를 저장소 권한 오류로 표시하지 않는다. 오류 화면에는 고정 단계와 HTTP 상태만 표시하고 서버 본문이나 인증값은 노출하지 않는다.

- 사용자 후속 결정 2026-10-12: 배포 메일 연결 화면은 MUST 회사 메일만 표시하고 새 설정의 기본값도 company로 둔다. Gmail 테스트 연결은 배포 화면에서 제거한다. Windows 메일 worker도 시스템 인증서 신뢰를 적용하며 인증 거절과 개인 저장 권한 실패를 구분한다. 인증서 검증을 끄거나 회사 정책을 우회하지 않는다.
- 사용자 후속 결정 2026-10-12: 모델 목록을 열 때는 연결 시 받은 목록을 재사용하고 명시적 새로고침은 화면 전체를 잠그지 않는다. 목록 조회 시각을 로그인 식별자로 쓰지 않는다. 위키 초기화는 별도 진행 모달에 실제 단계 처리 수, 경과와 계산 가능한 단계의 예상 잔여 시간을 표시하며 백그라운드로 접을 수 있다. 총 소요 시간이나 전체 완료율을 꾸며내지 않는다.

- 사용자 Beta 범위 결정 2026-10-12: 메일 첨부 내용 읽기/미리보기/AI 분석은 MUST 비활성화한다. 첨부 파일명/형식 조건 검색과 원본 다운로드, 메일 본문 검색/질문은 유지한다. 자동 정리는 첨부 대기/실패에 막히지 않고 본문과 메타데이터만 사용한다. 과거 첨부 추출 캐시와 첨부를 포함했을 수 있는 위키를 본문 근거로 재사용하지 않는다. 원본과 기존 읽기/COM 구현은 보존하되 Beta 설치본에는 첨부 분석 worker/파서를 넣지 않는다. 재활성화 시 기존 Office 2016/NASCA 계약과 실제 검증을 다시 적용한다.

- 사용자 설치 요청 2026-10-12: 앱/Windows 실행 파일/바로가기 아이콘은 MUST 기존 `bird-master.png` 새 원본을 공통 빌드 단계에서 재사용한다. 현재 전용 Electron 설치 검사는 `check-electron-shell.mjs`를 실제 설치 EXE에 연결하고 업그레이드/재설치/제거를 구분한다. 비활성 Computer Use의 winapp 드라이버는 설치본에 넣지 않으며 재활성화 시 별도 패키징 검토를 요구한다. 공개 배포와 실제 Windows 11/사내 환경 검증은 설치 파일 생성과 별개다.

- 사용자 후속 결정 2026-10-12: Workspace 내부 AI 및 회사 로그인은 MUST 앱 재시작 후에도 재사용한다. Electron main의 비동기 OS 보호 암호화 저장소만 사용하고 main을 막는 동기/평문 fallback과 다른 앱 인증 저장소 가져오기는 NEVER 사용한다. OS 대기 시간 초과 뒤 늦게 끝난 암호화는 파일에 쓰지 않는다. 로그아웃은 해당 저장 인증을 삭제하고 ChatGPT 갱신 토큰 교체를 저장한다. Office/브라우저 확장과 메일 비밀번호의 메모리 전용 계약은 그대로 유지한다. 기존 Desktop AI/회사 인증 메모리 전용 결정을 이 범위에서 대체한다.

- 사용자 후속 결정 2026-10-12: 대화 `…`의 고정/삭제는 MUST 가로 한 줄 아이콘 팝오버로 표시하고 대화 행을 늘리지 않는다. 스킬 선택창의 중복 제목/설명을 줄이고 스킬 관리 탭과 도구도 한 줄을 유지한다. 공간이 부족하면 보조 이름을 숨기되 접근성 이름, 툴팁과 승인/복구 동작을 보존한다. 기준은 `docs/SKILL-AND-CONVERSATION-MENUS-2026-10-12.md`다.

- 사용자 후속 결정 2026-10-12: 중앙 새는 MUST 기존 날개짓/웃음/눈물/잠든 표정을 유지하고 부드럽게 비행한다. 호버 중에는 웃으며 가볍게 춤추고 벗어나면 기존 상태로 돌아간다. 한 비행 경로와 작은 회전을 사용해 겹치는 도약을 피한다. 입력창 초점만으로 새를 멈추지 않는다. 상단/답변 작은 새의 위치 고정과 모달/비활성/OS 모션 감소 계약은 유지한다. 이전 중앙 새 2px 호흡 전용 결정을 대체한다.

- 사용자 결정 2026-10-12: 메일 읽기 화면은 MUST 제목과 발신자 이름을 강조하고 주소/날짜는 보조 위계로 표시한다. 받는 사람과 참조는 접지 않고 바로 표시하며 메일별 완료 정리 시간과 하단 직전 정리 시간은 숨긴다. AI 질문은 고정/태그/다운로드와 같은 메일 도구 줄에 배치하고 기존 초안 연결/명시적 전송 계약을 유지한다.

- 메일 검색의 일반 키워드는 MUST URL 쿼리/fragment의 추적값을 검색 근거로 삼지 않고, AI/RAG 같은 짧은 영문은 다른 영문 단어 안에서 일치시키지 않는다. 명시적인 URL 검색과 한글 인접 검색은 유지한다. 검색용 투영과 화면 미리보기는 원문/해시/AI 근거를 바꾸지 않는다. 본문은 텍스트와 HTTP 링크만 표시하고 원본 텍스트와 다운로드를 보존한다.

- 사용자 결정 2026-10-12: 메일은 정렬된 목록과 상단 고정 페이지 이동, 편안한/간결한 간격을 제공한다. 본문은 넓은 창에서 목록 옆, 좁은 창에서 단독으로 표시하고 페이지를 넘는 이전/다음과 목록 복귀를 지원한다. 검색/페이지/스크롤/선택은 대화로 이동해도 보존한다. 여러 메일의 AI 연결은 MUST 전부 원문 해시를 재확인한 뒤 원자적으로 초안에 추가하며 부분 실패와 초안 이동 때 붙이지 않는다. 중앙 대화와 오른쪽 메일 원문을 유지하고 선택 범위는 접힌 개수로 표시한다. 검색 결과 전체나 실제 모델 검증으로 확대 해석하지 않는다.

- 메일 통합 검색은 MUST 한 메일의 제목/발신/수신/참조/날짜/태그/본문/첨부/위키에 걸쳐 검색어를 함께 찾고 다른 메일의 단어를 합치지 않는다. 필터는 검색 전에 적용한다. AI로 찾기는 현재 검색어와 조건을 선택한 모델의 대화 초안에 연결하며 기존 초안을 보존하고 자동 전송하지 않는다. 입력창의 Enter와 전송 버튼은 같은 비활성 조건을 사용하고 한글 조합과 Shift+Enter는 전송하지 않는다.

- 사용자 우선순위 2026-10-11: 채팅 본문과 입력창을 먼저 Codex처럼 정돈한다. 대화는 흰 읽기 영역과 옅은 사용자 말풍선, 입력은 얇은 한 겹 테두리를 사용한다. 후속 사용자 결정 2026-10-12: 모델 버튼은 모델 선택 화면의 제공자별 고유 색상 토큰을 그대로 재사용한다. 문맥 도넛은 40px와 선명한 숫자를 유지하고 추론 정도는 공통 번개 아이콘으로 표시한다. AI Workspace는 왼쪽 메뉴 맨 아래에 아이콘만 두고 제품 제목은 누비 Workspace Beta로 표시한다. 추가/모델/추론/승인 방식과 문맥 도넛/전송을 MUST 같은 입력창 테두리 안에 둔다. 좁은 창에서는 보조 이름을 숨기고 아이콘/툴팁/접근성 이름을 유지하며 조작 줄은 줄바꿈하지 않는다. 기존 파랑 강조, 공통 폭과 스크롤/초안/승인/출처 계약을 유지한다.

- 회사 계정 진입은 MUST Electron 상단 오른쪽에 아이콘과 `회사 계정` 이름으로 표시한다. 프로젝트/모델 연결 전에도 표시한다. 로그인 모달과 툴팁에는 회사 서버 주소를 표시하지 않고 로고, 서비스명과 한 줄 안내를 같은 묶음에 배치한다. 긴 프로필 이름은 모달에 두고 기존 GHES Device Flow, 취소/초점 복귀와 세션 인증 계약을 재사용한다. 상단 없는 검토 호스트만 왼쪽 메뉴 진입을 유지한다.

- 최신 사용자 결정 2026-10-11: 모든 화면과 모달에서 아이콘으로 뜻을 알 수 있는 동작은 MUST 텍스트를 생략한다. 이전 모든 기능에 이름을 붙이는 결정을 대체한다. 복사/닫기/검색/새로고침/전송/중지 등은 접근성 이름과 툴팁을 유지하고, 모호한 기능/승인/선택한 모델과 상태에는 짧은 이름을 남긴다. 버튼 간격과 44px 터치 영역은 유지한다.

- 사용자 범위 명확화 2026-10-09: 가독성 개선은 MUST Electron의 모든 화면과 모달, body 포털과 오른쪽 파일/검색/Git/터미널/브라우저까지 동일한 CX 기준으로 적용한다. 핵심을 먼저 표시하고 승인/모델 전달/미확정/복구 정보를 보존한다. `test:all-surfaces`로 최종 Electron CSS의 넓은/좁은 화면과 글자 확대를 검사하고 native 도구 흐름은 `test:ui`로 확인한다. 전체 목록과 증거는 `docs/ALL-SCREENS-READABILITY-2026-10-09.md`를 따른다.

- 사용자 결정 2026-10-09: Electron의 텍스트 가독성을 먼저 개선한다. MUST 기존 레이아웃과 공통 UI를 유지하고 본문/입력 16px, UI 15px, 보조 글자 14px의 상대 단위 토큰을 `design/workspace-identity.css`에서 관리한다. 마지막 텍스트 스타일은 `design/workspace-typography.css`로 통일하며 한글 줄바꿈, 대비, 좁은 창과 글자 확대를 실제 Electron에서 확인한다.

- 후속 사용자 결정 2026-10-09: 상단은 MUST OS 창 조작과 한 줄 48px 도구 줄로 정돈한다. 대화 제목/상태와 기존 조작은 `WorkspaceToolbar`에서 유지하고 사이드바 로고와 두 번째 제목 줄은 중복하지 않는다. 입력/계획/질문/시작 카드의 세로 패딩은 `design/workspace-density.css`로 줄이며 글자 크기, 초안, 편집/승인과 터치 클릭 영역을 유지한다. Windows 창 조작은 native overlay를 쓰며 macOS 검사를 Windows 성공으로 표시하지 않는다.

- 후속 사용자 결정 2026-10-09: MUST 기존 CX, 기준 HTML/PPT의 시각 위계, 누비 이미지와 폰트/색/크기 토큰을 재사용한다. 기본 화면은 짧은 핵심과 주 동작을 먼저 보여주며 중복 인사/설명을 줄인다. 상세는 필요한 동작을 펼칠 때 제공하고 모델 전달 범위, 인증 보관, 승인과 복구 정보는 보존한다. 현재 Electron 수치는 `design/reference.json`의 adaptation과 `docs/VISUAL-IDENTITY.md`를 함께 유지한다.

- 가독성 후속 2026-10-09: 모델 모달은 MUST 목록 수에 맞춰 높이를 줄이고 긴 목록은 스크롤한다. 메일 서버 주소와 자동 정리의 수집 범위는 펼침에 두되 서비스/입력/모델/ON-OFF와 승인 범위는 기본 화면에서 유지한다. 검토 화면의 예시 데이터와 실계정 결과를 구분하며 모달 검사의 글자 수치는 같은 reference.json 계약을 사용한다.

- 사용자 결정 2026-10-07: 검증과 수정은 MUST Electron 앱(`electron-app/`)만 대상으로 한다. Theia 브라우저 앱은 쓰지 않으므로 검사와 수정 대상에서 뺀다. 브라우저 검사(`test:shared-ui`, `test:modals-ui`)는 Electron 배치(`integrated`)로 돌리고, 모든 게이트는 `npm run test:gates`로 차례로 돌린다(브라우저 검사를 동시에 돌리면 Chrome이 멈춘다).

- 사용자 결정 2026-10-07: 메일 자동 정리는 MUST 나중에 연결된 모델을 자동으로 쓴다(명시적 선택을 기다리지 않는다). 사용자가 다른 모델을 고르면 그 선택이 우선한다. 시험은 `tests/mail.test.mjs`의 "a model connected later is used automatically".

- 사용자 결정 2026-10-05: 시작 모달 "메일을 연결해 주세요"는 MUST 자동 정리가 켜져 있고 메일 계정이 연결되지 않았을 때만 표시한다. 그 밖에는 띄우지 않는다. 판단은 호스트(`electron-app/main.cjs`의 `startupConnections`, `lifecycle.cjs`의 `startupMailPrompt`)가 하고 렌더러는 `mailPrompt`만 본다.

- 사용자 결정 2026-10-05: 기본 펼침 상태에서 MUST 양쪽 사이드바의 로고/탭/조작 버튼이 잘리지 않는다. 2026-10-12 여백 축소 결정에 따라 왼쪽 기본 280px/최소 264px, 오른쪽 기본 380px/최소 320px와 대화 입력의 실제 최소 너비를 함께 예약한다. 유효한 사용자 너비는 보존하고 과거의 작은 값만 최소 너비로 올린다. 공간 부족 시 보조 영역은 overlay로 전환하며 너비를 압축해 내용을 자르지 않는다. 상단 제품명 뒤 구분선은 펼쳐진 왼쪽 사이드바의 실제 경계에 맞추고 크기 조절을 따라간다.

- 사용자 결정 2026-10-05: Windows 메일의 Office 첨부는 MUST Office 2016 호환 COM으로 자동 열어 읽는다. NASCA 원본은 바이트 동일성/사용자 ACL을 확인한 읽기용 사본만 Office에서 ReadOnly로 열며 외부 ZIP 파서로 우회하거나 Save/SaveAs/매크로/링크 갱신을 실행하지 않는다. PowerShell STA에서 순차 읽고 UTF-8 결과/읽은 범위/원본 해시를 검증한다. 정책/설치/시간 초과/사본 정리 실패는 보류로 표시하고 사용자 Office 프로세스나 다른 문서는 강제 종료하지 않는다. 일반 파서 캐시는 Office 읽기 성공으로 승격하지 않는다. 편집은 기존 누비 Office의 승인/문서 바인딩/readback 계약을 유지하며 Desktop의 읽기 구현을 편집 연동 완료로 표시하지 않는다. 실제 Windows Office 2016/NASCA 검증과 native/설치 빌드는 별도다.

- 사용자 결정 2026-10-04: 오른쪽 보조 사이드바의 너비 조절은 MUST 경계의 얇고 둥근 한 줄로 표시한다. 호버는 옅은 누비 파랑, 드래그와 키보드 초점은 선명한 파랑이며 긴 외곽선이나 넓은 색 면을 겹치지 않는다. 기존 드래그 영역, 키보드/취소, 너비 기억과 기본 너비 복원 계약을 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 메일 목록은 MUST 검색/조건과 페이지 조작을 고정하고 목록/원문을 각각 스크롤한다. 10/20/50/100개 선택과 현재 범위, 페이지 번호 직접 이동, 같은 모양의 이전/다음을 제공하며 개수 선택만 기기에 보관한다. 페이지/조건 변경 때만 목록을 맨 위로 이동하고 같은 페이지 갱신과 선택한 메일 원문은 보존한다. 검색 snapshot이 바뀌면 기존 cursor reset 계약으로 첫 페이지를 알리고 이동한다. 얇은 둥근 스크롤바, 키보드 스크롤/초점과 터치 영역을 유지하며 인증/POP3/개인 위키 계약을 바꾸지 않는다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 메일 연결은 MUST 서비스/주소, 유효한 주소 뒤 비밀번호, 유효한 비밀번호 뒤 연결 버튼 순서로 한 열에 표시한다. 입력 중 초점을 강제로 바꾸지 않고 이미 나타난 항목과 초안은 수정 시 유지한다. 첫 연결 후 모델/자동 정리/저장 위치를 표시하며 기존 자료와 목적지가 있으면 재로그인 중에도 관리 설정을 유지한다. 회사 비밀번호와 Gmail 16자리 정규화, 취소/중복 차단/메모리 전용 인증 계약은 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 메일 설정은 MUST 중복된 모델 제목/선택 안내 없이 아이콘과 선택한 모델의 한 줄 선택 동작으로 표시한다. 자동 정리 OFF는 이전 진행 snapshot보다 우선 표시하고 0건 요약은 숨긴다. 중지된 상태의 실제 저장 건수와 보류 건수는 유지하며 진행 타이머/첨부 진행을 동작 중으로 표시하지 않는다. 수집/첨부/위키 작업과 메모리 전용 인증 계약은 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 이름의 hover 흘러가기는 MUST 글자 자체 너비가 아닌 행의 남은 공간 전체를 사용하고 오른쪽 아이콘/상태/동작 앞에서 자른다. 원래 위치에서 왼쪽으로 이동하고 사라지면 해당 영역의 오른쪽 끝에서 다시 진입한다. 48px/s 공통 속도, 모션 감소와 고정된 모델 칩을 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 대기열 버튼은 MUST 기본/hover/누름 상태에서 테두리와 그림자 없이 동일한 옅은 파랑 hover를 사용한다. Desktop 행 높이는 28px, 행 간격과 목록 위아래 여백은 2px로 줄이고 기존 순서 변경, 편집, 삭제와 3행 이후 스크롤을 유지한다. 키보드 초점과 터치 44px 영역은 보존한다. Electron 빌드만 수행한다.

- 품질 보강 2026-10-04: 확인 질문은 MUST 질문 ID와 현재 실행 ID로 메시지에 연결하고 해당 진행 바로 아래에 표시한다. 같은 문구의 과거 메시지에 새 폼을 붙이지 않는다. 식별자가 없는 옛 기록은 현재 실행의 마지막 메시지만 인정하며 연결할 메시지가 없으면 현재 진행과 질문을 대화 하단에 함께 둔다. 기존 질문 초안, 선택/직접 답변과 승인/실행 계약을 유지한다. Electron 빌드만 수행한다.

- 품질 보강 2026-10-04: 컨텍스트 도넛은 MUST 응답의 유효한 total_tokens를 입력/출력 세부 값의 유무와 관계없이 우선 표시한다. 응답별 사용량 누락, 부분 제공과 요약 후 추정은 구분하고 모델이 사용량을 지원하지 않는다고 단정하지 않는다. 모델 최대 용량과 추정 used는 실측으로 승격하지 않으며 같은 모델의 actor/재응답 기록만 사용한다. 입력 실측 기반 실행 예산과 최대 컨텍스트 75% 자동 요약 정책은 유지한다. Electron 빌드만 수행한다. 근거는 docs/CONTEXT-USAGE-2026-10-04.md다.

- 사용자 결정 2026-10-04: 파일 선택 안내와 빈 편집 영역은 MUST 표시하지 않는다. 한 번 클릭은 선택만 하고 파일 행 전체의 더블클릭/Enter는 개별 파일 탭으로 열고 탐색기를 접어 편집 너비를 확보한다. 파일 탐색기 탭을 누르면 목록으로 돌아가고 열린 파일/미저장 모델/undo는 보존한다. 대화 변경 파일에서 요청한 탐색기 위치 표시는 유지하며 늦게 도착한 읽기 결과가 현재 탭/목록을 바꾸지 않는다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: HTTP/HTTPS 링크와 로그인은 MUST 기존 오른쪽 웹 탭으로 통일한다. localhost 화면/포털 모달의 링크와 중간 클릭도 내부 page bridge를 사용하고 시스템 브라우저 fallback은 두지 않는다. 다운로드 항목은 OS 폴더에서 표시하며 HTML의 기본 외부 브라우저를 실행하지 않는다. 모델 선택 칩과 글자는 hover/초점/누름에도 고정하고 폴더/대화의 흘러가기와 누비 모션은 유지한다. 이전 삼성 연결 검토는 참고 기록으로 보존한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 메일 검색은 MUST 공통 SearchField의 고정 돋보기와 메일당 한 결과를 사용한다. 기본 목록은 보낸 사람/메일 날짜/제목/본문 두 줄/첨부를 표시하고 기간/보낸 사람/첨부 조건은 접는다. 실제 본문/첨부/개인 위키 검색에 필터를 먼저 적용하고 커서 페이지를 연결한다. 다운로드는 사용자 UI의 OS 저장 창에서만 본문 UTF-8 TXT, 원본 EML, 첨부 원래 bytes를 저장하며 원문 해시와 저장 readback을 검증한다. 메일 내용은 실행 승인으로 취급하지 않고 인증값/저장 경로/다운로드 payload를 모델에 전달하지 않는다. Electron 빌드만 수행한다. 범위는 docs/MAIL-SEARCH-DOWNLOADS-2026-10-04.md를 따른다.

- 사용자 결정 2026-10-04: 커스텀 스킬은 MUST 등록 한 동작에서 시작하고 형식별 등록/폴더 선택 버튼을 따로 노출하지 않는다. 동일한 등록 영역에서 폴더, ZIP, Markdown 입력을 판별한다. OS 선택창의 제약과 끌어놓기 경로는 docs/CUSTOM-SKILLS-2026-10-04.md를 따른다.

- 사용자 결정 2026-10-04: Agent는 MUST 프로젝트 위키와 개인 메일/첨부 검색을 기본 지식 도구로 사용하고 실제 읽은 자료의 호스트 식별자/해시/위치에만 답변 출처를 연결한다. 출처는 문장 옆 번호와 답변 아래 문서/메일 이름으로 표시하며 기존 파일 탭과 메일 원문을 연다. `/` 입력 시 기본 명령과 현재 등록한 스킬을 위에 표시하고 키보드/한글 조합/대기열을 보존한다. `/plan`은 읽기 전용이며 `/bash`와 스킬 선택은 실행 승인이 아니다. 기존 Pi, 승인/미확정 복구, 개인 메일 격리와 3개 제공자를 유지하고 새 검색 프레임워크를 추가하지 않는다. Electron 빌드만 수행한다. 범위는 docs/AGENT-SOURCES-COMMANDS-2026-10-04.md를 따른다.

- 사용자 결정 2026-10-04: 스킬 관리는 MUST AI Workspace / 커스텀 관리로 구분한다. 하나의 등록 흐름에서 폴더, ZIP, SKILL.md 또는 일반 Markdown을 받아 기존 Pi의 SKILL.md 형식으로 저장한다. 프로젝트/worktree 범위와 경로/크기/해시/readback 검사를 유지하고 스크립트는 자동 실행하지 않는다. 수정은 기존 Monaco에 연결하고 삭제는 현재 내용을 확인한 뒤 복원 가능한 휴지통으로 이동한다. 항목별 삭제 영수증을 보존하여 같은 이름의 재등록이 이전 휴지통을 숨기지 않게 한다. 손상된 지침은 관리 목록에 남기되 에이전트 선택 목록에 포함하지 않는다. Electron 빌드만 수행한다. 범위는 docs/CUSTOM-SKILLS-2026-10-04.md를 따른다.

- 사용자 결정 2026-10-04: 회사 스킬의 미로그인 상태는 MUST 회사 SSO 로그인 버튼으로 표시하고 기존 GHES Device Flow와 오른쪽 네이티브 브라우저를 사용한다. 익명 원격 조회를 하지 않으며 기존 로그인은 다시 사용한다. 인증 후 원래 스킬 목록을 갱신하고 커스텀 스킬/초안을 보존한다. SSO 필요, 권한 부족, 요청 한도와 통신 오류를 구분하고 인증값을 UI/디스크/모델에 전달하지 않는다. Electron 빌드와 예시 화면 확인만 수행하며 실제 사내 SSO 완료를 별도 검증한다.

- 사용자 결정 2026-10-04: 입력창의 + 스킬 메뉴는 MUST 등록한 스킬의 요청 추가와 AI Workspace/커스텀 관리 진입을 구분한다. 이름과 설명을 두 줄로 배치하고 등록 목록만 스크롤하며 관리 동작은 아래에 유지한다. 기존 CX 버튼/토큰, X/Escape와 초점 복귀를 재사용하고 바깥 클릭으로 닫지 않는다. 초안은 useComposerDraft의 문자열 계약으로 보존하며 스킬 선택을 실행 승인으로 취급하지 않는다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: Agent의 계획, 변경 요약, 공개 진행 발화와 질문 폼은 MUST 브라우저 확장의 TaskPlan/AgentTrace/QuestionForm과 Pi 실행기를 직접 재사용한다. 질문도 실행 ID와 모델/시각을 갖고 진행 기록 아래 같은 메시지 위치에 표시한다. 실행별 공개 계획/trace는 SQLite 대화에 남기며 이전 실행과 새 실행을 섞지 않는다. 단계 완료는 해당 계획 revision의 expected_outcome에 대한 독립 검토의 supported 근거로만 반영하고 ready 응답/승인 대기를 작업 완료로 승격하지 않는다. 비공개 추론과 진단을 기본 화면에 노출하지 않으며 간단한 대화에는 계획을 강제하지 않는다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 대화 본문/입력창과 대기열은 MUST 공통 --nubi-chat-width(700px)로 좌우 끝을 맞추고 남는 너비에 따라 줄어든다. 채팅 본문, 입력칸과 Electron 바깥 Agent의 스크롤바와 예약 여백은 숨기되 overflow, 휠/터치/키보드, 최신 메시지 이동과 입력창 고정을 유지한다. 보조 목록/모달의 Chromium 스크롤바는 4px, 옅은 둥근 트랙/손잡이와 8px 끝 여백을 공통 적용한다. 터치는 6px을 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 답변 모델명 왼쪽 누비는 MUST 기존 AgentMark와 useIdleExpression을 재사용해 눈 깜박임, 웃기, 날갯짓, 20초 유휴 시 잠들기와 호버 인사를 표시한다. 작은 답변 아이콘의 이동은 1px로 제한하며 모델명과 선택 칩은 제자리를 유지한다. 실제 재응답/대기 상태만 working에 연결하고 OS 모션 감소, 비활성 창과 모달의 모션 정지를 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-12: 답변 아래 시각과 복사 버튼은 MUST 같은 줄에서 바로 붙여 표시하며 실제 소요 시간과 다시 응답 아이콘은 그 뒤에 둔다. 다시 응답 받기는 마지막 답변을 별도 기록으로 보존한 뒤 현재 대화에서 제거하고 같은 요청을 일반 에이전트로 다시 실행해 교체한다. MUST 실제 도구, 계획, 검토와 기존 승인/원본 fingerprint를 유지하며 완료한 명령을 무조건 반복하지 않는다. 시작 요청 중에는 복원 버튼 대신 실제 경과 시간을 표시한다. 상세 계약은 docs/CONVERSATION-RUNS-2026-10-12.md다.

- 사용자 결정 2026-10-04: 모델 선택 칩과 답변의 모델명은 MUST hover/키보드 초점에서 제자리를 유지한다. 모델명에 DriftLabel을 사용하지 않으며 긴 이름은 말줄임과 기존 전체 이름 툴팁으로 표시한다. 대화/폴더명 흘러가기와 누비 새 모션은 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: Desktop의 자동 요약 시작점은 MUST 현재 모델이 제공한 최대 컨텍스트의 75%로 계산한다. 응답 예약량을 뺀 입력 예산의 90%를 사용하지 않는다. 더 낮은 실제 입력 제한과 응답 공간 보호는 유지한다. 화면의 도넛은 모델 전체 용량 기준이며 자동 요약 (75%)과 해당 토큰 수를 별도로 표시한다. 화면과 실행은 context-policy.mjs와 공통 contextBudget의 같은 명시적 정책을 사용하고 Browser/Office 기본 정책은 변경하지 않는다. 원본 대화와 최신 요구사항, 도구 쌍, 승인/복구 기록 보존 계약을 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 파일 화면은 MUST 상단 경로, 왼쪽 편집기, 오른쪽 접이식 폴더 트리로 구성한다. 최신 사용자 결정에 따라 한 번 클릭은 선택만 하고 더블클릭/Enter는 개별 탭으로 연다. 좁은 보조 영역에서는 탐색기를 겹쳐 열고 파일 탭을 열면 편집 너비를 확보한다. 폴더를 제자리에서 펼치고 필요한 디렉토리만 읽으며 미저장 모델, undo, 기존 저장 hash/readback과 경로 보호를 유지한다. 새 IDE 프레임워크를 추가하지 않는다. 편집기 읽기는 editorSource로 분리하고 프로젝트/worktree/비공개 경로/UTF-8/크기 검사를 유지한다. 에이전트 지침의 크기 한도를 완화해 파일 열기를 우회하지 않는다.

- 사용자 결정 2026-10-04: 모달은 MUST 한 가지 목적과 주 동작을 먼저 보여주고 보조 설정은 필요할 때 펼친다. 선택한 값과 필수 입력, 승인 범위, 실제 상태와 복구 동작은 숨기지 않는다. 기능/선택지의 나열, 중복 관리 버튼과 장식성 강조를 줄이며 기본 화면의 가독성을 우선한다.

- 사용자 결정 2026-10-04: 메일 저장 위치는 MUST 아코디언에 원본 rawRoot와 정리한 wikiRoot를 구분해 표시하고 각 경로 옆에 공통 복사 아이콘을 둔다. 복사는 호스트의 현재 경로로 한정하며 완료 후 공통 2초 토스트를 표시한다. 메일 설정 모달의 마지막 확인 시각은 제거하고 이력의 실제 확인/반영 시각은 유지한다.

- 사용자 결정 2026-10-02: 로그인과 외부 HTTP/HTTPS 링크는 MUST 오른쪽의 기존 네이티브 브라우저 탭으로 연다. AI Pro/ChatGPT 콜백과 GHES device 인증 계약은 유지하며 시스템 브라우저나 독립 창으로 자동 우회하지 않는다. 페이지 열기 시 기존 모달을 내려 브라우저를 표시하고 GHES 입력 코드는 브라우저 도구 아래에서 복사한다. 인증 탭은 방문 기록에서 제외하고 콜백 code/token을 주소 상태에 노출하지 않는다. 실제 제공자 로그인 완료는 별도 검증한다.

- 사용자 결정 2026-10-02: 채팅 본문의 스크롤바와 예약 여백을 숨긴다. 휠/터치/키보드 스크롤, 최신 메시지 이동과 입력창 고정은 MUST 유지한다.

- 사용자 결정 2026-10-02: 메일 이력과 메일 설정의 배경은 MUST 진입 메뉴나 선택한 대화와 무관하게 동일한 누비 배경을 표시한다. 전체 버튼에 추가한 공통 hover 음영은 원복한다. 추가 음영은 대화 핀 버튼에만 적용하고 로그인과 기존 개별 hover를 보존한다. hover 테두리를 추가하지 않는다.
- 사용자 결정 2026-10-02: 메일 이력 화면은 MUST 우측 상단의 X 없이 표시한다. 다른 화면으로 이동할 때 왼쪽 메뉴를 사용한다. 메일 설정 모달의 기존 닫기 계약은 유지한다.
- 사용자 결정 2026-10-02: Computer Use 비활성 상태에서도 사용자가 요청한 HTTP/HTTPS 페이지는 MUST 오른쪽 네이티브 브라우저로 열 수 있다. open_workspace_page는 페이지 열기만 허용하고 읽기, 클릭, 로그인, 자격 증명 생성/입력과 구분한다. Google 앱 비밀번호는 전용 메일 설정에서만 직접 입력하며 페이지 열기를 인증 완료로 표시하지 않는다.

- 최신 사용자 결정 2026-10-02: 열린 사이드바만 MUST 실제 레이아웃 공간을 차지하고 대화는 남는 너비에 맞춘다. 왼쪽/오른쪽을 닫으면 대화창을 넓힌다. 닫힌 열의 사전 예약과 열림/닫힘에 무관한 고정 대화 너비 결정을 대체한다. 창 기본 크기는 기존 1480×960 DIP를 유지한다. 3분할 기본은 도구 줄 52/프로젝트 268/오른쪽 보조 420 DIP이며 사용자 지정 사이드바 너비와 기존 편집/대화 상태를 보존한다. 좁은 창과 명시적인 넓게 보기는 겹침 방식을 유지한다. 근거는 docs/DEFAULT-WINDOW-2026-10-02.md다.

- 사용자 결정 2026-10-02: Gmail은 MUST 임시 연동 확인용 선택지로 제공한다. 회사 POP3와 Gmail 테스트의 호스트는 고정 목록만 허용하고 Gmail은 pop.gmail.com:995/TLS와 사용자가 전용 설정 화면에 입력한 앱 비밀번호를 사용한다. Gmail의 최초 기본값은 자동 정리 OFF이며 사용자가 선택한 ON/OFF는 재연결에도 유지한다. ON이면 기존 수집/첨부 읽기/모델 정리 계약을 실행한다. 비밀번호를 채팅/디스크/모델에 기록하지 않으며 실제 계정 결과와 빌드 성공을 구분한다.

- 사용자 결정 2026-10-02: 대화 삭제 확인창은 하단에 닫기 아이콘과 취소, 체크 아이콘과 확인을 함께 표시한다. 휴지통만 있는 확인 버튼과 헤더만 취소하는 이전 결정을 대체하며 삭제 범위와 파일 보존 안내를 유지한다.

- 사용자 결정 2026-10-02: FabriX는 추론 설정을 지원하지 않는다. 추론 UI/모달과 요청 옵션을 노출하거나 전송하지 않는다. AI Pro/ChatGPT의 제공자별 effort 계약은 유지한다.

- This package is the user's explicitly authorized implementation of the Desktop proposal. Keep the browser extension, Office and router contracts intact.
- User-facing Korean copy and model replies MUST lead with the key result or next action. Use complete, concise sentences and retain details needed for decisions or recovery. NEVER use middle-dot separators. Remove repeated explanations and keep secondary details behind existing disclosures.
- UI/UX/CX MUST follow the root `사용자 UI/UX/CX 기준` in AGENTS.md: readability first, fewer steps, key text with its details, icon only when the icon alone is clear, no middle dots, the reference HTML tokens and the browser agent CX.
- Latest user decision 2026-10-01: use the dedicated Electron host and independent lazy Monaco editor. Theia and Code-OSS are not active app dependencies. Follow the previously supplied Codex layout: permanent central agent, project/conversation list, optional right file/diff/commit history. Desktop A2A is disabled. Folder, ZIP and Git project opening schedules background OpenWiki init with actual phase progress. Mail attachment text is read locally and sent directly to the selected LLM. Keep shared Nubi UI, Pi, approvals, hash/readback, dirty buffers and undo. See docs/ELECTRON-WORKSPACE-2026-10-01.md.
- Latest Desktop identity: the user reverted the lavender experiment. Restore shared Nubi blue #3182F6, deep blue #1B64DA, selection #E8F1FE and the original pale blue background. NEVER use a left stripe for selection. Apply rounded selection/hover through central desktop tokens and retain the mint bird. This does not change Office/browser themes. `start:web`/`preview:web` use the actual Electron worker on loopback 4318; sample data is restricted to `preview:mock` on 4320.
- MUST preserve the HTML identity across all components and portals through shared deck tokens and `design/workspace-identity.css`. New DetailPanel elements use `deck-dialog`; never add per-screen raw brand overrides. Keep useful details readable, remove redundant copy, and use named/tooltip-equipped CX icon actions for unambiguous utilities while retaining explicit approval labels. Follow `docs/VISUAL-IDENTITY.md` and run `npm run verify:identity` for visual changes; compilation enforces `design:check`.
- Screen CSS MUST use shared typography/color tokens, including nested dialogs and large-text mode. Numeric font sizes and raw colors belong only in the central identity layer; inline JSX typography/brand overrides are rejected. Reuse CX ActionButton for recognizable icon utilities with keyboard tooltips. Keep approval scope, changed targets, unresolved results and recovery actions readable even when shortening copy.
- All active Workspace dialogs MUST share `--nubi-modal-inset`/`--nubi-modal-block`, including provider/context/confirmation portals. Child panels restore the invoking panel and control; opening a Wiki file closes the panel before activating its editor. Keep approval menus inside the viewport and keyboard-operable. `test:modals-ui` is part of `verify:identity`; see docs/MODAL-REVIEW-2026-10-01.md.
- Preserve dirty editor buffers, Git checkout changes and human-authored knowledge. No automatic stash/reset/clean/push. Match content hashes before applying a proposal.
- Scope the backend to the opened project and owned worktrees. Keep credentials in this host's memory. Read-only project pairing must never grant shell or document-write access.
- Run package tests, build and actual browser interaction checks. Distinguish fixtures, local runtime, model/provider access, Electron and Windows. Office installer builds remain subject to the root rule.

- Agent edits require observations from the current run. Prefer unique exact replacements within observed ranges; do not treat old summaries as read authorization for full-file replacement.
- Wiki evidence revisions are new files under the task workspace. NEVER overwrite a human-edited or dirty-buffer revision, infer acceptance from exit codes/pixels, or silently commit generated documents.
- Keep one execution owner per local SQLite state directory. Acquire ownership before mutating recovery states; let OS locks release on process exit. Do not claim cross-machine coordination.
- Keep pinned dependencies and the separate host/renderer/worker bundles reproducible. Never patch installed modules. Legacy Theia source is reference only.

- Knowledge relations distinguish Git declarations, parsed DDL, collected DB metadata and imported snapshots. Preserve resource hashes, direction, missing coverage and collection time; no inferred link is execution evidence. Git catalog stores connection IDs only. DB credentials remain in host memory and never enter Wiki/model context. See docs/KNOWLEDGE-QUALITY.md for bounded adapters, FK limits and validation boundaries.
- Model edits require a current-run change plan covering observed targets and every original acceptance criterion. A plan/check is not a passed result. Use shared Nubi question parsing/rendering, preserve drafts and answer history, and refuse stale/duplicate answers or bypassing a pending question.

- Reuse the shared Pi analysis coordinator and context manager. Child analyses receive scoped briefs and read-only project tools; child source reads MUST NOT grant leader edit observations. Forward cancellation to child transports and preserve all original criteria and answered decisions after compaction.
- Conversation compaction MUST retain original messages in SQLite. Reuse a saved history boundary only when its task prefix hash matches, keep recent turns and bounded literal user requests, and reread live host requirements/receipts after in-run compaction. Historical conversation reads and summaries MUST NOT restore observations or approvals. Preserve cancellation and never replay tools for a model overflow. See `../../docs/research/2026-09-23-nubi-context-compaction.md` for budget assumptions and real-model verification boundaries.
- Budget compaction against the actual Pi tool definitions including progress fields. Only completed historical turns may use Desktop's explicit zero-recent-turn fallback; NEVER compact an unanswered current user request through that fallback. Protected requirements and live host receipts remain outside the summarized span.
- Recovery MUST distinguish retryable inference, failed reads, and unknown writes/process outcomes. Reuse Nubi's p-retry transport; journal operations before execution and reconcile actual file hashes/receipts before resuming. NEVER replay commands after a lost response or host restart, or auto-resume user cancellation. Failed commands may trigger AI diagnosis; corrected commands retain explicit execution and result review. Unsettled record-writing tools block overlapping execution. See docs/RECOVERY-HARNESS.md.

- Wiki retrieval reuses OpenWiki MiniSearch, ClaimsStore and RepositoryEvidenceResolver, with declared Graphology relations and RRF. Read Claims only; NEVER equate matching versions with factual truth, execution or edit authorization. Cite only evidence observed by the leader in the current run; revalidate cited documents, Claims and source hashes before plans/proposals. Keep missing provenance explicit. See docs/OPENWIKI-EVIDENCE.md.

- Reuse ripgrep for bounded literal source search and TypeScript/JSONC/YAML for in-memory draft diagnostics. Check before proposal creation and application; introduced errors or unavailable supported checks MUST return feedback instead of applying. Keep unchanged baseline errors, unsupported languages, syntax checks, types and execution tests distinct. AST outlines MUST NOT grant edit observations. Bundle and copy the analysis worker for both app targets. See docs/CODING-AGENT-QUALITY.md.

- User request 2026-10-01 includes A2A validation and missing mail-document collaboration in implementation scope. Current host routes remain inactive until wired and verified. Reuse the official SDK, current chat and HITL; distinguish protocol delivery, actual file analysis and business success. See docs/MAIL-DOCUMENT-COLLABORATION.md.

- 제품명은 **누비 workspace**, 사용자 표시 버전은 **beta 1.1.1**으로 통일한다. 패키지와 Windows 메타데이터의 숫자 버전은 **1.1.1**, GitHub 릴리즈는 사전 배포로 표시한다. 로고는 기존 누비 beta 워드마크를 유지한다. 이전 설치의 업그레이드를 위해 앱 ID와 영문 실행 파일 이름은 유지한다. 누비 제품군의 기존 새 이미지, 워드마크와 모션을 재사용한다. 브라우저/Office의 기본 누비 beta 표기와 내부 패키지 ID는 유지한다.

- 로컬 실행 준비는 기존 소스 조회와 QuestionForm을 재사용한다. 환경 선택 답변을 실행 승인으로 취급하지 않는다. 설치/설정/빌드/실행 제안은 현재 실행에서 읽은 근거와 정확한 명령에 연결하고 호스트의 명시적 일회 승인으로만 실행한다. 근거 변경, 질문 대기와 취소를 검사하며 미확정 실행을 재전송하지 않는다. 예상 영향은 sandbox 보장이 아니고 종료 코드 0은 기능 검증 성공이 아니다. 상세 범위는 docs/ENVIRONMENT-PREPARATION.md를 따른다.
- 관리자 실행은 Windows PowerShell의 짧은 단일 명령에 한정하며 관리자 전용 HITL과 OS RunAs/UAC를 거친다. 원래 명령은 메모리에서 고정하고 상승 뒤 사용자 쓰기 가능 스크립트 파일을 다시 읽지 않는다. 앱은 일반 권한을 유지하며 UAC 자동 클릭, 자격 증명 저장, 정책 변경, 무인 승인과 관리자 상시 셸을 제공하지 않는다. 취소는 이미 시작한 상승 프로세스의 종료를 보장하지 않으며 감시 프로세스를 죽여 종료로 표시하지 않는다. 미확정 결과는 재실행하지 않는다. 러너의 관리자 토큰 검사와 실제 Windows 11 UAC 사용자 승인은 구분한다.

- 프로젝트 규칙은 루트와 대상 파일 경로의 AGENTS.md, 없으면 같은 디렉터리 CLAUDE.md를 제한된 크기로 읽는다. 규칙은 실행 권한이 아니며 외부/홈 규칙을 자동 로드하지 않는다. 규칙 변경이나 새 규칙 추가 시 관찰과 변경 계획을 다시 확인한다. 새 파일은 현재 실행의 부재 관찰과 create 계획, 문법 검사, 사용자 반영, 배타적 생성과 readback을 요구한다. 미확정 생성은 자동 재실행하지 않는다. 부모 폴더 생성은 기존 승인된 환경 준비 흐름을 따른다. 범위는 docs/PROJECT-RULES-AND-NEW-FILES.md를 따른다.

- Windows 컴퓨터 도구는 실험적 winapp JSON 어댑터와 기존 Pi 이미지 전송을 사용한다. 창 연결은 작업별 메모리 권한이며 재시작 시 해제한다. 모델은 관찰/단일 동작 제안만 수행하고 호스트 UI의 정확한 일회 승인 뒤 실행한다. 오래된 관찰, 다른 창/요소/입력값과 미확정 동작은 재실행하지 않는다. 승인 전 커서는 대상 미리보기다. 실행 시 Windows 투명 포인터 창을 실제 UIA 호출에 연결하며 사용자 커서나 포커스를 옮기지 않는다. 표시를 숨긴 뒤 결과를 캡처하고 애니메이션은 시스템 설정을 따른다. 포인터는 OS 입력 녹화나 업무 성공 증거가 아니다. 화면 이미지는 승인 동작 메타데이터와 분리 저장한다. 실제 Windows 검증/배포 경계는 docs/COMPUTER-USE.md를 따른다.

- Windows 앱 실행은 Electron 파일 선택으로 등록한 작업별 EXE와 해시만 사용한다. 기존 Node 실행기로 승인한 앱을 한 번 시작하고 살아 있는 자식 PID의 창을 확인하며, 창 연결은 별도 사용자 선택이다. 재시작은 앱 권한을 복원하거나 실행을 재전송하지 않는다. Pi의 값 대조 결과는 개별 컨트롤 확인이며 업무 완료가 아니다. 명시적 Wiki 기록에는 결과 메타데이터만 추가하고 앱 경로, 입력값과 이미지를 제외한다.

- Windows 관찰/결과 근거는 공유 Pi 분석 조정기에 호스트 opt-in으로 등록한다. 하위 분석은 동결된 근거만 읽고 native 도구/승인 권한을 받지 않는다. 과거 캡처와 요약은 새 조작 관찰을 대체하지 않는다. 결과 분석 재개는 원래 동작을 재실행하지 않으며, UIA 변화 없는 반복 실패는 기존 질문 폼으로 전환한다. 범위는 docs/WINDOWS-HARNESS.md를 따른다.

- Windows 배포는 Windows x64에서 Electron 전용 앱을 빌드한 뒤 electron-builder NSIS로 만든다. 실제 설치 앱의 UI/worker/OpenWiki-SDS와 설치/재설치/제거 검사를 통과한 산출물만 게시한다. 러너 Windows 버전, 서명 상태, 실사용 Windows 11/실모델 미검증을 구분한다. Monaco의 내장 정제 코드는 저장소의 esbuild 플러그인으로 수정판에 연결하며 node_modules를 직접 수정하지 않는다. 상세 범위는 docs/WINDOWS-RELEASE.md를 따른다.

- Windows 대상 검색은 연결된 HWND의 winapp UIA search를 사용하고 부분 조회 범위를 보존한다. 클릭/invoke 결과는 사라진 대상 대신 창 전체 캡처와 historical UIA로 읽는다. 검색어/요소 순서 변경은 실패 복구의 진전이 아니며 과거 결과는 새 조작 관찰을 대체하지 않는다.

- VOC import는 호스트 UI가 선택한 nubi-voc-v1 JSON만 현재 Workspace에 새 revision으로 보관한다. 기존 AJV/MiniSearch/SQLite와 Pi 검색/구간 읽기를 재사용하며 변경된 원본을 덮어쓰지 않는다. imported/stored_bytes_only를 실제 JSM 수집이나 해결 검증으로 취급하지 않는다. A2A 파일 전송과 자동 JSM 수집은 아직 별도 미구현이며 docs/VOC-IMPORT.md를 따른다.

- Desktop A2A mail-document collaboration was superseded by the dedicated Electron decision. NEVER start or expose it. Attachment text goes to the current LLM directly. Do not infer authorization for SMTP sending, native/installer final builds or broader execution permissions.

- 사용자 최신 결정에 따라 UIA를 기본으로 하고 같은 연결과 대상에서 새로운 관찰로 확인한 UIA 패턴 부재가 3회 쌓인 경우에만 실제 Windows 마우스 제어를 동작별 HITL로 제안한다. 중복 관찰, 대상 변경과 미확정 실행은 실패 횟수에 넣지 않는다. 정상 조작, 연결 변경, 취소와 2분 경과로 조건을 해제한다. pointer_click/pointer_double_click/pointer_right_click/hover/drag는 shared_pointer 제안과 명시적 pointerConsent가 모두 필요하다. 기존 hover 승인이나 질문 답변을 재사용하지 않는다. 드래그는 같은 창에서 관찰한 두 대상을 검증한다. 가상 커서는 검정색과 흰 테두리의 둥근 화살표이며 배지를 붙이지 않는다. 미리보기와 실제 도구 실행 표시, 실제 마우스 입력을 구분한다. 물리 입력으로 자동 폴백하거나 포괄 승인을 저장하지 않는다. 중지는 이미 시작한 짧은 동작의 취소/복원을 보장하지 않으며 결과 확인 후에도 자동 재개하지 않는다.

- Windows UIA 상태 동작은 명시적 select/toggle_on/toggle_off/expand/collapse만 허용한다. 목표 상태를 재조회하고 상태 일치와 업무 완료를 구분한다. OpenWiki-SDS 근거 ID는 주 실행기의 현재 조회에서만 가져오며 제안, 승인, 가상 포인터/문서 확인 후 native 입력 직전에 다시 검증한다. winapp 자식 프로세스에는 제한된 Windows 환경 변수와 누비 workflow ID만 전달한다. 변경된 근거와 미확정 쓰기를 우회하거나 재전송하지 않는다. 상세 판단은 `docs/COMPUTER-USE.md`와 `docs/OPENWIKI-EVIDENCE.md`를 따른다.

- 프로젝트 스킬은 작업 Workspace 루트의 `.agents/skills`, `.claude/skills`, `.opencode/skills`에서 메타데이터만 검색하고 필요한 본문/참조만 해시 확인 후 읽는다. 기존 YAML/MiniSearch와 Pi 도구 루프를 재사용한다. 스킬의 allowed-tools와 스크립트는 승인이나 소스 수정 관찰이 아니며 자동 실행하지 않는다. 홈/외부 경로와 심볼릭 링크는 자동 로드하지 않는다. 도구 선택 안내는 실제 등록된 도구만 제공하며 실행 가능 여부와 성공은 호스트 상태/결과로 별도 확인한다. 상세 범위는 docs/AGENT-SKILLS-AND-TOOLS.md를 따른다.

- Desktop은 공통 Pi 실행기의 `clarifyOnStall`을 사용해 같은 도구 결과가 세 번 반복되면 기존 HITL 질문으로 구체적인 장애를 확인한다. 원래 목표와 조건, 답변 이력, 완료/미확정 기록을 유지하고 질문 답변을 쓰기 승인으로 취급하지 않는다. 전체 업무의 호출 횟수 제한이 아니다.

- Desktop 최종 응답은 동일 모델의 별도 문맥에서 요구사항과 주 실행기 근거/호스트 기록을 검토한다. Ajv로 요구사항 전체 대응과 근거 ID를 검증하고 누락 작업은 같은 Pi 작업으로 이어간다. 검토 ready는 답변 전달 가능 상태이며 완료 조건 통과나 반영 승인이 아니다. 새 근거 없는 검토 실패 3회는 기존 질문 폼으로 넘긴다. 자식 조회, 요약, 새 불투명 ID를 실행 근거나 진전으로 승격하지 않는다. 압축된 대화 경계와 원래 조건/답변을 유지하고 상세 근거는 별도 SQLite 기록에 둔다. 범위와 비용/실모델 한계는 docs/RESULT-REVIEW-HARNESS.md를 따른다.

- 사용자 스킬 등록은 Electron 파일 선택기로 고른 단일 스킬 ZIP/폴더를 현재 작업 Workspace의 `.agents/skills/<name>`에 하위 구조 그대로 저장한다. SKILL.md 규격과 바이너리 바이트를 보존하고 기존 스킬을 덮어쓰지 않는다. 모델은 discover_capabilities → use_skill → read_skill로 등록 지침을 사용하며 등록 RPC는 모델 도구로 노출하지 않는다. 스크립트는 기존 소스 조회와 명령 승인 흐름을 사용하고 스킬 활성화를 실행/반영 승인이나 완료 증거로 취급하지 않는다. 상세 범위는 docs/SKILL-REGISTRATION.md를 따른다.
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

- 사용자 결정 2026-10-01: OpenMetadata를 현재 구현과 배포 범위에서 제외한다. 관련 서비스 설치, 계정 초기화와 연결 UI를 추가하지 않는다. 기존 직접 DB 메타데이터 수집은 유지한다.

- 모델 비교는 같은 후보, 과제/가상 앱/자료 해시와 실제 제공자 한도로 수행한다. `contextOnly` 호스트 상태가 최신 미열람 도구 쌍을 압축 경계 밖으로 밀어내지 않도록 공통 압축기에서 보호한다. 비교 범위와 재현은 `docs/HARNESS-COMPARISON-2026-10-01.md`를 따른다.
- 사용자 재확인 2026-10-01: 실모델 품질 평가는 MUST 제공자 카탈로그의 실제 문맥 한도를 그대로 사용한다. AI Pro의 모델별 256K/512K/1M을 임의의 작은 창으로 낮추지 않는다. 축소 문맥 진단은 기본 과제와 모델 비교에서 제외하며 사용자가 따로 요청한 경우에만 수행한다. 긴 작업은 실제 자료/대화 누적으로 검증하고 최대 한도까지 채우지 않았다면 전체 문맥 용량 검증으로 표시하지 않는다.

- Workspace 문맥 압축은 실제 카탈로그 한도와 마지막 SSE usage를 사용한다. 실측 prefix에 새 tail만 추정하며 문맥/도구 변경과 압축 뒤에는 실측 기준을 무효화한다. 원래 조건, 현재 승인/실행 기록과 최신 도구 결과를 보존하고 원문 재조회 권한을 요약으로 복원하지 않는다. 모델별 정책과 선택 근거, 합성/실모델 경계는 /Users/ganadi/Documents/nubi-code-work/nubi-code/docs/ADAPTIVE-CONTEXT-2026-10-01.md를 따른다.

- Workspace design (user decision 2026-10-01): the product title is 누비 Workspace and the visible version is Beta. MUST review shared tokens, spacing, hierarchy, readable Korean copy, identical icons for identical actions, keyboard access and reduced motion. Connect the conversation to the native file/editor/Git/result flow while preserving user layout and drafts. Follow root docs/WORKSPACE-DESIGN-2026-10-01.md and validate the main fork, not only this source package.

- Workspace agent MUST be the central default surface, not a closable editor tab or a right-side helper. Keep conversation, planning, questions, approval and results together; reveal native files/diffs as supporting editors in the same window.

- Follow the user-provided Codex screenshot structure: Nubi tool rail, project/conversation list, central agent and supporting native documents/editors on the right. Remove generic startup shortcut instructions and VS Code branding from the product shell; preserve native editing, search, Git, terminal, debugging, keyboard access and user layout.

- The main agent MUST not expose Hide Panel/X or hide/move actions. Enforce this in the fork core, keep native output/debug/terminal and document tools in supporting areas, and never present stock VS Code development-host screenshots as a core-patched product runtime.

- Workspace 실행 중 메시지는 MUST 브라우저의 TaskPlan/AgentTrace/QueuedInputs와 inbox/Pi steering을 재사용한다. 대기열과 입력창은 함께 배치하고 전송 중 새 초안을 보존한다. 지금 반영은 actor 추론만 중단하며 도구/승인/영수증을 유지한다. 질문/승인/위임/취소/미확정 상태와 연결 변경 뒤 대기 메시지를 NEVER 자동 재개한다. 계획과 검증 완료를 구분한다. 범위는 docs/AGENT-INPUT-AND-PROGRESS.md를 따른다.

- Workspace Computer Use는 MUST 기존 로그인 모델과 기본 선택을 유지한다. 이미지 분석은 현재 인증 카탈로그와 브라우저 공통 Qwen 라우팅으로 같은 제공자의 이미지 모델에 한정해 별도 호출하고, 주 대화/문맥을 바꾸거나 인증을 로컬 파서에 전달하지 않는다. Agent S3의 판단/grounding 분리와 실제 결과 검토, UIA의 연속 결과 확인을 사용한다. 별도 LLM/GPU 서버를 기본 요구사항으로 추가하지 않으며 시각 힌트는 관찰/승인/실행 권한이 아니다. 범위는 packages/nubi-desktop/docs/COMPUTER-PERCEPTION-2026-10-01.md를 따른다.

- Visual checks read the Electron renderer stylesheet: `electron-app/workbench.css` imports the shared cascade and `design/workspace-identity.css` directly, and `npm run build:electron` writes `electron-app/lib/frontend/renderer.css` (the Theia-era generated `extension/lib/browser/style/style.css` is gone, 2026-10-07). Workspace-only icon actions reuse `WorkspaceIconAction` for identical CX glyphs, accessible names and keyboard hints. Keep welcome atmosphere separate from the calm conversation surface; the design gates are `npm run design:check` and `npm run test:modals-ui`.

- 사용자 결정 2026-10-01: Electron 화면은 웹 미리보기로 먼저 확인한다. 기존 누비 색감과 공통 캐릭터를 유지하고 새 뒤 배경의 경계 없는 유영 모션만 추가한다. 큰 글자 설정은 상단이 아니라 설정에서 제공한다. 미리보기 예시 데이터와 실제 로그인/모델 실행을 MUST 구분한다.

- 최신 화면 결정 2026-10-01: HTML CX와 누비 파랑으로 통일한다. 메뉴별 무지개 강조색은 사용하지 않는다. 버튼은 조약돌처럼 부드럽게 둥글게 하고 일반 버튼 외곽선은 줄인다. 중요한 동작과 초점/오류는 명확히 강조하며 로그인은 기존 공통 흰 카드와 provider 버튼 구성을 유지한다.

- 후속 Codex 스크린샷 기준 2026-10-01: 왼쪽 메뉴와 프로젝트/대화 목록은 차분한 중립색으로 두고 모든 메뉴에 색 면이나 테두리를 넣지 않는다. 새 대화는 단순한 목록 동작이며 누비 파랑은 선택 상태와 주요 실행에 집중한다. 중앙 에이전트/오른쪽 문서 구조와 HTML CX 로그인은 유지한다.

- 사용자 결정 2026-10-02: Desktop agent는 MUST 누비 브라우저 확장의 Pi, 계획/문맥/독립 검토와 복구 BP를 재사용한다. 직접 계획과 대체 계획은 같은 PLANNING_OUTCOME_GUIDE를 쓰고 대체 계획/최종 검토에는 사용자 원문을 요약과 별도로 보존한다. 검토 형식 오류 복구는 같은 턴에서 한 번의 읽기 전용 단계로 제한하며 도구 노출과 호스트 operation 양쪽에서 쓰기/제안/앱 조작을 차단한다. 브라우저 전용 harness를 Desktop 관찰로 가장하거나 검토 통과를 실제 성공으로 표시하지 않는다. 범위는 docs/BROWSER-HARNESS-PARITY-2026-10-02.md를 따른다. 기존 사용자 결정대로 Electron 빌드만 수행하고 테스트는 실행하지 않는다.

- 후속 사용자 결정 2026-10-02: 큐/지금 반영은 MUST 기존 브라우저 inbox/QueuedInputs/Pi steering을 유지하며 반영 대기와 실제 반영 메시지는 대화 하단에 이어진다. 최신 도넛 배치 결정에 따라 입력창 왼쪽은 스킬/모델/추론/도넛, 오른쪽은 승인 방식/위 화살표 순서다. 사용자 입력은 최신 위치를 보여주되 일반 진행으로 과거 대화의 스크롤 위치를 빼앗지 않는다. 범위는 docs/AGENT-INPUT-AND-PROGRESS.md를 따른다.

- 사용자 결정 2026-10-02: AI Workspace는 MUST GHES `Manufacturing-IT/ai_workspace/main`의 기존 정적 화면을 Desktop 보조 영역에서 열고 같은 Git 원본의 데이터를 조회/관리한다. 화면 버전을 고정하고 데이터는 기존 snapshot/head/readback 계약으로 읽고 저장한다. native GHES 계정을 재사용하며 실제 토큰/IPC/로컬 실행 권한을 frame에 NEVER 전달한다. 비강제 main 갱신 직전에는 native 확인과 HEAD 재확인을 유지한다. frame을 숨길 때 초안을 보존하며 새로고침은 명시적으로 확인한다. 팀 권한 쓰기와 외부 설치/서비스 연계를 완료로 표시하지 않는다. 범위는 docs/GHES-AI-WORKSPACE-2026-10-02.md를 따른다. 기존 사용자 결정대로 Electron 빌드만 수행하고 테스트는 실행하지 않는다.

- 사용자 결정 2026-10-02: 메일 계정/정리 모델/저장 위치는 MUST 설정의 메일 화면에서 관리한다. 자동 정리 OFF는 POP3 수집/첨부 읽기/모델 호출을 모두 멈추고 새 원본을 보관하지 않는다. 기존 자료는 보존한다. ON은 실제 수신 영수증만 기준으로 서버에 남은 미수신 메일과 첨부를 다시 수집한다. OFF의 UIDL과 최초 baseline을 NEVER 수신 완료로 취급한다. 정리할 모델은 대화 모델과 독립이며 모든 첨부의 읽기 실패/지원 범위를 노출한다. 기존 읽기 전용 파서와 사용자 전용 저장을 재사용하고 A2A는 시작하지 않는다. 상세 범위는 docs/PERSONAL-MAIL.md를 따른다. Electron 빌드만 하고 테스트는 실행하지 않는다.

- 사용자 결정 2026-10-02: Beta의 Computer Use는 MUST 비활성화한다. 공통 release flag로 화면/도구 노출, 앱 선택과 native 실행을 차단하며 기존 구현과 영수증은 이후 사용을 위해 보존한다. 사이드바는 MUST 대화 영역 위에 겹쳐 열리고 접기/펼치기/너비 조절로 대화창 너비를 바꾸지 않는다. 사이드바 버튼은 공통 panelLeft/panelLeftClose 아이콘으로 표시하고 로고/Beta/버튼 좌표를 유지한다. 상단 메일 연결과 메인 에이전트의 닫기 X는 제거하고 메일 설정/수신 이력을 유지한다. 모달 닫기는 후속 공통 X/Escape 결정을 따른다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-02: Desktop의 모든 일시 알림은 MUST WorkspaceToast 공통 CX로 통일한다. 검정 nubi-toast/desktop-toast와 화면별 타이머를 사용하지 않는다. 실제 완료는 확인 아이콘, 오류는 느낌표와 함께 같은 흰 표면/원형 카운트다운/2초 표시를 사용하며 X는 넣지 않는다. 모달에서는 활성 모달 안에 알림을 배치하고 프로젝트 전환에도 viewport를 중복 마운트하지 않는다.

- 사용자 결정 2026-10-02: 파일/편집/변경 비교/Git 보조 사이드바는 MUST 왼쪽 경계 드래그로 좌우 너비를 조절하고 공통 레이아웃 설정으로 기억한다. 기존 사이드바 resize hook과 pointer capture/키보드/취소 계약을 재사용한다. 대화창 너비는 유지하며 보조 영역만 겹쳐 넓힌다. 넓게 보기 중에는 경계 조절을 숨기고 복귀하면 이전 너비를 유지한다. 더블클릭은 기본 너비 복원이다. Electron 빌드만 수행하며 테스트는 실행하지 않는다.

- 사용자 결정 2026-10-02: 파일 보조 영역은 MUST 맨 앞의 파일 탐색기/인터넷 브라우저 아이콘과 열린 파일 탭으로 관리한다. Git 헤더는 아이콘만 표시한다. React Arborist의 실제 디렉토리 탐색과 기존 Monaco의 확장자별 편집/저장/undo를 재사용한다. 경로 입력과 breadcrumb는 열린 프로젝트 범위를 유지한다. 터미널은 하단 패널 대신 독립 탭에서 기존 Processes 영수증과 xterm.js 표시를 연결하고 기본 셸은 설정에서 관리한다. Windows 기본 PowerShell과 설치된 CMD/Git Bash, 다른 OS의 Bash를 유지한다. 사용자 직접 명령은 모델 대화를 만들거나 자동 재실행하지 않는다.
- 인터넷 브라우저는 MUST Electron WebContentsView로 제공한다. 별도 session/Node 비활성/context isolation/sandbox를 사용하고 모델 인증/IPC/파일 실행 권한을 원격 페이지에 전달하지 않는다. 웹 미리보기에서는 Electron 전용임을 표시하며 브라우저 native RPC를 거부한다. 프로젝트/모달/파일로 전환할 때 native view를 숨기고 탭 상태를 보존한다. Beta Computer Use 비활성 결정과 테스트 미실행 조건을 유지한다. 근거와 실제 구현 경계는 docs/TABBED-FILES-BROWSER-2026-10-02.md를 따른다.
- 사용자 결정 2026-10-02: 인터넷 브라우저는 MUST 파일과 웹페이지를 같은 탭 줄/선택/호버/크기 조절 안에서 관리한다. 별도 브라우저 탭 줄을 중복하지 않는다. 대화의 HTTP/HTTPS 링크도 같은 보조 영역의 웹 탭으로 열고 모델의 외부 인증 흐름은 유지한다. 주소/탐색과 프로젝트 경로 입력은 공통 누비 토큰을 사용한다. 웹페이지에 초점이 있어도 주소/찾기/새 탭/닫기/새로고침 단축키를 동일하게 처리한다.
- PowerShell 한글은 MUST 공통 powershell-encoding 계약으로 처리한다. 명령은 UTF-16LE EncodedCommand로 전달하고 콘솔 입출력/외부 프로그램 파이프/Python 표준 입출력은 UTF-8, InputFormat/OutputFormat은 Text로 명시한다. 일반 실행과 승인된 관리자 실행에서 같은 계약을 사용하며 스트림/로그 경계에서 한글 바이트를 자르지 않는다. 시스템 locale, 실행 정책, 사용자 프로필과 프로젝트 파일 인코딩을 자동 변경하지 않는다. 기존 UTF-8 무BOM ps1의 PowerShell 5.1 읽기 및 CP949 고정 외부 실행기 호환성은 별도로 확인한다. Electron 빌드와 실제 Windows 검증을 구분한다. 근거는 docs/POWERSHELL-KOREAN-2026-10-02.md다.

- 최신 사용자 결정 2026-10-04: 보조 영역의 + 메뉴는 MUST 터미널과 파일만 표시한다. 새 페이지/새 탭 메뉴와 빈 브라우저 탭은 노출하지 않는다. 브라우저 아이콘에서 주소를 입력하면 실제 페이지 탭을 열고 기존 페이지/인증/링크와 키보드 단축키 계약은 유지한다. 터미널 행의 …에서 현재 OS에 제공되는 셸을 골라 새 터미널 탭을 열고 설정의 기본 셸을 변경하지 않는다. 터미널별 경로/입력 이력/출력을 유지하며 탭 전환으로 실행을 재전송하지 않는다. 실행 중인 탭은 먼저 중지해야 닫을 수 있다. 파일 하단 터미널 패널과 사이드 채팅 메뉴는 표시하지 않는다. 상세 범위는 docs/TERMINAL-TABS-2026-10-02.md다.

- 사용자 결정 2026-10-02: 모든 Desktop 모달은 MUST 공통 제목 시작 여백(--nubi-modal-title-inset)과 좌우 여백(--nubi-modal-inset)을 사용한다. 기본 상단/좌우는 24px, 600px 이하에서는 16px이다. 모델 선택만 별도 헤더/본문 여백을 적용하지 않는다. 검색 진입과 모달 제목은 대화 검색으로 통일하고 제목/입력 앞에 돋보기 아이콘을 유지한다. 검색 모달 안의 새 대화 + 버튼은 제거하며 사이드바의 새 대화 기능은 유지한다.

- 사용자 결정 2026-10-02: 열린 파일과 웹페이지 탭은 MUST 칩 오른쪽에 같은 작은 X 닫기 버튼을 표시한다. 전역 모달/사이드바의 X 제거 결정과 구분한다. 닫기 버튼은 선택 버튼의 형제이며 탭 선택을 발생시키지 않는다. 미저장 파일 확인과 다른 탭의 상태를 유지하고 웹 탭 닫기로 제공자 외부 로그인 세션을 종료하지 않는다.

- 최신 사용자 결정 2026-10-02: 모든 Desktop 모달은 MUST 우측 상단의 동일한 X 닫기 버튼을 표시하며 배경 클릭으로 닫히지 않는다. 이전 모달 X 숨김/배경 닫기 결정을 대체한다. 작은 추론/스킬 대화상자에도 X를 두고 외부 클릭 닫기를 제거한다. Escape, 초점 복원, 부모 모달 복귀와 처리 중 닫기 차단은 유지한다. 선택형 도구/셸 메뉴는 비모달 메뉴다. CX의 기존 모달 수명주기는 유지하고 node_modules를 수정하지 않는다. 근거는 docs/MODAL-DISMISSAL-2026-10-02.md다.

- 사용자 결정 2026-10-02: 오른쪽 보조 영역의 확장/복귀와 닫기 버튼은 MUST 우측 상단의 같은 버튼 그룹에 둔다. 메일 수집/첨부 읽기/정리는 열린 화면과 무관하게 호스트에서 실행하며 하단 공통 상태 줄에 실제 완료, 남음, 확인 필요와 현재 단계 및 다음 서버 확인 시각을 표시한다. 서버 LOGIN-DELAY를 우회하지 않고 OFF/로그아웃 시 새 수집과 모델 호출을 멈춘다.

- 사용자 결정 2026-10-02: 답변 아래에 현재 실행 시작부터 최종 응답과 검토 완료까지 실제 걸린 시간을 표시한다. 실행 중 경과 시간과 완료 시간을 구분하고 monotonic clock을 사용한다. 메일별 정리/복구 저장 시간도 실제 완료 영수증에 연결한다. 사용자 확인/큐 대기와 후속 실행은 나누고 측정값 없는 과거 기록의 시간을 추정하지 않는다.

- 사용자 결정 2026-10-02: 메일 화면의 검색은 MUST 실제 OpenWiki Personal 검색 도구를 사용하고 개인 범위, 미정리/출처 누락/검색 한도를 표시한다. 백그라운드 작업과 확인 대기를 구분하며 최근 반영 시각은 Wiki 저장 readback 뒤의 savedAt으로 표시한다. 서버 확인 시각으로 대체하지 않는다. 넓게 펼친 오른쪽 보조 영역은 같은 모양의 복귀 버튼 하나만 표시한다.
- 사용자 결정 2026-10-02: 진행/완료 시간은 소수점 없는 정수 초로 표시하고 메시지의 전송/수신 시각은 OS 시간대/표시 형식으로 따로 표시한다. 큐 입력은 등록 시각과 적용 시각을 구분하고 과거 기록의 없는 시각을 추정하지 않는다.
- 사용자 결정 2026-10-02: 인증 완료 화면의 앱 복귀는 MUST 해당 인증 탭만 닫고 중앙 작업으로 돌아간다. Desktop에서 window.close로 앱 창을 닫지 않는다. 닫힌 WebContents는 즉시 목록에서 제거하고 상태 변경 이벤트를 사용하며 고빈도 브라우저 폴링을 하지 않는다. 종료 진단에는 시각/컴포넌트/정해진 사유/종료 코드만 남기고 URL/인증값/본문을 남기지 않는다.
- 사용자 결정 2026-10-02: 설정은 MUST 기본 터미널처럼 앱 동작을 정하는 항목만 남기고 메일/스킬/프로젝트 도구의 별도 화면을 중복하지 않는다. 홈 우측 상단 사용량은 브라우저 확장 UsagePanel과 실제 호출 집계 계약을 재사용한다. 오늘/전체의 입력/출력과 미집계를 구분하고 동시 백그라운드 호출을 포함한다. 컨텍스트 도넛과 계정 잔여 한도는 별도로 표시하며 인증값과 잔여 한도 캐시는 메모리에만 둔다. 이전 대화의 토큰을 추정해 채우지 않는다.
- 사용자 결정 2026-10-02 및 2026-10-12: 3분할 채팅의 최소 너비는 MUST 모델과 승인 방식을 아이콘으로 줄인 입력 도구가 한 줄에 들어가는 실제 너비와 여백으로 계산한다. 긴 초안의 펼치기, 실행 중 대기열/중지와 모델 복구 버튼도 각각 예약한다. 양쪽 사이드바는 같은 최소 너비를 침범하지 않으며 접으면 채팅을 넓힌다. 창 자체가 더 좁으면 사이드바를 겹쳐 표시한다. 근거는 docs/CHAT-MINIMUM-WIDTH-2026-10-02.md와 docs/COMPOSER-SINGLE-ROW-2026-10-12.md다.

- 사용자 결정 2026-10-04: 위키가 없는 프로젝트는 MUST 모델 연결 후 중앙의 폴더/Git URL 카드로 시작한다. 왼쪽 폴더 버튼은 이 화면을 열고 기존 대화와 초안을 보존한다. 이전 프로젝트 복원과 로그인만으로 새 위키 생성을 시작하지 않으며 명시적 폴더/저장소 선택 후 준비한다. Git은 선택한 상위 폴더의 새 하위 폴더에 복제한다. 위키 준비는 실제 단계별 처리 수와 경과 시간을 표시하고 가상 전체 완료율을 만들지 않는다. 화면 명칭은 위키로 통일하되 기술 식별자와 저장 경로는 보존한다. 버튼 누름은 1% 이내로 줄이고 큰 카드의 크기는 고정한다. 기존 배경/새 모션과 모션 감소 설정은 유지한다. 범위는 docs/PROJECT-START-WIKI-2026-10-04.md를 따른다. Electron 빌드만 수행한다.

- 품질 보강 2026-10-04: 메일 근거는 MUST 초안/큐/사용자 메시지에 원문 및 첨부 해시와 실제 위치를 보존하고 수락 시 호스트에서 재확인한다. 근거 연결만으로 자동 전송하지 않으며 비동기 응답이 다른 모델/문서/새 초안을 덮어쓰지 않는다. 반영 파일 요약은 해당 대화의 저장 완료 기록과 현재 파일 readback으로만 계산하며 미반영 제안이나 전체 Git 변경과 섞지 않는다. 근거/제한은 docs/QUALITY-AUDIT-2026-10-04.md를 따른다.

- 사용자 결정 2026-10-04: 대화의 변경 파일 요약은 MUST 파일별 추가/삭제 줄 수와 공통 파일 아이콘을 표시하고 선택 시 오른쪽 파일 탭과 탐색기의 선택/상위 폴더 펼침/스크롤을 함께 연결한다. 새 파일은 목록을 다시 읽고 필터나 다른 폴더가 가리지 않게 한다. 편집기와 탐색기는 같은 task workspace를 사용하며 미저장 모델/undo/현재 파일 해시 검사를 유지한다. Electron 빌드만 수행한다.

- 사용자 결정 2026-10-04: 메시지와 입력창 주변은 MUST 보조 사이드바와 같은 옅은 파랑/민트 그라데이션을 재사용한다. 가변 배치는 전체 창이 아니라 실제 Agent/보조 영역의 container 너비를 따른다. 좁아지면 승인/모델 문구를 아이콘으로 줄이고 공통 대화/큐/입력창 정렬, 추론 상태, 컨텍스트 도넛, 전송/중지와 접근성 이름을 유지한다. 최소 너비는 수축 가능한 여백의 최솟값으로 계산한다. 근거와 검증 범위는 docs/CHAT-SURROUND-RESPONSIVE-2026-10-04.md다. Electron 빌드만 수행한다.

- Mail raster previews use verified original attachment bytes and source/attachment hashes in the existing auxiliary reader. Preview is not OCR or document extraction: keep unread coverage and do not mark an image complete or send an empty text document to AI. Exclude SVG/HTML from raster previews and retain original downloads.

- 사용자 결정 2026-10-12: 선택한 메일과 첨부 질문은 MUST 동일 원문의 개인 OpenWiki 정리를 함께 참고하고 원문으로 검증한다. notes의 current/edited/pending/missing/unavailable과 잘린 범위를 구분하고 선택하지 않은 메일로 질문 범위를 넓히지 않는다. 프로젝트 질문은 기존 ask_openwiki와 원문 확인 흐름을 유지한다. 빈 채팅 입력은 한 줄부터 늘어나며 공통 세로 패딩을 사용하고 모델/승인/문맥 도구는 입력창 안에 유지한다.

- 사용자 결정 2026-10-12: 대화 목록의 …는 MUST 행 높이를 바꾸지 않는 떠 있는 메뉴로 표시하고 창 경계, 바깥 클릭, Escape와 초점 복귀를 보존한다. 진행 표시는 실제 도구와 공개 진행 메시지를 유지하며 최근 3개만 남겨 이전 조회를 숨기지 않는다. 정상 결과 검토는 작은 근거 펼침으로 두고 미확인/승인 대기/누락과 다음 행동은 숨기지 않는다.

- 사용자 결정 2026-10-12: 답변 원문 출처는 MUST 제목과 목록을 분리하고 아이콘/번호/제목 시작점을 고정 정렬한다. 메일과 첨부/문서 아이콘, 원문 열기 표시와 전체 제목 툴팁을 제공하며 출처 번호/해시/위치/미확인 상태는 보존한다.

- 사용자 결정 2026-10-12: 독립적인 복수 자료 조사는 기존 읽기 전용 서브에이전트로 분담하고 실제 담당 업무/자료 읽기/응답/메인 전달을 표시한다. 메일 분담은 먼저 읽은 해당 원문과 Personal 위키의 analysis_evidence_id만 배정한다. 현재 실행의 분담 결과는 최종 검토 뒤에도 기본 화면에 유지한다. 전달은 승인이나 전체 성공이 아니며 외부 A2A의 비활성 계약은 별도로 유지한다. 근거는 docs/SUBAGENT-VISIBILITY-2026-10-12.md다.

- 사용자 결정 2026-10-12: 모든 화면과 모달의 버튼/메뉴/제목과 입력 도구는 MUST 한 줄로 유지한다. 공간이 부족하면 불필요한 문구를 줄이거나 이름 있는 아이콘으로 전환한다. 승인 범위와 오류/복구 설명 및 문서 본문은 보존한다. 왼쪽 도구 줄은 72px와 24px 아이콘/48px 버튼을 사용하며 팀 공간 명칭을 AI Workspace로 통일한다. 의미별 선택/AI/주의/완료 색은 기존 CX 토큰을 재사용한다.

- 사용자 결정 2026-10-12: 대화 검색은 MUST 현재 공간의 저장된 모든 대화에서 첫 요청/사용자 질문/AI 답변 본문을 검색한다. 최근 50개 목록이나 모델 문맥으로 범위를 제한하지 않는다. 검색 결과 복사는 제거하고 일치 구절 한 줄과 문자 그대로의 검색어 강조를 제공한다. 결과 개수와 검색 범위를 표시하고 오래된 결과도 실제 대화로 연다. 내부 서브에이전트부터 진행하며 외부 A2A는 계속 비활성이다.
- 사용자 결정 2026-10-12: 같은 프로젝트의 여러 대화는 MUST 독립된 agent controller, run ID, 시간과 입력 큐로 함께 실행한다. 프로젝트/제공자 변경 및 승인된 쓰기의 공통 잠금은 유지하고 앱 종료 시 모든 대화를 중지한다. Desktop A2A와 다른 프로젝트 동시 실행으로 확대 표시하지 않는다.

- 사용자 결정 2026-10-12: 대화 진행 화면은 MUST 현재 작업과 경과 시간을 한 줄로 표시하고 공통 아이콘 열/본문 토큰을 사용한다. 정상 세부 기록은 펼침으로 유지하며 새 오류와 확인 대기는 드러낸다. 계획의 완료 기준, 하위 분석의 미확인/전달 상태, 명령/실행 결과와 승인 범위를 꾸밈 때문에 생략하지 않는다. Desktop의 간결한 표시는 공유 컴포넌트의 opt-in이며 다른 호스트 기본 표시는 유지한다. 범위는 docs/ACTIVITY-READABILITY-2026-10-12.md다.

- 사용자 결정 2026-10-12: 결과 품질을 화면 간결함보다 우선한다. 최종 답변은 요구한 해결책/발견/산출물부터 제시하고 실제 근거, 남은 확인과 다음 행동을 구분한다. 공통 의미 토큰으로 기본/보조/메타/선택/성공/주의/오류를 표현하고 중요한 결론만 600으로 강조한다. 모달은 제목/하단 조작을 보존하고 본문을 스크롤하며 작은 창/글자 확대에서도 필수 조작에 접근할 수 있어야 한다. 문맥 도넛 옆 토큰 숫자는 표시하지 않고 도넛 비율과 상세 조회를 유지한다. 범위와 검증은 docs/RESULT-AND-VISUAL-HIERARCHY-2026-10-12.md를 따른다.

- 사용자 결정 2026-10-12: 보조 터미널은 MUST 검정 표면과 실제 셸 배너/프롬프트/커서의 대화형 PTY로 제공하며 별도 명령 입력 폼을 두지 않는다. PowerShell 버전은 설치된 셸이 표시하며 7을 우선 탐색한다. 셸은 별도 worker에서 실행하고 입력 대기/Ctrl+C/경로/변수/탭 상태를 유지한다. 사람이 연 셸과 AI의 승인/실행 영수증은 분리한다. 숨긴 탭은 유지하고 명시적 닫기는 해당 셸을 종료하며 앱 종료/렌더러 장애 뒤 명령을 자동 재전송하지 않는다. 출력 버퍼와 IPC 범위, 복사 및 검증 경계는 `docs/INTERACTIVE-TERMINAL-2026-10-12.md`를 따른다.

- 사용자 결정 2026-10-12: 채팅 전송은 MUST 호스트 응답 전에 말풍선/접수 상태를 표시하고 새 초안을 독립 보존한다. 실제 실행 상태만 진행으로 표시하며 전송 결과가 불확실한 요청을 자동 재전송하지 않는다. 첫 전환 모션은 시스템 모션 감소를 따른다. 연결 전 계정 표시는 GitHub 아이콘과 로그인, 연결 후는 GHES 사진과 이름을 유지한다. 고정된 대화는 목록 앞의 채팅 아이콘을 같은 크기의 핀 아이콘으로 대체한다. 범위는 `docs/CHAT-SEND-RESPONSIVENESS-2026-10-12.md`를 따른다.

- 사용자 결정 2026-10-12: `/` 메뉴는 MUST 입력창 위에서 아이콘, 이름, 짧은 설명을 한 줄로 표시하고 실제 등록 스킬만 포함한다. `/mail`은 Personal 메일/관련 위키, `/code`는 현재 프로젝트 Code 위키/소스로 조회 도구와 실행을 제한한다. 공통 선택 메뉴는 입력 필드 너비를 따르며 모달을 연 버튼을 다시 누르면 기존 닫기 동작과 busy 보호를 통해 닫는다. 범위와 검증은 `docs/CHAT-SEND-RESPONSIVENESS-2026-10-12.md`를 따른다.

- 사용자 결정 2026-10-12: 에이전트는 MUST 요청에 필요한 자료만 읽고 제공된 내용으로 충분한 일반 답변에는 탐색/계획을 강제하지 않는다. 프로젝트 파일과 독립된 명령은 빈 references로 제안할 수 있으나 정확한 명령/영향/승인 계약을 유지하며 파일 의존 명령의 관찰/해시 검증을 생략하지 않는다. 작업에 속한 명령은 성공 후에도 실제 출력을 AI에 돌려주고 필요한 후속 작업을 판단하며, 명령 하나의 종료를 전체 작업 완료로 간주하지 않는다. 사용자 취소/미확정 실행/직접 연 보조 터미널은 자동 재실행하지 않는다. 질문과 명령 승인/수정은 간결한 앱 내부 팝업으로 표시하고 닫기는 보류만 한다. 확인 기준은 실행 기록에 유지하고 중복된 `실행 후 확인 방법` UI는 제거한다. 범위와 검증은 `docs/TASK-DECISIONS-CONTINUATION-2026-10-12.md`를 따른다.

- 하네스 개선 2026-10-12: 계획은 활성 검색 범위와 선택 메일 ID를 함께 받고 Personal 메일을 독립 workflow로 선택한다. 메일 검색은 수집된 로컬 범위와 누락/잘림/다음 페이지를 구분하며 서버 전체 조회로 표시하지 않는다. OpenWiki 위임 답변은 원문을 유지하되 Desktop 현재 페이지 대조와 소스 최신성을 함께 검토에 전달하고 일치하지 않는 인용문은 현재 근거로 사용할 수 없다. 방법론과 고정/실모델 검증 경계는 `docs/HARNESS-ROUTING-2026-10-12.md`를 따른다.

- 하네스 후속 2026-10-12: 사용자 요구의 유일한 근거가 무효가 되면 MUST 답변까지 다시 검토하고, 정확한 미확인 설명은 전달한다. Claude CLI의 호스트 도구 제안은 MUST 누비의 입력/승인 검사를 거친다. CLI 내부에서 실행하거나 CLI 도구 부재를 누비 기능 부재로 표시하지 않는다. 평가에는 실제 결과, 반복 일관성, 지연과 미실행을 분리해 남긴다. 적용 근거와 검증 범위는 `docs/HARNESS-METHODS-2026-10-12.md`를 따른다.

- 사용자 결정 2026-10-12: Claude 추론 UI는 MUST ChatGPT와 같은 번개 버튼/슬라이더를 재사용하고 `provider.reasoningOptions`만 표시한다. 기본값은 medium이며 설정은 기존 Desktop 모델/effort 저장 경로를 사용한다. CLI 요청값과 확인되지 않은 실제 적용 강도를 혼동하지 않는다. Opus 평가 기준은 `claude-opus-5-5`와 medium이며, Haiku는 추론 선택기를 표시하지 않는다. 첫 로그인 버튼은 기존 제공자 등장 순서와 모션 감소 설정을 따른다.

- 사용자 결정 2026-10-12: 추론 슬라이더와 번개/선택값은 MUST 제공자 고유 색을 사용한다. OpenAI는 기존 차콜, Claude는 테라코타, AI Pro는 번들 로고의 파랑/보라 그라데이션이며 공통 누비 파랑으로 덮어쓰지 않는다. 조작 방식/크기/레이아웃은 같은 선택기를 재사용한다.

- 사용자 결정 2026-10-12: Claude 클릭은 MUST 먼저 기존 CLI 연결을 확인하고 준비된 PC에서는 안내 없이 연결한다. 미설치일 때만 설치 안내, 구버전일 때만 업데이트 안내를 표시한다. 설치된 CLI가 미로그인이라면 사용자 클릭으로 공식 `claude auth login`을 실행하고 발급된 인증 URL을 누비 내장 브라우저에서 연다. 인증 저장/교환은 CLI에 맡기고 취소/완료 후 해당 인증 탭과 자식 프로세스만 정리한다. 앱 시작이나 상태 조회로 로그인을 실행하지 않으며 설치는 자동 실행하지 않는다.

- 사용자 결정 2026-10-12: 앱 AI Workspace의 위키 공유는 MUST native GHES 계정으로 `Manufacturing-IT/nuri/wiki/<uuid>`에 Code/Personal 문서를 구분해 관리한다. 선택 문서와 최종 native 저장 승인을 유지하고 버전별 manifest/hash, 최신 head 확인, 비강제 ref 갱신을 사용한다. 인증과 메일 원본은 공유 패키지에 포함하지 않으며 다운로드를 프로젝트 활성화로 표시하지 않는다. 범위는 `docs/WIKI-SHARING-2026-10-12.md`를 따른다.
- Claude 모델 목록과 추론 선택지는 MUST 설치된 CLI의 초기화 응답을 사용한다. 고정된 세 모델 목록이나 모델 이름으로 추론 지원을 추측하지 않는다. 같은 resolvedModel의 기본값/별칭은 합치되 별도 버전은 유지한다. 인증값은 기존 CLI에서만 관리한다.

- 사용자 결정 2026-10-12: Windows 설치판은 MUST SHA-256을 고정 검증한 공식 MinGit을 포함하고 앱/자식 프로세스의 PATH에서 우선 사용한다. 시스템 PATH, 전역 Git 설정과 인증 저장소를 변경하지 않는다. 실행기 누락/차단/지연은 구분해 안내하며 코드 Wiki 생성/갱신 전 확인한다. 기존 Wiki 조회와 Personal 메일 검색을 Git 설치로 막지 않는다. 라이선스/배포 출처를 함께 보존하고 시스템 Git 없는 Windows 설치판을 검증한다.
- 사용자 결정 2026-10-12: AI Workspace의 스킬 Team/Personal과 위키 Code/Personal은 같은 탭/사내 Github SSO 컴포넌트를 사용한다. 메일은 정렬/페이지네이션하는 표 아래에 원문을 표시하고 POP3의 보낸메일 수집 미지원을 명시한다. 파일명 이동은 실제로 잘린 이름에만 적용하고 모션 감소를 존중한다.
- 사용자 결정 2026-10-12: Windows 업데이트는 native GHES 계정으로 nuri/latest/windows-x64.json을 확인하고 실제 다운로드 진행률을 표시한다. 버전/Release asset/용량/해시를 검증한 뒤 작업/미저장 파일/터미널이 없는 상태에서 자동 설치/재실행한다. 사내 배포는 사내 PC의 Publish-NubiUpdate.ps1로 수행하며 Mac 검사나 GitHub 공개망 CI를 GHES 실배포 성공으로 표시하지 않는다.

- 후속 사용자 결정 2026-10-12: 스킬의 기존 안내/로그인 버튼 표면을 보존해 위키에도 그대로 적용한다. 위키의 넓은 Code/Personal 분할 탭을 유지하고 스킬 Team/Personal도 같은 넓은 분할 탭을 사용한다. 작은 칩 탭과 별도 로그인 줄로 대체하지 않는다.

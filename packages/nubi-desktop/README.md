# 누비 workspace

버전: **beta 1.1.0**

누비 제품군의 데스크톱 작업 공간입니다. 로고에는 기존 새 이미지와 누비 beta 워드마크를 사용합니다. Theia 기반의 로컬 IDE와 누비 작업 화면을 연결합니다. **요청 → 소스·Wiki 분석 → 변경 제안 → IDE에서 비교·반영 → 명령 실행 → 실제 화면 비교**를 연결합니다. 첫 화면은 누비 웹 확장과 같은 로그인 화면입니다. 연결 후 같은 인사말·모델 선택·요청 입력·대화 흐름으로 이어지고, 워크스페이스 기능은 작업 탭과 펼침 영역에서 엽니다.

사용자가 제공한 `agentfactorysdkdeck.html`의 색상, Pretendard/Noto Sans KR 글꼴 계열, 제목·본문 크기, 카드와 등장 모션을 기준으로 삼았습니다. 누비의 React/CX 컴포넌트, 캐릭터 프레임과 애니메이션은 브라우저 확장 소스를 직접 재사용합니다. 모델의 내부 추론이나 가상 진행률은 표시하지 않습니다.

## 실행

이 저장소를 기준으로 Node 24 LTS와 Git이 필요합니다. 실제 화면 비교에는 설치된 Chrome/macOS 또는 Edge/Windows를 사용하거나 `npx playwright install chromium`으로 브라우저를 준비합니다.

```sh
cd packages/nubi-desktop
npm ci --prefix ../../extensions/aipro-chat --ignore-scripts
npm ci
npm run build
npm start -- /absolute/path/to/git-project
```

브라우저 검증 주소는 `http://127.0.0.1:4330`입니다. 데스크톱 창은 다음 명령으로 실행합니다.

```sh
npm run build:electron
npm run start:electron -- /absolute/path/to/git-project
```

Windows에서도 같은 npm 명령을 사용합니다. 앱에서 실행하는 명령의 기본 셸은 PowerShell입니다. 프로젝트 설정에서 PowerShell, CMD, 설치된 Git Bash 중 기본 셸을 고를 수 있습니다. `NUBI_BASH_PATH`는 Git Bash 경로를 명시할 때만 사용합니다. Windows x64 설치 파일은 `npm run package:windows`와 전용 Windows workflow로 생성합니다. 검증 절차와 실제 통과 범위는 [Windows 배포](docs/WINDOWS-RELEASE.md)를 따릅니다. 자동 업데이트와 공인 배포자 서명은 아직 제공하지 않습니다.

## 현재 연결된 동작

- Theia 파일 탐색·Monaco 편집·기본 터미널과 별도의 누비 실행 기록.
- 업무 개념·소스·요구사항·DB 테이블/컬럼·Wiki를 Git 지식 목록으로 연결하는 관계 지도. 별칭 검색·방향 관계·정적 영향 후보·DDL/DB 대조·시점별 Wiki 기록.
- PostgreSQL/MySQL/MariaDB/SQL Server/Oracle 메타데이터 연결 어댑터와 SQLite 실제 파일 읽기, 기타 DB의 공통 JSON 입력. 원격 DB 실접속은 별도 검증 대상입니다. [설정과 수집 범위](docs/KNOWLEDGE-QUALITY.md)를 확인하세요.
- 원래 완료 조건·관찰한 파일·검증 방법을 연결하는 변경 계획. 계획 밖 파일·이전 실행의 계획·바뀐 해시로 모델이 수정안을 만들면 재계획합니다. 객관식/자유 입력 질문과 답변 초안은 같은 작업에서 복원합니다.
- Git 프로젝트의 실제 파일·문서 검색, OpenWiki의 구조 기반 BM25 검색 재사용, 출처 경로·행·내용 해시.
- 요청과 완료 조건의 SQLite 저장, OpenSpec 형식 문서 내보내기. 사람의 기존 문서는 덮어쓰지 않습니다.
- 현재 모델 실행에서 읽은 구간만 정확히 치환하는 부분 수정 제안과 jsdiff 변경 줄 수 표시. 전체 교체는 모든 행을 읽은 경우만 허용하고 UTF-8이 아닌 파일은 재인코딩하지 않습니다.
- 기존 파일에 대한 변경 제안, Monaco diff/undo/save, 저장되지 않은 편집 및 내용 해시 충돌 차단, Git 3-way merge로 독립 변경 보존.
- 명시적인 HEAD 기준 worktree. 원래 폴더의 미커밋 변경은 그 폴더에 유지하며 worktree에 자동 복제하지 않습니다.
- 소유 프로세스의 Bash/PowerShell 실행·출력·종료 코드·취소·로그. 전체 로그는 파일에, 최근 출력은 작업 상태에 남깁니다. Worktree는 OS 보안 샌드박스가 아닙니다.
- 모델 연결 재시도·문맥 초과 복구·도구 대기 제한과 SQLite 중단 기록. 실패한 명령은 AI가 원인을 분석하고 코드/명령 수정안을 준비합니다. 수정 명령 실행 뒤 실제 결과를 다시 검토하며, 재시작 후에는 **이어서 진행**에서 미완료 작업을 이어갑니다. [복구 방법과 한계](docs/RECOVERY-HARNESS.md)를 확인하세요.
- 최종 응답 전에 원래 요구사항과 실제 기록을 별도 문맥에서 검토합니다. 누락된 작업은 이어가고, 새 근거 없는 반복 실패는 기존 질문 폼으로 확인합니다. 검토 통과를 실제 반영이나 테스트 성공으로 취급하지 않습니다. [결과 검토 하네스](docs/RESULT-REVIEW-HARNESS.md)를 확인하세요.
- localhost 화면을 별도 브라우저에서 실제 캡처해 나란히/겹쳐 보기 및 픽셀 차이 저장. 쿠키·SSO 세션은 복제하지 않습니다.
- 기존 누비 Pi 도구 실행 순환, 최대 두 개의 격리된 문서·소스 분석, 전체 완료 조건·이전 답변을 유지하는 문맥 압축, 질문 후 재개, 호스트의 실제 호출 기록. AI Pro/ChatGPT/FabriX의 기존 제공자 어댑터를 재사용하며 인증값은 해당 실행기의 메모리에만 둡니다.
- **프로젝트 자료 → Wiki에 기록**으로 요청·완료 조건·소스 해시·변경·실행·화면 비교 근거를 프로젝트의 Markdown에 저장합니다. 같은 근거는 중복 저장하지 않고, 변경되면 새 버전을 남겨 기존 사용자 편집과 미저장 편집기를 보존합니다. 자동 commit/push는 하지 않습니다. **다시 확인**으로 소스 변경과 문서 직접 수정을 구분합니다. 과거 기록이 현재 동작을 증명하지는 않습니다.
- `openwiki/`가 있는 프로젝트에서 **누비 웹 확장과 연결**을 누르면 기존 OpenWiki 일회용 페어링 API가 열립니다. 문서·소스 읽기만 제공하며 디스크 변경을 재조회합니다.

같은 로컬 상태 저장소는 SQLite의 별도 실행 소유권 트랜잭션으로 보호합니다. 다른 실행기는 진행 중인 작업을 덮어쓰거나 중단 처리할 수 없으며, 소유 프로세스 종료 후에는 OS 잠금 해제로 복구할 수 있습니다. 네트워크 공유 상태 DB와 여러 기기 사이의 협업 잠금은 지원 범위가 아닙니다.

프로젝트 상태는 기본적으로 `~/.nubi-desktop/`에 저장합니다. `NUBI_STORAGE_ROOT`는 검증용 상태를 분리하는 설정입니다. IDE 설정은 시작 스크립트에서 `~/.nubi-desktop/ide`로 분리합니다. 렌더러 새로고침은 같은 메모리 전용 인증과 소유 실행을 유지합니다. 마지막 연결이 끊긴 뒤 30초 동안 재접속이 없으면 실행기를 정리하고 소유 실행을 중지합니다. 앱 종료 시에도 실행기를 정리하며, 재시작 시 미확정 작업은 `interrupted`로 남기고 자동 재전송하지 않습니다.

## 검증과 남은 범위

```sh
npm test
npm run test:ui
npm run test:shared-ui
```

런타임 검사는 실제 임시 Git 저장소·SQLite·프로세스·OpenWiki HTTP·Chrome 캡처를 사용합니다. 모델은 주입한 합성 응답으로 도구 계약을 검증합니다. UI 검사는 실제 Theia에서 편집 충돌·diff·저장·명령 실행·화면 비교·새로고침·접근성 모션을 확인합니다. 공통 UI 검사는 합성 제공자 상태로 로그인 후 전환·검색형 모델 선택·후속 대화·로그아웃·FabriX 테스트 후 연결을 확인합니다. 실제 계정 인증 검사가 아닙니다. 증적은 gitignore된 `verification/`에 생성합니다.

사용자 Windows 11 환경, 각 제공자 실계정·사내망 성능, 실제 확장 설치 후 페어링, Office 작업 수신·편집·저장, OpenWiki의 자동 생성·주기적 갱신, LSP/VS Code 확장 호환성, 다중 창 작업 조정은 별도 검증·구현 범위입니다. 현재 Agent는 분석과 변경안 준비를 수행하고, 코드 반영과 명령 실행은 화면의 명시적 동작으로 연결합니다. 검증 요약을 만들 수 있지만 Office에 전달되거나 저장됐다고 표시하지 않습니다. 화면 픽셀 차이로 기능 완료를 판정하지 않습니다.

검증 결과는 [검증 기록](docs/VERIFICATION.md), 개선 판단과 남은 우선순위는 [개선 기록](docs/IMPROVEMENTS.md), 선택 근거는 [구현 결정](docs/IMPLEMENTATION.md), 라이선스는 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md)에 기록했습니다.

OpenWiki와 함께 사용하는 검색, 출처 대조, 요구사항 인용 흐름은 [OpenWiki 근거 연결](docs/OPENWIKI-EVIDENCE.md)을 참고하세요. 업무 용어로 연결된 문서를 찾고, 오래된 근거는 현재 코드와 다시 대조합니다.

로컬 실행에 필요한 확인, 설치, 설정과 빌드 명령은 누비가 제안하고 사용자가 승인해 실행할 수 있습니다. 환경 선택에는 기존 객관식/직접 입력 폼을 사용하며, 답변을 실행 승인으로 취급하지 않습니다. [실행 준비와 승인](docs/ENVIRONMENT-PREPARATION.md)에 복구 방식과 검증 범위를 정리했습니다.

코딩 품질 개선에는 기존 Pi와 ripgrep 검색, JS/TS 구조 조회, TypeScript/JSONC/YAML 문법 검사를 연결했습니다. 새 오류는 AI에 돌려줘 제안을 고치고, 반영 전에도 다시 검사합니다. 화면에는 검사 상태를 한 줄로 보여 줍니다. 문법 통과와 실제 기능 테스트는 구분합니다. OpenCode/Aider 방법론의 적용 범위와 다른 후보의 선택 근거는 [코드 변경 품질](docs/CODING-AGENT-QUALITY.md)에 정리했습니다.

A2A는 향후 연결 가능성만 검토하며 현재 버전에서는 제공하지 않습니다. 앱 간 연결과 작업 전송은 비활성입니다.

작업 화면은 기능별 탭 없이 요청, 자동 작업 계획, 질문/승인과 실제 결과를 함께 보여줍니다. 첫 도구 전에 계획을 저장하고 누비가 필요한 소스, Wiki와 실행 도구를 선택합니다. 직접 조작은 작업 도구 모달에서 사용할 수 있습니다. [작업 중심 화면과 실행 계약](docs/TASK-FIRST-WORKSPACE.md)을 확인하세요.

## 실측 평가

실제 모델로 고정 과제를 돌려 품질과 비용을 측정합니다. 로그인은 별도 터미널의 모델 세션이 유지합니다.

```bash
node eval/model-session.mjs
node eval/run.mjs --split dev
node eval/compare.mjs <이전>/report.json <이후>/report.json
```

결과는 gitignore된 `verification/eval-live/`에 생성합니다. 공개 자료와 합성 자료로 측정한 값이며 사내 모델이나 회사 저장소의 성능이 아닙니다. 범위는 [실측 평가 문서](docs/LIVE-EVAL.md)를 따릅니다.

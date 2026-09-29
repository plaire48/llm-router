# 로컬 실행 준비와 사용자 승인

누비가 소스에서 실행 방법을 찾고, 필요한 명령을 준비한 뒤 사용자가 승인한 명령만 실행한다. 환경 선택과 실행 권한을 구분한다.

## 적용한 흐름

1. `inspect_environment`가 선택한 프로젝트의 manifest, lockfile, 버전 파일과 호스트 셸을 정적으로 확인한다. Node 프로젝트는 `packageManager`, lockfile, scripts, engines 순으로 실행 근거를 제공한다. AI가 기존 `source_search`와 `read_source`로 README와 추가 설정을 읽고 필요한 명령을 준비한다. PATH 발견은 버전이나 정상 설치의 증명이 아니므로 필요한 버전 검사는 별도 제안한다.
2. 설정 파일로 결정할 수 있는 셸과 패키지 매니저는 사용자에게 묻지 않는다. 파일 간 충돌이나 업무 의도가 해결되지 않을 때만 기존 `ask_user`와 누비 QuestionForm을 사용한다. 객관식과 직접 입력, 초안과 답변 이력을 유지한다. 답변은 실행 승인이 아니다. 비밀번호나 토큰을 이 폼에 요구하지 않는다.
3. `propose_setup_action`은 한 단계의 확인, 설치, 설정, 빌드, 서버 실행 또는 검증 명령을 준비한다. 목적, 예상 변경, 정확한 명령, 작업 폴더, 셸, 확인 방법, 이번 실행에서 읽은 근거 파일 해시를 저장한다. 준비 도구에는 실행 권한이 없다.
4. 작업 화면의 **승인하고 실행**이 호스트의 `decideSetupAction`에 연결된다. **실행하지 않기**는 거절을 기록한다. 제안 지문과 근거 파일을 다시 확인하고, 질문 대기나 취소 상태에서는 실행하지 않는다.
5. 기존 프로세스 하네스로 실행하고 실제 출력과 종료 상태를 저장한다. 정상 종료도 AI의 후속 결과 검토에 연결한다. 종료 코드 0, 설치 성공, 서버 준비, 기능 검증을 동일하게 취급하지 않는다. 새 명령은 새 제안으로 검토한다.

승인은 한 명령에 한 번만 적용한다. 동시 클릭과 응답 유실은 저장된 실행 기록을 반환한다. 실행 준비 중 앱이 재시작되면 상태 확인이 필요하다고 표시하고 자동 재실행하지 않는다. 프로세스에는 제안 ID를 함께 기록한다. 모델이 생성한 변경 설명은 보장된 영향 범위가 아니며 셸은 현재 사용자 권한으로 동작한다. 이 기능은 OS sandbox가 아니다.

## 방법론과 재사용 판단

- [Claude Code permissions](https://code.claude.com/docs/en/permissions)의 도구별 승인과 호스트에서 권한을 강제하는 방식을 참고했다. 모델 지시문이나 질문 답변으로 실행 권한을 부여하지 않는다.
- [Microsoft PowerShell 실행 인자](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1)와 [CMD 실행 인자](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)에 따라 내장 Windows 셸을 호출한다. CMD의 `/D`는 AutoRun을 끄고 `/C`는 명령 뒤 종료한다. 외부 셸 실행 프레임워크는 추가하지 않았다.
- [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/)처럼 lockfile 기반 설치를 우선 검토하되 기존 node_modules 제거와 설치 스크립트 실행 등의 효과를 제안에 설명한다. `ignore-scripts`도 명시적으로 요청한 npm run 스크립트를 차단하는 sandbox가 아니므로 자동 안전 판정에 사용하지 않는다. 사용 중인 패키지 매니저 버전의 동작을 확인해야 한다.
- Pi agent core, Ajv 계약 검증, 기존 SourceObservations, SQLite 실행 기록, Bash 사전 문법 검사, 누비 QuestionForm과 CX 버튼을 재사용했다. 새 agent/설치 프레임워크와 별도 질문 UI는 도입하지 않았다.
- mise/Dev Containers 등 환경 관리 도구를 제품 필수 의존성으로 추가하지 않았다. 프로젝트가 이미 사용한다면 설정을 읽고 관련 명령을 제안할 수 있다. 관리자 권한은 별도 일회 승인과 Windows RunAs를 연결했으며 `ADMINISTRATOR-EXECUTION.md`를 따른다. 실제 회사 PC 설치, UAC 자격 증명 입력과 OS sandbox는 별도 검증 범위다.

## 검증 경계

실제 임시 Git 저장소와 Bash로 승인 전 실행 차단, 중복 승인, 파일 변경, 거절, 질문 대기, 취소와 재시작을 검사한다. Pi 모델 응답은 합성 주입으로 실행 기록 전달을 검사한다. 실제 Theia 화면에서는 승인, 거절, 새로고침, 오래된 근거와 좁은 레이아웃을 확인한다.

임의 저장소의 환경 자동 발견 정확도, 실제 의존성 다운로드/설치, 실모델의 명령 선택 품질, Windows 설치 성공은 별도 평가다. 이번 정적 환경 확인 도구는 인터넷 문서 검색이나 모든 언어의 설치 자동화를 제공하지 않는다. 자동 승인 정책과 관리자 권한의 무인 설치는 제공하지 않는다.

2026-09-23 검증: 런타임 69개, 실제 Theia UI 38개, 브라우저/Electron 개발 빌드와 CX 검사 통과. 전체 병렬 실행은 integration 프로세스가 종료되지 않아 중단했고, 해당 파일 단독 4개와 전체 순차 실행 69개가 통과했다. 병렬 대기의 근본 원인은 확정하지 않았다. 증적은 `verification/setup-all-tests-serial.log`, `setup-integration.log`, `setup-ui.log`, `setup-build.log`, `setup-electron.log`, `ui-setup-approval.png`, `ui-setup-narrow.png`에 있다.


## 2026-09-25 자동 설정 준비

사용자는 “실행해서 확인해 줘”라고 요청한다. 누비는 실제 프로젝트 설정을 확인하고 짧은 계획과 실행 준비안을 보여준다. 예를 들어 `packageManager: pnpm@10`과 `dev` 스크립트가 있다면 해당 근거로 명령을 준비한다. Windows에서는 PowerShell이 기본이며 프로젝트 설정의 셸 선택을 따른다. 설치와 실행의 정확한 명령은 기존 승인 카드에서 확인한다. 모호한 요구사항은 한 질문, 짧은 선택지, 하단 자유 입력으로 받는다. 환경 준비를 위한 선행 설정 폼은 요구하지 않는다.

### 실제 적용

- `inspect_environment`는 Git 파일 목록 안에서 최대 24개 설정 파일을 읽는다. 파일당 256 KiB, 전체 512 KiB 한도이며 미열람과 제한 여부를 반환한다. `.env`, 인증 파일, 범위 밖 경로와 심볼릭 링크는 읽지 않는다. 설정 모듈이나 버전 명령을 실행하지 않는다.
- Node의 선언과 lockfile이 충돌하면 임의로 고르지 않는다. 둘 다 없는 경우 npm은 명시적인 기본 관례로 표시한다. 불완전한 scripts와 추가 언어의 manifest는 원문 조회가 필요하다. Python, .NET, Rust, Go, Java 관련 파일의 발견을 해당 언어의 설치 완료로 표현하지 않는다.
- PATH 검사 결과는 실행 파일 위치의 발견 여부다. 실제 버전, 런타임 건강 상태, 회사 인증과 설치 권한은 별도다. PowerShell/bash 기본값은 호스트에서 결정하며 모델의 명시적 셸 선택은 지원 여부를 검증한다.
- Windows에서는 AI가 준비하는 명령과 직접 실행 모두 PowerShell을 기본으로 사용한다. 프로젝트별 **설정 → 기본 셸**에서 CMD 또는 설치된 Git Bash를 선택할 수 있다. 선택은 SQLite에 보존하며 이후의 환경 조회와 실행 준비에 반영한다. 개별 명령의 셸은 실행 직전에도 바꿀 수 있다. 실행 기록에는 실제 셸과 종료 상태를 먼저 표시하고, 정확한 명령은 **실행 명령**에서 펼쳐 본다. PowerShell 인자는 UTF-16LE `-EncodedCommand`로 전달하며 한글 출력은 UTF-8로 받는다. CMD는 `/D /Q /C`와 UTF-8 코드 페이지를 사용한다. [Microsoft가 설명한 8191자 CMD 한도](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation)를 넘기지 않도록 실행 전에 더 짧은 한도를 적용한다. 이 로컬 검사는 Windows 11 실행 성공의 증거가 아니다.
- 환경 근거는 `SourceObservations.environment`에만 기록한다. 제한 시간 안에 성공한 조회만 등록하며 소스 편집 권한은 생기지 않는다. 압축 후 근거를 비운다. 준비안이 환경 파일 하나를 인용해도 같은 조회에서 읽은 설정 해시를 함께 고정한다. 준비 및 승인 시 이 파일들을 재확인한다. 새 파일의 출현이나 전체 PC 환경 변경 감지까지 보장하지 않는다.
- 명령 실행, 관리자 권한, 앱 연결의 기존 승인은 유지한다. 질문 답변이나 환경 추정으로 권한을 부여하지 않는다.

### 비교한 방법론과 소스

| 출처 | 적용한 점 | 구분 |
| --- | --- | --- |
| [OpenCode LSP root discovery](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/lsp/server.ts), MIT | manifest와 lockfile을 기준으로 프로젝트 범위를 찾고 하위 프로젝트를 좁혀 조사 | 고정 소스의 설계 참고. LSP 자동 설치 코드 복사 없음 |
| [OpenCode permissions](https://opencode.ai/docs/permissions/) | 자동 판단과 실행 권한을 분리 | 기존 도구별 HITL 유지. 포괄 자동 승인 미도입 |
| [Claude Code 동작](https://code.claude.com/docs/en/how-claude-code-works)와 [Anthropic agent patterns](https://www.anthropic.com/engineering/building-effective-agents) | 먼저 환경 근거를 모으고 한 도구의 실제 결과로 다음 행동 결정 | 공식 방법론 참고. 비공개 Claude Code 내부 구현 분석으로 표현하지 않음 |
| [Codex 환경 구성](https://learn.chatgpt.com/docs/environments/cloud-environment) | 관례에서 설정을 준비하고 설정 변경 때 준비안을 다시 확인 | 클라우드 컨테이너 사례 참고. 로컬 Windows 격리/무인 설치로 대체하지 않음 |
| [Codex environment context](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/context/environment_context.rs), Apache-2.0 | 호스트 환경과 권한 문맥을 모델의 추정과 분리 | 소스 설계 참고. 코드 복사 없음 |
| `jsonc-parser` 3.3.1, MIT | 현재 설치된 파서를 재사용해 package.json 구문 오류를 별도 표시 | 실제 라이브러리 재사용. 주석/후행 쉼표는 허용하지 않음 |
| 기존 Pi, Ajv 8.20.0, Git 조회, SQLite 영수증 | 도구 호출, 입력 검증, 범위 제한과 중복 실행 방지 | 실제 기존 런타임 재사용 |

추가 환경 프레임워크는 도입하지 않았다. mise/Dev Containers 설정은 관찰 대상이며 사용자 PC의 필수 설치 항목이 아니다. 기존 의존성으로 해결 가능한 정적 탐색에 새 런타임 비용을 추가하지 않는다.

### 검사 중 발견한 보완

`jsonc-parser`의 UMD 진입점을 서비스 번들 안에 넣으면 내부 상대 require를 찾지 못해 호스트가 종료됐다. 기존 코드 분석 worker와 같이 설치된 패키지를 외부 의존성으로 해석하도록 고쳤다. 개발 빌드 성공만으로 실제 서비스 시작을 판단하지 않고 Theia 화면까지 확인한다.

공유 하위 분석 파서는 `complete` 응답에 미해결 항목이 있으면 `partial`로 정규화한다. Desktop의 오래된 테스트 기대값을 이 현재 계약에 맞췄다. 공유 파서의 동작을 이번 변경에서 새로 구현한 것은 아니다.


2026-09-25 최종 검증: 전체 런타임 순차 실행 293/293, Theia UI 49/49, 스킬 등록 12/12, 공유 UI 36/36, 기준 HTML 디자인 검사와 브라우저 개발 빌드가 통과했다. 실모델 대신 합성 응답으로 자동 환경 조회→명령 준비→승인 대기를 검사했다. 최초 전체 병렬 실행은 integration 파일의 종료 대기로 해당 테스트 프로세스를 중단했다. 단독 integration 4/4 및 전체 순차 실행은 통과했지만 병렬 종료 지연의 근본 원인은 미확정이다. 새 Windows 설치 파일 생성이나 실제 Windows 11/실계정 검증은 수행하지 않았다. 증적은 `verification/automatic-environment-20260925/`에 보존했다.

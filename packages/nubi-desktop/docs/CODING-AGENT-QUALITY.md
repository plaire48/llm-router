# 코드 변경 품질 개선

2026-09-23. 기존 Pi 실행기를 유지하고 검색, 코드 구조 파악, 수정안 검사에 검증된 오픈소스를 연결했습니다. 목표는 관련 코드를 놓치지 않고, 오류가 있는 수정안을 모델이 고친 뒤 사용자가 검토하게 하는 것입니다.

## 선택한 방법

| 검토 대상 | 적용한 강점 | 선택 범위 |
|---|---|---|
| [OpenCode 진단 피드백](https://opencode.ai/docs/lsp/) | 검사 결과를 도구 응답으로 돌려주고 AI가 다음 수정에 사용 | 방법론 적용. OpenCode 전체 실행기나 LSP 서버를 가져온 것은 아님. 공식 문서도 서버 비용과 프로젝트별 효과를 비교하도록 안내 |
| [Aider 검사와 수정](https://aider.chat/docs/usage/lint-test.html) | 수정 후 오류를 확인하고 다시 고치는 흐름 | 방법론 적용. 현재는 디스크 반영 전 메모리의 수정안을 검사. 프로젝트 테스트 자동 실행은 추가하지 않음 |
| [Pi](https://github.com/earendil-works/pi) | 기존 도구 실행, 작은 관찰 단위, 제한된 검색 결과 | 이미 사용하는 MIT agent-core와 누비 문맥/하위 분석 재사용. Pi의 직접 파일 쓰기 도구로 기존 검토 경계를 대체하지 않음 |
| [VS Code ripgrep](https://github.com/microsoft/vscode-ripgrep) | 문자열 검색을 네이티브 검색기로 처리 | `@vscode/ripgrep` 1.18.0을 직접 런타임 의존성으로 고정. shell 없이 인수로 실행 |
| [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) | 실제 AST와 문법 진단 | 기존 5.9.3을 런타임에서도 사용. 전체 프로젝트 타입 검사나 import 해석은 수행하지 않음 |
| [JSONC parser](https://github.com/microsoft/node-jsonc-parser), YAML | 실제 형식 파서로 수정안 검사 | jsonc-parser 3.3.1을 직접 고정하고 기존 YAML 2.9.0 재사용. 정규식으로 문법을 판정하지 않음 |

OpenCode의 편집 및 지침 소스, Pi의 편집/검색/리소스 로더, Aider의 linter 소스를 읽어 실제 동작을 비교했습니다. 조사한 소스를 제품에 복사한 것은 아니며, 위 표의 라이브러리 API와 설계 패턴을 사용했습니다.

| GitHub 검토 기준 | 고정 커밋 | 라이선스와 판단 |
|---|---|---|
| anomalyco/opencode | `2406400f0aeb07b36d0495af4e05aaca49159832` | MIT. 이미 있는 Pi와 인증/작업 상태를 중복 운영할 이유가 부족해 실행기 교체 보류 |
| earendil-works/pi | `898ab804050730e9dcefb4443875d5a932aa6a32` | MIT. 조사 기준과 실제 설치 버전 0.86.1은 구분 |
| Aider-AI/aider | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | Apache-2.0. Python 실행기 전체 대신 검사 피드백 방법론 적용 |
| OpenHands/software-agent-sdk | `b5e756b1061a859ce827a16e14ee484f317899bf` | MIT SDK. Action/Observation/Executor 분리는 참고. 별도 Python 실행기와 상태 체계 도입 보류 |
| ast-grep/ast-grep | `6175e07b668b388a1a326d8fc543c4856eb5f54b` | MIT. 구조 검색 후보로 검토. 이번 JS/TS 진단에는 기존 컴파일러가 적합해 네이티브 파서 중복 도입 보류 |

조사 시점 원문과 메타데이터는 `verification/research-coding/`에 남겼습니다. 방법론 참고를 해당 제품의 성능 재현이나 코드 도입으로 표시하지 않습니다. TypeScript는 Apache-2.0, JSONC parser와 VS Code wrapper는 MIT, YAML은 ISC입니다. 원문 라이선스는 설치 패키지와 `vendor/licenses/`에 보존합니다.

## 실제 변경 흐름

1. `source_search`로 경로나 본문을 찾습니다. `within`으로 Git 파일 열거 단계부터 범위를 좁힙니다.
2. JS/TS의 `code_outline`으로 함수, 클래스, 타입, import 위치를 찾고 필요한 구간을 `read_source`로 읽습니다. 구조 정보만으로 수정 권한이 생기지 않습니다.
3. 기존 OpenWiki 근거와 현재 소스를 요구사항, 수정 대상, 검증 방법에 연결합니다. 기존 Claims 재확인과 변경 계획 계약은 유지합니다.
4. `propose_patch` 또는 `propose_edit`의 수정안을 별도 worker에서 검사합니다. 새 문법 오류가 있으면 제안을 저장하지 않고 오류 코드, 행, 열을 모델에 돌려줍니다. 모델은 변경되지 않은 원본을 기준으로 다시 제안합니다.
5. 기존 오류는 바뀌지 않은 줄의 동일한 진단일 때만 경고로 남깁니다. 새 줄에 같은 오류를 추가하면 차단합니다. 진단이 잘리거나 검사에 실패해도 통과로 표시하지 않습니다.
6. 화면의 제안에 검사 상태를 한 줄로 표시합니다. 사용자가 반영하면 다시 검사한 뒤 기존 Monaco dirty/version/hash 보호와 저장 readback을 거칩니다.
7. Wiki 기록에는 검사 엔진, 대상 해시, 검사 범위를 남깁니다. 문법 검사로 완료 조건이나 기능 테스트를 통과 처리하지 않습니다.

자동 검사는 JS/TS/JSX/TSX, JSON/JSONC, YAML에 적용됩니다. JSON 주석은 `.jsonc`와 `tsconfig*.json`에만 허용합니다. 다른 형식은 **자동 문법 검사 미지원**으로 표시하며 기존 검토 흐름을 유지합니다. HTML, Python, Java 등의 검사기까지 제공하는 것은 아닙니다.

## 비용과 경계

- 검색은 Git에서 최대 20,000개 파일을 열거합니다. 기존 본문 검색의 첫 3,000개 파일 제한을 제거했습니다. 파일당 1 MiB, 전체 검색 10초, 출력 2 MiB, 결과 40개 제한을 표시하고 범위를 좁히게 합니다. 전체 저장소의 검색 완료를 추정하지 않습니다.
- `.gitignore`, 비밀 파일 제외, 프로젝트 경로 검사, 외부 symlink 제외를 유지합니다. 검색 문자열은 리터럴 인수로 전달합니다. 파일을 다시 읽어 현재 해시와 일치하는 검색 결과를 만듭니다. OS 샌드박스는 아닙니다.
- 검사 worker는 256 MiB 힙 제한과 기본 5초 제한을 사용합니다. 프로젝트 설정, plugin, import를 로드하지 않고 코드를 실행하지 않습니다. 중지하면 worker를 종료합니다. 진단은 최대 30개입니다.
- AST 구조는 최대 100개 선언과 50개 import 위치만 반환합니다. 참조 그래프, 호출 그래프, 완전한 repository map은 아닙니다.
- 검사에서 성공해도 `types: not_checked`, `tests: not_run`을 유지합니다. 프로젝트 타입 검사, lint, 실행 테스트는 실제 명령 결과로 별도 확인해야 합니다. 요청 범위를 벗어난 수정이나 오류를 숨기는 삭제를 모델 지침으로 금지했습니다.
- 별도 모델이나 임베딩 서버, 추가 인증 계정은 필요하지 않습니다. Windows용 ripgrep 패키지는 upstream에서 제공하지만 실제 Windows 실행은 아직 검증하지 않았습니다.

## 검증

`tests/coding-quality.test.mjs`는 실제 파서와 ripgrep을 실행합니다. 형식별 오류, 원래 있던 오류와 새 오류, 시간 초과, 취소, 비밀 파일/심볼릭 링크, 3,000개 이후 파일 검색, 제안 전 차단, 반영 전 재검사, 재열기와 Wiki 기록을 확인합니다. 실제 Pi에 합성 모델 응답을 연결해 오류 진단 후 수정한 제안만 남는지도 확인합니다.

실제 Theia UI 검사에서는 검사 상태, 사용자 반영, 실제 파일 readback, 새로고침 후 상태 복원을 확인합니다. 번들 검증에서 발견한 JSONC 상대 require 문제는 패키지를 런타임 의존성으로 유지해 해결했고, 새 worker가 브라우저/Electron 출력 경로로 복사되도록 수정했습니다.

실모델 정확도 향상은 아직 측정하지 않았습니다. 후속 평가는 같은 저장소와 요구사항으로 수정 성공률, 새 오류, 원본 보존, 불필요한 질문, 완료까지 모델 호출 수를 비교해야 합니다. 최신 통과 수와 실행 범위는 [검증 기록](VERIFICATION.md)을 따릅니다.

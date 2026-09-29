# 순서별 품질 작업과 Pi 업그레이드

2026-09-25. 사용자 요청의 “미뤄둔 항목까지 순서대로 구현”을 기준으로 기존 구현/후보/실환경 대기를 대조했다. 이번 구현은 NQ-13 작업 목록 검증과 NQ-14 Pi 업그레이드다. 현재 실행 가능한 보류 작업부터 구현하고 외부 조건을 코드 완료로 바꾸지 않는다.

## NQ-13: 현재 소스의 검증만 인정하는 목록

`quality-work.json`에 20개 항목의 순서, 상태, 완료 조건을 등록했다. `npm run quality:status`는 기존 `verificationInputs`와 `QUALITY_BASELINE`을 재사용해 최신 소스/테스트/의존성 해시가 같은 **단일** 전체 핵심 보고서를 찾는다. 필수 단계 누락, 중복, 중단, 실패, 다른 소스와 1회 반복은 거부한다. 서로 다른 실행을 합산하지 않는다.

구현됨과 검증됨은 다른 상태다. 최신 gate가 없으면 `needs_current_core`를 표시하고, 외부 조건 대기/비채택은 성공으로 승격하지 않는다. 이 명령은 모델이나 브라우저를 실행하지 않고 로컬 기록만 읽는다. `actualModelQuality=null`, `releaseApproved=false`를 유지한다. 기존 통과 이력은 별도 [이력 문서](BROWSER-QUALITY-HISTORY-2026-09-25.md)에 보존했다.

단위 5개에서 같은 소스의 더 늦은 실패/중단, 오래된 해시, 부분 실행 합산, 중복 단계, 중단, 실패 exit code, 줄인 반복, 작업 순서와 외부 상태를 검증했다. 수정 후보에서 기존 보고서만 있을 때 현재 근거가 없다고 표시하는 [실제 CLI 결과](../verification/ordered-quality-2026-09-25/status-before.json)를 남겼다.

## NQ-14: 보류했던 Pi 0.87.1 적용

브라우저의 `@earendil-works/pi-agent-core`와 `@earendil-works/pi-ai`를 0.86.1에서 0.87.1로 고정 업그레이드했다. lockfile에는 Pi의 chord/telemetry와 전이 의존성 해석 변경도 포함되며 [변경 목록](../verification/ordered-quality-2026-09-25/dependency-changes.json)에 기록했다. MIT 원문과 버전 고지는 후보 패키지에 보존한다. CLI/Node 실행기나 새 인증 방식은 도입하지 않는다.

[공식 0.87.1 소스/변경 기록](https://github.com/earendil-works/pi/blob/v0.87.1/packages/agent/CHANGELOG.md)을 읽고 실제 설치 소스의 호출 순서를 확인했다. 0.87에서 기존 `shouldStopAfterTurn`이 제거됐다. 새 `finishTurn`은 `turn_end`보다 먼저 호출되며 오류/취소에도 들어오므로, 해당 종료 사유에서는 사용자 대기 상태를 덮어쓰지 않는다.

버전만 변경했을 때 질문 뒤 내부 assistant 턴이 2개가 되는 [실패](../verification/ordered-quality-2026-09-25/pi-before.log)를 재현했다. 기존 방어 코드 덕분에 추가 실제 모델/쓰기 호출은 없었지만 공식 중지 지점을 사용하지 못했다. 새 훅으로 실제 질문/승인 결과 뒤 정확히 1개 턴에서 종료하도록 수정했다. 완료 의미를 바꾸거나 원래 사용량을 지우지 않는다.

Office/Desktop/VS Code는 같은 소스를 가져오지만 이번 브라우저 작업에서 그들의 패키지는 변경하지 않았다. `userWaitHooks`는 기존 0.86용 훅도 제공한다. 같은 중지 함수의 구/신 계약과 오류/취소를 단위로 검증했다. 이는 실제 Office/Desktop 전체 회귀나 해당 앱의 업그레이드 성공을 주장하는 것이 아니다. 공통 엔진 식별자는 이름만 사용하고 정확한 배포 버전은 호스트별 `build-info.json`에 둔다.

## BP와 선택/비선택

| 공식 근거 | 적용 | 판단 |
| --- | --- | --- |
| [Anthropic 장기 실행 하네스](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 항목별 완료 조건, 작은 단계의 검증, 구조화된 상태 목록 | 문서의 과거 완료 문구만 믿지 않고 현재 입력 해시와 실제 gate를 연결했다. 프레임워크 추가 없이 기존 Node 도구 재사용 |
| [Pi 0.87.1](https://github.com/earendil-works/pi/blob/v0.87.1/packages/agent/CHANGELOG.md) | 실제 최신 실행기와 공식 정상 종료 API | 보류 사유였던 API 경계를 회귀 검사 후 이전. 같은 선택 모델, 기존 수신/usage/브라우저 승인 유지 |
| [OpenCode agents](https://opencode.ai/docs/agents/) | 읽기 전용 하위 역할과 주 실행기 권한 분리 유지 | 서버/셸 런타임을 확장에 붙일 필요 없음. 기존 2개 동시 분석 및 범위 제한 유지 |
| [DeepAgents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents) | 기존 Wiki 실행기와 격리된 문맥 재사용 | 이번 브라우저 중지 API와 작업 목록의 문제를 다른 라이브러리로 교체할 이유 없음 |

기존 Pi 활용 검토의 세션 분기/전체 하네스, 별도 진행 이벤트, 파일 스킬 로더, 외부 telemetry 후보는 D01~D04로 명시했다. 기존 대화/실제 단계/가져오기/usage 경로가 있으므로 미구현 제품 기능으로 오인하지 않는다. 추가 사용자 가치나 재현 결함이 없는 프레임워크 교체는 비채택이다. React/Vite/DeepAgents 등 다른 버전 후보도 이번 관련 변경과 묶지 않는다. 비채택을 구현 완료나 최신 버전 호환성 통과로 표시하지 않는다.

## 검증 상태

- 신규 8개 단위: 목록 5개, Pi 경계 3개. Pi 집중 회귀 **41/41**, 전체 사전 단위 **776/776**.
- [npm audit](../verification/ordered-quality-2026-09-25/audit.json): 알려진 취약점 0건. [설치 버전](../verification/ordered-quality-2026-09-25/pi-installed.json).
- [최종 동일 후보 gate](../verification/pre-release-2026-09-25T01-48-45-460Z/report.json): **전체 단위 777/777**, **Chrome 71/71**, 디자인/후보 빌드 통과. `quality-baseline-v4`, 21종 × 3회 + 8종. 신규 8개 단위 포함. 소스/테스트/의존성/빌드 해시 불변.
- [최종 요약](../verification/ordered-quality-2026-09-25/report.json), [상태 명령의 최종 결과](../verification/ordered-quality-2026-09-25/status-after.json). 현재 core 보고서를 정확히 선택하고 외부/비채택을 완료로 바꾸지 않았다. 진행 중에는 [미완료로 표시](../verification/ordered-quality-2026-09-25/status-during-verification.json)했다.
- 빌드 SHA-256 `6fd141ad937c99270cb1b947647ce03ec9db5ec975ae2d0fa572dac244948ce2`, 후보 ZIP SHA-256 `08de9dd69786ea8680084d52639a1d743262f0e03d996583bb7e395800e56a84`.
- 실모델 평가기는 전용 인증 부재로 `not_configured`이며 모델 호출 0회. 실제 Qwen 의미 정확도, 회사 서비스, Windows/Edge/설치/배포는 별도다. 전체 배포 매트릭스가 아니며 설치본 교체/공개 업로드 없음.


## 검증 중 발견한 목록 판정 결함

같은 소스로 나중에 실패하거나 아직 실행 중인 core gate가 있어도 이전 성공을 고를 수 있었다. 회귀를 추가해 [수정 전 실패](../verification/ordered-quality-2026-09-25/status-freshness-before.log)를 확인하고, 같은 입력의 가장 최근 core 시도 및 그 이후 실패/중단을 확인하도록 고쳤다. 현재 진행 중인 검증도 완료 전에는 이전 성공으로 덮지 않는다.

이 보완 전에 실행하던 [첫 gate](../verification/pre-release-2026-09-25T01-43-35-939Z/report.json)는 의도적으로 종료했다. 당시 제품 실패가 발견된 것은 아니며 종료한 브라우저 단계는 실패로 남긴다. [중단 이유](../verification/ordered-quality-2026-09-25/interruption.json)를 보존하고 부분 통과를 후속 최종 gate에 합산하지 않는다. source/tests/scripts는 검사 종료를 확인한 뒤 변경했다.

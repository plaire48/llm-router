# 순서와 검증 근거를 연결한 품질 작업표

## 현재 추가 항목

NQ-18은 큰 첨부 문서의 `ask_documents`, 압축 후 원문 재조회와 최종 근거 검토를 연결한다. NQ-19는 역할별 분할/보완/합성과 전체 진행 저널을 연결한다. 두 항목은 **구현 / 현재 후보 미검증**이며 아래 이전 통과 기록을 재사용하지 않는다.

고정 기준은 `quality-baseline-v5`로 갱신했다. `large-document-browser`, `trace-journal-browser`, `browser-policy-browser`는 각 1회, 기존 `subagent-progress-browser`는 3회다. 전체 핵심 기준은 Chrome 77회와 단위/디자인/후보 빌드로 80단계다. once 목록과 단계 계산은 공통 상수를 사용한다. C01-C08에 정책 초기화 지연과 늦은 정책 복구 검사를 연결했으며 현재 후보는 미검증이다.

동일 입력의 단일 `full` 보고서도 필수 기준을 모두 포함하면 인정한다. `fullMatrix=true`, 3회 반복, 모든 추가 단계의 정상 종료, 단계 이름 중복 없음, 선택 목록과 실제 단계의 일치가 필요하다. 더 최근의 실패/미완료/불완전 종료 근거를 과거 통과로 덮지 않는다. 보고서 합산과 v4 근거 재사용은 거부한다. 실제 모델 품질과 배포 승인은 여전히 별도다.

기존 Node test/assert와 Playwright 종료 근거 검사 패턴을 재사용했다. 새 평가 라이브러리나 모델 호출은 추가하지 않았다. 아래는 변경 전 검증 이력이다.

## 이전 구현

2026-09-25. 브라우저 누비의 개선 항목을 재대조하고 NQ-16 → NQ-17 순서로 구현했다. 제품 실행기와 UI는 이번에 변경하지 않았다. 기존 보류 개발이었던 NQ-14는 이전에 구현됐다. 현재 외부 조건 4개는 실제 환경 검증이며, D01~D05는 기존 경로와 중복되거나 도입 효과가 확인되지 않은 비채택 후보다.

## 구현 순서와 완료 조건

| 순서 | 항목 | 재현/개선점 | 구현 |
| --- | --- | --- | --- |
| 1 / NQ-16 | 점수 계산의 종료 근거 | passed 표지만 있는 불완전 기록, 실패 exitCode, timeout, 종료 signal을 통과로 계산 가능 | 공통 stageOutcome으로 종료 코드 0과 명시적 timeout=false 확인. 실패/종료와 근거 누락을 구분. 원본 보고서가 실패하면 필수 gate 통과 금지 |
| 2 / NQ-17 | 작업표와 검사 연결 | 순서 중복, 없는 검사명, 빈 다음 행동을 막지 못하고 항목별 로그를 찾기 어려움 | schemaVersion 2, 고유 양수 순서, 유효한 검사 목록/다음 행동 검사. 현재 동일 후보의 단계 로그와 외부 조건별 다음 행동 출력 |

NQ-16은 손상되거나 모순된 보고서를 읽을 때의 판정 결함이다. 기존 실행기는 이미 실패 종료를 failed로 기록한다. 이전의 정상 통과 보고서가 실제 실패였다는 뜻은 아니다. 점수 계산과 현재 후보 판정이 이제 동일한 종료 근거 규칙을 사용한다.

NQ-17의 연결 검사는 항목의 핵심 회귀를 추적하기 위한 것이다. 개별 기능의 모든 경우를 검사하거나 실계정 성공을 보증하지 않는다. `unit` 연결은 전체 단위 검사 실행이며 특정 기능의 실모델 점수가 아니다. 외부 조건/비채택 항목에는 로컬 검사를 완료 근거로 붙이지 않는다.

## 사용

- `npm run quality:status`: 코드 변경 후 기존 통과를 재사용하지 않고 현재 후보 상태 확인
- `npm run quality:report`: 우선순위/항목/상태/연결 검사/다음 행동 표 출력
- `npm run quality:status -- --json`: 항목별 `evidenceStages`의 실제 단계 이름과 로그, 외부 조건 `blocked` 확인
- `npm run verify:quality`: 고정 핵심 회귀 실행. 배포 전체 매트릭스는 별도

현재 보고서가 없으면 연결 로그를 null, 단계를 unverified로 표시한다. 새 부분/실패/중단 보고서를 과거 통과로 덮지 않는다. pending 항목이 있으면 순서상 첫 항목을, 현재 회귀가 없으면 verify:quality를 next로 표시한다. 외부 조건은 next가 비어도 blocked에 계속 남는다.

## BP와 오픈소스 판단

| 참고 | 적용/비채택 근거 |
| --- | --- |
| [Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 과제/반복/검사기/결과를 분리하고 실제 결과를 채점하는 방법론 적용. 핵심 회귀와 모델 능력 평가를 계속 구분 |
| [Playwright TestResult](https://playwright.dev/docs/api/class-testresult), [Reporter](https://playwright.dev/docs/api/class-reporter) | timeout/interrupted/failed와 최종 결과를 별도 취급하는 패턴 참고. 설치된 Playwright 1.62.1의 lib/runner/index.js의 task runner 및 mergeEndEvents 소스를 대조. 기존 Playwright 실제 Chrome 검증 유지 |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | 선언형 평가 사례 참고. 이번 문제는 이미 생성하는 subprocess 결과와 작업표 연결에 있으므로 별도 평가 런타임/추가 모델 호출 도입 없음 |
| Node 내장 test/assert | 고정된 보고서 입력과 잘못된 종료 근거를 직접 회귀 검사. 새 의존성 없이 기존 테스트 도구 재사용 |

Playwright 소스를 복사하거나 수정하지 않았다. Promptfoo는 참고 후보이며 도입/실행한 라이브러리가 아니다. npm audit의 알려진 취약점은 0건이다.

## 근거

- [수정 전 실패](../verification/quality-ledger-2026-09-25/scorecard-before.log)
- [NQ-16 집중 검사](../verification/quality-ledger-2026-09-25/scorecard-after.log)
- [최종 집중 검사 16개](../verification/quality-ledger-2026-09-25/focused.log)
- [gate 전 상태](../verification/quality-ledger-2026-09-25/status-before-gate.json): 변경 전 후보를 현재 통과로 쓰지 않음
- [audit](../verification/quality-ledger-2026-09-25/audit.json)

## 최종 검증

[최종 요약](../verification/quality-ledger-2026-09-25/report.json), [동일 후보 보고서](../verification/pre-release-2026-09-25T02-25-07-810Z/report.json): **단위 787/787, Chrome 71/71**, 디자인/후보 빌드와 총 74단계 통과. 검증 입력/빌드 해시가 일치한다. 신규 회귀 5개를 포함한다.

[최종 자동 작업표](../verification/quality-ledger-2026-09-25/work-final.md), [항목별 로그](../verification/quality-ledger-2026-09-25/status-after.json)의 모든 연결 로그 존재를 확인했다. 신규 판정기는 이번 후보를 선택하며 외부 조건 4개와 비채택 5개를 완료로 바꾸지 않는다. [소스/선택 근거 해시](../verification/quality-ledger-2026-09-25/source-selection.json)를 보존했다.

빌드 SHA-256은 `6677be8aaf9edc4d872ee1f6f5baa8fffd65de26404b5184e6808a77229c81ca`이며 직전 제품 빌드와 같다. 이번 변경은 품질 관리 도구다. 실제 Chrome/합성 사이트/합성 모델을 검사했고 실계정 Qwen/실제 사이트 저장/Windows·Edge/공식 WebArena 조건은 유지한다. 배포 전체 매트릭스와 공개 배포는 수행하지 않았다.

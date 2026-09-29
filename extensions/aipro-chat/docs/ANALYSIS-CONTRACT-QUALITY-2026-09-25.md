# 하위 분석 작업 조건과 결과 복구

2026-09-25. 기존 Pi 실행기와 같은 선택 모델을 유지하면서 위임 조건의 유실과 불필요한 재실행을 보완했다. 이전 조사와 구현은 [하네스 방법론 기록](HARNESS-METHODS-2026-09-25.md), [Anthropic 적용 기록](ANTHROPIC-HARNESS-QUALITY.md)을 재사용했다.

## 공식 구현 비교와 선택

| 근거 | 검토한 방식 | 이번 적용과 경계 |
| --- | --- | --- |
| [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) | 목적, 도구/출처, 출력과 작업 경계를 구체적으로 위임하고 독립적인 조사를 통합 | 결과 및 재조회에 원래 assignment를 함께 반환. 빈 목적/완료 조건 거부. 분업 수를 늘리는 대신 현재 2개 동시 실행과 6개 미수집 한도 유지. |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | 격리 문맥에서 조사하고 필요한 요약을 주 실행기로 반환 | 전체 대화 복사 없이 기존 근거 요약과 최대 길이가 있는 작업 조건만 전달. 별도 CLI, 다른 모델 자동 선택, 중첩 위임은 도입하지 않음. |
| [OpenCode task.ts](https://github.com/anomalyco/opencode/blob/6df0d5d951e0bb8c82dd1a7f9315eff4efd7f1ef/packages/opencode/src/tool/task.ts) | 스키마 기반 작업 입력, 작업 ID를 통한 기존 세션 연결, 비동기 결과 전달 | 기존 task_id 재조회와 결과 전달을 유지하고 진입점 검증 추가. OpenCode 세션 재개를 복사하지 않았으며 누비는 미완료 결과를 회수한 뒤 변경한 작업을 새 격리 문맥에서 실행. MIT. |
| [Codex followup_task](https://github.com/openai/codex/blob/1f17a0a04b5c53ef2ea89b7d874764139321b26a/codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs), [wait](https://github.com/openai/codex/blob/1f17a0a04b5c53ef2ea89b7d874764139321b26a/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs) | 대상 에이전트에 후속 메시지를 전달하는 경로와 활동 대기 경로 분리 | 결과를 가져오는 동작과 새 분석 실행을 구분. 누비의 자동 결과 전달과 첫 완료 대기를 유지하며 effort 변경을 새 접근으로 취급하지 않음. Apache-2.0, 패턴 참고이며 소스 복사 없음. |
| [TypeBox](https://github.com/sinclairzx81/typebox) 1.3.27 / MIT | JSON Schema 런타임 검증 | **기존 실제 의존성을 추가 적용**. 공개한 delegate_analysis 스키마를 기존 toolArgumentIssues/Errors 인터프리터로 진입점에서도 검사. 별도 스키마나 JIT 코드 생성 없음. |
| [Zod](https://zod.dev/basics) 4.4.3 / MIT | safeParse 기반 구조 검증 | 이미 설치된 후보지만 이 경로에는 비채택. 별도 Zod 스키마를 만들면 모델에 공개한 JSON Schema와 이중 관리가 필요함. |

OpenCode/Codex 소스와 라이선스를 조회하고 고정 커밋/파일 SHA-256을 [upstream.json](../verification/analysis-contract-2026-09-25/upstream.json)에 남겼다. 제품에 외부 소스를 복사하거나 새 패키지/런타임을 추가하지 않았다. Pi, p-limit, MiniSearch의 기존 역할과 라이선스 고지는 유지한다.

## 발견한 문제와 구현 순서

| 순서 | 수정 전 재현 | 구현 | 확인 기준 |
| --- | --- | --- | --- |
| 1 | 결과 재조회에는 작업 이름 앞 160자만 있고 constraints/done_when이 없음 | 별도 assignment에 전체 작업, 제약, 완료 조건, effort, 원래 근거/문서 ID와 범위를 보존. 반환할 때도 복제 | 최초 입력과 반환 객체를 수정해도 보관한 작업 조건이 바뀌지 않음. 근거가 해제되면 기존처럼 partial로 낮추되 작업 조건은 유지 |
| 2 | 공백 목적/완료 조건은 허용되고 직접 진입점의 null 입력은 예외 발생 | 실제 도구 스키마에 비공백 조건을 추가하고 모든 작업을 검사한 후 시작 | 정상/비정상 혼합 배치에서도 모델 호출 0회, 작업 생성 0개. 오류는 안전한 스키마 경로만 반환 |
| 3 | partial/blocked 결과에서 effort만 변경하면 같은 분석을 다시 실행 | 실패/복구 결과에 사용하던 중복 방지를 미완료 보고서까지 적용 | 같은 task_id/결과 재사용, 추가 모델 호출 0회. 바뀐 작업이나 새 관찰은 새 분석 가능 |

주 실행기 안내에도 assignment와 원래 요청을 대조하고 미완료 조건을 보존하도록 연결했다. `done`은 하위 호출이 끝났다는 실행 상태이며 목표 달성 인증이 아니다. 실제 화면 조작/최종 완료는 기존 검증과 승인 경로를 따른다.

## 검증

- 수정 전 신규 회귀 4개 실패. [before.log](../verification/analysis-contract-2026-09-25/before.log).
- 수정 후 관련 단위 검사 48개 통과. [focused.log](../verification/analysis-contract-2026-09-25/focused.log). 결과 조건을 추가하면서 기존 1,500자 요약 검사는 유지하고 assignment를 별도 예산으로 분리했다. 최초 신규 검사의 expected 객체가 입력 배열을 공유하던 오류도 복제하도록 수정했다.
- 실제 Chrome MV3에서 6개 분석의 작업 조건/근거 보존, 잘못된 배치의 호출 0회, 원문 해제 후 partial 재조회 통과. 같은 모델 ID와 12회 합성 응답 유지. [browser-final.log](../verification/analysis-contract-2026-09-25/browser-final.log). 초기 브라우저 검사는 정규화된 작업의 끝 공백과 원래 fixture를 비교해 실패했고 진단 후 기대값을 같은 정규화 기준으로 수정했다. 초기 로그도 보존했다.
- 최종 공통 후보: 단위 **765/765**, Chrome **71/71**, 디자인/후보 빌드 통과. [동일 후보 보고서](../verification/pre-release-2026-09-25T01-07-24-774Z/report.json), [검증 요약](../verification/analysis-contract-2026-09-25/report.json). `quality-baseline-v4`, 21종 × 3회 + 8종, `fullMatrix=false`. 검사 중 입력/빌드 해시 불변. 초기 실패 gate와 합산하지 않는다.
- 제품 빌드 SHA-256 `1718365297ec8ef192cbd62b97fa571978fea59014a77afbf4158437a822a779`. 최종 후보 ZIP SHA-256 `c2e230546b953d80c32e4a15843e9d0d7006d2900da2c7f7290dc9f149494480`. 초기 실패 gate와 제품 빌드는 같고 테스트 입력 해시만 다르다.
- [npm audit](../verification/analysis-contract-2026-09-25/audit.json): 개발 의존성 포함 알려진 취약점 0건. UI 소스/의존성 버전/배포는 변경하지 않았다. 실제 Qwen 모델 정확도는 미측정이다.

### 공통 검사에서 발견한 입력 fixture 경합

첫 공통 실행은 [agent-input-browser 3회차](../verification/pre-release-2026-09-25T00-58-19-882Z/agent-input-browser-3.log)에서 멈췄다. 대기열 저장은 끝났지만 UI의 후속 DRAFT/readback이 끝나기 전에 다음 Enter를 보내고 있었다. 입력은 보존됐고 당시 submitRunningInput은 inputSending으로 중복 전송을 차단했다. 검사에서 저장 상태만 기다리는 것은 화면의 전송 준비 완료와 다르다.

UI RPC 응답을 350ms 지연시켜 [수정 전 동일 실패](../verification/analysis-contract-2026-09-25/input-race-before.log)를 재현했다. [Playwright actionability](https://playwright.dev/docs/actionability)의 기준에 따라 다음 Enter 전에 실제 대기열 추가 버튼의 enabled 상태를 확인하고, 드래그 전에도 손잡이 준비를 확인하도록 fixture를 수정했다. 지연 상태를 실제 만났다는 assertion도 추가했다. 제품의 입력 처리와 대기 시간 제한은 바꾸지 않았다. [수정 후 같은 지연 조건의 통과](../verification/analysis-contract-2026-09-25/input-race-after.log)를 확인한 뒤 전체 gate를 새로 실행했다. 첫 gate의 부분 통과를 새 실행에 합산하지 않는다.

## 남은 한계

작업 조건이 보존된다는 검사는 모델이 그 조건을 의미상 모두 충족한다는 평가가 아니다. Qwen 실모델 성공률, 실제 계정/회사 사이트, Windows/Edge는 별도 평가 대상이다. 결과와 assignment는 실행 메모리이며 브라우저 재시작 복구를 추가하지 않았다. 주 실행기가 애초에 누락한 사용자 조건을 이 변경이 자동 복원하지는 않는다. 메모리에서 제거된 오래된 task_id 역시 복구할 수 없다.

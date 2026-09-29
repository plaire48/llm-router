# Pi 활용 점검

최신 상태: 브라우저는 0.87.1/finishTurn으로 이전했다. [순서별 작업과 현재 판단](ORDERED-QUALITY-2026-09-25.md), [현재 작업 목록](BROWSER-QUALITY-BACKLOG.md)을 우선한다. 아래 0.86.1 검토는 도입 당시 근거다.

기준: 실제 설치한 `@earendil-works/pi-agent-core@0.86.1`의 README, agent.d.ts, agent-loop와 harness 타입. 공급자 호출은 기존 AI Pro/ChatGPT/FabriX 전송 계약을 유지한다.

| 기능 | 기존 상태 | 이번 판단 |
|---|---|---|
| `Agent.steer`, `followUp` | 사용자 큐/방향 전환, 검토 후 보완에 사용 | 기존 구현 유지 |
| `prepareNextTurn` | 완료된 하위 분석을 다음 판단에 전달 | 먼저 도착한 결과의 전달 유지 |
| `beforeToolCall`, `afterToolCall` | 인자/실행 권한/재검증/오류 처리에 사용 | 브라우저 승인과 실행 순서 유지 |
| `toolExecution: parallel`, 도구별 `executionMode` | 모든 경로가 sequential | **하위 분석의 독립 읽기에 적용** |
| `shouldStopAfterTurn` | 질문 후 가상의 빈 assistant 응답으로 종료 | **질문/승인에서 정상 종료하도록 적용** |
| `transformContext`, 내장 compaction | Pi 훅 대신 기존 context-manager가 공급자 wire 변환 뒤 처리 | 즉시 대체하지 않음. 누비의 요구사항 앵커/도구 쌍/승인/문서 출처 보호를 Pi 세션 계약으로 옮기는 평가 필요 |
| `AgentHarness`, session branching/navigation | 현재 worker lease/IndexedDB 대화와 run-local 분석 레지스트리 사용 | 후보. 별도 대화로 비교안을 만들되 저장 및 승인 범위 이전 설계가 먼저 필요. 아직 적용하지 않음 |
| 도구 `onUpdate`/`tool_execution_update` | 호스트 단계 이벤트로 상태 전달 | 후보. 긴 문서/MCP 작업의 실제 진행 이벤트가 있을 때 연결. 가짜 퍼센트는 추가하지 않음 |
| Pi skill loader/formatter | ZIP/폴더 스킬과 MiniSearch 점진 조회 구현 | 후보. ExecutionEnv의 파일 어댑터와 가져오기 검사를 연결해야 함. 스킬 등록 기능이 없다는 뜻은 아님 |
| Pi telemetry | 호스트 usage/진단 집계 사용 | 후보. 원문/인증값 없는 역할별 지연과 토큰 평가부터 검토. 외부 추적 서비스는 연결하지 않음 |

## 적용한 병렬 읽기

하위 분석은 `parallelReads: true`를 호스트 코드에서 받는다. 모델 인자로 실행 권한을 바꾸지 않는다. 모든 도구가 `read_analysis_evidence`, 프로젝트 조회, 첨부 문서 조회의 고정 허용 목록에 있고 주 브라우저의 단계별 실행/하네스가 아닐 때만 Pi parallel을 선택한다.

이미 알고 있는 독립된 두 문서/질문을 한 응답에서 함께 읽는다. 검색 결과를 보고 다음 경로나 범위를 결정해야 한다면 분리한다. 배치당 2개를 넘는 읽기는 미실행 결과를 돌려주며 다음 판단에서 필요한 것만 요청한다. 기존 p-limit이 실제 동시 조회도 2개로 제한한다. 실패한 한 조회 때문에 성공한 다른 결과를 버리지 않는다. Pi는 완료 이벤트를 도착 순서로 보내고 대화의 도구 결과는 원래 호출 순서로 유지한다.

페이지 클릭/입력/이동/MCP 실행은 이 허용 목록에 없다. 섞인 도구 집합과 주 실행기의 관찰→행동→검증은 기존 순차 흐름을 유지한다. 최대 두 하위 담당이 각각 두 읽기를 실행할 수 있지만 실제 호스트/사내 서버가 조회를 직렬화하면 그 네트워크 구간이 더 빨라진다고 보장할 수 없다.

## 질문에서 종료

Pi `shouldStopAfterTurn`이 실제 `requiresUserInput` 결과 이후 자동 진행을 멈춘다. 원래 질문/승인 상태와 usage를 보존하고 후속 조작은 실행하지 않는다. 기존 질문/승인 요청에서 추가 실제 LLM 호출을 이미 막고 있었으므로 이번 변경을 API 호출 수 절감이라고 표현하지 않는다. 가상 assistant 응답을 만들어 종료하던 내부 절차를 Pi 공식 종료 지점으로 옮긴 것이다.

## 비교한 방법론

- [Pi agent](https://github.com/earendil-works/pi/tree/main/packages/agent): 설치된 동일 버전의 공식 코드/문서에서 실행 모드, 도구별 override, 종료 훅을 확인했다. SDK를 하나 더 붙이지 않고 기존 MIT 실행기를 활용한다.
- [OpenAI Agents SDK orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/): 메인이 제어를 유지하고 독립된 담당을 도구처럼 호출하는 방식. [실행 제어](https://openai.github.io/openai-agents-js/guides/running-agents/)의 동시 실행 제한도 참고했다.
- [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use): 필요한 도구만 노출하고 독립된 조회를 모아 호출하는 방향을 참고했다. Claude 전용 Tool Search/PTC API를 Qwen에 그대로 전송하지 않는다. 누비는 기존 MiniSearch + 샌드박스 + Pi 읽기 배치를 쓴다.
- [OpenCode agents](https://opencode.ai/docs/agents): 읽기 전용 탐색 담당과 메인/하위 권한 분리, 내부 요약 담당 구분을 참고했다. 확장에 OpenCode 서버나 로컬 셸을 설치하지 않는다.

## 검증

`pi-read-parallel.test.mjs`는 실제 Pi 실행기로 두 읽기의 겹침, 먼저 끝난 조회, 대화 결과 순서, 실패 격리, 초과 배치 보류, 브라우저 쓰기 혼합 시 순차 실행, 질문 뒤 실행 차단을 검증한다. `role-agents-browser.mjs`는 Chrome 확장에서 합성 Qwen이 한 번에 두 근거 조회를 제안하고 결과를 받는 경로까지 확인한다.

실모델의 도구 선택 정확도, 사내 API 지연과 총 토큰 개선은 별도 평가 대상이다. 새 라이브러리나 기능 수를 품질 향상의 증거로 삼지 않는다.

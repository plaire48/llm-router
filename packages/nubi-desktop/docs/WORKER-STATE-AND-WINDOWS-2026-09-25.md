# 워커 상태와 Windows 입력 직전 검증

2026-09-25. 기존 OpenWiki-SDS/Pi 멀티에이전트 흐름을 유지하면서 실제로 재현한 세 가지 결함을 보완했다.

## 반영한 동작

| 문제 | 변경 |
| --- | --- |
| 호스트 재시작으로 중단된 워커가 다음 실행에서 다시 ‘분석 중’으로 표시됨 | 현재 checkpoint.runId에 속한 최신 trace만 이력에 병합한다. 중단/종료 워커를 오래된 queued/running 이벤트로 되돌리지 않는다. 아직 이력 페이지를 읽지 못했어도 이전 실행의 미완료 trace는 중단으로 표시한다. |
| 오래된 실패가 최신 성공 12개에 밀려 최종 검토에서 빠짐 | 최대 12개 검토 요약에 실패, 부분 결과, 미수집, 미확인 사항이 남은 분담을 우선 포함한다. 그 안에서는 원래 순서를 보존한다. 남은 자리에는 최근 완료 응답을 넣는다. 선택 한도와 모델 입력 예산에서 제외한 미해결 수를 별도로 남긴다. 전체 이력을 삭제하지 않는다. |
| 가상 포인터 이동/클릭 표시 중 사용자가 바꾼 값이나 대상에 이전 승인으로 입력 가능 | 포인터 표시와 비동기 문서 확인 뒤 native dispatch 직전에 바인딩, 창, 요소, 만료, 드래그 도착 대상과 기존 입력값 해시를 다시 검사한다. 문서 근거를 연결하지 않은 일반 입력에도 적용한다. 충돌은 stale/not_started로 보존하고 실행하지 않는다. |

분석 과정은 기존 작업 화면에서 워커별 역할, 원문 읽기, 응답 수집, 남은 확인과 최종 검토로 보여준다. 이전 기록은 펼쳐서 읽으며 내부 추론은 표시하지 않는다. ‘응답 수신’과 실제 앱 동작/업무 완료는 서로 다른 상태다.

## 실제 소스와 공식 방법론

| 비교 대상 | 확인한 강점과 적용 판단 |
| --- | --- |
| [OpenCode task.ts](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/tool/task.ts), MIT | foreground/background 작업 구분, 결과 상태 반환, 자식 권한 파생과 중첩 제한을 확인했다. 누비는 기존 두 워커 병렬 조사와 자식 쓰기 금지를 유지한다. 종료/실행 중 구분과 완료 이벤트의 신뢰성을 이번에 보완했다. |
| [Codex list_agents](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs), [wait_agent](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs), Apache-2.0 | 실행 범위에 속한 실제 agent status 조회와 시작/종료 이벤트, mailbox/steer 대기를 확인했다. 누비 UI도 현재 실행 ID와 실제 이벤트를 기준으로 만들며 대기나 오래된 이벤트를 완료/새 실행으로 해석하지 않는다. Rust 실행기를 복제하거나 교체하지 않았다. |
| [Claude subagents](https://code.claude.com/docs/en/sub-agents) | 독립 문맥과 도구 제한, 상위로 요약 반환하는 방식을 확인했다. Claude의 상용 런타임을 오픈소스로 복사한 것이 아니다. |
| [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) | 역할별 목표와 경계, 부분 실패 관찰, 주 실행기의 결과 합성 방법을 재확인했다. 이번에는 검토 문맥에서 실패/미확인 사항을 우선 보존한다. 멀티에이전트 성능 수치를 누비의 성능으로 인용하지 않는다. |

추가 라이브러리는 없다. 기존 Pi Agent Core, p-limit, OpenWiki-SDS의 DeepAgents 코어, SQLite와 winapp 어댑터를 재사용한다. 상태 병합과 입력 직전 검사 문제는 새 오케스트레이터 설치보다 현재 실행 경계를 수정하는 것이 적합했다. 분석은 병렬화하고 Windows 입력은 기존 승인과 순차 실행을 유지한다. 상용 데스크톱 전체 소스 접근이나 외부 agent 연동/A2A를 구현한 것은 아니다.

## 검증과 한계

- 실제 이력 저장 → 재시작 복원 → 새 실행 화면 병합으로 상태 회귀를 재현하고 검사한다.
- 초기 실패/불확실성 뒤 성공 응답 20개, 미해결 분담 12개 추가와 작은 모델 문맥에서의 생략 수를 확인한다.
- Windows 어댑터 fixture에서 포인터 move/pulse 중 사용자 값 변경과 대상 위치 변경을 주입해 native dispatch 0회와 사용자 값 보존을 확인한다.
- 마지막 검사와 OS 실행은 서로 다른 호출이므로 모든 사용자/앱 변경을 원자적으로 막는다는 보장은 아니다. 앱의 실제 동작 이후 readback과 미확정 결과 재전송 금지를 유지한다.
- 로컬 브라우저/합성 모델/Windows 어댑터 검사와 실제 Windows 11, 제공자별 실모델 성능, 설치 파일 배포는 별개다.

검사 로그와 소스 해시: `verification/worker-state-windows-20260925/result.json`.

최종 로컬 검사: Desktop 273개, 공통 분석/에이전트 46개, UI 92개(Workbench 49, 스킬 등록 12, 공유 UI 31) 통과. 브라우저/Node 개발 번들 오류 0개. 중단 상태와 미해결 분담 화면 캡처를 직접 확인했다. Windows 관련 회귀는 합성 어댑터 입력이며 Windows 11 실제 앱 테스트는 수행하지 않았다.

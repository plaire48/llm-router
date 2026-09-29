# 모델 대기와 하위 분석 재개 검토

2026-09-26. 브라우저 누비의 사용자 요청 5, 7에 대한 원인과 적용 기록.

## 확인한 원인

| 경로 | 이전 동작 | 반영 |
|---|---|---|
| 느린 응답 안내 | 각 모델 호출 시작 15초 뒤 안내. 본문, 추론, 도구 인자 델타가 계속 와도 타이머가 유지됨 | 실제 파싱된 모델 활동이 없었던 15초만 대기로 표시. 활동이 재개되면 동일 대기 항목을 즉시 종료 |
| 병렬 모델 상태 | 하위 호출이 부모와 같은 `onPhase`를 갱신하여 부모 진행 표시를 덮음 | 하위 분석은 기존 작업별 진행 이벤트를 사용하고 부모 전역 단계를 덮지 않음 |
| 질문 답변 후 자동 비교 | `runAgent`가 마지막 wire user 메시지를 요청으로 사용. 실제로는 체크포인트나 새 페이지 원문일 수 있음 | 호스트가 보존한 작업 목표를 별도 인자로 전달 |
| 답변 후 의도 판단 | `사용자 수정 요청:`이라는 호스트 접두사까지 쓰기 요청으로 해석 | 해당 줄의 호스트 접두사만 분류에서 제외. 실제 사용자 문장과 쓰기 조건은 그대로 검사 |

대기 이벤트를 이력에서 지우거나 전부 합치지 않는다. 실제 무응답 구간은 호출별로 남기며 계획, 검토, 하위 분석, 문맥 정리 대기는 짧은 이름으로 구분한다. 타임아웃, 재시도 횟수, 취소, 공유 Retry-After, 쓰기 재전송 금지는 변경하지 않았다. SSE keepalive는 모델 활동으로 인정하지 않는다.

## 공개 구현 비교와 선택

| 근거 | 관찰한 설계 | 적용과 선택 |
|---|---|---|
| [OpenCode session processor](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts), [MIT](https://github.com/anomalyco/opencode/blob/dev/LICENSE) | 텍스트와 추론 delta를 메시지/part 식별자에 연결하고 실행 상태를 별도로 관리 | 실제 이벤트 기반 진행을 기존 Pi 전송에 적용. 서버 런타임 추가와 소스 복사는 하지 않음 |
| [Codex exec events](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs), [Apache-2.0](https://github.com/openai/codex/blob/main/LICENSE) | turn 수명과 item 시작/갱신/종료 이벤트를 구분 | 동일 대기 ID의 시작/종료를 유지. 하위 호출로 상위 단계를 덮지 않는 수명 분리 적용 |
| [OpenAI Agents streaming](https://openai.github.io/openai-agents-js/guides/streaming/), [MIT](https://github.com/openai/openai-agents-js/blob/main/LICENSE) | raw model 이벤트와 run item/agent 이벤트를 구분 | 파싱된 델타만 대기 시계에 반영. 실제 위임은 기존 assignment 이벤트로 보여줌. 두 번째 하네스 의존성은 추가하지 않음 |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | 독립 문맥, 제한된 도구, 명확한 하위 임무와 결과 반환 | 원래 목표와 최소 근거를 전달하는 기존 격리 Pi 구조 유지. 재개 시 호스트 목표 연결을 보완 |
| [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) | 독립 조사에 맞춘 분해, 명확한 산출 조건, 과제 규모에 맞춘 자원 사용 | 자동 비교는 두 관찰 출처가 있을 때만 최대 두 워커. 불필요한 모델 호출이나 병렬 수 증가는 하지 않음 |

Claude Code는 공개 문서에서 동작 계약을 검토했다. Claude 브라우저 확장/데스크톱의 비공개 구현을 읽었거나 복사한 것으로 주장하지 않는다. 추가 패키지 없이 기존 Pi, p-limit, p-retry, DeepAgents와 MiniSearch를 유지한다. 교체 비용과 MV3 실행 제약에 비해 이번 결함은 연결과 수명 관리 수정으로 해결할 수 있다.

## 실제 구현 동작과 한계

- 일반 하위 분석은 Pi가 독립 문맥에서 실행하며 동시 2개, 미수집 포함 6개 한도를 유지한다. 출처 ID의 원문을 실제 읽은 경우만 인용할 수 있다. 주 에이전트만 브라우저를 조작한다.
- 자동 비교는 짧고 명시적인 읽기 전용 비교 요청과 두 개의 서로 다른 캡처 출처가 필요하다. 임의의 모든 요청을 병렬 작업으로 바꾸지 않는다. 긴 목표, 단일 출처, 쓰기 요청, 질문 대기, 미확정 쓰기는 자동 비교 대상이 아니다.
- 긴 첨부와 Wiki는 기존 DeepAgents 분할 조사, 누락 보완, 계층 합성과 인용 재검색 경로를 유지한다. 일반 하위 분석과 같은 기능으로 뭉뚱그리지 않는다.
- 압축은 기존 요청 앵커, 미완료 하위 작업 ID, 문서 범위와 원문 근거를 유지한다. 이번 수정은 실제 작업 목표를 합성 메시지와 분리하는 연결 보완이다.

## 검증

집중 단위/전송 통합 220개 통과:

```sh
node --test tests/model-recovery.test.mjs tests/model-wait-api.test.mjs tests/analysis-*.test.mjs tests/context*.test.mjs tests/review-context.test.mjs tests/document-agent.test.mjs tests/openwiki-agent.test.mjs tests/completion-errors.test.mjs
```

- 가상 시계에서 SSE 델타를 10초마다 80초 동안 제공: 대기 항목 0개. 이후 16초 무응답: 대기 시작 1개. 다음 델타: 같은 ID 종료. 전체 모델 요청 1회 유지.
- 병렬 호출 중 하나만 멈춘 경우 해당 호출만 느린 응답으로 표시. 취소 후 늦은 델타는 상태를 바꾸지 않음.
- 실제 `completeChat → runAgent → 하위 분석 전송` 경로의 합성 응답 시험: 질문 재개 목표와 배송비 조건을 두 워커에 전달. 워커 2개와 원문 조회 후 반환까지 하위 모델 호출 4회 확인.
- 독립 두 역할의 동시 호출, 원문 격리, 사용량 합산, 하위 추론이 부모 상태/본문에 섞이지 않음, 문맥 압축과 DeepAgents 누락 보완 회귀 통과.

이 결과는 코드 경로와 합성 전송의 검증이다. 80초는 가상 시계이며 실제 제공자 응답 시간 측정이 아니다. 실계정 모델의 지연, 정답률, 네이버 업무 성공률 개선은 이번 검사로 주장하지 않는다.

# 추가 지시 채팅과 진행 기록 분리

## 문제와 반영

기존 위 화살표는 이미 Pi steer와 연결돼 있었으나 소비 전 입력은 입력창의 대기 카드에만 남았다. 소비 뒤에는 기존 assistant 앞에 user 메시지를 넣었고, 이전부터 쌓인 계획/진행 기록도 같은 답변 안에 있었다. 메시지 접수, 실제 반영과 작업 상태를 구분하기 어려웠다.

- `conversation-view.js`는 worker가 수락해 영속 inbox에 저장한 steer만 채팅에 투영한다. 일반 queue는 기존 대기열에 둔다.
- 수락된 메시지는 기존 옅은 파란 사용자 말풍선과 동일하게 표시하고, 소비 전에는 `반영 대기`, 중지/다른 실행이면 `보류`로 구분한다.
- 실제 모델 문맥은 기존 `TAKE_AGENT_INPUT`이 소비할 때만 갱신한다. UI 투영을 모델의 사용자 메시지나 승인으로 전달하지 않는다.
- inputId로 소비 전후 같은 메시지를 연결해 중복 말풍선을 만들지 않는다. 새로고침은 영속 inbox/대화 기록으로 복원한다.
- 추가 지시가 있는 실행의 계획/도구 기록은 답변 밖 `작업 진행 상황` 영역에 둔다. 최종 응답은 기존 배경 없는 본문이며 복사는 답변 텍스트만 대상으로 한다.
- 미반영 메시지의 수정/삭제를 채팅에서 제공한다. 중지 후 명시적 실행 버튼은 기존 조건을 유지한다. dnd kit은 보이는 queue만 정렬 대상으로 두고 원래 전체 inbox ID 스냅샷으로 호스트의 충돌 검사를 유지한다.
- 사용자가 위 화살표를 누르면 최신 대화로 이동한다. 이후 위로 스크롤한 위치를 유지하는 기존 기능은 그대로다.

이번 변경은 **접수된 지시의 표현 방식**이다. 실행 중인 브라우저 도구를 중단하거나 쓰기 영수증을 버리지 않는다. 도구 실행이 직렬 메시지 큐를 점유하는 동안 접수 자체가 기다리는 기존 조건을 제거한 것은 아니다. 네트워크 요청의 로컬 optimistic 표시를 서버 접수로 위장하지 않는다.

## BP와 오픈소스 판단

| 근거 | 실제 적용 | 도입하지 않은 부분 |
| --- | --- | --- |
| [Codex TurnItem 소스](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/items.rs), [Apache-2.0](https://github.com/openai/codex/blob/main/LICENSE) | UserMessage와 Plan/도구 활동을 별도 항목으로 취급하는 패턴, 안정된 ID에 따른 사용자 메시지 표시 | 비공개 Codex Desktop UI 코드를 분석했다고 주장하지 않음. Rust 런타임 추가/소스 복사 없음 |
| [OpenCode V2 session 명세](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md), [MIT](https://github.com/anomalyco/opencode/blob/dev/LICENSE) | durable admission과 model-visible promotion을 구분하는 원칙을 기존 누비 inbox에 적용 | 명세의 실험적 V2 전체가 배포됐다는 근거로 사용하지 않음. Effect/서버/DB 도입 없음 |
| 기존 React와 Pi 0.87.1, dnd kit | 기존 worker 소비와 Pi steer, React 안정된 key와 명시적인 상태 투영, 기존 Pointer/Keyboard 정렬 재사용 | 채팅 프레임워크 교체나 새 상태 관리 패키지는 문제 범위 대비 비용이 커서 추가하지 않음 |

모든 화면 문구와 색/글꼴은 기존 Nubi/CX 토큰을 유지했다. 모델의 비공개 추론이나 시간 기반 가상 진행은 표시하지 않는다.

## 검증 구분

`conversation-view.test.mjs`는 접수/소비 사이 ID 유지, 중복 방지, 다른 대화/제공자 격리, 미반영 메시지 복원과 원본 상태 불변을 검사한다.

`steering-transcript-browser.mjs`는 실제 Chrome/확장과 합성 모델을 사용한다. 접수 직후 경계는 영속 inbox fixture로 고정해 화면 표시/수정/삭제/재진입을 재현하고, 실제 `STEER_AGENT_INPUT`과 worker 소비를 통해 같은 실행에 한 번 전달되는지 확인한다. 실제 위 화살표 클릭, 모델 요청 중단, 대기열 정렬/순차 실행/HITL/취소는 기존 `agent-input-browser.mjs`에서 별도로 검사한다. 접수 fixture를 실제 장시간 브라우저 도구 중 입력 접수 성공으로 해석하지 않는다.

실모델 의미 이해나 업무 성공률은 이번 UI 회귀의 측정 대상이 아니며 공개 배포는 하지 않는다.

## 화면 확인

- [360px 반영 대기](../verification/steering-transcript/pending-360.png): 기존 사용자 말풍선 안의 짧은 상태와 수정/삭제 아이콘. 진행 기록은 그 아래 독립 영역.
- [1100px 완료](../verification/steering-transcript/completed-1100.png): 원래 요청/추가 지시/진행 기록/최종 답변을 구분하며 입력창은 하단에 유지.

초기 새 검사에서 사용한 페이지 이동 fixture는 작업 원본 탭 바인딩이 없어 목적 경로를 재현하지 못했다. 이후 실제 페이지 관찰 + 응답 대기와 영속 접수 상태 fixture를 분리했다. 저장 성공 직후의 화면 갱신은 비동기이므로 DOM의 동일 ID/상태 변경을 기다린 뒤 판단하도록 검사를 맞췄다. 이 fixture 수정은 제품 완료/권한 검사를 완화하지 않는다.

## 같은 후보의 입력 회귀

[입력/표시 회귀 보고서](../verification/steering-transcript/report.json)의 `agent-input-browser`와 `steering-transcript-browser`가 통과했다. 전자는 실제 위 화살표 클릭/요청 중단/순차 대기열 등 7개 검사를, 후자는 접수/표시/소비/재진입의 3개 검사를 수행한다. 두 스위트의 시작/종료 소스와 빌드 해시가 일치한다.

## 최종 검증

[전체 identity gate](../verification/pre-release-2026-09-25T20-14-56-092Z/report.json)에서 단위 검사 **908/908**, 디자인 검사, 후보 빌드와 실제 Chrome 화면 스위트 **30/30** 통과. 위의 입력 스위트 2개를 합해 **32개 Chrome 스위트**를 확인했고, 종료 후 소스/검사/빌드 해시를 다시 대조했다. 합성 모델을 사용했으며 실제 모델 품질 점수나 공개 배포 완료를 뜻하지 않는다.

빌드 SHA-256: `de3bc76319017d18235d762b979d98f3e72c841957a505af80b34b07d97a1b79`

후보 ZIP SHA-256: `077846d35c6aad74d0962b37282bbeec72856c7aeae67633b95b73241d48826c`

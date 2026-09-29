# 화면 상태 조회 복구

2026-09-23. 화면의 상태 조회 실패를 Agent 실행 실패와 분리한다. 화면 조회 때문에 모델이나 브라우저 동작을 다시 실행하지 않는다.

## BP 선택

- [TanStack Query 재시도](https://tanstack.com/query/latest/docs/framework/react/guides/query-retries): `@tanstack/query-core` 5.103.2 MIT를 실제 의존성으로 추가했다. 조회 캐시, 유한 재시도와 취소를 맡긴다.
- [상태에 따른 polling](https://tanstack.com/query/latest/docs/framework/react/guides/polling): 정상 주기 조회와 실패 재시도를 구분한다. 재시도가 끝난 뒤 interval이나 저장소 변경 알림이 새 재시도를 무한히 시작하지 못하게 한다.
- [Query 취소](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation): 화면 종료 시 취소하고 늦게 도착한 결과를 반영하지 않는다. Chrome RPC는 이미 전송한 요청 자체를 취소할 수 없으므로 결과 대기와 UI 반영을 취소한다.
- [Anthropic Managed Agents의 분리 원칙](https://www.anthropic.com/engineering/managed-agents): 세션 기록, 실행과 화면 관찰의 실패를 구분한다. 이 공개 설계를 참고했으며 Claude Code UI 내부 구현이나 Claude 서비스 연동을 도입한 것은 아니다.

## 발견 사항

`App.jsx`가 `GET_STATE`를 고정 10초 interval과 모든 저장소 변경 이벤트에서 호출했다. 실패해도 멈추지 않았고, 응답이 느리면 요청이 겹칠 수 있었다. 첫 조회가 실패하면 spinner가 계속 표시됐다. 실제 작업의 lease 갱신도 화면의 조회에 의존했다.

## 구현 정책

| 상황 | 처리 |
| --- | --- |
| 상태 조회 실패 | 최초 요청 포함 최대 3회. 약 1초, 2초의 지수 지연과 편차. 요청별 대기 8초 |
| 조회 한도 소진 | 자동 조회 중단. 저장소 알림, 주기 타이머와 포커스 복귀도 실패 한도를 초기화하지 않음 |
| 이미 표시한 상태가 있음 | 마지막 응답과 기록 유지. 상단에 짧은 안내와 다시 조회하는 아이콘 표시 |
| 최초 조회 실패 | 무한 spinner 대신 같은 복구 버튼 제공 |
| 사용자 재연결 | 상태만 조회. `START_CHAT`, 도구 호출, 모델 재요청을 실행하지 않음 |
| 확장 context 무효화 | 재시도하지 않고 확장 화면 다시 열기 제공 |
| 저장소 변경이 몰림 | 짧게 모으고 조회 중이면 후속 조회 하나만 예약. 응답 역전과 변경 누락 방지 |
| 정상 상태 | 변경 알림을 우선 사용. 작업/로그인 진행 중인 보이는 화면만 10초 보조 조회 |
| 화면 종료 | 캐시와 대기 정리. 늦은 응답 반영 금지. 기존 사용자 중지와 화면 종료 시 작업 처리 유지 |

조회 상태와 Agent 작업 상태는 별개다. `SAVE_CONTEXT`/도구 호출의 실제 소유자 활동으로 lease를 갱신한다. 모델 스트림과 실행 진행 이벤트는 최대 10초 간격으로 생존 신호를 전달한다. 이는 무한 heartbeat 타이머가 아니며 취소/종료 후 재시작하지 않는다. 다른 화면, 잘못된 소유자, 취소되거나 만료된 작업은 되살리지 않는다. 기존 비활동 감시와 최종 승인 경계는 유지한다.

CX `CxNotice`와 `ActionButton`을 사용한다. 새 설정, 모달과 긴 안내를 추가하지 않았다. 좁은/넓은 화면에서 마지막 답변과 재연결 아이콘을 확인한다.

## 검증 경계

- `state-sync.test.mjs`: 실패 횟수, 이벤트 폭주, 중복/응답 역전, 무응답/늦은 결과, 수동 복구, 취소와 화면 가시성.
- `login-lifecycle.test.mjs`: 화면 조회 없이 실제 소유자 활동으로 갱신. 다른 소유자/취소/만료 작업 재생성 금지.
- `state-sync-browser.mjs`: 실제 Chrome에서 조회 실패 주입 후 2분 타이머/여러 저장소 변경에도 추가 조회가 없는지 검사. 재연결 전후 모델/작업 실행 수와 대화 보존, 최초 실패 화면을 검사.
- 기존 사이드 패널, 제공자 전환과 승인 흐름을 함께 검사. 대상 스위트와 배포 후보 해시는 `verification/pre-release-*/report.json`에 기록한다.

Chrome 검사는 합성 제공자 응답을 사용한다. 실제 사내망, 실제 Qwen 정확도와 공개 배포 완료를 의미하지 않는다.

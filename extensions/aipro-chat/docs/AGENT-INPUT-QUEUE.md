# 실행 중 방향 변경과 다음 작업

## 사용자 흐름

작업 중에도 입력창을 사용한다. Enter/입력창의 위 화살표는 순서대로 대기열에 넣고 현재 작업 완료 후 실행한다. 대기 메시지 옆 위 화살표를 누르면 해당 메시지를 현재 작업에 반영한다. Shift+Enter는 줄바꿈이다. 대기 목록은 입력창 위에 표시하며 수정은 입력창으로 되돌리고 삭제는 해당 메시지만 제거한다.

기존 CX 버튼, Noto Sans KR 14/22px, HTML 기반 deck 표면/반경/색상 토큰을 사용한다. 아이콘에 접근 가능한 이름과 툴팁을 제공한다. 작업 중 새 첨부는 받지 않는다. 기존 질문과 승인 폼은 그대로 유지한다.

## 공식 사례와 선택

- [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works): 실행 중 입력을 대기 목록에 표시하고 도구 종료 후 전달하며, 보내기 전 회수해 수정하는 흐름을 참고했다.
- [OpenAI mid-turn steering](https://developers.openai.com/api/docs/guides/steering): 접수와 실제 적용을 구별하고, 시작한 도구 실행을 되돌리지 않으며, 연결 단절 후 입력 중복 재전송을 피하는 원칙을 참고했다. 이 API는 특정 모델/Responses WebSocket에 제한되므로 Qwen/OpenAI 호환 Chat Completions에 직접 붙이지 않았다.
- [Pi Agent](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md#steering-and-follow-up): 설치된 MIT 라이선스 `@earendil-works/pi-agent-core` 0.86.1의 `steer`, `prepareNextTurn`, `beforeToolCall`을 실제 사용한다. 새 하네스 의존성은 추가하지 않았다.

Pi의 `followUp`은 모델이 끝내려는 시점에 실행되지만 누비는 그 뒤 별도의 결과 검증과 HITL을 수행한다. 따라서 사용자 후속 작업은 Pi 메모리 큐에 바로 넣지 않고 **호스트의 검증된 FINISH_CHAT 이후 새 lease**로 시작한다. 각 답변/사용량/실행 기록을 분리하고 대화 문맥은 공유한다. 기존 내부 복구용 Pi followUp은 유지한다.

## 실행과 저장

- `chat.inbox`에 대화, 제공자, 인증 시점, 실행 ID와 입력 ID를 저장한다. 저장 성공 전 초안을 지우지 않으며 중복 입력 ID를 다시 실행하지 않는다.
- 단일 직렬 호스트가 입력 접수/회수/실행 인계를 결정한다. 이미 실행 중인 도구는 끝까지 결과를 받고 다음 경계에서 반영한다. 지금 반영을 누르면 진행 중인 일반 모델 요청만 취소하고 새 추론을 시작한다. 이미 실행 중인 브라우저 도구는 취소/재전송하지 않는다. 서버의 토큰 생성 자체를 편집하는 네이티브 steering API는 아니다.
- 새 지시가 도착하면 이전 모델 응답의 아직 실행하지 않은 도구 제안을 막고, Pi steer를 통해 다음 추론으로 전달한다. 완료한 클릭/입력/캡처의 영수증은 보존하며 자동 재실행하지 않는다.
- 소비할 지시는 먼저 실제 사용자 메시지로 기록한다. 체크포인트의 목표, 독립 검증의 목표, 압축 후 보호하는 목표도 갱신한다. 기존 사용자 제한은 요약문에만 맡기지 않고 별도로 유지한다.
- 지시 변경은 승인으로 취급하지 않는다. 기존 승인 기록을 폐기하고 최종 트랜잭션은 다시 명시적 승인을 받아야 한다.
- 정상 완료 후에만 해당 실행 체인의 다음 항목을 시작한다. 중지/오류/질문/HITL/worker 종료는 큐를 남기며 자동 진행하지 않는다. 이후 무관한 요청이 성공해도 과거에 멈춘 큐를 재개하지 않는다. 질문에 답하거나 같은 작업을 명시적으로 이어가면 해당 실행 체인의 대기 목록도 이어간다.
- 현재 질문에 답하기 전에는 대기 항목의 실행 버튼으로 질문을 우회할 수 없다. 다른 대화나 변경된 인증의 입력도 자동 인계하지 않는다.
- 실행 중 새 파일 첨부와 네이티브 서버 측 토큰 생성 중단은 이번 범위가 아니다. 브라우저 권한과 로컬 실행기를 추가하지 않는다.

## 검증

`tests/agent-input.test.mjs`: 입력 ID/대화/인증/실행 범위, 오래된 도구 실행 차단, 완료 결과 보존, 최종 검토 중 지시 수신, 취소 후 미소비.

`tests/agent-input-browser.mjs`: 실제 Chrome에 설치한 후보 확장과 합성 Qwen 응답으로 입력창 단축키, 접수/순서, 새로고침, 다른 대화 거절, 자동 후속 작업, 중지 후 보존, 무관한 새 요청과의 분리, 수정/삭제, 질문 경계, 좁은/넓은 화면을 검사한다. 사내 AI Pro 실계정과 실제 Qwen 정확도 검증은 아니다.

관련 기존 회귀: 문맥 압축/제한 보존, 백그라운드 수명, 질문/승인, 완료 검증, 대화 전환, 모델 지연 복구. UI는 `npm run verify:identity`를 통과해야 한다.

### 최종 후보 검증 결과

- 후보: `1.0.0-beta.17` / 확장 `1.4.20` / 표시 `Beta 1.0.0`.
- 단위 테스트 511개 통과. 동일 빌드에서 큐/대화/문맥/승인 회귀 10회와 CX 화면 검증 17회, 총 27회 Chrome suite 실행 통과.
- 설치 ZIP의 모든 파일이 검증된 `dist`와 일치하고 ZIP 무결성 검사 통과.
- 산출물: `verification/agent-input/nubi-beta-1.0.0.zip`. 상세 근거: `verification/agent-input/verification.json`.
- SHA-256: `b3f270bad42e8ccedaeda54f7e5cc51d9c91d6b5e9fd12e28ecc16217b1ebadf`.
- 합성 응답 기반이며 사내 실계정과 실제 Qwen 추론 품질은 미검증. GitHub 릴리즈 업로드는 실행하지 않았다.

## 드래그 정렬과 중간 지시 추가 검증

왼쪽 점 6개 손잡이로 대기 카드 순서를 바꾼다. 순번과 옅은 HTML/CX 카드 표면으로 다음 실행 순서를 표현하며, 오른쪽 ↑는 정렬과 별개인 지금 반영이다. 별도 위/아래 버튼은 없다. 키보드는 스페이스로 잡기/놓기, 방향키로 이동, Escape로 취소한다. 모션 감소를 존중한다.

MIT dnd kit의 고정 버전 `core 6.3.1` / `sortable 10.0.0` / `utilities 3.2.2`를 번들했다. 안정된 React sortable API와 Pointer/Keyboard sensor, 드래그 손잡이 초점/스크린리더 지원을 사용한다. [공식 sortable](https://dndkit.com/legacy/presets/sortable/overview/)과 [접근성 문서](https://dndkit.com/legacy/guides/accessibility/)를 참고했다. 최신 재설계 API로 전체 앱을 이관하거나 OS 마우스를 제어하지 않는다. 의존성과 라이선스는 lockfile 및 ZIP에 포함한다.

호스트의 직렬 큐에서 드래그 시작 당시 ID 목록과 현재 ID 목록을 비교한 뒤 아직 대기 중인 같은 실행 체인의 순서만 저장한다. 소비/추가/다른 창 정렬로 목록이 달라지면 이전 drop을 거부하고 최신 상태를 표시한다. 실행 중 메시지나 반영 대기를 정렬하지 않으며 순서를 바꿔도 승인/재개 권한은 생기지 않는다.

[OpenCode V2 session 명세](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md)의 durable admission과 model-visible promotion 분리, ID 기반 중복 방지와 중지 후 inbox 보존을 대조했다. 개발 명세를 배포된 전체 동작의 증거로 취급하지 않는다. [Claude Code](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works)의 도구 완료 경계 전달, [OpenAI steering](https://developers.openai.com/api/docs/guides/steering)의 접수/실제 반영 구별과 이미 시작한 도구 결과 보존을 유지한다. 실제 실행은 기존 Pi steer 및 누비의 단일 worker lease다. OpenAI 네이티브 WebSocket steering이나 OpenCode 서버는 추가하지 않는다.

Chrome 회귀에서 응답을 일부러 열어 둔 상태로 ↑를 누른다. 기존 모델 연결이 취소되고 원래 응답을 해제하기 전에 수정 지시가 포함된 새 요청과 다음 작업이 완료되는지 검사한다. 완료한 도구는 중복 실행하지 않으며 불확실한 작업은 기존 확인 절차로 남긴다. 실제 Qwen의 요구사항 해석 품질을 입증하는 평가는 아니다.

대기열은 첫 3개 카드의 실제 높이를 ResizeObserver로 측정해 최대 높이를 맞춘다. 이후 항목은 목록 내부 스크롤로 확인하며 overscroll은 채팅에 전파하지 않는다. 5개 메시지로 고정 높이/스크롤/실행 순서를 Chrome에서 확인한다.

## Beta 18 최종 검증

`1.0.0-beta.18` / manifest `1.4.21`: 단위 테스트 516개와 동일 빌드의 Chrome suite 25회 통과. 큐/문맥은 새 프로필에서 3회 반복했고 ChatGPT/FabriX 어댑터 및 CX 17개 suite를 포함한다. 키보드 정렬 검사는 저장 후 버튼이 다시 활성화되고 drag 측정 프레임이 준비된 뒤 입력하도록 대기 조건을 보완했다.

검증 ZIP: `verification/clock-queue/nubi-beta-1.0.0.zip`. 무결성과 dist 바이트 일치 확인. SHA-256 `cccbd8feb213ddab521023c4898c7c0c59fbe136ea924e017b7ca8064d1b38cf`. 상세 결과는 `verification/clock-queue/verification.json`. 합성 모델 응답을 사용했고 실계정 검증이나 GitHub 업로드는 실행하지 않았다.

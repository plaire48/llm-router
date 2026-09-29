# 도구 수정과 단계별 검증 복구

## 확인한 문제

1. Pi가 잘못된 도구 인자를 실행 전에 거부해도, 누비가 모델에 보내는 결과는 `tool_arguments_invalid`뿐이었다. 수정할 필드나 위반한 규칙은 사라졌다. Pi의 원문 오류에는 전체 인자가 포함되므로 그대로 전달할 수도 없었다.
2. `verify_page`를 통과해도 완료 전 검증을 다시 요청한 횟수가 누적됐다. 서로 다른 네 단계의 입력과 성공 검증을 반복했을 때, 세 번째부터 검증 복구가 차단됐다. 실제 진전이 있는 작업과 같은 단계에서 정체된 작업을 구분하지 못했다.

수정 전 기록은 `verification/harness-repair/baseline.json`에 있다. 잘못된 인자가 페이지에서 실행된 문제는 아니다.

## 적용 근거와 라이브러리

| 참고 | 누비에 적용 |
| --- | --- |
| [Anthropic: Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | 도구 실패를 다음 행동을 고칠 수 있는 정보로 반환하고, 실제 결과와 오류 횟수를 평가한다. |
| [OpenAI: Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) | 호출 결과가 다음 모델 판단의 입력이 되는 루프를 유지한다. 오류를 숨기거나 같은 쓰기를 자동 재실행하지 않는다. |
| [Codex의 plan handler](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/plan.rs) | 인자 파싱 실패를 모델 응답 경로로 반환하는 실제 구현을 참고했다. 코드는 복사하지 않았다. |
| [TypeBox](https://github.com/sinclairzx81/typebox), MIT | Pi가 사용하는 1.3.27을 직접 의존성으로 고정하고 `typebox/schema`의 인터프리터 검증을 재사용했다. |
| [cfworker/json-schema](https://github.com/cfworker/cfworker/tree/main/packages/json-schema) | 브라우저용 후보로 비교했으나 TypeBox와 역할이 겹쳐 추가하지 않았다. |

검증 재시도 횟수를 성공한 단계에서 초기화하는 것은 위 문서의 특정 알고리즘을 이식한 것이 아니라, 재현한 누비의 상태 관리 결함을 수정한 것이다. 기존 Pi 실행기와 Playwright를 유지한다.

## 동작 계약

- 모델 원본 인자를 JSON Schema로 검사한다. 숫자와 문자열을 바꾸거나 선택 필드의 `null`을 임의로 지워 실행하지 않는다.
- Pi 사전 검사와 누비 실행 전 검사 모두 같은 필드별 오류를 반환한다. 예: `{"path":"/fields/0/value","rule":"type"}`.
- 모델이 호출 ID를 재사용하더라도 대화 순서대로 직전 호출과 결과를 연결한다. 뒤 호출의 인자로 이전 오류의 수정 힌트를 다시 계산하지 않는다.
- 수정 힌트는 최대 네 개다. 도구 스키마에 선언된 필드 경로와 고정된 규칙 이름만 보낸다. 입력값, 임의의 추가 필드 이름, Pi 오류 원문은 복사하지 않는다. 기존 도구 호출 기록 자체는 모델 문맥에 남는다.
- 도구 결과를 받은 모델이 수정할 다음 호출을 선택한다. 호스트가 값을 추측하거나 잘못된 호출을 재전송하지 않는다.
- `verify_page`의 `ok: true, verified: true`만 해당 복구 구간을 초기화한다. 읽기 성공, 새 참조, 추가 쓰기와 실패한 검증은 초기화하지 않는다.
- 같은 미검증 상태에서 완료만 반복하면 기존 제한 뒤 구체적인 질문으로 전환한다. 전체 작업의 누적 횟수 제한을 추가하지 않는다.
- 페이지 권한, 작업 창 소유권, 최종 행동의 HITL은 기존 호스트가 계속 검사한다. 화면과 CX 스타일은 변경하지 않는다.

## 검증

`tool-validation.test.mjs`는 타입/패턴/필수 필드/배열 중복/union/nullable 처리, 원본 보존, 비밀값 제외, 코드 생성이 금지된 환경을 검사한다. 실제 Pi로 잘못된 호출을 거부하고 수정한 호출만 실행되는지도 확인한다.

`harness-repair-browser.mjs`는 실제 Chrome 확장과 기본 누비 작업 창에서 다음 흐름을 검사한다.

1. 관찰한 입력란에 숫자 인자를 요청하고, 페이지 입력 없이 필드 오류를 받는다.
2. 모델의 수정 호출로 첫 번째 초안을 입력한다.
3. 단계마다 성급한 완료 응답을 주고 실제 입력값 검증을 거쳐 다음 단계로 진행한다.
4. 세 단계의 정확한 입력값, 신뢰된 입력 이벤트 세 건, 원본 탭 보존, 최종 검토와 새로고침 후 중복 실행 없음을 확인한다.

모델 응답은 Qwen 3.8 계약의 합성 응답이다. 이는 실행기와 복구 연결 검증이며 실제 Qwen의 판단 성능을 입증하지 않는다. 실제 평가에는 `npm run eval:agent`와 사내 연결이 필요하다. 검사 결과와 설치 후보는 `verification/harness-repair/RESULTS.md`에 기록한다.

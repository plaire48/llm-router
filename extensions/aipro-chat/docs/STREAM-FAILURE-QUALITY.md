# 스트림 오류 복구 품질 점검

2026-09-23. 기준 모델 Qwen 3.8 27B. 실제 회사 API 장애를 관찰한 기록이 아니라, 로컬에서 재현한 오류 처리 결함과 회귀 검사다.

## 발견과 변경

HTTP 200 응답의 SSE 안에 `server_error`가 도착하면 기존 AI Pro 경로는 `upstream`만 반환했다. HTTP 상태가 실패가 아니어서 추론 복구가 한 번도 실행되지 않았다. ChatGPT의 `response.failed`도 Pi SDK가 오류로 반환했지만, 어댑터가 세부 분류를 버려 같은 공백이 있었다.

AI Pro 호환 응답과 ChatGPT Responses 오류에서 고정 오류 코드만 분류해 기존 p-retry 복구기로 전달한다. 서버 일시 장애와 요청 제한은 기존 최대 3회 재시도, 지연 편차, Retry-After, 사용자 취소 규칙을 따른다. 인증, 할당량 소진, 요청 형식, 모델, 컨텍스트 오류와 알 수 없는 오류는 이 경로에서 자동 재시도하지 않는다. 컨텍스트 초과는 기존 압축 경로가 처리한다.

HTTP 상태는 실제 수신값을 유지한다. HTTP 500을 만들어 기록하지 않는다. 제공자 원문, 인증값과 임의 코드는 진단에 복사하지 않는다. 실패 스트림에서 미완성 도구 호출은 폐기하고, 이전 요청에서 이미 실행한 도구 결과는 그대로 다음 추론에 전달한다. 측정된 usage만 기록하며 사용량 누락을 0으로 만들지 않는다.

## 방법론과 오픈소스 선택

| 근거 | 적용과 도입 판단 |
| --- | --- |
| [OpenAI SDK 스트림 구현](https://github.com/openai/openai-node/blob/main/src/core/streaming.ts) | `event: error`와 JSON 오류를 성공 HTTP 응답과 별도로 처리하는 경계를 참고했다. Apache-2.0 SDK 전체를 중복 추가하지 않았다. |
| [Pi Responses 구현](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-codex-responses.ts) | 설치된 MIT 0.86.1의 실패 이벤트 전달을 확인하고 어댑터에서 고정 분류를 보존했다. 인증과 모델 카탈로그는 유지한다. |
| [p-retry](https://github.com/sindresorhus/p-retry) | 기존 MIT 8.0.1의 `shouldRetry`, 지수 지연과 취소를 재사용한다. SDK와 이중 재시도하지 않는다. |
| [Anthropic Agent 평가 방법](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 완료 문구 대신 실제 클릭 수, 토글 상태, 미완성 호출 비실행과 재진입 상태를 검사한다. 합성 회귀와 실제 Qwen 능력 평가를 분리한다. |
| [AgentLab](https://github.com/ServiceNow/AgentLab) | Apache-2.0 외부 평가 후보로 비교했다. Python 실행 환경과 별도 어댑터가 필요해 이번 MV3 수정에는 추가하지 않았다. |

새 프레임워크로 교체할 비교 성능 근거는 확보하지 못했다. 기존 라이브러리를 유지하고 재현한 결함의 연결 경계를 고쳤다.

## 검증 계약

- 단위 검사: JSON/SSE/이름 있는 오류 이벤트, 영구 오류 우선, Retry-After, 비밀값 제외, 실제 Pi SDK의 실패 이벤트 전달.
- 실제 Chrome 검사: 클릭 이후 응답 유실 → 재클릭 차단 → 429 → 불완전한 SSE → HTTP 200 서버 오류 → 새 관찰과 검증. 실제 클릭은 한 번이어야 한다.
- 현재 탭 편집기 검사는 작업 모드를 명시한다. 팝업 직접 실행기 검사는 시작 시 복구 큐를 먼저 기다린다. 제품 권한이나 결과 검증을 완화하지 않는다.
- 원래 실패 기록은 `verification/quality-audit/baseline.json`과 `verification/pre-release-2026-09-23T04-22-23-949Z/report.json`에 있다.
- 최종 범위와 설치 후보는 `verification/quality-audit/RESULTS.md`에 기록한다. 실제 회사 계정, Qwen 성공률과 Windows 포커스 격리는 별도 검증 대상이다.

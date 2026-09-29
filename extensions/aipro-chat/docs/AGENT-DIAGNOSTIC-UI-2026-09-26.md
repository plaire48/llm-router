# 실행별 진단 화면

## 누락과 반영

NQ-46. `GET_AGENT_DIAGNOSTICS`와 원문을 제외한 로컬 저널은 있었지만 앱의 조회 경로는 없었다. 연결 설정의 인증 진단은 에이전트의 검토/종료 원인을 보여주지 않는다.

채팅의 실행 기록 안에 접히는 **실행 진단**을 추가했다. 같은 제공자/대화/응답 ID로 저장한 검토 범위, 충족/미충족/미확인 개수, 종료 종류와 고정 오류 문구를 최신순으로 읽는다. 기록 50개씩 이전/최근 페이지를 이동하고 새로고침한다. 이 동작은 모델 호출이나 브라우저 작업을 재전송하지 않는다.

`응답 종료`는 완료 선언이 아니다. 별도 기록의 `verification=passed`이고 결과가 answer일 때만 **최종 검토 통과**로 표시한다. 과거 검토 이벤트는 당시의 기록이며 실행 전체 성공 배지가 아니다. 기록 없음, 보관 한도 제외, 저장 누락, 읽기 실패를 구분한다. 읽기 실패 시 남은 페이지에는 이전 조회 결과임을 표시한다.

기존 CX ActionButton/Icon, 진행 기록의 페이지 조회/응답 역전 방지, 브랜드 토큰을 재사용했다. 14px/22px 본문, 600 굵기의 핵심 상태, 접근성 이름과 툴팁을 유지한다. 별도 모달이나 상시 진단 버튼을 늘리지 않는다. 공통 AgentTrace의 선택 prop으로 연결해 다른 호스트에 저장소 의존성을 강제하지 않는다.

## 비교와 선택 근거

| 근거 | 확인한 계약 | 적용/비선택 |
| --- | --- | --- |
| [Claude 공식 확장 정적 분석](CLAUDE-HARNESS-STATIC-2026-09-26.md), 1.0.94 | 종료 신호, 승인 대기, 도구 오류를 분리한다 | 이미 검토한 원본 흐름을 근거로 상태를 구분. 번들/프롬프트 복사 없음. 공개 OSS로 간주하지 않음 |
| [OpenAI Agents tracing](https://openai.github.io/openai-agents-js/guides/tracing/) | 실행별 이벤트와 민감 데이터 통제. 브라우저에서는 기본 비활성 | 실행 단위 조회 패턴 적용. 외부 수집기/계정 추가 없이 로컬 idb 사용 |
| [OpenAI Agents spans.ts](https://github.com/openai/openai-agents-js/blob/fdaf0a66ca6e9d89498909ad7cf64745630e8afb/packages/agents-core/src/tracing/spans.ts), MIT | trace/span ID, 시작/종료와 error 필드를 분리하고 직렬화 시 private 필드를 제거 | 실제 소스의 분리 계약 참고. 기존 허용 값 sanitizer 유지. SDK 패키지 추가/코드 복사 없음 |
| [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage) | 사용자 프롬프트/응답/도구 내용의 수집을 구분하고 명시 설정으로 제어 | 누비는 내용 수집을 추가하지 않고 고정 상태/개수만 표시 |
| [Codex/OpenCode의 앞선 코드 대조](ACTION-RECOVERY-ADMISSION-2026-09-26.md) | 실제 처리 결과와 실패/대기 기록을 구분 | 기존 admission/복구 계약 유지. 진단 읽기를 복구 실행으로 전환하지 않음 |
| 기존 idb 8.0.3 (ISC), React/CX | MV3 로컬 영속화와 기존 페이지 UI | 실제 재사용. 외부 telemetry 라이브러리는 필요에 비해 인증/전송/의존성을 늘려 이번 범위에서 비채택 |

새 의존성은 없다. 서버 트레이싱, API별 지연 통계, worker 전체 재시작 복원은 구현하지 않았다. 최종 검토 통과 기록도 실서비스 저장 영수증이나 독립 정답 평가를 대체하지 않는다.

## 검증

`agent-diagnostic-view.test.mjs`는 응답 종료/사용자 대기/실패를 완료로 표시하지 않는지, 알 수 없는 값/임의 문자열을 노출하지 않는지 검사한다.

`agent-diagnostic-journal-browser.mjs`는 실제 Chrome/IndexedDB에서 410개 동시 기록, 400개 보관, 브라우저 재시작, 소유권, 삭제를 검증한다. 이번에 실제 App RPC 조회, 50개 페이지, 5개 종료 상태, 실패 원인, 조회 오류 복구, 새로고침의 비실행성, 누락/빈 기록, 320/360/1100px 서체와 키보드 검사를 추가했다. 진단 데이터는 합성이며 실계정 모델 호출이 아니다.

첫 UI 검사에서는 이미 초점이 있는 버튼에 다시 focus해 툴팁을 기다리는 시험 절차가 실패했다. Tab 이동 후 키보드 재진입하도록 고쳤다. 실패 로그는 `verification/diagnostic-ui-browser.log`에 보존한다.

첫 아이덴티티 gate에서는 기존 진행 기록 검사가 공유 CSS 클래스 두 개를 동시에 선택해 실패했다. 기존 기록과 새 진단을 구분하는 선택자로 고쳤다. 실패 보고서 `verification/pre-release-2026-09-26T12-04-51-472Z/report.json`은 그대로 보존했다.

최종 gate 결과는 아래에 기록한다.

## 남은 항목과 다음 순서

1. 수정된 후보의 실계정 네이버 과제에서 첫 계획 완료와 최종 결과를 다시 측정한다. 이전에 관찰한 실모델 실패가 이 UI 변경으로 해결됐다고 볼 수 없다.
2. NQ-02 실제 Qwen 8개 과제 × 3회, NQ-04 서버 저장/등록 영수증, NQ-07 Windows/Edge 실계정 설치/SSO, NQ-08 공식 WebArena 독립 평가는 외부 검증 조건이 남아 있다.
3. 브라우저 재시작 후 worker 문맥 전체 복원은 구현하지 않았다. 이번 영속 진단은 읽기 기록이며 실행 복원이나 자동 재실행이 아니다. 미확정 쓰기/취소를 보존하는 별도 설계가 필요하다.

외부 telemetry SDK, 전체 하네스 교체, 검색/에이전트 라이브러리 일괄 최신화는 미루어둔 필수 구현으로 재분류하지 않는다. 재현되는 결함과 현재 계약에 맞춰 도입을 판단한다.

두 번째 gate는 기존 feedback 검사의 저장소→화면 반영 대기 누락과 welcome의 240초 제한 초과로 실패했다 (`verification/pre-release-2026-09-26T12-07-41-015Z/report.json`). feedback은 주입한 verify_form 오류 단계가 실제 화면에 반영된 뒤 검사한다. welcome의 정지 원인은 접힌 `.agent-trace > ol`에도 유한 등장 애니메이션을 지정한 기존 CSS다. 실제 Chrome에서 닫힌 요소의 animationName이 deck-dialog-enter인 것을 `verification/diagnostic-motion-before.log`로 재현했다. 애니메이션은 `[open]`일 때만 적용하고 기록 없는 진행 중 응답에는 빈 패널을 생성하지 않는다.

## 최종 결과

- `npm run verify:identity`: **통과**. 단위 984개, 디자인 검사, 후보 빌드, 실제 Chrome UI 32종을 포함한 35단계.
- 보고서: `verification/pre-release-2026-09-26T12-15-35-331Z/report.json`. 검사 후 소스/테스트/공유 입력, dist, 후보 ZIP 해시를 다시 대조해 모두 일치했다.
- 모션 수정 후 welcome-browser는 12.0초, feedback-browser는 15.3초로 통과했다. 제한을 늘리거나 실패를 무시하지 않았다.
- 화면: `verification/agent-diagnostics-320.png`, `agent-diagnostics-360.png`, `agent-diagnostics-1100.png`. 320px와 1100px 캡처를 직접 검토하고 날짜 행과 중지 안내를 정리했다.
- 후보 ZIP SHA-256: `efdaa6e0465180c976048faf2aea27f59d6e0d9cff7e61848644e42169d14905`.
- 이 보고서는 selected UI gate다. 전체 핵심 baseline v7의 이번 소스 재검증, 실모델 완주, 실서비스 저장, Windows/Edge 실계정 평가로 계산하지 않는다. 이전 baseline의 해시는 이번 변경으로 달라졌다. 현재 범위는 `verification/diagnostic-ui-quality-status.txt`에도 남겼다.
- 릴리즈 ZIP/업로드/배포는 수행하지 않았다.

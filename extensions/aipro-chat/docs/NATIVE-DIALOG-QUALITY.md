> 이 문서는 자동 취소 경로의 이력이다. 현재 confirm/prompt 사용자 선택은 [후속 구현](NATIVE-DIALOG-APPROVAL.md)을 따른다.

# 브라우저 기본 확인창 품질 점검

2026-09-23. 실제 Chrome과 합성 페이지로 재현했다. 회사 사이트나 실제 Qwen 판단 성능을 검증한 결과는 아니다.

## 재현한 문제

`confirm()`이 뜨는 버튼을 누르면 기존 Playwright 경로가 확인창을 취소했지만 클릭 도구는 `ok: true`를 반환했다. 실제 페이지는 클릭 1회, 수락 0회였다. DOM 모달과 새 창 처리가 있어도 JavaScript 기본 확인창 처리는 별개다. 수정 전후 기록은 `verification/native-dialog-quality/baseline.json`과 `after.json`에 남겼다.

## 반영

- 작업에 연결한 Playwright context의 확인창 이벤트를 관찰한다. 유형과 취소 결과만 보관하고 메시지, 기본 입력값, 원시 오류는 읽거나 기록하지 않는다.
- `confirm`, `prompt`, `beforeunload`는 수락하지 않고 취소를 시도한다. 이전 기본 동작은 `beforeunload`를 수락했으므로 이 경우는 편집 중인 페이지를 보존하는 방향으로 바뀐다. 취소 성공과 불확실한 결과를 구분하되 둘 다 완료로 표시하지 않는다.
- 확인창 이후 같은 실행의 쓰기와 재클릭을 막는다. 호버가 확인창을 열면 뒤따를 클릭을 발행하지 않고, 본문 덧붙이기의 초점 변경이 확인창을 열면 뒤따를 텍스트 삽입을 막는다. 생성된 스크립트가 예외를 잡아도 호스트가 성공 반환과 후속 입력을 차단한다.
- 기존 질문 폼으로 바로 전환하고 사용자가 페이지에서 처리한 결과를 받는다. 최종 실행 승인 직후 발생한 확인창도 추가 추론 전에 같은 경로로 멈춘다. 질문 답변은 새 실행 승인으로 취급하지 않는다.
- 선택이 없는 `alert`는 취소 후 정상 진행하고 관찰 기록을 남긴다. 작업 종료 시 listener를 해제하며 일반 읽기에 debugger 연결을 추가하지 않는다.

취소는 이미 발생한 부작용의 롤백이 아니다. 사용자가 이어서 진행하면 기존 재개 흐름으로 최신 상태를 다시 확인한다. 확인창을 다시 열기 위해 원래 클릭을 자동 재실행하지 않는다.

## 방법론과 오픈소스

| 근거 | 반영 및 선택 |
| --- | --- |
| [Playwright Dialogs](https://playwright.dev/docs/dialogs) | listener가 없을 때의 자동 취소와 처리하지 않은 dialog의 동작 정지를 구분한다. 기존 Playwright CRX를 재사용한다. |
| [Microsoft Playwright MCP dialog 도구](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/backend/dialogs.ts) | Apache-2.0. 원래 클릭과 dialog 상태/처리를 분리하는 패턴을 적용했다. SDK 전체를 추가하거나 accept 기능을 그대로 이식하지 않았다. |
| [Playwright MCP 회귀 검사](https://github.com/microsoft/playwright/blob/main/tests/mcp/dialogs.spec.ts) | 별도 검사 클라이언트의 자동 취소가 제품 동작을 가리지 않도록 dialog listener를 명시한다. |
| [Anthropic Agent 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 도구의 성공 문구 대신 클릭 수, 수락 수, 보존된 입력과 질문 대기를 검사한다. 주요 흐름은 새 프로필로 반복한다. |
| [Playwright 파일 업로드](https://playwright.dev/docs/input#upload-files) | 다음 확장 후보다. 실제 사용자 첨부를 사이트 입력란/출처/승인에 연결하는 계약이 필요하며 이번 수정에 포함하지 않았다. |

새 runtime 의존성은 추가하지 않았다. 기존 Pi의 질문 대기와 Playwright 이벤트를 연결했다. 모델 프롬프트만으로 확인창 실패를 보완하지 않는다.

## 검증과 남은 범위

단위 검사는 오류/비밀값/기록 제한/정리와 추론 없는 질문 전환을 다룬다. Chrome 검사는 일반 클릭, prompt 예외를 삼키는 스크립트, 호버와 입력 초점, alert, 편집 페이지 이탈, 승인 후 확인창, 질문 새로고침을 다룬다. 질문은 기존 CX 컴포넌트와 토큰을 사용한다.

**이 기록 당시에는 중단 감지와 사용자 직접 처리 연결이었다.** 확인창을 유지하면서 승인 후 accept하거나 prompt 값을 입력하는 기능은 이 후속 작업 전에는 없었다. 이를 지원하려면 dialog 수명과 승인 만료, 원래 실행의 부작용, 새 창/종료 복구를 함께 묶어야 한다. 파일 업로드, OS 포커스 완전 격리, 실제 회사 계정/모델/Windows 검증도 이 수정으로 완료되지 않는다.

최종 검사 수와 후보 ZIP은 `verification/native-dialog-quality/RESULTS.md`를 따른다.

## 2026-09-25 대기열 경계 보완

전체 Chrome 검사에서 native dialog가 열렸지만 상태 조회가 그 도구 뒤에 줄을 서서 120초 확인 대기 종료 뒤에야 응답한 경합을 확인했다. 기존 `toolBusy`는 도구 실행이 시작될 때만 켜졌으므로 도구를 대기열에 넣은 직후 수신한 `GET_STATE`를 보호하지 못했다.

`serialTool`은 `RUN_TOOL`과 `APPLY_FILL`을 대기열에 넣기 전에 개수를 예약하고 성공·실패 후 개별 예약을 해제한다. 예약이 있는 동안 신뢰한 UI의 상태 조회만 기존 읽기 전용 경로로 처리한다. 평상시 상태 복구와 미신뢰 발신자 검사는 유지한다. 복수 작업 중 하나가 끝나도 다른 예약은 남으며 실행이나 승인을 재시도하지 않는다. 직접 호스트를 호출하는 native dialog 및 캡처 검사도 같은 scheduling helper를 사용한다.

`background-observer-queue.test.mjs`는 실제 runner 생성부, scheduling helper, 메시지 listener를 소스에서 읽어 실행한다. 도구 시작 전 조회 경합, 외부 호스트 경로, 미신뢰 발신자, 실패 후 복구와 복수 예약을 결정적으로 검사한다. native dialog request와 정책 회귀를 포함한 15개 단위 검사가 통과했다. 실제 Chrome 재검증은 해당 변경을 포함한 빌드에서 별도로 수행한다.

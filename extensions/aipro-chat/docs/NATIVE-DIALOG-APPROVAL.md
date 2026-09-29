# 실제 확인창의 사용자 선택

NQ-06. 이전 자동 취소만 가능한 경로에 살아 있는 `confirm`/`prompt`를 누비 질문 UI로 전달하는 경로를 추가했다. 같은 클릭과 모델 실행을 유지하며 추가 추론 없이 사용자의 명시적인 선택을 기다린다.

## 계약

- 확인창의 실제 문구와 사이트 origin을 CX `QuestionForm`에 일반 텍스트로 표시한다. confirm은 확인/취소만, prompt는 직접 입력/빈 값 확인/취소를 제공한다. 모델이 승인 답변을 대신 만들 수 없다.
- 답변은 요청/대화/로그인 시점/제공자/새 질문 ID에 묶이며 한 번만 소비한다. 실제 Dialog 객체와 활성 Page가 일치해야 수락한다. 다른 탭이나 새 확인창에 답변을 재사용하지 않는다.
- 확인창 문구와 prompt 입력은 worker/UI 메모리에만 둔다. 기본 입력값은 읽지 않고 local/session 저장소, 모델 영수증과 진단에 기록하지 않는다. session에는 UI 갱신용 무작위 revision만 저장한다. 페이지가 입력을 자체 표시하면 이후 일반 페이지 관찰의 대상이 될 수 있다.
- 도구가 기다리는 직렬 대기열과 사용자 답변 수신을 분리한다. UI를 다시 열어도 같은 worker의 살아 있는 확인창을 표시한다. worker/Chrome 종료 뒤 확인창을 재생성하거나 원래 클릭을 재전송하지 않는다.
- 2분 만료, 실행 중지, 연결 변경, 사용자 취소는 수락하지 않는다. `beforeunload`는 기존 초안 보호 취소를 유지한다. alert는 선택 없이 닫는다. 호스트 콜백 없는 직접 도구 검사는 기존 자동 취소 동작을 유지한다.
- 사용자가 기다리는 동안 원래 Playwright 클릭의 제한 시간이 끝나도 답변은 해당 확인창에만 전달한다. 원래 동작은 **미확정**으로 반환하고 실제 결과 검증을 요구한다. 사용자 선택을 전체 업무 완료로 바꾸지 않는다.

## 검증

`native-dialog-request.test.mjs`: 중복/다른 실행/대화/로그인 답변 거부, 만료/중지, prompt 원문 비저장, 활성 페이지 변경 거부.

`native-dialog-approval-browser.mjs`: 실제 confirm을 연 채 UI 재진입, 일반 클릭 timeout보다 긴 8초 대기 후 승인, 원래 클릭 1회 유지, prompt 한 번 전달, 취소 후 추가 쓰기 차단, local/session 원문 부재. 360px 화면 스크린샷을 확인했고 가로 넘침이 없다. `verification/native-dialog-approval/confirm.png`, `prompt.png`.

기존 `native-dialog-browser.mjs`는 호버/포커스 중 확인창, 스크립트의 오류 숨김, alert, beforeunload, 기존 최종 버튼 승인 뒤 새 확인창을 유지한다. 실제 채팅 두 경로는 새 확인 UI의 취소를 거쳐 기존 질문으로 전환하는 것을 검사한다. 합성 Qwen 응답이며 실제 모델 정확도 검사가 아니다.

## 근거

[Playwright Dialogs](https://playwright.dev/docs/dialogs)의 명시적인 accept/dismiss 계약과 기존 Playwright 런타임을 사용했다. 단순히 dialog를 보류하면 원래 도구 호출도 기다리므로, 기존 도구 큐 밖의 사용자 응답 경로가 필요하다. 새로운 대화 프레임워크 없이 CX `QuestionForm`/`InteractionSurface`를 재사용했다. 원문을 모델에 보내 해석시키거나 클릭을 다시 실행해 확인창을 재현하는 방식은 선택하지 않았다.

이 기능은 살아 있는 브라우저 확인창의 일회 선택이다. 재시작 후 확인창 복원이나 실제 서버 저장 완료 기능은 아니다.

## 2026-09-25 경계 재검토

NQ-06a/06b에서 재현한 두 결함을 수정했다.

1. 최근 8개 영수증으로 동작 허용 여부를 계산해, 취소/미응답 확인창 기록이 후속 alert에 밀리면 차단이 해제되었다. 실행의 `pendingDecisions`와 `declined` 상태를 영수증 순환과 분리했다. 실제 수락이 끝나야 대기 상태가 해제되며 취소/실패 상태는 같은 실행 동안 유지한다. 최근 영수증은 계속 8개로 제한한다.
2. prompt 응답을 OR 조건으로 처리해 `{optionId: 'cancel', text: '...'}`도 수락했고, accept 옵션이 입력 자료형/길이 검사를 우회했다. 선택 응답과 직접 입력 응답을 상호 배타적으로 검사한다. 잘못된 응답은 질문을 소비하지 않고, 이후 정상 답변을 같은 질문에 전달한다. 문자열 제한은 기존 UI와 같은 UTF-16 4,000자로 유지한다.

재현 단위 검사 3개는 수정 전 실패했고 수정 후 통과했다. 실제 Chrome 검사에는 취소 뒤 연속 alert 12회와 신선한 관찰 뒤 재클릭 차단, 혼합/초과 길이/숫자 prompt 응답 거부와 이후 정상 답변을 추가했다. 최신 통합 검사 결과는 [통합 품질 목록](BROWSER-QUALITY-BACKLOG.md)에 기록한다.

### 방법론/오픈소스 검토

- [Playwright Dialogs](https://playwright.dev/docs/dialogs)의 실제 Dialog 수락/취소와 이벤트 완료 계약을 재확인했다. 설치된 `@playwright-repl/playwright-crx` 1.21.4의 `Dialog.accept/dismiss`와 처리 상태 코드를 확인했고 기존 Apache-2.0 런타임을 계속 사용한다. 별도 브라우저 제어 엔진으로 교체할 근거는 없다.
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)의 실행별 상태와 장기 기록 구분을 참고했다. 이번 적용은 로컬 실행 상태와 제한된 진단 기록을 분리하는 패턴이다. 새 LangGraph 서버/저장소나 확인창 재시작 복원을 도입한 것은 아니다.
- [Zod의 strict object/union](https://zod.dev/api)의 대안별 입력 검증을 검토하고 설치된 MIT Zod 4.4.3의 union 검사 소스를 확인했다. 이 모듈은 빌드 때 그대로 복사되는 브라우저 ESM이므로 bare import와 별도 번들을 추가하는 대신 두 작은 응답 형태를 직접 엄격히 검사했다. 기존 Zod 사용처와 버전은 유지한다.
- 정상 UI가 혼합 응답을 생성하는 사례는 발견하지 않았다. NQ-06b는 worker 메시지 경계의 재현 결함이다. 의미 검색 품질/실모델 정확도 향상 수치로 환산하지 않는다.

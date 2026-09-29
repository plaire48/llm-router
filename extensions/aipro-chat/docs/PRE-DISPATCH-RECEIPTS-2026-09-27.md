# 실행 전 실패 영수증의 검증 의무

## 실제 평가와 독립 재현

`verification/naver-sso-luna-2026-09-27T08-59-31-237Z.json`의 E-04는 PDF에서 `press_key`가 `browser_stale`로 실패한 뒤 계획 완료가 `verification_required`로 막혔다. 평가 진단에는 `actionIssued`가 없어 실제 실패가 실행 전이었다고 단정하지 않는다.

별도 하네스 재현에서는 `press_key`에 `{error: 'browser_stale', actionIssued: false}`를 반환해도 새 검증 의무가 생겼다. 기존 구현은 실행하지 않았다는 영수증 예외를 스크립트에만 적용했다.

## 반영 범위

- `agent-harness.js`의 `hasReliableUnissuedReceipt`를 실행 중 하네스와 `context-state.js`의 영속 검증 상태가 함께 사용한다.
- `click_element`, `press_key`, `drag_element`, `fill_form`, `select_option`은 명시적인 `actionIssued === false`만 새 검증 의무에서 제외한다. 기존 스크립트 계약도 유지한다.
- 이전 미검증 작업은 그대로 남는다. 새 도구 시작 전에 보관한 검증 상태를 종료 후 복원하며, 실패 도구를 성공이나 완료로 표시하지 않는다.
- `true`, 누락, `null`, 숫자 또는 문자열 값은 이 예외가 아니다. 이 영수증은 페이지나 서버의 불변을 증명하지 않는다. 클릭 전 hover/scroll 또는 키 입력 전 focus가 이미 수행되었을 수 있다.

## 반환 계약 검토

`browser-agent.js`의 `clickObserved`는 실제 click 호출 전, `browser-keyboard.js`의 `keyboardInput`은 실제 key 호출 전에 `onIssued`를 호출한다. `browser-drag.js`는 mouse down 전 발행 상태를 기록한다. `fill_form`은 각 필드 작업 전, `select_option`은 선택 실행 전 보수적으로 발행 상태를 기록한다. 따라서 이 경로에서 일부 입력 뒤 오류가 발생한 경우 발행 여부가 false로 되돌아가지 않는다.

### 별도 발견: 좌표 클릭 오류 영수증

수정 전 `browser-agent.js`의 `click_at`은 `task.page.mouse.click()` 호출 전에 지역 변수 `issued`를 true로 바꾸지 않았다. 클릭 성공 뒤에만 `action = {ok: true, actionIssued: true}`를 만들어 클릭 또는 이후 `followPopup`/`settle`/관찰 예외가 false인 오류 영수증으로 반환될 수 있었다.

실제 mouse 호출 직전 콜백에서 `issued = true`와 `actionRevision` 증가를 수행하도록 소스를 수정했다. 기존 실제 모듈 VM fixture로 준비 실패와 전송 이후 예외를 분리해 검증했다. 기존 실행 영수증 패턴을 재사용하는 국소 수정이므로 새 의존성을 추가하지 않았다. 실사이트 부분 클릭을 재현한 결과는 아니며, 하네스는 여전히 `click_at`을 예외에 포함하지 않아 false만으로 검증 의무를 해제하지 않는다.

## 검증

`node --test tests/agent-harness.test.mjs`: 20/20 통과. 실행 전 실패, 이전 pending/failed/passed 상태 보존, 저장소 JSON 왕복, 재개 검증 상태, 미확정 값, 좌표 클릭 예외 제외를 확인했다. 실제 E-04 성공, PDF 원문 열람, 실모델 완료율 개선은 아직 검증하지 않았다. 후보 빌드와 실행 중 평가를 변경하지 않았다.

`node --test tests/click-dispatch-boundary.test.mjs`: 6/6 통과. 추가한 좌표 클릭 검사에서는 screenshot/viewport/approval/pointer 준비 실패가 `actionIssued: false`와 revision 0을 유지했다. mouse 호출 실패와 이후 popup/settle/observe 실패는 `actionIssued: true`와 revision 1을 유지했고, 성공 경로도 확인했다. 실제 production 함수의 VM 실행이며 Chrome 전송은 fixture로 대체했다.

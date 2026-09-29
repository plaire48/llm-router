# 조직 정책 조회 지연과 시작 복구

## 확인한 문제

`capture-coverage-browser`에서 느린 이미지 응답을 보류한 페이지를 먼저 열었을 때 확장 준비가 약 180초 지연됐다. 진단 복사본에서 `boot`의 9개 초기화 중 `refreshBrowserPolicy()`만 미완료였으며 캡처, 첨부, 저널 IndexedDB 정리는 모두 끝났다. 브라우저 관찰 도구를 호출하기 전의 문제였다. 확장 준비를 먼저 기다린 대조 실행에서는 정책 준비가 2.5초, 전체 13개 검사가 약 11초에 끝났다.

## 근거와 적용

Chrome 공식 [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)는 저장소 작업이 비동기이며 완료까지 시간이 걸릴 수 있다고 명시한다. [managed storage 명세](https://developer.chrome.com/docs/extensions/reference/manifest/storage)에 따라 조직 정책의 읽기 전용 스키마와 관리자 제한을 유지한다. 문서는 이 환경에서 발생한 약 180초 지연의 원인을 규정하지 않으므로 페이지 로딩과 정책 초기화의 관계는 이번 실제 Chrome 대조 관찰로만 기록한다.

별도 의존성을 추가하지 않고 기존 Promise와 generation 비교로 다음을 적용했다.

- 초기 미확인, 새 조회 시작, 정책 변경, 조회 실패는 모두 자동화 차단 상태다. 이전의 허용 결과로 대체하지 않는다.
- UI와 시작 대기는 5초 이내에 정책 미확인 결과를 반환한다. 운영체제나 Chrome API 호출 자체가 취소됐다는 뜻은 아니다.
- 실제 managed API 호출은 최대 1개다. 동시 요청은 같은 호출과 대기를 공유하며 대기 만료 후 반복 조회도 새 호출을 쌓지 않는다.
- 늦게 도착한 결과는 현재 generation과 같은 경우만 적용한다. 정책 변경으로 무효화한 이전 결과는 허용 상태를 복구할 수 없다.
- 이전 API가 끝난 뒤 다음 명시 조회가 새 읽기를 시작한다. 자동 재시도나 허용 캐시 fallback은 없다.
- 미확인 상태에서 실제 도구는 `browser_policy_invalid`로 중단하고 기존 짧은 오류 문구를 사용한다. 명시적인 관리자 차단은 `browser_policy_blocked`로 구분한다.
- 정책 변경 이벤트는 조회를 즉시 무효화하고, 새 정책 응답을 기다리지 않고 실행 중인 주 에이전트와 하위 읽기, 브라우저 작업을 취소한다. 정책 미확인 오류는 스크립트 수정이나 다른 도구 재시도 안내로 바꾸지 않는다.

## 검증 범위

`tests/browser-policy.test.mjs`는 대기, 병렬 조회, 기한 만료, 늦은 정상 응답, 정책 변경 후 이전 응답 무효화, 실패와 스냅샷 독립성을 검사한다. 기존 반복 작업 단위 검사는 정책 조회 성공을 명시적으로 준비한다.

실제 `public/background.js` 정책 변경 listener를 실행하는 회귀로 미완료 정책 API와 대기 타이머보다 취소가 먼저 시작됨을 확인한다. `script-feedback.test.mjs`는 정책 미확인 분류와 우회 금지 안내가 도구 결과 및 trace까지 유지되는지 확인한다.

`tests/browser-policy-browser.mjs`는 정책 API 응답만 고정한 실제 Chrome에서 운영 부트와 UI, 실제 브라우저 도구, 늦은 응답 복구를 확인한다. 조직 정책 서버 실접속이나 실모델 성능 검사는 아니다. `capture-coverage-browser`는 실제 정책 준비를 기다린 뒤 지연 이미지를 열며 원래 13개 캡처·스크롤 조건과 한도를 유지한다.

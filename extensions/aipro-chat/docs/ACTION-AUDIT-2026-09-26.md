# 브라우저 관찰과 액션 품질 점검

2026-09-26. 첫 계획의 실제 대상이 관찰에서 누락되거나 숨은 대상으로 잘못 노출되는 두 경로를 수정했다. `browser-tools.js`라는 파일은 없으며 현재 실행기의 공통 관찰 소스는 `browser-dom.js`다. 이번 변경은 주 실행기의 계획이나 승인 경계를 확대하지 않는다.

| 재현한 문제 | 반영 | 실제 확인 |
|---|---|---|
| 닫힌 `details` 안의 기록 5,100개가 기본 5,000노드 예산을 소비해 뒤의 검색 입력과 버튼을 모두 누락 | 닫힌 영역은 첫 `summary`만 순회하고 숨은 하위 요소를 생략 범위에 기록. 매 관찰마다 현재 열림 상태 재확인 | 변경 전 실제 Chrome에서 입력 누락 assertion 실패. 변경 후 같은 입력과 버튼 관찰, 20개 미만의 노드 검사. 펼친 뒤 본문과 실제 부분 범위 복원 |
| `visibility:collapse`인 표 행의 버튼을 관찰기에서 가시 대상으로 간주 | 역할/이름 관찰과 실행 직전 검사에서 collapse를 hidden으로 처리 | 실제 Chrome에서 ref 미노출. 정상 Playwright 클릭은 실패하며 이벤트 0회 |

## 검토한 공식 BP와 소스

- [Playwright actionability](https://playwright.dev/docs/actionability): 클릭 전에 가시성, 안정성, 이벤트 수신, 활성 상태를 검사한다. 요청한 입력을 발행한 사실과 실제 결과 검증은 별개다. 기존 `force:false`, 노드 식별, 쓰기 영수증과 결과 검토를 유지했다.
- [Playwright domUtils 실제 소스](https://github.com/microsoft/playwright/blob/main/packages/injected/src/domUtils.ts): `checkVisibility`와 닫힌 details 처리, `visibility !== 'visible'` 검사를 확인했다. 이 가시성 분리 패턴을 기존 정적 관찰기에 적용했다. 대상 재선택이나 강제 입력으로 숨은 노드를 우회하지 않는다.
- 기존 번들 Playwright CRX, dom-accessibility-api와 정적 빌드 구조를 유지했다. 이 결함은 관찰 순회/가시성 경계 문제이므로 새 에이전트 또는 별도 자동화 패키지를 추가하지 않았다. Playwright는 Apache-2.0이며 구현 소스를 복사하지 않고 확인한 패턴을 현재 코드에 반영했다.

## 검증 범위

- `tests/browser-dom-actionability-browser.mjs`: 새 실제 Chromium DOM 회귀 3개 통과.
- `tests/browser-editor.test.mjs`, `browser-recovery.test.mjs`, `script-feedback.test.mjs`, `browser-keyboard.test.mjs`: 관련 단위 23개 통과.
- 후보 빌드 통과. 기존 번들 크기 경고는 남아 있다.
- `tests/page-information-browser.mjs` 및 `tests/script-recovery-browser.mjs`: 격리된 확장의 실제 Chrome 회귀 통과. 중복 이름/입력 제약/표/민감 정보와 정상 복구의 신뢰된 입력 이벤트, 재로딩, 반복 실패 중 기존 쓰기 미재전송을 확인했다.

이는 합성 문서와 합성 모델을 사용한 실제 Chrome 검증이다. Google/네이버 실서비스나 실제 Qwen/ChatGPT의 과제 완료율과 지연 시간 개선은 이번 결과로 주장하지 않는다. 큰 열린 문서와 가상 목록은 기존 관찰 예산과 부분 범위를 유지하며 별도 읽기/스크롤로 확인해야 한다.

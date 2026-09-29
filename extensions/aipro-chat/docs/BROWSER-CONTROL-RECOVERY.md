# 토글 인식과 자동 복구

버튼 클릭과 상태 변경은 다르다. 누비는 현재 상태를 읽고 필요한 변화만 실행한 뒤 다시 검증한다. 이미지 입력이 가능한 Qwen에서는 DOM이 부족한 대상을 화면과 함께 판단한다.

개발 기준 모델은 **Qwen 3.8 27B**다. 신규 AI Pro 연결과 실모델 평가의 기본값은 `QWEN3.8-27B-FP8-256K`이며 기존 모델 선택은 유지한다. 다른 모델은 비교 대상으로 검증한다. 브라우저 코파일럿은 요구사항 파악, 관찰, 행동, 검증을 이어가며 필요한 사용자 정보는 질문 폼으로 받고 최종 트랜잭션은 HITL로 승인받는다.

## 현재 확장에 반영한 방식

- 네이티브 checkbox/radio, ARIA switch/checkbox, `aria-pressed` 버튼과 `aria-expanded`의 상태를 수집한다. `mixed`는 꺼짐으로 바꾸지 않는다.
- 스타일 때문에 숨겨진 체크박스는 실제로 연결된 보이는 label을 클릭 대상으로 사용한다. 다른 숨김 요소나 비활성 상태를 강제로 바꾸지 않는다.
- `setChecked(true/false)`와 `fill_form`의 boolean 값은 원하는 상태로 맞춘다. 이미 맞으면 클릭하지 않는다. 상태가 바뀌지 않으면 같은 클릭을 반복하지 않고 구체적인 복구 사유를 반환한다.
- `verify_page`의 `control_state`, `control_expanded`로 결과를 확인한다. `data-state`는 힌트로만 전달하며 색이나 클래스만으로 저장 성공을 판단하지 않는다.
- 현재 브라우저 캡처에는 정확한 ref, 이름, 상태와 화면 좌표 범위를 함께 전달한다. DOM 대상 오류가 발생하면 하네스가 새 캡처를 읽고 다음 모델 판단에 실제 이미지와 후보를 보낸다. 좌표는 정규화 값이 아닌 CSS 픽셀이다. 기존 승인과 최신 캡처 검증을 유지한다.

## 중단을 줄이는 방식

Pi가 성공한 도구 결과와 계획을 유지한 채 다음 모델 호출을 진행한다. 모델 HTTP 408/429/5xx, 네트워크 오류와 120초 동안 응답 데이터가 없는 요청은 `p-retry` 8.0.1의 지수 백오프로 최대 3회 재시도한다. 재시도는 추론 요청에만 적용한다. 이미 실행한 페이지 클릭, 입력, 발송은 재실행하지 않는다. 각 모델 요청의 사용량은 별도로 기록한다.

10분 전체 작업 제한을 10분 무활동 감시로 바꿨다. 모델 데이터와 도구 진행이 있으면 감시 시간을 갱신하며, 살아 있는 요청 소유자는 worker lease를 갱신한다. 다른 창은 소유권이나 만료된 요청을 되살릴 수 없다.

사용자 중지, 인증 거절, 최종 승인 대기는 자동 실행하지 않는다. 일시적 장애와 달리 연결이 계속 실패하면 보관한 작업을 남기고 오류를 표시한다. 브라우저가 확장 실행 자체를 종료한 상태에서 백그라운드 작업을 보장하는 기능은 아니다.

## 참고한 공식 자료와 오픈소스

| 자료 | 적용 |
| --- | --- |
| [Playwright 입력](https://playwright.dev/docs/input) | 원하는 체크 상태 지정, 자동 대기와 실제 포인터 입력 |
| [WAI-ARIA Switch](https://www.w3.org/WAI/ARIA/apg/patterns/switch/) | switch/checkbox/toggle의 역할과 checked/pressed 상태 구분 |
| [browser-use 요소 탐지](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/clickable_elements.py) | 의미 요소 외 이벤트와 시각적 후보를 관찰에 보완 |
| [Qwen 시각 에이전트](https://qwenlm.github.io/blog/qwen2.5-vl/) | 실제 이미지와 위치 정보를 함께 사용하는 시각 판단 |
| [p-retry](https://github.com/sindresorhus/p-retry) | 취소 신호와 지수 백오프를 지원하는 추론 연결 복구 |

2026-09-22 확인. Pi와 Playwright는 기존 확장 런타임을 사용한다. p-retry와 is-network-error는 MIT 라이선스로 번들에 포함했다. browser-use와 Qwen 자료의 패턴을 참고했으며 Python 서버를 설치하지 않는다. Qwen 자료는 접근 방식의 근거이고 사내 Qwen 모델의 정확도 측정 결과는 아니다.

# 요소 관찰과 키보드 입력 품질

2026-09-23. 브라우저 실행기는 기존 Pi와 Playwright를 유지하고, 잘못된 입력을 재현해 관찰 정보와 호스트 실행을 함께 수정했다. 기준 모델은 Qwen 3.8 27B이며 실모델 평가와 합성 응답 검사는 구분한다.

## 확인한 문제

입력란의 `focus` 이벤트가 다른 칸으로 초점을 옮기는 페이지에서 기존 `press("A")`는 다른 칸에 A를 입력한 뒤 성공으로 반환했다. 기존 후보를 새 Chrome 프로필에서 실행한 재현 기록은 `verification/before-keyboard-20260923/reproduction.log`에 있다. 또한 키 이벤트에 반응하는 자동완성에 `fill()`만 사용하면 값은 채워져도 후보 목록이 나타나지 않았다.

## 적용

1. 현재 초점, 편집 가능 여부, `aria-autocomplete`, 연결된 목록의 표시 상태와 실제 `aria-activedescendant`를 관찰 결과에 추가했다. 프레임과 열린 Shadow DOM에서도 각 문서의 정확한 관계를 읽는다. 숨겨진 후보 이름과 입력값을 자동 관찰에 추가하지 않는다.
2. `press`와 `press_key`는 동일한 노드를 검사하고 초점을 맞춘 뒤 실제 초점을 다시 확인한다. 다른 곳으로 옮겨졌으면 키를 보내지 않고 `script_focus`와 새 화면을 모델에 반환한다. HITL에서 승인한 키 입력도 같은 검사를 거치며 초점이 바뀌면 승인된 동작을 발행하지 않는다.
3. `pressSequentially`를 제한된 Playwright facade에 추가했다. 글자별 실제 브라우저 키 입력이며 매 글자 전 같은 노드의 연결, 보호 여부, 편집 상태와 초점을 확인한다. 입력 중 초점이 이동하면 남은 글자를 중단한다. 실행 기록은 이미 발행한 키가 있는지 구분하므로 같은 문자열을 자동 재전송하지 않는다.
4. 글자별 입력도 한 번의 판단 단계로 처리한다. 이어서 클릭하거나 키를 누르려는 스크립트는 잠시 멈추고 모델이 새 후보와 선택 상태를 확인한 후 다음 단계를 고른다. 기존 입력 묶음 작성과 최종 HITL은 유지한다.
5. 모델 안내는 일반 본문 `fill`, 긴 이어쓰기 `appendText`, 키 이벤트가 필요한 짧은 입력 `pressSequentially`, 관찰한 위젯 탐색 `press`를 구분한다. 링크 클릭 실패를 Enter나 강제 클릭으로 우회하지 않는다. 모든 요소가 관찰 예산에 들어오면 DOM 순서를 유지하고, 초점 이동만으로 복구의 실패 횟수를 초기화하지 않는다. 긴 페이지의 모달/초점 우선 선택과 명시적인 검색 순위는 유지한다.

초점 검사와 실제 키 발행은 별도 브라우저 명령이다. 그 사이의 모든 외부 변화를 원자적으로 막는 보장은 없으므로 실제 입력 결과의 `verify_page` 검사를 계속 요구한다. 글자별 입력은 최대 512자, 선택적 지연 0–50ms이며 개행/Tab/제어문자를 허용하지 않는다. 큰 본문은 기존 빠른 입력 방식을 쓴다. Unicode 입력은 검사하지만 운영체제 IME 조합 전체를 재현하는 기능은 아니다.

## BP와 오픈소스 판단

| 근거 | 실제 확인과 적용 판단 |
| --- | --- |
| [Playwright 입력](https://playwright.dev/docs/input#type-characters), [actionability](https://playwright.dev/docs/actionability) | 일반 입력은 fill, 별도 키 처리가 있는 경우에만 글자별 입력을 사용한다. press/type에는 클릭과 같은 actionability 검사가 없으므로 누비 호스트가 초점을 확인한다. 기존 Apache-2.0 Playwright 런타임을 재사용했다. |
| [WAI-ARIA Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) | DOM 초점과 목록의 활성 항목은 다를 수 있다. controls/expanded/activedescendant와 실제 후보를 함께 전달한다. 역할만 보고 임의 키 조합을 연속 실행하지 않는다. |
| [Stagehand 실행기](https://github.com/browserbase/stagehand/blob/0721ee22d8cff5358075bf5130217d487e7b58f0/packages/extension/handlers/handlerUtils/actHandlerUtils.ts) | 현재 main의 extension 구현과 MIT 라이선스를 확인했다. fill/type/press/select/hover를 분리하는 패턴을 참고했다. 기존 누비 승인/문서 결합/취소 경로를 다른 실행기로 교체하는 비용에 비해 이번 결함의 이점이 확인되지 않아 런타임은 추가하지 않았다. |
| [Browser Use 요소 탐지](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/browser_use/dom/serializer/clickable_elements.py) | 현재 main과 MIT 라이선스를 확인했다. 의미, 상태와 키보드 단서를 함께 보는 접근을 참고했다. class 이름이나 아이콘 크기만으로 클릭 대상을 확대하는 휴리스틱은 오인 가능성이 있어 그대로 이식하지 않았다. Python 런타임도 추가하지 않았다. |

외부 구현 코드를 복사하지 않았으며 새 라이브러리 의존성은 없다. 현행 소스에서 필요한 패턴을 검토한 결정이며, 인기나 특정 모델의 성공률을 비교 측정한 결과는 아니다. 입력 방식 안내는 기존 도구 설명에 포함하고 오류 후 안내는 기존 첫 system 메시지에 합쳐 Qwen의 단일 system 계약을 유지한다.

## 검증 범위

`keyboard-interaction-browser`는 실제 Chrome 확장에서 다음을 확인한다.

- 다른 입력란으로 초점이 바뀌면 키 발행 0회
- 일반 fill과 키 이벤트 기반 자동완성의 차이
- 글자별 입력 뒤 모델 재판단, ArrowDown의 활성 후보, Enter 선택과 실제 값 검증
- 입력 중 초점이 보호 필드로 이동하면 남은 글자 중단
- 열린 Shadow DOM, iframe, 한글, 읽기 전용, 최종 승인 유지
- Pi와 Qwen 형식의 합성 응답이 오류/관찰을 받고 다음 행동을 수정하는 전체 채팅 흐름

관련 링크, 호버, 토글, 리치 편집기, 팝업과 작업 창 회귀도 함께 실행한다. 이 환경에는 `NUBI_EVAL_TOKEN`이 없어 실제 Qwen 정확도 개선 수치는 산출하지 않는다. 회사 페이지와 실모델의 종단간 성공률은 별도 검증 대상이다. 실행 기록과 후보 해시는 `verification/pre-release-*/report.json` 및 이번 입력 품질 검증 기록에 남긴다.

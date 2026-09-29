# 링크 클릭과 호버 메뉴

## 확인한 문제

2026-09-23 실제 Chrome의 합성 페이지로 재현했다. 사용자 사내 페이지 자체를 재현했다는 뜻은 아니다.

- 여러 줄 `<a href>`에서 첫 줄만 가려져도 기본 클릭 지점을 계속 사용해 `script_obscured`로 종료됐다. 둘째 줄은 실제 클릭 가능한 상태였다.
- `onmouseenter`만 가진 링크는 관찰 대상에서 빠졌다.
- `aria-controls`로 연결된 메뉴가 늦게 열리면 기존 250ms 정리 대기 후에도 메뉴 없이 관찰 결과가 반환됐다.

수정 전 근거는 `verification/hover-links-before.json`이다. 일반 제목 링크의 클릭은 원래도 성공했다. 자동으로 Enter를 누르는 실행기 fallback은 없었다. 모델이 키보드 도구를 선택할 수 있었으므로, 도구/시스템 안내에 클릭 실패를 Enter로 우회하지 않는 기준을 추가했다. 이 안내만으로 모든 실모델 선택을 보장하지 않는다.

## 처리 방식

1. 최신 DOM 관찰의 정확한 노드를 사용한다. `mouseenter/mouseover/pointerenter/pointerover`와 팝업 단서를 함께 제공한다.
2. 스크롤 후 각 줄의 실제 영역을 확인한다. 현재 hit test가 원래 노드에 도달하는 지점을 element-relative 좌표로 Playwright에 전달한다.
3. 클릭 전 호버로 변한 배치도 다시 확인한다. `force:false`, Playwright의 안정성/가림 검사는 유지한다. DOM click, 주소 재구성, Enter로 대체하지 않는다.
4. 명시적인 호버는 같은 포인터 경로를 사용한다. 호버 전 보이는 팝업을 로컬 JSHandle로 기록하고, `aria-controls/aria-owns` 대상, `aria-describedby` 툴팁 또는 새로 나타난 메뉴/목록/대화상자/popover를 최대 1.5초 동안 확인한다. 50ms 간격으로 두 번 보이는지 확인한 뒤 다시 관찰한다. 기존의 무관한 메뉴는 새 메뉴로 세지 않는다. 시간 만료나 팝업 출현 자체는 작업 완료의 증거가 아니다.
5. 최신 화면을 모델에 반환하고 새 메뉴 항목을 선택한다. 스크립트 안의 호버 다음 행동도 기존 체크포인트에서 멈추므로 나타날 메뉴를 미리 추측해 연속 클릭하지 않는다.

스크립트 호버도 실행 기록과 이전 캡처 무효화에 포함한다. 새 라이브러리나 외부 실행기를 추가하지 않았다. 사용자 입력과 최종 거래의 HITL은 기존대로 유지한다.

## 공식 사례와 선택

| 자료 | 적용/비선택 판단 |
| --- | --- |
| [Playwright actionability](https://playwright.dev/docs/actionability)와 [마우스 동작](https://playwright.dev/docs/input) | 기존 Apache-2.0 Playwright CRX를 계속 사용한다. 실제 입력, 가시성, 안정성, 이벤트 수신 검사를 유지하고 정확한 지점 선택을 보완했다. |
| [Playwright 실제 클릭 지점 구현](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/dom.ts) | 기본 quad 중심과 element-relative position 처리 방식을 확인했다. 브라우저 구현을 복제하지 않고 공개 position 옵션을 사용한다. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | 최신 snapshot의 정확한 대상에 hover/click하고 다시 관찰하는 도구 분리를 참고했다. 확장 단독 실행을 유지하므로 별도 MCP 서버는 넣지 않았다. |
| [browser-use 대상 탐색](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/serializer/clickable_elements.py) | 역할, 이벤트, 스타일 단서를 합치는 패턴을 참고했다. Python 런타임과 모든 a 태그를 대상으로 보는 광범위한 규칙을 그대로 가져오지는 않았다. |
| [Stagehand observe](https://docs.stagehand.dev/v3/basics/observe) | 관찰한 action 후보의 방법을 확인한 뒤 실행하는 패턴을 적용했다. 동적으로 나타나는 메뉴에는 관찰을 한 번만 하고 묶어서 실행하는 방식을 사용하지 않는다. 별도 하네스로 교체할 근거는 확인되지 않았다. |
| [WAI-ARIA 툴팁 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) | 지연 표시와 `aria-describedby` 연결을 참고해 툴팁도 호버 후 재관찰 대상에 포함했다. DOM 정보가 부족할 때 성공을 추정하지 않는다. |

이는 사용자 요구와 MV3 확장 환경에 맞춘 선택이다. 라이브러리 간 정확도나 Qwen 성능 우위를 측정한 비교가 아니다.

## 검증과 제한

`hover-links-browser`는 제목 링크, 부분 가림의 여러 줄 링크, ref/locator/의미 도구의 호버 메뉴, 지연 메뉴, 스크립트의 단계 분리와 완전 가림을 실제 Chrome에서 검사한다. 키 이벤트가 없고 실제 trusted click이 한 번 발생했는지 확인한다. 기존 링크, 포인터, 토글, 전용 창, 승인 회귀와 함께 반복한다.

의미/이벤트/스타일 단서가 없는 위임 이벤트, 닫힌 shadow root, canvas 내부와 임의 지연 시간의 메뉴를 모두 해결하지는 않는다. 현재 보이는 증거가 부족하면 추가 관찰 또는 제공된 Qwen 캡처를 사용하고, 대상 의도가 모호하면 사용자에게 질문한다. 실제 Qwen의 도구 선택과 사내 페이지 성공률은 별도 검증 대상이다. 이전 전용 창 변경의 네이티브 팝업 초점 문제도 여전히 남아 있다.

## 2026-09-23 포털 메뉴 추가 검증

`aria-controls` 없이 700ms 뒤 document에 생성되는 포털 메뉴는 수정 전 관찰에서 누락됐다. 호버 전후 비교를 적용한 뒤 메뉴 항목을 반환했고, 450ms 뒤 나타나는 툴팁과 이미 열린 무관한 메뉴도 함께 검사했다. 호버 도중 클릭/키 입력이 추가되지 않았는지 확인했다. 기준 DOM 참조는 페이지 내부 JSHandle에만 두고 작업 후 해제하며 모델 컨텍스트나 영구 저장소에 보내지 않는다.

- 수정 전/후 재현: `verification/hover-portals/before.log`, `verification/hover-portals/after.log`.
- 검증 보고서: `verification/pre-release-2026-09-23T09-32-27-962Z/report.json`.
- 단위 검사 489개, 디자인 검사와 후보 빌드 통과. 호버/포인터/캡처/복구/분석/하위 에이전트/컨텍스트의 7개 Chrome 시나리오를 새 프로필로 3회씩, 총 21회 통과했다.
- Chrome 확장 내부의 기존 Pi/Playwright CRX를 보완했다. Windows 앱 제어, OS 마우스 조작, 네이티브 실행기는 추가하지 않았다. 실제 Qwen/사내 서비스 평가와 공개 릴리즈는 수행하지 않았다.

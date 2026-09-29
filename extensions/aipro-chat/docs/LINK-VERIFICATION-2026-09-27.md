# 검색 결과 링크 검증

## 실제 원인

[b4489e E01 감사](../verification/browser-30/b4489e-e01-cause-audit.json)는 검색 결과 페이지에서 서로 다른 결과 링크 두 개에 `url_is`를 사용한 반복 실패를 확인했다. 이 조건은 현재 페이지의 전체 URL을 검사한다. 검색 페이지에 머무르면서 박물관과 다른 사이트의 주소가 동시에 현재 URL과 같을 수는 없다.

본문 문자열 검사는 통과했지만 URL 조건은 `url_origin_mismatch`를 반복했다. 최종적으로 기술적인 검증 실패를 사용자 의도 부족으로 취급해 이미 명확한 요구를 다시 물었다. 0/3, 최종 답변 없음, 모델46회와362,168ms이므로 실패다. 범위 감사 두 번의 unknown은 형식 오류라고 단정할 수 없다.

## 벤치마킹

| 근거 | 적용 판단 |
|---|---|
| [Anthropic: Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | 도구가 무엇을 검증하는지 구별하고 오류에 실행 가능한 교정 방향을 담는다. 같은 기술 오류를 사용자 질문으로 바꾸거나 무작정 반복하지 않는다. |
| [Playwright 요소 assertion](https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-have-attribute) | 현재 페이지의 URL과 실제 링크 요소의 목적지를 분리하고 최신 요소에서 다시 검증한다. |
| 기존 playwright-crx와 관찰 ref | 별도 브라우저 런타임을 추가하지 않고 현재 확장의 대상 바인딩과 호스트 내 정확한 URL 비교를 재사용한다. |

Playwright의 설계 패턴을 적용하며 `@playwright/test`를 제품에 추가하지 않는다. 기존 라이브러리와 관찰 체계를 재사용한다. Claude 상용 확장 코드를 복사하지 않는다.

## 변경 범위

`verify_page`에 관찰한 링크 ref에 한정된 `link_destination` 조건을 추가한다. 현재 페이지 주소 확인은 `url_is`로 유지한다. 링크 목적지는 실제 href를 호스트 내부에서 전체 URL과 비교한다. 링크를 클릭하거나 페이지를 이동하지 않는다.

표시용 주소는 일부 쿼리와 fragment가 가려질 수 있으므로 복원하거나 동등하다고 추정하지 않는다. 정확한 주소를 모르면 다른 원문 근거를 확보해야 한다. URL 조건을 origin/path만으로 완화하지 않는다. 삭제/변경된 대상과 링크가 아닌 요소를 통과시키지 않으며 인증값을 진단에 남기지 않는다.

이 검사는 광고 제외, 결과 순위, 기사 원문의 진실성 또는 최종 답변 전달을 자동으로 증명하지 않는다. 기술적 검증 경로 하나를 보완하는 변경이며 기존 독립 채점은 유지한다.

## 검증 상태

관련82개 소스 검사가 통과했다. 실제 Chrome 회귀는 서로 다른 두 링크 목적지, 현재 페이지 URL과의 구별, 비밀 쿼리를 출력하지 않는 불일치 판정, 링크 변경/삭제/비링크 거부, 클릭0회와 페이지 미이동을 확인했다. [Chrome 기록](../verification/browser-30/link-destination-browser.json)을 보존했다.

실측을 마친 b4489e 재시험에는 반영하지 않았다. 통합 검사와 후속 실측은 후보 해시를 구분해 기록한다.

후속 a83bc160 후보의 통합 검사에서 단위1,189개, 디자인/빌드, 선택 Chrome23종이 모두 통과했다. [통합 결과](../verification/pre-release-2026-09-27T12-45-44-857Z/report.json)와 [실측/후속 변경의 구분](MEASURED-IMPROVEMENTS-2026-09-27.md)을 따른다. 새 후보의 실제 모델 개선 효과는 미측정이다.

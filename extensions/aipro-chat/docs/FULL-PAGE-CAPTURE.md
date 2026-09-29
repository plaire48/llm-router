# 전체 페이지 캡처

2026-09-23. 전체 캡처를 요청해도 현재 viewport만 촬영하던 문제를 수정했다.

후속 개선은 [캡처 범위와 구간 이동](./CAPTURE-COVERAGE-QUALITY.md)을 따른다. 내부 영역의 실행 참조, 겹치는 구간 이동, 실제 이동 검증과 로딩/실패 이미지 구분을 추가했다. 아래 ZIP과 검증 기록은 최초 전체 캡처 후보의 이력이다.

## 기본 동작 개선 (2026-09-24)

전체 캡처는 있었지만 기본 호출이 viewport여서 아래쪽을 빠뜨리는 경로가 남아 있었다. 이제 일반 도구와 스크립트 모두 기본적으로 렌더링된 전체 문서를 모델과 채팅 첨부에 전달한다. [Playwright 공식 screenshot](https://playwright.dev/docs/screenshots)의 기존 `fullPage` 구현을 재사용하며 새 엔진이나 권한은 추가하지 않는다.

문서 높이가 viewport 두 배를 넘거나 가로로 넘치면 `coverage.detailRecommended`와 구간 읽기 지침을 준다. 이는 누비의 보수적인 가독성 힌트이며 실제 모델의 해상도나 정확도 측정값은 아니다. 긴 이미지는 모델 측에서 축소될 수 있어 DOM 텍스트와 필요한 구간의 viewport 캡처를 병행한다. 자동 전체 스크롤/숨은 영역 펼치기는 하지 않는다. 기존 스크롤 도구는 각 이동 결과를 모델이 확인하고 다음 구간을 선택한다.

한도 초과 시 작은 이미지로 몰래 대체하지 않고 구간 캡처 복구 지침을 반환한다. 전체 이미지와 이전 viewport 좌표의 클릭 거절은 유지한다.

## 변경

- `capture_page({full_page:true})`와 `browser.screenshot({fullPage:true})`는 현재 렌더링된 전체 문서 PNG를 만든다. 2026-09-24부터 기본값도 전체 문서다. `full_page:false` / `fullPage:false`로 좌표 클릭과 세부 확인용 viewport를 명시한다.
- 캡처 전후 URL/문서 크기/viewport/스크롤을 대조하고, PNG의 실제 크기가 요청한 범위와 맞는지 확인한다. 크기가 다르거나 캡처 중 페이지가 변하면 전체 캡처 성공으로 표시하지 않는다.
- 전체 이미지에는 좌표 클릭 대상을 제공하지 않는다. 이전 viewport 좌표도 무효화한다. 클릭에는 fresh semantic ref 또는 스크롤 후 새 viewport 캡처가 필요하다.
- 기존 비밀 입력 마스크, IndexedDB 이미지 보관, 정확한 실행 단계 연결, 미리보기와 원본 PNG 다운로드를 유지한다. 이미지 출처에는 URL의 query/fragment를 저장하지 않는다.
- 전체 캡처 확대는 폭 맞춤과 세로 스크롤을 기본으로 한다. 기존 CX 모달, 원본 보기, 아이콘 다운로드와 키보드 조작을 재사용한다.

## 범위

전체 문서 캡처가 내부 스크롤 영역, 접힌 패널, 가상 목록의 미생성 행, 아직 불러오지 않은 이미지를 모두 포함하는 것은 아니다. 도구 안내에서 이 차이를 명시하며, 기존 `browser_snapshot`/`scroll_page(ref)`로 해당 영역을 관찰하고 필요한 구간을 촬영하게 한다. 사이트의 모든 숨겨진 데이터를 자동으로 읽는 기능은 아니다.

이미지는 한 변 32,768px, 32Mi pixels, 기존 base64 6,000,000자 이내다. 초과하면 `capture_too_large`와 구간별 캡처 지침을 반환한다. 같은 큰 캡처를 반복하거나 작은 이미지로 몰래 바꾸어 전체라고 표시하지 않는다. 외부 앱/데스크톱 권한은 추가하지 않았다.

## 선택 근거

[Playwright 전체 페이지 screenshot](https://playwright.dev/docs/screenshots)의 `fullPage`를 사용한다. 이미 고정된 `@playwright-repl/playwright-crx` 1.21.4에 포함되어 있어 새 캡처 라이브러리나 직접 이미지 이어 붙이기를 추가하지 않았다. 번들 screenshotter의 문서 크기 계산과 대조했다. [Trace Viewer](https://playwright.dev/docs/trace-viewer)의 행위와 이미지 구분도 따르되 정식 trace 기록을 구현했다고 표시하지 않는다.

## 검사

단위 검사에는 문서/viewport 크기 구분, 실제 PNG 크기 불일치, 크기 제한, 페이지 변동, 취소, 격리 VM의 옵션 전달, 첨부 메타데이터를 포함한다. `full-page-captures-browser`는 실제 Chrome 확장에서 아래쪽 색상 표식, 비밀번호 마스크, 전체 이미지의 좌표 클릭 거절, 폭 맞춤, 원본 다운로드, 새로고침 후 보관을 검사한다. 기존 viewport 캡처와 모델 전환 회귀도 같은 후보에서 반복한다.

실행 결과는 `verification/pre-release-*/report.json`에서 대상 suite와 성공 여부를 확인한다. 브라우저 fixture는 합성 사이트와 제어된 모델 응답을 사용한다. Qwen 실계정, 실제 고객 UAT와 Office 이미지 삽입은 별도 검증 대상이다.

최종 [검증 기록](../verification/pre-release-2026-09-23T00-24-05-418Z/report.json): 단위 437개, 디자인 검사와 후보 빌드 통과. `captures-browser`, `full-page-captures-browser`, `vision-routing-browser`를 새 Chrome 프로필에서 각각 3회, 총 9회 통과했다. 1120×820 viewport 대비 1120×1823 전체 PNG의 아래쪽 표식을 확인했다. 소형/대형 모달, 실제 side panel, byte-for-byte 다운로드와 재시작 후 보관을 검사했다.

초기 검증 환경의 기본 브라우저 경로 부재는 설치된 Chrome for Testing으로 해결했다. 전체 캡처 fixture의 도구 결과 경로, 의도적 실패 이후 모델 응답 대기, 스크롤 반올림과 작은 화면의 스크롤 기대 조건을 수정했으며 이전 실패 로그도 보존했다. 좌표 거절은 UI 완료 시나리오와 분리해 동일한 native browser host에 호출하고 실제 클릭 0회와 `actionIssued:false`를 확인했다.

[설치 검토용 ZIP](../verification/full-page-captures/nubi-beta-1.0.0-full-page.zip), SHA-256: `1457d83ba4375ccb8a19e05d37b3537b5d567925e28f147070ee916f6424a073`. 자동 설치나 공개 배포는 하지 않았다.

검증 중 클릭 실패 후 자동 시각 복구도 기본 캡처를 호출하는 경로를 확인했다. 이 경로는 화면 내 클릭 위치를 찾아야 하므로 `full_page:false`를 명시한다. 초기 회귀의 토글 복구 실패를 보존하고 수정 후 같은 흐름을 재검증한다.

### 기본 전체 캡처 검증 결과

[최종 기록](../verification/pre-release-2026-09-23T15-32-54-707Z/report.json): 단위 498개, 디자인 검사와 빌드, 실제 Chrome 25회 회귀 통과. 기본 호출의 전체 PNG가 모델 입력에 전달되는 크기, 화면 아래쪽 픽셀, 첨부/다운로드/보관, 좌표 클릭 거절, viewport 복구, 내부 스크롤과 누비 탭 유지까지 확인했다. 모델 응답은 합성이며 실제 Qwen/회사 사이트의 완료율 검증은 별도다.

[검증용 ZIP](../verification/full-page-default/nubi-beta-1.0.0.zip) SHA-256: `b7b976d82fb98dd6ff176144fd6be712590514097e481bde189762de6df4dfb3`. GitHub 릴리스는 갱신하지 않았다.

# 페이지 정보로 판단하고 행동하기

누비는 요청에 필요한 근거를 찾고, 현재 노드에 한 단계 실행한 뒤 결과를 확인한다. 개요를 먼저 읽고 설명·표·이미지·저장 데이터로 범위를 좁힌다. 전체 페이지와 브라우저 데이터를 매번 대화에 복제하지 않는다.

## 정보 선택

| 판단할 내용 | 우선 근거 | 부족할 때 |
| --- | --- | --- |
| 어디를 클릭할지 | 현재 역할, 이름, 영역, 상태, 실제 ref | 설명으로 검색하거나 새 캡처의 시각 대상 확인 |
| 무엇을 입력할지 | 라벨, 도움말, 필수 여부, 길이·범위·패턴, 오류 설명 | 실제 위젯을 확인하고 사용자 선택이 필요하면 질문 |
| 표의 값이 무엇인지 | 캡션, 열 제목, 행과 셀의 순서, 병합 정보 | 해당 행의 키워드로 검색, 가상 목록은 스크롤 후 재관찰 |
| 화면 어디에 있는지 | viewport, 스크롤 범위, 컨트롤의 inViewport | 스크롤/호버 후 최신 관찰과 캡처 |
| 새 창이나 프레임인지 | 작업 소유 탭, 프레임 소유 요소, frameCoverage | 소유 탭을 조회하고 대상 창 선택 |
| 저장된 사이트 설정인지 | 허용된 도구의 storage 키 목록 | 필요한 키만 조회. 페이지 상태와 저장값을 구분 |
| 구현 코드의 근거인지 | 연결한 OpenWiki/프로젝트 도구 | 원문 경로와 줄을 확인. DOM에서 저장소 소스를 추측하지 않음 |

탭 전환, 시각 도구, 저장소, OpenWiki 연결, 독립 분석 및 검증 도구는 기존 경로를 사용한다. 이번 변경은 그 도구를 선택할 때 필요한 관찰과 안내를 보강한다. 관찰이 불완전하거나 후보가 여러 개면 추가 근거를 읽거나 질문하며, 등록·발송·배포는 기존 HITL을 유지한다.

## 적용한 변경

- **입력란 설명:** 설치된 `dom-accessibility-api@0.7.1`의 `computeAccessibleDescription`으로 `aria-describedby`, `aria-description`, `title`을 계산한다. 실제 maxlength/minlength/min/max/step/pattern과 연결된 오류 문구를 전달한다. MiniSearch는 라벨과 주변 영역에 이 설명을 함께 사용한다.
- **표 검색:** 기존 `minisearch@7.2.0`으로 표와 행을 검색한다. 맞는 행과 열 제목을 함께 반환한다. native table 및 ARIA table/grid/treegrid의 실제 행·셀 순서와 명시적인 row/column index, rowspan/colspan을 보존한다. 복잡한 병합을 임의의 평면 좌표나 스프레드시트 수식으로 변환하지 않는다.
- **관찰 예산:** script/style/template, 숨은 하위 트리와 SVG 내부 경로를 수집 한도 전에 제외한다. 기본 개요는 5,000개, 구체 검색은 16,000개 노드까지 확인한다. 검색 범위를 넓혀도 컨트롤 180개, 본문 16,000자와 프레임 16개의 출력 제한은 유지한다.
- **추가 정보 예산:** 입력 설명·조건은 프레임당 직렬화 6,000자, 표의 행 데이터는 7,000자 안에서 선택한다. 표는 최대 6개, 표별 8행, 행별 12셀이다. 긴 셀은 검색어 주변을 발췌하고 잘림을 표시한다. 설명이나 행이 제외되면 생략 정보를 반환한다.
- **화면과 범위:** 문서 언어와 로딩 상태, viewport/스크롤, 이미지·canvas·SVG·iframe 존재, 스크롤 영역을 제공한다. `inViewport`는 위치 힌트이며 가려지지 않았거나 클릭 가능하다는 보증이 아니다. 표의 선언된 전체 행 수와 실제 관찰한 행 수를 구분한다.
- **동일한 관찰:** 콘텐츠 스크립트와 Playwright는 같은 정적 번들 수집기를 사용한다. 일반 읽기로 debugger를 붙이지 않는다. 실제 입력은 기존 Playwright의 동작 검사와 정확한 ref를 사용하고 별도로 결과를 검증한다.

입력값은 일반 관찰에 넣지 않는다. 편집 요소나 인증값에 연결된 도움말은 제외하며, 허용된 필드의 값을 확인하는 기존 도구와는 구분한다. 페이지가 작성한 설명·표·오류는 신뢰하지 않는 참고 자료다. 새 권한, 쿠키/API 응답 전체 수집, 페이지 스크립트 실행, 다른 확장의 저장소 접근은 추가하지 않는다.

`frameCoverage.discovery=accessible_documents_only`는 Chrome이 접근을 허용한 문서 목록이다. 권한 없는 프레임까지 발견한 전체 목록이라고 해석하지 않는다. Playwright의 `attached_frames`와 구분한다. 닫힌 Shadow DOM, canvas 내부, 아직 로드하지 않은 가상 행, 노드/프레임 제한 밖은 읽었다고 주장하지 않는다.

## 오픈소스와 공식 사례의 선택

| 근거 | 채택 | 판단 |
| --- | --- | --- |
| [dom-accessibility-api](https://github.com/eps1lon/dom-accessibility-api), MIT | 실제 라이브러리의 설명 계산 추가 | 이미 확장에 번들된 표준 접근성 계산을 재사용. 자체 라벨 추측보다 역할/설명 관계를 일관되게 처리 |
| [MiniSearch](https://lucaong.github.io/minisearch/), MIT | 실제 검색 대상을 도움말과 표로 확대 | 브라우저에서 인덱스를 생성하고 폐기. 별도 서버나 임베딩 요청 불필요. 어휘 순위는 확률이나 권한이 아님 |
| [Browser Use serializer](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/browser_use/dom/serializer/serializer.py), MIT | 구조·가시성·스크롤 정보를 구분하는 패턴 | Python/CDP 전체 런타임은 MV3 배포와 맞지 않아 도입하지 않음. 숨긴 입력을 강제로 노출하는 예외는 채택하지 않음 |
| [Playwright locators](https://playwright.dev/docs/locators), [ARIA snapshots](https://playwright.dev/docs/aria-snapshots) | 기존 Playwright 실행과 의미 기반 관찰 유지 | 읽기 정보와 실제 동작 성공은 별개. 최신 ref, actionability, 실행 후 검증 유지 |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 개요와 필요한 근거의 단계적 조회 | 최소한의 유용한 문맥을 유지. 이번 구조의 적용 판단이며 특정 회사의 내부 구현을 복제했다는 뜻은 아님 |
| [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) | 기존 isolated world/documentId 경로 유지 | 권한이 있는 문서에서 정적 함수만 실행. 로컬 라우터/실행기 설치 추가 없음 |

## 검증

`tests/page-information-browser.mjs`는 실제 Chrome과 합성 사이트에서 확인한다.

1. 같은 이름의 입력란을 설명으로 구분하고 실제 조건 전달.
2. 25번째 데이터 행 검색 시 열 제목과 값의 관계 보존.
3. 가상 목록의 선언된 1,000행과 실제 1행 구분.
4. 입력값/민감 필드와 연결된 도움말 제외, Shadow DOM 설명 유지.
5. 병합 셀과 값이 생략된 편집 셀 표시.
6. 숨은 요소 5,500개 앞에서 관찰 한도가 소진되던 실패 수정.
7. debugger 없는 읽기 → 정확한 ref에 입력 → 별도 verify_page. 동명인 다른 입력란과 제출 버튼은 변경하지 않음.
8. 설명 예산, 노드 한도, 검색 범위 확장, 긴 셀의 발췌와 생략 표시.

이 검사는 실제 모델을 호출하지 않는다. Qwen 3.8 27B의 판단 정확도·토큰 비용·회사 사이트 성공률은 실모델 평가로 별도 확인해야 한다. 상세 실행 결과와 후보 해시는 `verification/page-information-2026-09-23/검증기록.md`에 기록한다.

## 모델 선택 화면

기존 CX `DetailPanel` 푸터에서 새로고침/연결 편집/로그아웃 아이콘을 오른쪽 아래로 정렬했다. 서버 수신/표시/전체/검색 개수 문구를 제거하고 모델 목록과 검색을 남겼다. 로딩·빈 결과·오류 안내와 연결 진단 데이터는 유지한다. 기존 HTML 색·서체·모션 토큰을 사용한다.

토스트는 화면 상단 중앙에 고정한다. 모달 전체의 transform이 fixed 토스트의 기준을 모달로 바꾸던 문제를 재현했다. 모달은 그림자 깊이를 애니메이션하고, 모델 탭 내용은 기존 이동 효과를 유지한다. 토스트는 접근성과 초점 처리를 위해 계속 활성 모달 안에 둔다. 320/360/1100px, 모달 진입 프레임, 키보드 닫기와 모션 감소 설정을 확인했다.

# 입력창 추가 메뉴와 진행 기록 가독성

## 반영

입력창의 파일 첨부, 현재 페이지 연결, 스킬 선택을 `+` 하나로 묶었다. 메뉴 안에서는 같은 기능 아이콘과 짧은 이름을 함께 표시한다. 등록된 프로젝트가 있는 경우 프로젝트 연결도 같은 메뉴에 표시한다. 모델 선택은 계속 입력창에서 바로 사용한다. 기존 파일 입력, 드래그/붙여넣기, 선택된 자료 표시, 스킬 편집과 계정/작업 중 비활성 조건을 유지한다.

계획 제목과 진행 기록의 계획 이름, 하위 작업 질문/완료 조건/다음 행동에도 기존 Markdown 렌더러를 적용했다. 공개 진행 설명의 한 줄 개행을 보존하고 목록 간격을 정리했다. 본문 14px/22px와 핵심 강조 600, 기존 블루와 배경을 유지한다. 사용자 원문이나 실행 결과를 임의로 줄이거나 완료 상태를 바꾸지 않는다.

## 방법론과 도입 판단

- [WAI-ARIA disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/): 일반 버튼을 펼쳐 제공하는 구조. 복잡한 ARIA menu 역할을 붙이지 않고 Tab/Enter/Space를 사용한다.
- [브라우저 Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using): top layer, 바깥 클릭과 Esc 닫기, invoker 관계와 키보드 복귀를 재사용했다. CSS anchor positioning으로 + 바로 위에 배치한다. 기존 최소 Chrome 125 범위에 있는 브라우저 기능이며 메뉴 전용 패키지를 추가하지 않았다.
- [react-markdown](https://github.com/remarkjs/react-markdown) 10.1.0 + remark-gfm 4.0.1: 이미 설치한 MIT 오픈소스를 재사용한다. React 요소로 렌더링하고 HTML은 건너뛰며 HTTP(S) 링크만 허용한다. 새 Markdown 파서나 raw HTML 플러그인은 필요하지 않다.
- 설치된 CX 0.5.4의 CxButton, ActionButton, Icon과 deck 의미 토큰을 재사용한다. 다른 호스트의 기본 AttachmentPicker/SkillPicker 표시는 변경하지 않고 브라우저 메뉴에서만 짧은 이름을 켠다.

## 검증

`tests/composer-add-browser.mjs`는 실제 후보 확장을 Chrome에서 실행한다. 320/360/1100px에서 메뉴 경계, Tab/Esc/바깥 클릭, 스킬 창 닫기 후 + 초점 복귀, 실제 file chooser의 문서 첨부, 새로고침 유지, 계획의 굵은 글자와 진행 기록의 목록/표/줄바꿈, 위험 링크와 HTML 제외를 검사한다. 모델 응답과 계정은 합성 상태다. 실모델 품질이나 릴리즈 배포 근거로 사용하지 않는다.

전체 UI 회귀는 `npm run verify:identity`로 실행하며 결과는 검증 보고서에 남긴다.

최종 결과: [identity 보고서](../verification/pre-release-2026-09-26T08-05-28-956Z/report.json). 단위 검사 941개, 디자인 검사, 후보 빌드와 선택한 Chrome UI 검사를 모두 통과했다. 최종 후보의 소스/테스트 해시와 빌드 해시가 검사 시작/종료 때 일치한다. 이전 실행은 기본 브라우저의 worker 시작 실패 및 중간 스타일 보완으로 종료했고, 품질 작업 목록의 검사명 계약도 바로잡아 최종 결과와 구분한다.

[320px 메뉴](../verification/composer-add-320.png), [1100px 메뉴](../verification/composer-add-1100.png), [진행 기록](../verification/composer-progress-360.png). 이 화면들은 합성 데이터로 실제 Chrome에서 캡처했다. 전체 실모델 하네스 완료율은 이번 UI 변경으로 재측정하지 않았고 릴리즈는 업로드하지 않았다.

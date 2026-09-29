# 브라우저 누비 아이덴티티와 가독성 후속 점검

기존 HTML의 글꼴, 크기, 색감, 공통 컴포넌트를 유지하고 실제 화면에서 발견한 차이를 보완했다. 새 디자인이나 패키지를 추가하지 않았다.

## 기준과 적용

기준 HTML: `/Users/ganadi/Downloads/agentfactorysdkdeck.html`  
SHA-256: `df9cfcc44f2f8d4ea14c6f137d0297c562ca506f8a0028df374c7f012d8715ac`

| 항목 | 확인한 차이 | 반영과 유지 검사 |
| --- | --- | --- |
| 일반 답변과 Wiki 강조 | 일반 Markdown 강조가 브라우저 기본 700을 사용 | 공통 600과 진한 블루. 320/360/1100px 계산 스타일 검사 |
| 위키 초안과 저장 상태 | 파일 크기용 12px 스타일을 상태에도 사용 | 상태는 로컬 Noto Sans KR 14/22px. 초안, 저장, 재열기 검사 |
| 진행 기록 조작 | 개별 아이콘 버튼에 공통 키보드 툴팁 누락 | CX ActionButton 재사용. 페이지 이동과 새로고침 유지, 툴팁 Escape가 읽는 기록을 닫지 않는지 검사 |
| 코드가 있는 모달 | 검사기가 코드도 일반 본문 폰트로만 판단 | 실제 코드 원문과 인라인 코드, 언어 표시를 구분. 잘못된 폰트/크기를 넣으면 검사가 거부하는지 확인 |
| 안내 문구 | 오류 옆 새로고침 버튼과 반복 안내 | 오류 결과만 남김. 대상/조건/승인/복구에 필요한 문구와 입력 이름은 보존 |

일반 본문과 상태는 14/22px, 모달 제목은 16/24px, 날짜/버전/파일 크기는 12/16px다. 코드 원문은 고정폭 13px/1.75를 유지한다. 아이콘의 이름과 툴팁은 남기고 모호한 행동이나 중요한 승인에는 짧은 텍스트를 사용한다. 상세 계약은 [시각 기준](VISUAL-STANDARD.md)을 따른다.

## 방법론과 라이브러리 판단

- 설치된 CX 0.5.4의 ActionButton, Icon, 공통 모달과 로컬 Noto Sans KR를 재사용했다. 새 UI 라이브러리는 같은 역할의 스타일과 조작 계약을 중복시키므로 추가하지 않았다.
- [W3C Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/): 아이콘 버튼도 접근성 이름과 키보드 조작을 보존한다.
- [W3C Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html): 입력의 의미를 잃지 않도록 필요한 이름과 조건을 남기고 중복 안내를 줄인다.
- 정적 검사와 실제 Chrome 계산 스타일, 저장 후 재열기, 키보드 조작, 좁은/넓은 화면 캡처를 함께 사용한다. 자동 검사는 문장 의미나 모든 접근성을 인증하지 않는다.

## 검증

`npm run verify:identity` 최종 후보 통과: 단위 **853/853**, 실제 Chrome UI **26/26**, 디자인 검사와 후보 빌드 통과. 검사 전후 소스/검사/의존성/빌드 해시가 같고 원본 작업 폴더의 검증 입력도 일치한다.

- [원본 gate 보고서](../verification/pre-release-2026-09-25T07-26-36-912Z/report.json)
- [범위와 화면 근거](../verification/identity-readability-2026-09-25/report.json)
- [320px 답변](../verification/identity-readability-2026-09-25/typography-chat-320.png), [위키 편집 모달](../verification/identity-readability-2026-09-25/browser-wiki-review-390.png), [진행 기록](../verification/identity-readability-2026-09-25/trace-journal-320.png)

본문 대비 16.56:1, 보조 설명 6.60:1, 강조 4.75:1을 해당 표면에서 측정했다. 상태 색도 검사한 조합에서 4.5:1 이상이다. 일반 답변, 펼친 Wiki/코드, 편집 모달과 진행 기록 캡처를 직접 검토했다. 최종 검증은 모션 감소, 저장 후 재열기, 포커스와 키보드 조작도 포함한다.

중간 실행 `pre-release-2026-09-25T07-24-35-128Z`는 프로세스 종료로 완료되지 않아 통과 근거로 쓰지 않았다. 위 최종 gate를 새로 실행해 전체 완료했다. 앞선 UI 통과 결과를 새 빌드의 근거로 재사용하지 않았다.

이번 변경은 브라우저 UI 검증이다. 로컬 합성 모델을 사용했으며 실계정/실모델의 업무 정확도, 모든 접근성에 대한 인증, Windows Office 실행 또는 릴리스 배포를 뜻하지 않는다. 전체 배포 gate와 현재 소스에 대한 `quality:status` 판정은 별도다.

후속 UI 작업은 `VISUAL-STANDARD.md`와 공통 CX/Deck 컴포넌트를 유지하며 `verify:identity`를 실행한다. 보조 글자를 작거나 희미하게 줄이지 않고 불필요한 문장을 제거한다. 진한 색과 볼드는 핵심 구절, 옅은 색은 배경과 구획에 사용한다.

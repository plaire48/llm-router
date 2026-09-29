# 누비 아이덴티티 유지 점검

2026-09-25. 기존 `agentfactorysdkdeck.html`을 시각 기준으로 유지한다. 원본 SHA-256 `df9cfcc44f2f8d4ea14c6f137d0297c562ca506f8a0028df374c7f012d8715ac`를 재확인했다. 브라우저 누비 범위이며 Office/Desktop 별도 호스트 화면을 변경한 작업은 아니다.

## 반영

- 이미 공통 토큰에 연결된 로컬 Noto Sans KR, 본문 14/22px, 구획/모달 제목 16/24px, 날짜/버전 12/16px와 HTML의 블루/보라/청록색을 유지했다.
- 파일/녹화/예약/정책의 중첩 펼침에 공통 글꼴, 잉크색, 화살표, 초점, 호버, 모션 감소를 적용했다. 입력/요소 간격은 공통 간격 토큰으로 정리했다.
- 예약의 필수 조건과 승인 안내를 먼저 표시하고 세부 실행 조건은 펼침으로 옮겼다. 알림 이름을 줄이고 불필요한 기술 표현을 제거했다.
- 녹화의 완료·저장·재녹화는 의미가 다른 동작이므로 짧은 텍스트 버튼으로 구별한다. 보조 아이콘 동작의 접근성 이름과 호버/키보드 툴팁은 유지한다.
- 질문 폼의 구체적인 입력 안내는 사라지는 플레이스홀더 대신 입력칸 아래의 지속 텍스트로 보이고 `aria-describedby`로 연결한다.
- 실제 모달 검사가 통합 설정의 공통 스타일 누락을 잡도록 보강했다. identity gate에 native 확인창을 추가했다. 기존 로그인/제공자/모델/설정/도움말/질문/승인/첨부/캡처/코드/이력/위키 검사를 재사용한다.

## 방법론과 도구

설치된 CX UI 스킬과 @e2e/cx-design-system 0.5.4의 공개 ActionButton/DetailPanel/CxField를 사용했다. 라이브러리 내부나 원본 HTML을 수정하지 않았다. 별도 아이콘/폰트 패키지와 원격 폰트를 추가하지 않았다.

[W3C 버튼 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/button/)의 접근성 이름/키보드 동작과 [입력 이름과 안내](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)의 충분하고 간결한 안내 원칙을 적용했다. 아이콘으로 의미를 알아보기 어려운 동작까지 숨기지 않는다.

## 유지 방법

새 컴포넌트와 모달도 design/agent-deck.css와 공통 CX/Deck 컴포넌트를 사용한다. UI 수정 후 `npm run verify:identity`로 계산 스타일, 좁은 화면, 펼친 상세, 키보드와 상태 전환을 검사하고 실제 캡처를 검토한다. 표준은 VISUAL-STANDARD.md와 확장 AGENTS.md에 연결했다.

## 검증 결과

녹화 UI를 수정한 후보에서 `verify:identity` 33단계가 통과했다. 단위 테스트, 디자인 검사, 후보 빌드와 실제 Chrome의 설정·질문 폼·글꼴·접근성·키보드 검사가 포함된다. 설정은 320/360/1280px에서 계산 스타일과 넘침을 확인했고 녹화 종료 후 360px 캡처에서 기록 확인·이름·목표·저장 버튼이 한 화면에 들어왔다. 이는 합성 사이트와 모델의 화면 회귀이며 실계정 업무 성공은 별도다.

첫 실행에서는 새 `실행 조건`을 기존 접근성 검사 목록에 넣지 않아 실패했다. 해당 목록과 중첩 키보드 검사를 보완한 뒤 전체 gate를 다시 통과했다. 최초 실패 기록도 보존했다. 최종 검증 전후의 소스/테스트/의존성 입력과 빌드 해시가 일치한다.

- [최종 보고서와 단계별 로그](../verification/pre-release-2026-09-25T03-20-55-996Z/report.json)
- [검증 요약과 화면 목록](../verification/identity-recheck-2026-09-25/summary.json)
- [좁은 설정 화면](../verification/identity-recheck-2026-09-25/browser-routines-360.png), [넓은 설정 화면](../verification/identity-recheck-2026-09-25/browser-routines-1280.png)
- [녹화 상세](../verification/identity-recheck-2026-09-25/browser-routines-recording-360.png), [연결 모달](../verification/identity-recheck-2026-09-25/simple-fabrix-320x640.png), [초안 수정 모달](../verification/identity-recheck-2026-09-25/approval-edit-320.png)

실제 Chrome과 합성 데이터로 UI를 검증했다. 실계정 로그인/실모델 정확도나 모든 운영체제의 픽셀 일치를 보증하지 않는다. 후보 빌드만 생성했으며 배포하지 않았다.

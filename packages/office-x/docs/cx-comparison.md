# Workspace 채팅 CX 비교와 Office 적용

2026-10-13. 기준은 현재 `/Users/ganadi/Documents/llm_router/packages/nubi-desktop`의 Electron Workspace 채팅방 소스다. 로그인/환영 화면과 실제 대화 화면의 최종 CSS를 구분했다. Code-OSS 전체 셸이나 실제 로그인된 Electron 화면을 검증한 결과는 아니다.

| 항목 | 수정 전 Office | Workspace 기준 및 적용 결과 |
| --- | --- | --- |
| 대화 배경 | 환영 화면의 파랑·민트 그라데이션 | 흰색 `--deck-card`; 환영 화면에만 그라데이션 유지 |
| 사용자 말풍선 | 파란색, 전체 폭 | 잉크 5%+흰색 95%의 중립색, 오른쪽 정렬, 최대 85%, 16px 모서리, 10px/16px 안쪽 여백 |
| 답변 | 별도 Office 문단 스타일 | Workspace `message-body`: 16px/28px, 400, 잉크 #191F28 |
| 입력창 | 큰 고정 높이·그림자 | Workspace `nubi-composer-surface`: 흰색, #E5E8EB 테두리, 18px 모서리, 8px/12px 여백, 포커스 링 |
| 추론 설정 | 하단 select | Workspace `ReasoningPicker` 원본: 번개·슬라이더·초점 관리·실패 복구 |
| 모델 포인트 | Office 별도 CSS | Workspace의 제공자별 표면/잉크; Claude #F9EDE7 / #8E422C |
| 전송/중지 | Office 버튼 규칙 | Workspace의 원형 전송·중지 컨트롤과 포인터 조건 |
| 검증 결과 | 거절·실패에도 초록색 | 검증 완료만 초록색, 거절은 중립색, 확인 필요는 주의색; 문구 병행 |
| 읽기/입력 정렬 | 서로 다른 여백 규칙 | 같은 Office inset 토큰으로 시작·끝 정렬 |

## 토큰 및 재사용

CX 0.5.4의 공개 CxButton, ActionButton, CxTextarea, DetailPanel, CxInput, CxNotice를 유지한다. CX의 기본 시그니처 색을 새로 지정하지 않고 누비의 `agent-deck.css` 의미 토큰 매핑을 따른다. `--brand-action` #1B64DA, `--brand-soft` #E8F1FE, `--layout-text` #191F28, `--layout-muted` #4E5968, `--layout-border` #E5E8EB를 양쪽에서 확인했다.

Workspace identity → ios → typography → density → dialogs의 최종 우선순위가 Office에서도 적용되도록 실제 클래스 구조를 연결했다. 중복 Office CSS를 정리했다. `NubiComposerInput`, `NubiComposerBar`, `ReasoningPicker`, `ModelPicker`, `ModelSelection`, `useConversationScroll`, `ResponseTime`을 재사용한다. Office는 입력 도구가 적으므로 좁은 화면에서도 선택한 모델명을 표시하는 의도적인 차이를 남겼다.

Pretendard 우선의 동일 폰트 스택, UI 15px·보조 14px·답변 16px를 사용한다. Pretendard 미설치 시 번들 Noto Sans KR를 사용한다. 추론 선택은 기존 Office provider 명령으로 연결하며, 제공자/모델을 확인하고 실행 중 변경을 막는다. 인증값은 UI로 가져오지 않는다. 원본 ReasoningPicker는 AI Pro/ChatGPT의 비밀이 아닌 추론 선호도만 WebView 로컬 저장소에 기록하고, 실제 적용값은 Office provider 응답으로 확인한다.

## 보존한 기능과 범위

- GenOffice AgentLoop·composeSkills·도구 검사·취소·문맥 압축·응답 검증 구조와 원본 85개 파일을 유지했다. 이번 변경은 UI와 입력 설정 연결이다.
- 로그인 4종, 모델 검색·갱신·선택·해제, Markdown·표·코드, IME 입력, 새 대화·이력, 복사, 자동 스크롤·최신 메시지 이동, 승인/거절·중지·문서 검증 결과를 유지했다.
- Excel 변경 승인은 기존 runId/planId 및 네이티브 실행 경로를 사용한다. 거절 상태를 성공으로 표시하지 않는다.
- 파일 첨부, Workspace 메일/Wiki, 전체 GenOffice 문서 도구, A2A는 아직 이 Office 구현에 포함되지 않는다. 작동하지 않는 컨트롤을 추가하지 않았다.

## 확인 결과

- 같은 대화 마크업을 현재 Workspace 원본 CSS와 Office 번들로 각각 렌더링한 38개 계산 스타일/토큰: 차이 0. 폰트 변수의 공백은 정규화했다. 제품 전체 시각적 동일성이나 실제 Electron 검증을 뜻하지 않는다.
- UI 모의 호스트 14개 흐름, pageerror 0. 추가로 추론 적용/초기화, 실패 시 복구, 실행 중 차단, 중지, 거절 상태색을 확인했다.
- CX 정적 검사 issues 0, TypeScript 통과, Office 연결/대화 테스트 11개 통과. 원본 해시 GenOffice 85개, 누비 88개 통과.
- Windows Excel/VSTO·실제 계정 로그인은 미검증이다.

증거: `verification/cx-audit/computed-styles.json`, `verification/cx-audit/comparison.html`.
재현: `npm run build`, `node scripts/build-cx-reference.mjs`, dist/ui를 localhost:4178로 제공한 다음 Playwright에서 `tests/ui.browser.js`, `tests/cx-compare.browser.js` 실행. 비교 CSS는 테스트용이며 패키징 전 `dist/ui/cx-audit`를 제거한다.

## 가독성 후속 정리

반복되는 입력창 안내와 긴 로그인 설명을 제거하고 연결 조건은 접힌 안내로 옮겼다. 결과는 `수식 검증 완료`, 셀 수, 저장 여부만 표시한다. 모델 표시명과 상태 구분자의 중간점을 없앴다. 모델 ID, 사용자 메시지, 생성된 답변 원문은 변경하지 않는다. 본문 400, 모델명 500, 핵심 결과 600의 굵기를 사용하고 강조색은 작업 상태와 제공자에 한정한다. 14개 UI 흐름과 연결 테스트 11개를 다시 통과했다.

## 시간대별 인사

로그인 제목은 PC 현지 시간을 기준으로 아침 05–11시, 점심 11–14시, 오후 14–18시, 저녁 18–22시, 밤/새벽 22–05시의 각 10개 문구 중 하나를 표시한다. 총 50개 문구는 `ui/greetings.js`에 있다. 같은 시간대 안에서는 화면을 읽는 동안 고정되며, 다시 열 때 직전 문구를 피한다. 시간대 경계와 창 복귀 시 다시 확인한다. 직전 문구 ID만 sessionStorage에 저장하며 인증이나 대화 정보는 기록하지 않는다. 320px에서 줄바꿈을 확인했다.

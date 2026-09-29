# 브라우저 누비 폼 사용성 점검

입력 목적, 필요한 정보량, 제출 동작, 실패 후 복구를 기준으로 현재 폼을 검토했다. 불필요한 입력 항목이나 질문 단계를 추가하지 않고 기존 HTML과 CX의 본문 크기, 색상, 모달을 유지한다. 사용성 점수를 임의로 만들지 않으며 실제 사용자 작성 시간과 모델 질문 품질은 별도 평가 대상이다.

## 폼별 판단과 개선 목록

| 폼 | 사용자 관점의 문제 또는 유지할 점 | 적용 |
| --- | --- | --- |
| 선택형 질문 | 선택 즉시 전송됨을 hover 없이 알기 어려움 | 짧은 전송 안내. 직접 입력은 선택지 아래에 항상 유지 |
| 짧은 직접 답변 | 형식 안내가 입력하는 순간 사라짐 | 구체적인 형식 안내를 CxField hint로 연결. 실제 답변을 미리 채우지 않음 |
| 긴 답변 | 줄바꿈이 있으면 축소 버튼이 크기를 바꾸지 못함 | 수동 조절 핸들 제거. 내용에 따라 최대 176px까지 자동 증가하고 긴 내용에만 더 보기/접기 표시. 원문/선택 범위와 Enter 줄바꿈 유지. 화면의 반복 단축키 설명은 제거하고 전송 툴팁 유지 |
| 이미지 선택 | 실제 후보와 직접 입력을 함께 이해해야 함 | 기존 실제 이미지와 이름, 공통 질문/직접 입력 유지. 새 이미지나 가상 선택지를 만들지 않음 |
| 브라우저 확인창 | 사이트의 확인/취소와 텍스트 답변의 구분 필요 | 기존 사이트/내용/선택 이름을 유지하고 동일 질문 컴포넌트로 안내 |
| 최종 승인과 초안 수정 | 검토, 수정, 등록은 서로 다른 행동 | 기존 대상/미리보기/명시적 승인, 닫기 후 편집 복원 유지. 일반 답변으로 승인하지 않음 |
| 페이지 입력 검토 | 이미 읽은 값을 다시 작성할 필요 없음 | 기존 읽기 전용 항목 비교와 페이지 입력 동작 유지 |
| 스킬 편집/등록 | 저장 중 추가 입력 유실, 닫기 후 초안 초기화 | 저장 중 입력/가져오기 보호. 같은 대화와 같은 항목의 실제 편집만 메모리에서 이어 작성 |
| 사이트 위키 편집 | 저장 중 추가 입력 유실, 다시 열 때 초안 초기화 | 저장 중 입력 보호, 실제 편집의 같은 대상 재열기. 성공 후 초안 해제 |
| 녹화 절차 | 예약과 이름/요청을 공유해 값이 섞임. 긴 목표도 한 줄 | 독립 초안과 여러 줄 목표 입력, 필수 항목 표시 |
| 작업 예약 | 긴 요청이 한 줄. 잘못된 주소/시각이 권한 요청 뒤 발견됨 | 여러 줄 요청, 필수 표시, 입력별 오류/초점, 오류가 있는 상태에서는 권한/저장 요청 없음 |
| FabriX 연결 | 3개 필수 제공자 값과 테스트/연결 구분 필요 | 기존 3개 필수 입력과 연결 테스트 유지. 인증값 추정이나 추가 설문 없음 |
| MCP 연결 | 이름/주소와 선택적인 인증 헤더가 섞이면 부담 | 기존 이름/주소를 먼저, 헤더는 펼친 상세. 현재 연결 검사와 실패 후 입력 유지 |
| 외부 Wiki와 작업 연결 | 이미 발견한 연결을 다시 입력하는 부담 | 기존 프로젝트 발견/선택과 출처 안내 유지. 필요한 연결 주소만 입력 |
| 대화/모델 검색 | 검색과 실제 선택을 구분해야 함 | 기존 검색과 선택 상태, 키보드 동작 유지 |

질문 입력은 일반 채팅 초안/첨부와 구분하고 질문 ID별로 보존한다. 접힌 입력은 화면 높이에 맞춰 110~176px를 상한으로 자동 증가하며, 더 보기는 최대 화면 높이 65%까지 확장한다. 그보다 긴 원문은 입력란 안에서 스크롤해 모두 확인한다. 실제 입력값을 말줄임으로 대체하거나 자르지 않는다. 짧아지면 더 보기 버튼도 사라진다. 스킬과 Wiki 편집 초안은 해당 컴포넌트의 메모리에만 남으며 새 영구 저장소를 만들지 않는다. 새로고침이나 앱 종료 뒤 복구된다고 표시하지 않는다.

## 공개 구현 비교와 채택 근거

| 자료 | 확인한 코드/계약 | 채택과 비채택 |
| --- | --- | --- |
| [Codex 질문 스키마](https://github.com/openai/codex/blob/d7b07d45517a793acfba4cbf8de697d723cceb46/codex-rs/core/src/tools/handlers/request_user_input_spec.rs), [TUI](https://github.com/openai/codex/blob/d7b07d45517a793acfba4cbf8de697d723cceb46/codex-rs/tui/src/bottom_pane/request_user_input/mod.rs), Apache-2.0 | 짧은 질문과 구분되는 선택, 질문별 입력 상태와 단축키 안내 | 전송 버튼의 이름/단축키 툴팁과 원문 보존을 적용. TUI나 추천 기본 선택을 그대로 복사하지 않음 |
| [OpenCode 웹 질문 폼](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/app/src/pages/session/composer/session-question-dock.tsx), [질문 지침](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/tool/question.txt), MIT | 요청별 초안, 입력 높이, 제출 중 조작과 오류 복구 | 대상별 초안, 실제 크기 변경, 저장 중 보호를 적용. 직접 입력 접기는 누비의 상시 노출 계약과 달라 비채택 |
| [Claude Agent SDK 공식 문서](https://code.claude.com/docs/en/agent-sdk/user-input) | 질문과 권한 승인의 분리, 선택 이름/설명, 자유 입력 | 기존 질문/승인 분리 유지. Claude 제품 UI 코드는 공개 자료로 취급하지 않음 |
| [W3C 입력 안내](https://www.w3.org/WAI/tutorials/forms/instructions/), [오류 안내](https://www.w3.org/WAI/tutorials/forms/notifications/) | 사라지지 않는 안내, 필수 입력, 입력과 오류의 연결 | 기존 CxField hint/error와 native 입력 검증을 재사용 |

Claude SDK 저장소의 [LICENSE.md](https://github.com/anthropics/claude-agent-sdk-typescript/blob/9e477a178c370991ed87ca65b4c8631d390aea35/LICENSE.md)는 Commercial Terms/All rights reserved이므로 오픈소스 UI로 복사하지 않았다. OpenAI 제품 비교는 공개 Codex 구현으로 한정하며 ChatGPT/Claude의 비공개 프런트엔드를 조사했다고 주장하지 않는다.

실제 재사용은 React와 기존 CX CxField/CxInput/CxTextarea/ActionButton, Playwright와 기존 DOM 검사다. 공개 코드의 설계 패턴을 누비의 기존 컴포넌트에 적용했고 소스를 복사하거나 폼 SDK를 추가하지 않았다. 현재 짧은 폼들에 별도 폼 엔진을 추가하는 것은 상태/스타일/의존성을 중복하므로 비채택했다. 여러 질문 탭, 자동 기본 선택과 전체 일괄 승인은 기존 순차 질문과 명시적 승인 경계에 맞지 않는다.

## 검증

- 변경 전 실제 Chrome에서 긴 답변의 축소 전후가 모두 3줄/112px이며 버튼 문구만 바뀌는 문제를 재현했다. [재현 기록](../verification/form-usability-2026-09-25/question-resize-before.json)
- 최종 `verify:identity`: 단위 853개, 디자인 검사, 후보 빌드, 실제 Chrome 화면 30종 모두 통과했다. [33단계 보고서](../verification/form-usability-2026-09-25/pre-release-2026-09-25T07-56-03-832Z/report.json). 검증 후 [현재 소스 입력 해시](../verification/form-usability-2026-09-25/source-match.json)도 모두 일치했다.
- 질문 검사: 핸들 없음, 320px에서 자동 증가 상한, 더 보기/접기와 선택 범위 보존, 짧아지면 버튼 해제, IME/Enter/질문 초안과 별도 채팅 초안 보존을 확인했다. CRLF/CR 붙여넣기는 LF로 정규화하고 삽입 끝에 커서를 둔다. 선택한 내용과 같은 텍스트를 다시 붙여도 다음 타이핑이 원문을 덮지 않도록 검사했다.
- 예약 검사: 녹화와 예약 초안 분리, 긴 요청, 필수 입력과 개별 오류, 잘못된 주소/시각에서는 권한 요청 및 저장 호출이 없는지 확인했다. 스킬/Wiki는 실제 편집만 재열기, 최신 저장본 반영, 저장 중 잠금, 실패 후 입력 보존을 확인했다.
- 공통 폼 소비 경로의 DOM 검사 31개 통과. [로그](../verification/form-usability-2026-09-25/shared-form-dom.log). Office native/설치 빌드는 실행하지 않았다.
- [320px 접힌 질문](../verification/form-usability-2026-09-25/question-auto-grow-compact-320.png), [펼친 질문](../verification/form-usability-2026-09-25/question-auto-grow-expanded-320.png), [선택형 질문](../verification/form-usability-2026-09-25/question-choice-320.png). 펼친 입력보다 긴 문서는 내부 스크롤과 대화 스크롤로 접근한다.
- 첫 UI 실행에서 예약 안내의 12px/20px 크기가 본문 기준에 미달해 공통 모달 hint를 14px/22px로 고쳤다. 중간 변경 전 실행은 최종 후보의 통과로 합산하지 않았다.
- Chrome의 모델/서비스 응답은 합성 fixture다. 이번 UI gate는 전체 핵심 회귀, 실제 사용자 작성 시간, 실모델 질문 품질, 실서비스 저장이나 릴리즈 배포를 입증하지 않는다.

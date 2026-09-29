# 브라우저 누비 앱 재검증

## 발견과 수정

| 우선순위 | 재현한 현상 | 원인과 반영 |
| --- | --- | --- |
| 1 | 추가 지시가 채팅에 표시된 동안 인접한 대기 작업을 정렬하면 `agent_input_changed` 발생 | 전체 inbox에서 숨겨진 steer까지 이동 대상으로 검사했다. 같은 실행과 인증에 속한 queue 슬롯만 재정렬하고 steer의 위치와 순서는 유지한다. 이전 순서 또는 실행/계정 경계가 다르면 계속 거부한다. |
| 2 | 위 상황에서 화면 두 번째 행을 보조 기술에 세 번째 위치로 안내 | dnd-kit 안내의 순번을 실제 표시 목록에서 계산한다. |
| 3 | 다단계 폼 시험이 사용자 답변 전달 단계에서 실패 | 앱은 답변 원문과 `answered_question`의 질문 ID를 정상 전달했다. 과거의 순수 문자열만 기대한 테스트를 수정하고 원문 한 번 전달, 정확한 질문 ID, 질문 내용과 최초 요청 보존까지 검증한다. 앱의 답변 보존 기능은 유지한다. |
| 4 | 긴 문서 조회 시험의 초기 문맥 크기 검사 실패 | 공통 시스템 지침 증가를 문서 원문 주입으로 오인했다. 시스템 지침 30,000자 미만, 비시스템 초기 문맥 6,000자 미만을 독립 검사한다. 원문 끝 정답의 초기 누출 금지와 실제 문서 검색/분할 읽기는 유지한다. 문자 크기를 모델 토큰 한도나 정확도로 표현하지 않는다. |
| 실행 설정 | 첫 Chrome 검사가 serviceworker 생성 대기에서 종료 | `CHROME_PATH` 대신 검사들이 사용하는 `CHROME_BINARY`로 테스트용 Chrome을 지정한다. 앱 품질 실패나 통과로 해석하지 않는다. |

## 방법론과 오픈소스 판단

- [dnd-kit 접근성 지침](https://dndkit.com/legacy/guides/accessibility/): 실제 목록의 위치 안내, 키보드 이동과 취소를 적용한다. 설치된 `@dnd-kit/core` 6.3.1 및 sortable 10.0.0의 MIT 구현을 재사용한다. 새로운 정렬 패키지와 전면 버전 교체는 필요하지 않다.
- [OpenCode V2 세션 명세](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md): 접수한 입력과 모델 이력 반영을 구분하는 기존 설계를 재검토했다. 개발 중인 명세 참고이며 배포된 제품 동작을 검증한 것은 아니다. 순서 변경을 입력 반영이나 실행 시작으로 처리하지 않는다. 소스 복사는 없다.
- 기존 React/CX와 Playwright로 실제 Chrome UI, 저장 후 재진입, 모델 요청 본문, 대상 페이지 입력과 최종 등록 횟수를 함께 확인한다. 모델 응답과 사이트는 합성한다. 표의 원인과 재현이 없는 기능은 일괄 교체하지 않는다.

## 검증 범위

- 수정 전: `verification/pre-release-2026-09-26T04-56-56-167Z/report.json`은 잘못된 브라우저 경로로 실패. `verification/pre-release-2026-09-26T04-58-09-680Z/report.json`은 오래된 폼 답변 기대값으로 실패. 두 실패 기록을 보존한다.
- `verification/pre-release-2026-09-26T05-03-42-816Z/report.json`의 문서 초기 크기 실패도 보존한다. 검사 대상 분리 후 문서 조회/분업/취소 7개 계약을 개별 재검증했다.
- 중간 여백 후보의 `verification/pre-release-2026-09-26T05-30-47-121Z/report.json`에서는 업로드 대상 조회가 `targets`를 반환하지 않아 실패했다. 반환값을 기록하는 독립 재현에서는 정상 대상과 업로드/녹화/예약 계약이 모두 확인됐고 원인은 확정하지 못했다. 이 중간 실패를 통과로 바꾸지 않으며 최종 후보 gate 결과와 구분한다.
- `verification/app-probe/mixed-queue-before.png`: 실제 키보드 재정렬 실패 화면. 합성으로 보류시킨 durable steer를 사용한다.
- `agent-input.test.mjs`: 양방향 정렬, steer 위치 유지, 이전 순서 및 실행/계정 경계 차단.
- `agent-input-browser.mjs`: 포인터/키보드 정렬, 표시 순번 안내, 새로고침과 실제 저장 순서, 재정렬로 모델 호출이 추가되지 않는지 검사. durable steer는 fixture로 접수 상태를 고정하며 실제 화살표 반영 검사는 기존 경로로 수행한다.
- `form-workflow-browser.mjs`: 두 질문과 새로고침 후 답변/질문 연결, 실제 필드 값과 단위 변환, 승인 전 등록 0회와 승인 후 등록 1회.
- `document-retrieval-browser.mjs`: 공통 지침/문서 문맥 크기 분리, 초기 정답 미주입, 원문 검색/조회, 독립 분석과 취소/지연 복구.
- 기능 수정 단계의 핵심 gate는 `pre-release-2026-09-26T05-06-50-040Z/report.json`에서 909개 단위 검사와 Chrome 87회가 통과했다. 이후 화면 변경과 다른 소스이므로 최종 UI 후보의 핵심 gate로 표현하지 않는다.
- 최종 배치 후보는 `pre-release-2026-09-26T05-41-32-892Z/report.json`에서 909개 단위 검사, 디자인 검사, 후보 빌드 및 Chrome 30회가 통과했다. 검증 전후 소스/검사/의존성과 빌드 해시도 일치했다. 대기 입력 회귀 8개 및 360/1100px 실제 배치 측정도 별도로 통과했다.
- [통합 결과](../verification/app-retest-2026-09-26/report.json)에 단계를 구분했다. 실계정 로그인, 실제 모델 정확도와 실제 사이트 저장 성공은 별도다. 배포하지 않았다.

화면: [수정 전 정렬 오류](../verification/app-probe/mixed-queue-before.png), [수정 후 1100px](../verification/app-probe/mixed-queue-after.png), [360px 대기열](../verification/agent-input/mixed-queue-360.png). 추가 캡처용 임시 probe의 첫 실행은 키보드 측정 프레임 대기 누락으로 중단됐고 기존 회귀와 동일한 준비 대기 후 성공했다. 핵심 회귀 횟수에 합산하지 않는다.

## 남은 항목

긴 브라우저 도구 실행 중 입력 접수가 전역 직렬 큐 뒤에서 기다리는 기존 제한은 남아 있다. 이번 변경은 접수된 입력의 표시와 정렬을 다루며 저장 동시성 구조를 바꾸지 않는다. 실모델 대형 과제의 성공률과 Windows/Edge 검증도 미측정이다.

## 검증 중 받은 색상 요청

사용자 후속 요청에 따라 활성 실행의 `반영 대기`는 기존 `--brand-ink` 파랑과 600 굵기로 표시한다. 보류는 보조색을 유지한다. 휴지통의 빨강 요청은 이후 일반 색상으로 정정됐다. 최종 채팅 및 대기열 휴지통은 다른 보조 아이콘과 같은 `--layout-muted` 회색이며 hover에서도 배경/테두리/그림자를 없앤다. 접근성 이름, 툴팁과 키보드 focus outline은 유지한다. CX 컴포넌트나 패키지는 수정하지 않는다.

이 후속 변경은 App의 상태 표시 속성과 CSS에 한정한다. 앞선 핵심 87회 보고서를 색상 변경 뒤 소스와 동일하다고 주장하지 않는다. 최종 색상 후보에서는 필수 identity gate 및 실제 360/1100px 화면, 상태 글자 색상/굵기와 휴지통 hover/focus의 계산 스타일을 다시 검사한다. 색상 확인 화면: [360px](../verification/app-probe/pending-neutral-icons-360.png), [1100px](../verification/app-probe/pending-neutral-icons-1100.png).

대기열 좌우 여백 요청도 반영했다. 한쪽만 예약하던 스크롤바 공간을 `scrollbar-gutter: stable both-edges`로 대칭 배치한다. 3개 이하와 내부 스크롤이 생기는 상태 모두 같은 양쪽 간격을 유지하며, 기존 높이 제한과 휠 동작은 유지한다.

[CSS Overflow 3의 both-edges 정의](https://www.w3.org/TR/css-overflow-3/#scrollbar-gutter-property)를 적용한다. 별도 스크롤바 라이브러리를 추가하지 않는다. 처음 양쪽 23px를 확인했지만 사용자가 여백 축소를 요청해 얇은 기본 스크롤바와 작은 좌우 padding으로 조정했다. 최종 실제 Chrome의 360/1100px에서 2개/5개 큐 모두 행의 좌우 간격이 **15px**로 같고 가로 넘침이 없었다. 기존 포인터/키보드 정렬과 취소/승인/순차 실행 8개 검사도 통과했다. [위치 변경 전 2개 큐 화면](../verification/app-probe/queue-compact-2-360.png), [위치 변경 전 5개 큐 화면](../verification/app-probe/queue-compact-5-360.png).


## Codex를 참고한 대기열 위치

사용자가 위치를 “입력창 바깥 바로 위”로 확정했다. `QueuedInputs`를 작성 폼에서 분리하고 공통 `composer-stack`에서 입력창과 동일한 폭으로 배치한다. 두 영역 사이 간격은 CX 8px 토큰이며 페이지 연결 및 첨부는 작성 폼에 남는다. 대기열은 최대 3줄과 독립 스크롤, 기존 순서 변경과 승인 경계를 유지한다.

[OpenAI Codex 공개 TUI의 BottomPane](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/mod.rs)는 `pending_input_preview`를 composer 위에 표시하도록 정의한다. 이 배치 패턴을 참고했으며 비공개 Desktop 코드를 확인하거나 Rust 코드를 복사한 것은 아니다. 기존 React/CX/dnd-kit으로 구현해 새 라이브러리는 추가하지 않았다.

실제 Chrome에서 360/1100px, 대기 항목 2개/5개를 캡처했다. 큐는 입력 폼 밖 위쪽이고 좌우 끝 차이는 0px, 입력창과 간격은 8px, 행의 좌우 여백은 각 15px였다. 5개에서는 큐 내부 스크롤이 생기며 페이지 가로 넘침은 없다. 파란 반영 대기와 일반색 아이콘의 hover/focus도 확인했다. 합성 모델 및 사이트를 사용한다.

[최종 좁은 화면](../verification/app-probe/queue-above-composer-2-360.png), [최종 넓은 화면과 5개 대기 항목](../verification/app-probe/queue-above-composer-5-1100.png).

위치 수정 중 `05-39-38-632Z` 검사는 Chrome 환경변수 누락을 발견해 중단했고, `05-40-03-303Z` 검사는 실제 캡처에서 간격 24px를 확인한 뒤 8px로 수정하기 위해 중단했다. 두 후보를 통과로 집계하지 않는다. 최종 배치 후보는 별도 identity gate로 검사한다.

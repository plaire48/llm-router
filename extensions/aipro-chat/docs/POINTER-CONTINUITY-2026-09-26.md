# 커서 연속 표시와 누비 작업 화면 따라가기

## 반영

| 문제 | 바뀐 동작 | 검증 |
| --- | --- | --- |
| 행동마다 커서가 생성/제거됨 | 같은 실행/문서의 DOM과 마지막 실제 좌표를 유지. 대기 중 입력 리스너 해제 | 11초 대기와 다음 행동에서 같은 DOM 유지, 사용자 클릭에 위치/효과 변화 없음 |
| 캡처 전에 커서가 사라짐 | 이미 번들한 Playwright의 screenshot style로 캡처 순간만 숨기고 복원 | 캡처의 커서 영역 픽셀이 숨긴 기준 화면과 일치하고 보이는 화면과 다름 |
| 프레임의 이전 커서가 남음 | 다른 프레임 표시를 숨기고 대상 프레임만 사용 | iframe → 본문 이동, 캡처 뒤 프레임 hidden 확인 |
| 표시가 작업보다 오래 남거나 먼저 사라짐 | 10초마다 30초 임대 갱신. 중지/탭 이동/페이지 이탈에서 제거 | 갱신 종료와 고아 표시 만료, 다중 프레임 정리 검사 |
| 보는 페이지와 작업 페이지가 다름 | 누비 소유 탭을 선택한 동안 현재 에이전트 탭을 따라감 | 링크/탭 전환, 사용자 탭 선택 시 중단, 소유 탭 복귀 후 재개 |
| 다른 화면을 보고 있는데 작업 창이 올라옴 | 자동 경로는 tabs.update만 사용. 창 포커스/최소화 변경 없음 | 다른 창의 선택/초안, 전환 전후 Chrome 창 상태 유지와 windows.update 미호출 확인 |

첫 누비 작업 탭은 기존처럼 비활성으로 생성한다. 처음부터 다른 탭에서 작업하는 사용자에게 자동 전환을 강제하지 않는다. **누비 작업 탭을 보고 있으면 따라가고, 다른 사용자 탭을 보면 멈춘다.** 기존 작업 보기 버튼은 사용자의 명시적 요청이므로 창을 열 수 있다. 그룹 이름이 같아도 기록된 소유권이 없는 탭은 따라가기/실행 대상에서 제외한다.

## 오픈소스와 방법론

- [rrweb replay 소스](https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb/src/replay/index.ts), MIT: 한 번 만든 커서에 좌표/효과만 바꾸는 방식 채택. 소스/SVG 복사나 녹화 SDK 설치는 없음.
- [Playwright 캡처 스타일](https://playwright.dev/docs/api/class-page#page-screenshot-option-style), Apache-2.0: 기존 Playwright CRX의 실제 기능 재사용. Shadow DOM/프레임을 포함한 캡처 전용 숨김이며 기존 민감 필드 마스킹 유지.
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-update): 탭 활성화와 창 포커스를 구분. 선택 조회 중 사용자 탭 전환 이벤트를 받으면 자동 변경 취소.
- [Codex 공개 실행 이벤트](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs), Apache-2.0: 작업/항목 수명 분리 참고. Codex 데스크톱의 비공개 커서 구현을 복제한 것은 아님.

새 의존성은 추가하지 않았다. 기존 번들 기능과 표시 수명 수정으로 해결할 수 있어 전체 녹화 SDK나 OS 마우스 제어 도구를 추가하지 않았다.

## 검증 범위

실제 Chrome 확장을 합성 페이지에서 실행한다. 클릭/입력 결과와 커서 표시를 별도로 검증하고 캡처 픽셀을 비교한다. 영상과 화면은 `verification/pointer-demo.webm`, `verification/pointer-click.png`, `verification/pointer-dialog.png`에 보관한다.

headless Chrome은 여러 창을 동시에 focused로 보고할 수 있다. 따라서 여러 창 검사는 변경 전후 상태/포커스 API 미호출/탭 선택/입력 보존을 각각 검증한다. 이는 실제 OS 전면 포커스의 증명이 아니다. headless 검사에서 시작 상태를 확인하지 않고 첫 focused 창만 고르던 실패는 별도 기록으로 보존했다.

페이지 이동/실행 탭 전환에서는 문서 표시가 다시 만들어지며 캡처 중에는 짧게 숨긴다. 완전한 무깜빡임으로 표현하지 않는다. 같은 페이지에서 작업하면 초점/선택/스크롤은 공유한다. Chrome 조회와 변경 사이의 모든 경합을 원자적으로 막는 것은 아니다. 실모델/실계정 업무 성공률, native OS 포커스, 공개 릴리스는 이번 검증에 포함하지 않는다.

## 추가 Chrome 회귀 결과

[추가 검증 보고서](../verification/pointer-continuity-2026-09-26/report.json)에 실행 로그와 후보 빌드/입력 해시를 보관했다.

- pointer-browser: 22개 검사 통과. 실제 이벤트, 동일 DOM 유지, 픽셀 제외/복원, 프레임/모달, 모션 감소, 종료와 고아 정리.
- workspace-browser: 8개 검사 통과. 소유권, 자동 따라가기/중단/복귀, 다른 창의 선택/초안/Chrome 상태 보존.
- workspace-flow-browser: 5개 검사 통과. UI 종료/재연결, 원본 초안 보호, 실제 승인 대기/재개.
- full-page-captures-browser: 15개 검사 통과. 전체 페이지 PNG, 저장/다시 보기/다운로드, 보존 범위.

이는 50개 검사 조건이며 실모델로 수행한 50개 업무 시험이 아니다. 초기 실패와 포커스 진단 로그를 삭제하지 않고 같은 폴더에 남겼다. 픽셀 대조와 좌표 실행 검사는 분리해 좌표 실행 직전에 새 캡처를 사용하며 기존 30초 좌표 만료 규칙을 바꾸지 않았다.

## 최종 후보 검사

단위 검사 **896/896**, 디자인 검사, 후보 빌드, 전체 UI Chrome **30개 스위트**가 모두 통과했다. [통합 보고서](../verification/pre-release-2026-09-25T19-24-20-554Z/report.json)와 추가 4개 Chrome 스위트의 소스/검사 입력 및 후보 빌드 해시가 일치한다. 기존 배포 ZIP과 공개 릴리스는 변경하지 않았다.

후보 ZIP SHA-256: `38567ab765c64292fb0e442ae6d16174236adba4b0da1123fb2693675e1db7ce`

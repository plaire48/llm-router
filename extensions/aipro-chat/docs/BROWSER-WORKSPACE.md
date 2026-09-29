# 누비 전용 작업 창 (이전 설계)

2026-09-24부터 새 작업의 기본 배치는 [기존 창 안의 누비 탭 그룹](NUBI-TAB-GROUP.md)이다. 아래 내용과 검증 기록은 이전 전용 창 구현을 설명한다. 대화별 소유권과 승인/재개 경계는 유지한다.

## 문제와 결정

기존 `attachTab`과 `popupWatch`는 페이지 작업마다 대상 탭을 활성화하고 전체 창에 초점을 주었다. 사용자가 다른 탭에서 일해도 Agent의 클릭으로 원래 화면으로 돌아오는 문제를 실제 Chrome에서 재현했다. `verification/workspace-focus-before.json`이 수정 전 근거다.

또한 `RUN_TOOL`과 `GET_STATE`가 같은 직렬 대기열을 사용했다. 긴 페이지 작업이 상태 조회까지 막으면 UI가 실행 상태를 확인하지 못해 멈춘 것처럼 보였다. 변경 후 상태 조회는 실행 중 읽기 전용 경로를 사용한다. 도구 결과를 기다리는 동안 다른 화면이 작업을 종료하거나 재실행하지 않는다.

기본은 **기존 Chrome 프로필 안의 별도 누비 창**이다. 로컬 실행기나 새 브라우저 설치 없이 확장 API로 연다. 사용자 탭과 입력 대상을 분리하며 쿠키, 로그인, 같은 사이트의 저장 데이터는 공유한다. 별도 프로필이나 별도 계정의 격리는 아니다.

## 흐름

1. 전송 시 대상 탭 ID만 고정한다. 일반 대화에는 새 창을 만들지 않는다.
2. 첫 브라우저 도구에서 원래 URL을 비활성 새 창에 열고 누비 그룹을 만든다.
3. 관찰, 입력, 검증은 소유 탭에서 수행한다. 원래 탭의 미저장 폼이나 sessionStorage를 복사하지 않는다.
4. 새 탭과 작업 중 생긴 팝업은 소유 관계를 확인한 뒤 작업 창으로 모은다. 다른 창의 같은 URL은 선택하지 않는다.
5. 승인/질문/재개에도 같은 탭 관계를 유지한다. 등록 승인은 원래 문서에 묶이며 한 번만 소비한다.
6. 완료/중지에는 디버거를 해제하고 Chrome의 메모리 관리 설정을 복구한다. 작성한 탭과 초안은 닫지 않는다.

입력창의 창 열기 아이콘은 사용자가 명시적으로 작업 창을 앞으로 가져온다. 설정의 `현재 탭`은 이미 작성한 미저장 초안을 이어 수정할 때 쓴다. 모드 변경은 실행 중 금지하며 기존 작업 내용은 남겨 둔다.

그룹 이름/색은 표시다. 실행 권한은 대화 ID, 제공자, 인증 시점, 창 ID, 실제 소유 탭 ID 목록으로 검사한다. 그룹에 사용자가 탭을 추가해도 자동으로 읽거나 실행할 권한을 주지 않는다. 창이 닫히면 재연결을 요청하며 다른 사용자 탭으로 조용히 전환하지 않는다.

## 정지 원인의 구분

채팅 종료 후 실행과 팝업 간섭을 더 줄이는 다음 구조는 [백그라운드 실행 설계](BACKGROUND-EXECUTION-DESIGN.md)에 정리했다. worker 실행 소유권은 로컬 후보에 적용했으며 완전한 OS 초점 격리는 별도 한계다.

| 현상 | 원인과 처리 |
| --- | --- |
| 진행 상태만 갱신되지 않음 | 도구 대기열과 조회 분리. 조회 재시도만 하며 쓰기 재실행 금지 |
| 채팅을 닫거나 새로고침 | worker의 Pi 실행 유지. 재진입 화면에서 진행 확인과 명시적 중지 |
| worker 강제 종료/Chrome 종료/업데이트 | 체크포인트에서 안전하게 일시 중지. 이어가기 때 관찰부터 진행 |
| 작업 탭이 닫히거나 이동 | 소유 탭 검사. 닫힌 자식은 기록된 같은 작업 창의 부모로만 복귀 |
| 모델/서버 응답 지연 | 기존 일시적 오류 복구와 유휴 제한 유지. 인증 거절을 무한 재시도하지 않음 |
| 쓰기 중 결과 불명 | 현재 화면을 다시 관찰하고 검증. 이전 쓰기를 통째로 반복하지 않음 |
| 페이지의 JS 대화상자/정지 | 페이지와 디버거 연결 문제를 구분. 핸들 정리에 갇히지 않도록 중지 정리를 제한 |

## 비교한 공식 사례와 오픈소스

- [Claude Code in Chrome](https://code.claude.com/docs/en/chrome): 사용자의 Chrome 로그인 공유와 세션별 탭 그룹을 참고했다. 별도 테스트 브라우저 프로세스라고 가정하지 않았다.
- [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows): `focused:false`로 새 창을 열며 탭 활성과 창 초점을 구분한다.
- [Chrome tabGroups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups): 그룹은 시각적 구분에 사용하며 생성할 창 ID를 반드시 지정한다.
- [Playwright CRX](https://github.com/ruifigueira/playwright-crx): 기존 설치 버전의 실제 attach/detach와 `Emulation.setFocusEmulationEnabled` 구현을 확인했다. OS 마우스 대신 대상 페이지에 입력하는 기존 호스트를 유지한다.
- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): 단순 worker 이동만으로 영구 실행을 보장할 수 없다. 실행 중에만 제한적으로 수명을 연장하고 강제 종료는 체크포인트로 일시 중지한다.

새 프레임워크나 서버를 추가하지 않았다. 이번 문제는 계획 모델 교체보다 탭 소유권, 초점, 실행 대기열의 문제여서 Pi와 기존 CRX 호스트에 적용하는 편이 범위와 검증 비용이 작다. 설치된 Pi Agent Core는 MIT, Playwright CRX는 Apache-2.0 라이선스이며 기존 번들 및 고지를 유지했다.

## 검증 범위

별도 창의 DOM과 소유 탭 분리와 OS 창 초점은 다른 조건이다. Chrome에서 새 팝업을 만들 때 작업 창이 앞으로 나올 수 있다. 창 초점 복원을 요청하지만 이 로컬 Chrome 환경에서는 `focused:true` 반환 후에도 마지막 초점 창이 바뀌지 않는 경우가 재현됐다. 원래 사용자 탭은 바뀌지 않지만 완전한 무간섭 조건은 아직 충족하지 못했다. `workspace-browser.json`의 `popupFocus`와 `focusIsolationVerified`를 별도 수치로 기록하며 false이면 공개 배포를 승인하지 않는다.

`workspace-browser`는 실제 Chrome의 원본 초안 보존, 전용 창, 탭 범위, 새 탭/팝업, 재개와 닫힘을 검사한다. `workspace-flow-browser`는 합성 Qwen 응답으로 실제 UI → worker → 도구 → 검증 → 승인 → 결과를 검사한다. 회사망의 실제 Qwen 정확도와 실제 서비스 등록은 이 검사에 포함하지 않는다. 배포 후보와 반복 결과는 `verification/pre-release-*/report.json`으로 구분한다.

## beta13 초점 검증 정정

기존 검사에서 `lastFocusedWindow`의 탭 ID를 전면 창으로 간주했다. 진단 시 Chrome의 모든 창이 `focused:false`였는데 새 팝업으로 마지막 창 ID가 바뀌어 실패로 기록되는 경우를 확인했다. [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows)는 현재 초점과 마지막 초점 창을 별개로 제공한다.

검사는 동작 전후의 실제 `focused` 상태를 기록한다. Chrome이 전면이면 원래 창과 사용자 탭을 유지해야 하며, 다른 앱이 전면이면 Chrome을 앞으로 가져오지 않아야 한다. 기존 보호 로직을 강제 활성화로 바꾸지 않았다. `popupFocus.mode`, `beforeFocus`, `afterFocus`로 실제 검증한 상태를 남긴다. 후면 상태에서 통과한 것을 전면 복원 검증으로 표현하지 않는다. 해당 상태의 실패는 기존대로 배포를 차단한다. 모든 OS/사이트의 완전한 초점 격리를 보장하는 것은 아니다.

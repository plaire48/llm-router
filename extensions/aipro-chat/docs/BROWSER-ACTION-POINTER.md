# 실제 동작과 포인터 표시

현재 동작은 [2026-09-27 포인터 유지와 작업 탭 정리](POINTER-WORKSPACE-2026-09-27.md)를 따른다. 아래 과거 검증의 ‘읽기에는 설치하지 않음’, ‘50ms 이동’, ‘행동 종료 때 파동 취소’는 새 정책으로 대체했다. 읽기부터 휴지 포인터를 표시하고 새 문서에서 복원하며, 이동은 160ms, 클릭 파동은 180ms 수명을 유지한다.

모델은 관찰한 ref 또는 최신 캡처의 좌표를 선택한다. 실제 입력은 기존 Playwright CRX가 수행한다. 페이지 위의 포인터는 그 입력을 보여주는 표현 계층이며 OS 마우스 커서를 이동시키는 별도 프로그램이 아니다.

[Playwright Mouse](https://playwright.dev/docs/api/class-mouse)는 뷰포트 CSS 픽셀 좌표와 move/down/up을 사용한다. [Anthropic 공개 browser-use 예제](https://github.com/anthropics/claude-quickstarts/tree/main/browser-use-demo)도 관찰과 실제 브라우저 입력을 연결한다. [OpenAI computer-use 문서](https://developers.openai.com/api/docs/guides/tools-computer-use)는 모델의 도구 제안과 실행기/관찰을 구분한다. 공개 문서로 Codex나 Claude Code 제품 내부의 모든 포인터 구현을 확인한 것은 아니다.

## 누비의 구현

- `browser-pointer.js`의 정적 helper는 실제 입력을 보내지 않는다. 실행 대상의 윤곽과 실제 전달된 trusted 이벤트의 좌표를 표시한다. 입력값/키 내용/페이지 데이터를 읽거나 모델에 반환하지 않는다.
- CX deck의 청록/블루/옅은 색면을 빌드 시 가져온다. 텍스트, 설정 버튼, 재생/정지 버튼을 추가하지 않는다. 표시 자체는 `aria-hidden`, inert, `pointer-events:none`이며 닫힌 Shadow DOM으로 사이트 CSS와 분리한다.
- manual popover를 사용해 페이지의 `<dialog>` 위에 표시하되 초점과 실제 클릭 대상을 가로채지 않는다. 해당 기능이 없으면 fixed 위치로 내려간다. 브라우저 자체의 alert/confirm 창 위에 표시하는 기능은 아니다.
- 클릭/호버/입력/스크롤/드래그 실행에서만 활성화한다. 일반 페이지 읽기와 로그인에는 설치하지 않는다. iframe은 실제 이벤트를 받는 문서에서 그린다.
- 동작 종료 뒤에도 같은 DOM과 마지막 위치를 유지한다. 입력 리스너는 해제하므로 대기 중 사용자 입력을 따라가지 않는다. 작업 중지/실행 탭 전환/페이지 이탈에서 정리하고, 숨긴 탭에서는 표시만 숨긴다. 캡처에는 Playwright의 임시 스타일을 적용하고 캡처 뒤 같은 표시를 복원한다. 늦은 표시 요청은 만료시키고 표시 단계의 대기는 250ms로 제한한다. 실행기가 10초마다 갱신하는 30초 임대가 끊기면 고아 표시를 제거한다. 예외는 실제 입력 결과를 바꾸거나 재실행시키지 않는다.
- 모델로 보내거나 다운로드하는 `capture_page`에는 포인터를 포함하지 않는다. 테스트 영상은 실제 동작 중의 표시를 확인하기 위한 별도 산출물이다.

무작위로 사람처럼 움직이는 ghost cursor는 추가하지 않았다. 불필요한 hover 이벤트와 지연을 늘릴 수 있으며, 정확한 대상 선택/결과 확인을 해결하지 않는다. 익숙한 포인터와 짧은 클릭 파동을 기존 실행에 연결하는 것이 확장 단독 제품에 적합하다고 판단했다.

## 커서 피드백 개선

[rrweb의 커서 스타일](https://github.com/rrweb-io/rrweb/blob/main/packages/rrweb/src/replay/styles/style.css)과 [재생 구현](https://github.com/rrweb-io/rrweb/blob/main/packages/rrweb/src/replay/index.ts)을 검토했다. rrweb은 MIT 라이선스이며 실제 이벤트와 시각 커서, 클릭 효과를 분리한다. 누비에는 이 패턴을 자체 구현했다. 소스나 SVG를 복사하지 않았으며 전체 녹화/재생 SDK와 사용자 행동 수집은 추가하지 않는다.

| 실제 입력 | 화면 표시 |
| --- | --- |
| 이동 | 전달된 좌표 사이만 50ms 보간하는 검은 화살표와 흰 테두리 |
| 호버 | 화살표와 얇은 대상 윤곽 |
| 클릭 | 정확한 입력 위치에서 최대 180ms 파동, 누르는 동안 작아지는 화살표 |
| 드래그 | 누르는 동안 점선 후광, 놓으면 해제 |
| 휠 | 스크롤 축에 맞춘 작은 방향 아이콘 |
| 글 입력 | 입력란 윤곽만 표시 |

이동은 표시만 보간한다. Playwright `mouse.move({steps})`를 추가하거나 가상 mousemove를 보내지 않는다. 첫 좌표와 누름/놓음은 즉시 표시하므로 다른 요소를 클릭한 것처럼 보이지 않는다. 색과 효과 시간은 `design/agent-deck.css`에서 생성한다. 파동은 `deck-pointer-pulse` 이내에서 실제 행동 종료 때 정리하고, 이동은 짧은 `deck-pointer-travel`을 사용한다. 종료 뒤에는 효과 없이 마지막 커서 위치를 유지한다. 재생/정지 버튼이나 설명 라벨은 없다.

포인터는 Codex의 익숙한 화살표 실루엣을 참고해 직접 그린 작은 화살표다. 앱의 SVG 소스를 복사하지 않았으며 Codex 내부 동작을 재현했다고 주장하지 않는다. 사용자의 후속 요청에 따라 그라데이션, 누비 배지와 호버 후광을 제거하고 deck-ink의 검은 면과 흰 테두리만 남겼다. 클릭에만 짧은 블루 파동을 표시한다. 화면 가장자리에서도 화살표의 끝은 실제 입력 지점을 유지한다. 페이지의 `cursor` 스타일이나 OS 커서는 변경하지 않는다. 시각적으로 두 포인터가 있어도 같은 탭의 초점, 선택, 스크롤은 공유한다.

## 상태에 맞는 가상 커서

사용자가 제공한 검은 면/흰 테두리 화살표 이미지를 모양의 기준으로 삼는다. 기본 화살표, 링크/버튼의 손가락, 편집기의 I-beam, 드래그의 펼친 손/잡는 손, 비활성 상태의 금지 표시를 같은 선 굵기로 그린다. 색을 바꾸거나 텍스트를 붙이는 대신 모양으로 구분한다. 클릭 반응은 실제 `pointerdown`에서만 나타난다.

실제 이벤트의 composed path에서 대상 요소의 계산된 CSS cursor 키워드를 읽는다. auto/default에는 편집기, 링크, 버튼의 의미를 보완하며, 알 수 없는 키워드는 화살표로 표시한다. 외부 cursor 이미지 URL은 표시 계층에서 불러오지 않는다. 모양마다 다른 hotspot을 적용하고 모양을 전환할 때는 보간하지 않아 실제 지점에서 어긋나지 않는다. 입력 내용은 읽지 않는다. 이 분류는 표시용이며 실행 권한이나 성공 판정에 사용하지 않는다.

### 검토한 방법과 적용 범위

| 근거 | 적용 |
| --- | --- |
| [Playwright Mouse](https://playwright.dev/docs/api/class-mouse), [actionability](https://playwright.dev/docs/actionability) | 이미 번들된 Playwright CRX가 브라우저 입력을 수행한다. DOM에서 click 이벤트만 만들어 보내거나 OS 제어 앱을 추가하지 않는다. 가시성/안정성/입력 수신 대상 검사는 기존 실행기에 유지한다. |
| [rrweb 커서 구현](https://github.com/rrweb-io/rrweb/blob/main/packages/rrweb/src/replay/styles/style.css) | 실제 이벤트와 가상 표시를 분리하고 표시가 입력을 가로채지 않는 패턴을 적용한다. MIT 프로젝트의 전체 녹화 SDK는 이 표시 기능에 필요하지 않아 추가하지 않는다. |
| [CSS UI cursor 표준](https://www.w3.org/TR/css-ui-4/#cursor) | 페이지가 제공하는 cursor 의미와 표준적인 손/텍스트/드래그 모양을 활용한다. 읽기만 하고 페이지 cursor 스타일은 변경하지 않는다. |
| [Anthropic browser-use 예제](https://github.com/anthropics/claude-quickstarts/tree/main/browser-use-demo) | ref 기반 대상 선택과 좌표 입력의 구분을 유지한다. Python/Docker 실행기를 Chrome 확장에 중복 도입하지 않는다. |
| [OpenAI computer-use](https://developers.openai.com/api/docs/guides/tools-computer-use) | 관찰 → 실제 입력 → 새 관찰/결과 확인의 기존 루프를 유지한다. 커서 애니메이션은 완료 근거로 사용하지 않는다. |

새 마우스 라이브러리를 덧씌우는 대신, 기존 Playwright 실행 경로에 상태 표시를 연결한다. 별도 OS 권한과 프로세스가 필요하지 않고 동일 동작의 중복 실행을 피한다. 이 변경 자체가 모델의 대상 선택 정확도를 높였다고 주장하지 않는다.

`prefers-reduced-motion`에서는 이동과 파동을 정적으로 표시한다. 동작 도중 설정을 변경해도 실행 중 애니메이션을 취소한다. 페이지가 숨겨지면 표시만 숨기고 돌아오면 마지막 위치를 복원한다. 페이지 이탈이나 작업 종료 때 제거한다.

[W3C Pointer Events](https://www.w3.org/TR/pointerevents3/#suppressing-a-pointer-event-stream)에 따라 HTML 드래그 시작 시 브라우저는 `pointercancel`로 포인터 스트림을 종료한다. 드래그에서는 이를 작업 취소로 해석하지 않고 `dragover` 좌표와 `drop`/`dragend`를 이어서 표시한다. 마지막 `drag` 이벤트의 부정확한 좌표로 커서가 원점으로 튀지 않도록 이동은 `dragover`에서만 읽는다. 실제 취소나 작업 종료의 정리는 기존 실행기가 담당한다.

검증은 실제 Chrome 확장의 클릭/호버/입력/프레임/모달/캡처/중지 경로와, 같은 helper에 실제 마우스 입력을 전달하는 중간 상태 검사로 나눈다. synthetic 이벤트 무시, 드래그 누름/놓음, 휠과 클릭의 시각 구분, 실행 중 모션 감소 전환, 좁은 화면을 검사한다. 표시 개선은 클릭 정확도나 실모델의 판단 성능 향상을 입증하는 결과는 아니다.

입력 피드백 검사는 실제 trusted `input` 이벤트 때 표시 상태, 초점, 표시 내부 텍스트를 기록하고 도구 반환 후 입력값을 별도로 확인한다. 완료 응답 뒤에는 idle 상태를 검사하고 입력 당시의 이벤트 기록과 구분한다. 커서가 유지되어도 동작이 계속되거나 성공했다는 뜻은 아니다.

## 클릭 안정화에서 발견한 문제

도움말의 `:hover`가 본문 높이를 바꾸는 페이지에서, 클릭 직전 도움말이 닫히면 기존 위치 아래의 iframe이 눌렸다. 포인터 표시를 완전히 끈 재현에서도 동일했다. `verification/pointer-hover-before.log`에는 명령 반환과 실제 잘못된 frame 클릭이 함께 남아 있다.

동일한 실제 대상에 먼저 호버하고, 연결/이름/타입을 다시 확인한 뒤 Playwright가 클릭 위치와 actionability를 다시 계산하도록 했다. 클릭을 재전송하거나 강제로 누르지 않는다. 이 사례와 프레임/Shadow DOM/모달/시각 좌표 클릭을 Chrome에서 검사한다.

포인터가 보였다는 사실은 목표 완료의 증거가 아니다. 해당 단계의 결과 검사와 최종 요구사항 검토를 계속 수행한다. 페이지가 표현 계층을 지울 수 있고, 같은 대상에 사용자가 동시에 trusted 입력을 보내면 완벽한 출처 구별도 보장하지 않는다. 표시를 보안 경계나 실행 영수증으로 취급하지 않는다.

## 2026-09-23 검증

단위 검사 480개, 디자인 검사, 후보 빌드가 통과했다. 같은 제품 빌드에서 포인터, 링크, 호버 링크, 키보드, JavaScript 대화상자, 팝업, 캡처, 단계별 드래그의 8개 스위트를 각각 새 Chrome 프로필로 3회 통과했다. 입력 표시의 수명이 끝난 뒤 검사하던 테스트 오류는 실제 이벤트 시점의 상태와 결과값을 각각 확인하도록 수정하고 3회 재검증했다.

[통합 검증 기록](../verification/pointer-ux/report.json)에 두 실행 보고서와 동일 빌드 해시, 후보 ZIP 해시를 남겼다. 영향 범위의 합성 페이지 검증이며 전체 릴리스 매트릭스나 사내 실모델 호출 검증은 아니다. 공개 배포는 수행하지 않았다.

### 가상 포인터 모양 개선

작은 화살표와 누비 배지, 180ms 클릭 피드백을 적용한 후보에서 단위 검사 489개, 디자인 검사와 빌드가 통과했다. 실제 Chrome의 포인터/호버 링크/클릭 피드백/캡처 4개 스위트를 새 프로필로 각각 3회 통과했다. 페이지의 기존 crosshair 커서 유지, 실제 hit 대상 보존, 화면 가장자리 배지 위치도 확인했다. OS 커서 위치를 직접 측정한 테스트나 실모델 평가는 아니다.

[검증 기록](../verification/pre-release-2026-09-23T09-14-20-987Z/report.json)과 [실제 화면](../verification/pointer-detail.png)을 남겼다. 후보 ZIP만 생성했으며 기존 공개 릴리스 파일은 변경하지 않았다.

### 이미지 기준 반영과 상태별 커서

후속 검증에서는 사용자 이미지의 검은 화살표/흰 테두리와 상태별 손/텍스트/드래그/비활성 모양을 적용했다. 기존 테스트가 제거한 호버 후광을 기대해 실패한 기록은 보존하고, 실제 상태 전환과 hotspot/입력 보존 검사로 갱신했다. 새 후보의 단위 검사 489개, 디자인, 빌드와 포인터/호버 링크/클릭 피드백/캡처 4개 스위트의 3회 반복이 모두 통과했다.

[최종 후보 검증](../verification/pre-release-2026-09-23T09-22-55-644Z/report.json)은 합성 페이지를 사용하는 실제 Chrome 실행이며 실모델/실계정이나 전체 릴리스 검증은 아니다. [기본 화살표](../verification/pointer-detail.png), [링크](../verification/pointer-link.png), [편집기](../verification/pointer-text.png) 캡처를 확인했다. 전체 OS 커서 위치를 측정한 검사는 아니며, 코드 경로는 기존 브라우저 입력만 사용한다. 이 후보는 공개 배포하지 않았다.


## 2026-09-26 연속 표시와 작업 화면 전환

원인은 매 행동마다 표시 DOM을 교체하고 짧은 타이머로 제거하던 수명 정책, 캡처 전 전체 제거였다. 같은 실행/문서에서는 표시를 재사용하고 실제 행동 동안에만 이벤트를 구독한다. 대상 프레임 외의 표시는 숨긴다. 캡처는 임시 `visibility:hidden` 스타일로 표시만 제외하며 사전 대기/관찰 동안에는 계속 보인다. 캡처 자체의 짧은 숨김과 페이지 이동 시 DOM 교체까지 없앴다고 주장하지 않는다.

| 검토한 실제 소스/공식 계약 | 채택과 제외 |
| --- | --- |
| [rrweb replay](https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb/src/replay/index.ts)의 setupDom/moveAndHover, MIT | 커서를 한 번 만들고 좌표/효과를 바꾸는 수명 패턴 채택. 소스 복사나 전체 사용자 녹화 SDK 도입은 없음. |
| [Playwright screenshot style](https://playwright.dev/docs/api/class-page#page-screenshot-option-style), Apache-2.0 | 이미 번들한 Playwright CRX의 캡처 전용 스타일을 실제 사용. 프레임에 적용하고 캡처 뒤 원복. 기존 인증값 마스킹 유지. |
| [Chrome tabs.update](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-update) | 소유 작업 탭이 선택되어 있을 때만 현재 에이전트 탭 활성화. 자동 경로에서 windows.update 호출하지 않음. |
| [Codex exec events](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs), Apache-2.0 | 실행 수명과 항목 수명의 구분 참고. 이 소스가 Codex 데스크톱 커서 구현을 공개하는 것은 아님. |

누비 그룹의 다른 작업 페이지로 이동하면 그 페이지를 따라간다. 사용자가 무관한 탭을 선택하면 자동 선택을 멈추고, 소유 탭으로 돌아오면 다음 도구에서 재개한다. 다른 창이 전면이어도 누비 창 안의 선택만 갱신하고 전면 창을 올리거나 최소화를 풀지 않는다. 선택 조회 중 사용자 전환 이벤트를 받으면 자동 전환을 버린다. Chrome의 탭 조회와 변경은 원자적 연산이 아니므로 모든 경합과 OS 환경의 완전 무간섭을 보장하지 않는다.

검증 결과는 [연속 표시 검증 기록](POINTER-CONTINUITY-2026-09-26.md)에 남긴다. 표시 유지 검증은 실제 모델의 정확도/업무 성공률과 별개다.

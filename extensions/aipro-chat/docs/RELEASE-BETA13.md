# nubi Beta 1.0.0 — beta13

2026-09-23. Chrome 업데이트 번호는 1.4.16입니다.

## 변경

- 업무 문장으로 필요한 도구를 검색하고, 읽은 스킬의 도구를 다음 단계에 연결합니다. 단계가 바뀌면 이전 선택 스키마를 줄일 수 있습니다. [구현과 근거](BROWSER-TOOL-DISCOVERY.md).

- AI 전용 포인터를 검은 화살표와 흰 테두리로 다듬었습니다. 링크, 텍스트와 드래그에 맞춰 모양이 바뀌고 실제 입력 위치에 맞춰 표시됩니다. 사용자 커서는 이동하지 않습니다.
- 호버 후 늦게 나타나는 메뉴와 툴팁을 기다린 뒤 다시 읽습니다. `aria-controls`가 없는 포털 메뉴도 감지하며, 이미 열린 다른 메뉴를 새 결과로 오인하지 않습니다.
- 업데이트 때 대화와 초안이 보존되는지 검사하는 재사용 가능한 Chrome 검증 스크립트를 추가했습니다.
- 압축 후에도 첨부 문서의 정확한 근거 위치를 다시 읽도록 문서 ID, 해시와 범위를 요약과 별도로 보존합니다. [하네스/멀티 에이전트 점검](AGENT-QUALITY-BETA13.md).
- 공유 컨텍스트 모듈은 최신 요구사항을 조회하는 옵션을 지원하며, 브라우저의 최근 두 턴 보존 기본값은 유지합니다. 공유 실행기의 정체 시 질문 전환 옵션도 포함되지만 Chrome 호출은 기존 기본값을 유지합니다.
- 클릭과 캡처, 실패 복구, 컨텍스트 압축과 하위 분석은 기존 Pi와 Playwright CRX 기반을 유지합니다. Windows 앱 제어, 로컬 실행기와 A2A는 추가하지 않았습니다.

## 검증

단위 검사 **495개**, 디자인 검사와 빌드가 통과했습니다. 실제 Chrome 검사 **182회**가 통과했고, 핵심 51개 흐름은 새 프로필로 3회 반복했습니다. [최종 전체 기록](verification/beta13-browser.json).

별도 체크아웃에서 빌드한 559개 파일과 배포 ZIP의 내용이 테스트한 파일과 일치합니다. 의존성 감사에서 보고된 취약점은 0개였습니다. 팝업 초점은 이번 실행에서 Chrome 후면 상태의 유지 여부를 확인했으며, 모든 OS의 전면 복원 검증으로 확대하지 않습니다.

배포 ZIP SHA-256: `f731e492190500173138b8fb55f7dd49c77a65153153b413197f59a07f88a82e`

- [첨부 근거 보존 재현과 수정](verification/beta13-context-continuity.json), [업무별 도구 검색 점검](verification/beta13-tool-retrieval.json).
- [업데이트 보존 검사](verification/beta13-upgrade.json), [독립 빌드 비교](verification/beta13-build-comparison.json), [ZIP 검사](verification/beta13-package.json).
- 첫 전체 검사에서 초점의 `lastFocusedWindow`를 실제 전면 상태로 혼동한 검사가 있었습니다. Chrome의 `focused` 상태로 구분하도록 정정했으며, 후면 상태 통과를 전면 복원 검증으로 표현하지 않습니다. [최초 기록](verification/beta13-initial-focus.json).
- 다음 검사에서는 대화 전환의 저장소 반영 직후 입력창 값을 즉시 확인해 실패했습니다. UI 갱신을 300ms 늦춰 저장된 초안은 있고 화면만 아직 비어 있는 상황을 재현했습니다. 저장과 렌더링을 각각 확인하도록 검사를 수정하고 3회 반복 대상에 추가했습니다. 제품 UI 코드를 바꾸거나 실패 기록을 지우지 않았습니다. [최초 기록](verification/beta13-initial-history.json), [타이밍 재현](verification/beta13-history-timing.json).

## 방법론과 오픈소스

[Playwright의 실행 가능성 검사](https://playwright.dev/docs/actionability)를 유지하면서 실제 노드에 입력하고 새로운 화면 근거로 다음 행동을 판단합니다. [WAI-ARIA 툴팁 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)의 지연 표시와 연결 속성을 적용했습니다. 가상 표시에는 [rrweb의 입력과 표시 분리 방식](https://github.com/rrweb-io/rrweb/blob/main/packages/rrweb/src/replay/styles/style.css)을 참고했으며, 녹화 SDK나 외부 마우스 프로그램은 추가하지 않았습니다.

[Anthropic의 평가 방법](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)에 따라 실행 로그만으로 성공을 판정하지 않고, 화면의 최종 값과 실제 입력 횟수, 승인 경계, 중단 후 복구를 함께 확인합니다. 실제 모델의 자율 판단 평가는 합성 모델을 사용하는 실행기 회귀와 구분합니다.

## 확인 범위와 남은 항목

실제 Chrome과 합성 업무 사이트/제공자 응답으로 검사합니다. [Qwen 실모델 평가 상태](verification/beta13-live-model.json)를 별도로 남깁니다. 평가용 인증값이 없어 실제 Qwen의 도구 선택 정확도, 회사망 SSO/API 및 실제 JSM/MCP 서버는 확인하지 못했습니다. Windows의 실제 Chrome/Edge 환경과 OS 폴더 선택 승인 화면도 별도 확인 대상입니다.

Chrome을 완전히 종료하거나 worker가 강제 종료되면 체크포인트에서 일시 중지하며 재관찰 후 이어갑니다. 같은 계정의 저장 데이터는 공유되므로 전용 창을 별도 계정 격리로 표현하지 않습니다. 임의 사이트의 모든 팝업 초점 동작, 닫힌 shadow root와 canvas 내부, 무제한 지연 메뉴를 보장하지 않습니다. 검증된 절차의 자동 학습/재사용은 아직 구현하지 않았습니다.

## 설치

[설치 ZIP](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.13/nubi-beta-1.0.0.zip)을 기존 설치 폴더에 풀고 `chrome://extensions`에서 새로고침합니다. 새 설치는 개발자 모드의 **압축해제된 확장 프로그램 로드**를 사용합니다. 웹 스토어 배포본은 아닙니다.

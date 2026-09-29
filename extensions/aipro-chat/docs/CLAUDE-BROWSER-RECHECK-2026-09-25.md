# Claude Chrome과 누비 재점검

후속 예약 결손과 월·연 반복 개선은 [예약·재사용 품질 재평가](CLAUDE-BROWSER-DELTA-2026-09-25.md)를 따른다. 아래 검증 수치는 그 이전 후보의 결과다.

검토일: 2026-09-25. 기준은 공식 Claude Chrome 1.0.94의 배포 JS 정적 분석과 공식 도움말, 현재 누비 소스다. Claude 확장의 원본 저장소나 재사용 가능한 라이선스는 확인되지 않았다. 배포 JS에서 API 이름이 보이는 사실과 실제 업무 성공은 구분한다. [이전 파일별 해시와 비교](CLAUDE-BROWSER-COMPARISON-2026-09-25.md)를 재사용했다. 공식 [스토어](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn), [기능 안내](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome), [권한](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide), [관리](https://support.claude.com/en/articles/13065128-claude-in-chrome-admin-controls)를 확인했다.

기존 26/26은 선정한 13개 기능의 실행 경로 점수다. Claude와 누비의 실제 성공률, 안전성이나 제품 동등성 점수가 아니다. 아래는 현재 코드의 차이와 검증 상태다.

| 범위 | Claude 근거 | 누비 현재와 판단 |
| --- | --- | --- |
| 탭 작업 공간 | 공식 `tabGroups` 권한 | 독립 누비 그룹/소유권 검사가 이미 구현됨. 이전의 미구현 설명은 현재 코드에 맞지 않음 |
| 콘솔/네트워크, 업로드/다운로드, 알림, 녹화, 예약, 조직 정책 | 공식 문서와 이전 CRX 정적 분석 | 기존 C01~C08, C10~C12 경로 구현. 실제 서비스/OS/조직 배포의 성공은 별도 |
| 승인 제어 | 공식 수동/자동/건너뛰기 모드 | 누비는 현재 사이트 권한과 최종 반영 HITL을 유지. Claude의 세 모드를 그대로 도입하면 기존 승인 경계가 달라져 비채택 |
| 예약 주기와 영상 | Claude는 월/연 반복, Claude Code 결합 GIF를 설명 | 누비는 한 번/매일/매주와 의미 기반 절차 기록. 영상/GIF, 월/연 주기는 기능 차이이며 이번 안전성 수정과 분리 |
| 기기간 이어받기와 비밀번호 관리자 | Claude 클라우드/Cowork/macOS 생태계 | 누비는 로컬 확장과 사용자 선택 모델. 서버와 별도 설치 경로를 강제하는 복제는 범위 밖 |
| 실제 업무 정확도 | 같은 계정/사이트/정답 기준 반복 실행 필요 | Claude/Qwen 동등 과제, 서버 저장 완료, OS 배너, 기업 정책 배포는 미측정 |

## 현재 코드에서 재현한 결함과 반영

| 우선순위 | 재현 | 변경 | 완료 조건 |
| --- | --- | --- | --- |
| P0 | 미확정 입력 뒤 다른 탭 또는 재로딩된 같은 URL/양식의 값을 검증해도 이전 쓰기의 대상과 혼동할 수 있음 | 시도 전 탭 ID와 Chrome 문서 ID를 보존하고 재관찰 및 실제 검증 결과의 최상위/대상 iframe 문서와 대조. ID가 없으면 임의의 ref 대조를 거부하고 재시작 기록을 차단 상태로 보존 | 다른 탭/문서/iframe은 실패, 같은 문서의 새 ref와 실제 값 확인만 통과. 워커 재시작 후 중복 쓰기 없음 |
| P1 | 열린 설정이 녹화 자동 만료, 예약 실행, 권한 철회를 반영하지 않음. 최초 조회 실패에 로딩 문구가 남음 | 관련 Chrome 저장소/권한 이벤트만 묶어 재조회하고 작성 중 초안은 그대로 유지. 실패 시 재조회 버튼, 초안에 자동 종료 이유 표시 | 실제 알람으로 녹화 종료, 예약 상태 변경 중 열린 화면 갱신과 초안 보존 |
| P1 | 녹화 시작·종료·저장이 여러 접힌 화면에 흩어지고 긴 단계 목록이 저장 폼을 밀어냄. 재녹화 시 미저장 초안이 덮어써질 수 있음 | 현재 단계의 주동작, 누비 상단 녹화 상태/종료, 3단계 미리보기와 나머지 펼침, 명시적 초안 교체, 저장 성공과 다음 실행 위치를 연결 | 실제 Chrome에서 버튼 경로, 초안 보존, 100단계, 360px 폼/저장 상태 검사. [흐름별 CX 근거](RECORDING-FLOW-2026-09-25.md) |
| P1 | 캡처의 개별 screenshot 7초만 제한되어 전후 DOM 레이아웃 조회가 무기한 대기 가능 | 레이아웃/스크린샷/재조회 전체에 단일 16초 기한과 취소 감시를 적용. 기한 초과 뒤 PNG나 클릭 가능한 screenshot ID를 만들지 않음 | 평가 호출 보류/취소에서도 유한 시간 종료, 새 screenshot 0 |
| P2 | 여러 턴의 사용자 참고 이미지 중 마지막 턴만 최종 검토에 전달 | 사용자 이미지 전체를 원래 순서와 턴 번호로 검토 입력에 연결. 모델 문맥에 모두 담기지 않으면 완료 검토를 실패로 처리 | 두 턴의 서로 다른 이미지 모두 전달, 예산 부족 시 허위 완료 없음 |

실제 적용한 공개 패턴은 [browser-use의 DOM/캡처 대기 분리](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/browser_use/browser/watchdogs/dom_watchdog.py), [Stagehand MV3의 남은 전체 시간과 정리](https://github.com/browserbase/stagehand/blob/514970e13f2ffe7528407dd2e57e41a77b61e785/packages/extension/handlers/handlerUtils/actHandlerUtils.ts), [Anthropic 공개 computer-use 예제의 이미지 문맥 관리](https://github.com/anthropics/claude-quickstarts/blob/dee71163217524eed07d79d00ffea5a7d02cedda/computer-use-best-practices/computer_use/loop.py)다. 각각 MIT 공개 소스의 방법론을 참고했고 코드를 복사하거나 새 런타임/패키지를 넣지 않았다. Python browser-use 실행기와 Stagehand 전체 교체는 확장 단독 설치/기존 Playwright 권한 계약에 맞지 않는다.

## 검증 경계

최종 동일 후보 회귀에 `uncertain-frame-browser`와 `full-page-captures-browser`를 추가했다. 녹화 흐름은 실제 Chrome의 합성 사이트 검사에서 재녹화 확인, 상단 상태, 저장, 긴 기록 축약과 320/360/1280px를 통과했다. 현재 소스의 [핵심 품질 보고서](../verification/pre-release-2026-09-25T09-47-20-792Z/report.json)는 86/86단계, [화면 아이덴티티 보고서](../verification/pre-release-2026-09-25T09-38-20-266Z/report.json)는 33/33단계 통과다. 두 보고서의 소스·빌드 해시가 같고 현재 작업 폴더의 검증 입력 해시와 일치한다. 실제 Claude/Qwen 동일 업무 정확도, 실계정 로그인, 회사 사이트 저장 완료와 OS 알림 표시는 미측정이다. 재시작·팝업·파일 저장 성공은 각각 다른 조건이다.

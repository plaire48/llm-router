# Claude in Chrome와 누비 비교 — 2026-09-25

최신 후속: [시각 문맥·바로가기 재점검](CLAUDE-BROWSER-VISUAL-AND-SHORTCUTS-2026-09-25.md), [예약 복구·검증 수준·월연 반복 재평가](CLAUDE-BROWSER-DELTA-2026-09-25.md), [녹화·저장 복구 비교와 개선](BROWSER-RECORDING-LIFECYCLE-2026-09-25.md). 아래의 이전 후보 검증은 현재 후보와 구분한다.

공식 배포 JavaScript와 공식 문서를 대조했다. C01~C04에 이어 미구현이었던 C05~C08의 파일 전송, 알림, 녹화/예약, 조직 정책을 구현했다. [구현 범위와 검증 경계](BROWSER-ROUTINES-2026-09-25.md)를 함께 확인한다. **기능 지원 점수는 실제 Claude/Qwen 업무 성공률이 아니다.** Claude를 로그인해서 같은 업무로 실행한 비교는 하지 않았다. 누비의 회귀 검사는 실제 Chrome과 합성 사이트/모델을 사용한다.

## 조사 대상과 재사용 경계

- Chrome Web Store의 [공식 Claude 확장](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn), ID `fcoeoabgfenejglbffodgkkbkcdhcgfn`, Google 공식 update2 배포 CRX **1.0.94**를 설치/실행 없이 압축 해제해 확인했다.
- CRX SHA-256: `325905e34e61ad37f3ff07eb5ecf81aa96eb8c310adca6ded2309fb9b724649d`. [manifest/다운로드 근거](../verification/claude-comparison-2026-09-25/claude-package.json), [파일별 해시와 API 식별자](../verification/claude-comparison-2026-09-25/claude-markers.json).
- `mcpPermissions-tSjXinpi.js`에서 `read_console_messages`, `read_network_requests`, `Runtime.consoleAPICalled`, `Network.requestWillBeSent`, `Network.responseReceived`, `chrome.downloads.download/search/onChanged`를 확인했다. 이 식별자는 코드 존재의 근거이며 실서비스 실행 성공 증거가 아니다.
- `SavedPromptsService-N3Mr18Wn.js`와 worker에서 alarms, managed storage, notifications 호출을 확인했다. 함수명만으로 서버 실행기, 상태 복구 또는 모델 품질을 추정하지 않았다.
- 배포 코드가 보인다고 오픈소스인 것은 아니다. 이 패키지에서 재사용을 허가하는 라이선스를 확인하지 못했으므로 Claude 구현 코드는 복사하지 않았다. 원문 코드는 임시 검토 폴더에 두고 저장소에는 메타데이터/해시만 남긴다.
- classic Chrome side panel, Cowork side panel, Claude Code 연결은 서로 다른 제공 범위다. 공식 문서상 녹화는 classic에 한정된다. 아래 표의 제한 표기를 함께 읽어야 한다. [공식 기능 안내](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)

## 채점 기준

**0 = 해당 경로 없음, 1 = 제한된 대체 경로, 2 = 명시한 기능의 실행 경로 있음, — = 비교 근거 부족 또는 다른 제품 범위.** 동일 가중치이며 기능 유무를 비교하기 위한 내부 기준이다. 안전성, 지능, 정확도, 속도 점수가 아니다. `D`는 공식 문서, `S`는 배포 코드의 정적 확인, `L`은 누비 로컬 Chrome 검사다. D/S와 L의 증거 강도는 다르다. 미공개 기능에 0점을 부여하지 않는다.

| 기능과 2점 기준 | Claude Chrome | 누비 최초 | 누비 현재 후보 | 비교 근거와 제한 |
| --- | ---: | ---: | ---: | --- |
| DOM 문맥을 읽어 대상 찾기 | 2 D/S | 2 L | 2 L | 누비 semantic ref와 프레임/열린 shadow DOM, Claude read/DOM 기능 |
| 화면 캡처와 시각 대상 조작 | 2 D/S | 2 L | 2 L | 누비는 이미지 지원이 확인된 모델에서만 시각 입력 사용 |
| 양식 입력과 여러 단계 조작 | 2 D | 2 L | 2 L | 실제 서버 등록 성공률을 뜻하지 않음 |
| 여러 탭을 구분해 작업 | 2 D | 2 L | 2 L | 누비는 소유 작업공간과 알려진 opener를 구분 |
| 사이트 접근과 중요 행동 승인 | 2 D/S | 2 L | 2 L | 승인 정책 내용은 서로 다르며 보안 동등성 주장이 아님 |
| 콘솔 경고/오류를 모델이 조회 | 2 D/S | 0 | **2 L** | 신규 `read_browser_diagnostics`; 연결 이후 현재 탭만 수집. 제한 프레임이 있으면 콘솔 수집 중지/범위 제한 표시 |
| 요청 실패/HTTP 상태를 모델이 조회 | 2 D/S | 0 | **2 L** | 본문/헤더 제외. HTTP 성공을 업무 완료로 판정하지 않음 |
| 사용자 이미지의 웹 업로드 | 2 D/S | 0 | **2 L** | 현재 대화 첨부 ID/해시, 보이는 파일 입력칸, 기존 HITL, 원본 파일 전송. hidden picker/폴더 제외, 서버 완료는 추가 확인 |
| 파일 다운로드와 완료 상태 추적 | 2 S | 1 L | **2 L** | 승인한 관찰 링크 → Chrome ID/완료/중단/미확정 영수증. complete와 내용 무결성 구분 |
| 업무 절차 저장과 반복 실행 | 2 D/S | 1 L | **2 L** | 의미 기반 클릭/입력 항목 녹화, 검토 후 기존 Pi가 재관찰. 같은 origin 최상위 화면, 값 미수집, 영상/GIF 아님 |
| 예약 시간에 업무 시작 | 2 D/S | 0 | **2 L** | Chrome alarm → 새 탭/기존 Pi 실행. 대화/계정/모델/스킬 일치 필요. 실제 알람+합성 모델 검사 |
| 완료/사용자 응답 필요 시 OS 알림 | 2 D/S | 0 | **2 L** | 선택 권한/중복 방지/해당 대화 복귀. Chrome API 접수 검사, OS 실제 표시 미검증 |
| 조직 관리자의 중앙 사이트 정책 | 2 D/S | 0 | **2 L** | managed schema와 origin 교집합, block 우선/잘못된 정책 차단/실행 중 변경 중단. 합성 정책으로 검사, 실제 조직 배포 미검증 |

기능 범위 합계: Claude **26/26**, 누비 **12/26 → 16/26 → 26/26**. 16점은 C01~C04 완료 시점, 26점은 C05~C08의 제한된 실행 경로를 더한 현재 점수다. 이는 위 13개 항목만의 지원 범위이며 Claude의 품질 100점 또는 누비 정확도 100점을 의미하지 않는다. Claude 배포 코드/문서와 누비 실제 로컬 검사는 같은 실험이 아니므로 승패를 판정하지 않는다.

기능 출처: [공식 Chrome 안내](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome), [권한과 승인](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide), [조직 정책](https://support.claude.com/en/articles/13065128-claude-in-chrome-admin-controls), 위 배포 코드 기록. 일반 파일 업로드와 GIF는 [Claude Code 결합 기능](https://code.claude.com/docs/en/chrome)도 있으므로 standalone 기능으로 합산하지 않았다.

| 실행 품질 기준 | Claude 점수 | 누비 이전 → 이번 | 판단 |
| --- | ---: | ---: | --- |
| 원하는 문구/URL까지 조건부 대기 | — | 1 → **2** | 누비의 고정 1초 wait를 선택적 조건 대기로 보완. Claude 동일 계약은 미확인 |
| 오류 근거를 제한된 복구 분석에 전달 | — | 1 → **2** | 기존 하위 분석에 콘솔/네트워크 고정 근거 전달 추가. 하위 분석에 live 제어 권한 없음 |
| 긴 문서 분할/검색/위임 | — | 2 → 2 | 기존 MiniSearch/LangChain/DeepAgents와 위키별 격리 유지. Claude Chrome 내부 동등 계약 미확인 |
| 미확정 쓰기 재전송 방지와 독립 완료 검토 | — | 2 → 2 | 기존 누비 영수증/실제 상태/최종 검토 유지. Claude 내부 상세 미공개 |
| 실제 Qwen 대 Claude 동일 업무 성공률 | 미측정 | 미측정 | 동일 사이트/계정/정답/실모델 반복 평가 필요 |

## 분석과 개선 목록

핵심 결손은 실패 후 원인을 읽을 도구가 없다는 점이었다. 화면이 갱신되지 않을 때 DOM만 재조회하면 서버 오류, 연결 실패, 프런트엔드 오류를 구분하기 어렵다. 또 1초가 지나도 화면이 늦게 나타나면 불필요한 모델 호출과 재시도가 생길 수 있었다. 콘솔/네트워크를 근거로 추가하되 업무 성공/실패의 최종 판정은 실제 화면과 영수증에 남긴다.

| ID / 순서 | 개선 | 상태 | 구현/완료 기준 |
| --- | --- | --- | --- |
| C01 / P0 | 콘솔/예외 진단 | 구현 및 로컬 검증 | Playwright console/pageerror, 현재 탭, 200개 제한, 조회 최대 40개, cursor, known-secret 필터 |
| C02 / P0 | 네트워크 실패 진단 | 구현 및 로컬 검증 | response/requestfailed, URL query 제거, 인증 페이지/다른 탭 제외, body/header/cookie 미수집 |
| C03 / P0 | 오류 복구에 진단 연결 | 구현 및 로컬 검증 | 실패 스크립트/검증/조건 대기에 진단 도구 노출, 고정 근거를 recovery analyst에 전달, HTTP 200으로 완료 검증 해소 불가. 새 로그 번호/중복 오류는 진전으로 취급하지 않음 |
| C04 / P0 | 조건부 대기 | 구현 및 로컬 검증 | text_present/url_is 두 번 연속 관찰, 250~15000ms 한 번 대기, 시간 초과 명시, 취소 중단, 쓰기 0회 |
| C05 / P1 | 웹 파일 업로드/다운로드 영수증 | 구현 및 로컬 검증 | 사용자 첨부 ID/해시와 관찰한 upload target을 결합, 반영 HITL, 읽기 확인/중복 전송 차단. 다운로드 interrupted/complete를 분리 |
| C06 / P1 | 완료/질문 OS 알림 | 구현 및 로컬 검증 | 사용자 선택 권한, 작업 ID 중복 방지, 클릭 시 해당 대화, 민감 본문 제외 |
| C07 / P2 | 녹화와 예약 업무 | 구현 및 로컬 검증 | 검토한 절차만 재사용, 예약은 새 실행/최신 탭 바인딩, 취소/미확정 쓰기 자동 재개 금지. 입력값 없이 의미 기반 절차만 기록 |
| C08 / P2 | 중앙 조직 정책 | 구현 및 로컬 검증 | Chrome managed 정책과 사용자 권한의 교집합, 기존 실행 중 정책 변경 처리, 조직 배포 검증 필요 |
| C09 / 평가 | 실제 모델 비교 | 외부 평가 미실행 | 동일 업무/정답과 실제 Claude/Qwen 계정으로 반복 측정. 기존 합성 회귀와 합산하지 않음 |

**C01~C08의 위 실행 경로를 구현했다. C09 실모델 비교는 미측정이다.** 26/26은 한정한 기능 존재 점수이며 Claude 제품의 모든 차이 해소, 영상/GIF 지원, 실계정 성공이나 보안 동등성을 뜻하지 않는다. 사용자에게 대표 업무 URL이 없다는 기존 답변을 유지한다. 기존 NQ-02/04/07/08의 실계정, 실제 서버, Windows/Edge, 공식 벤치마크 조건도 그대로다.

## 오픈소스와 방법론 선택

| 후보 | 라이선스/실행 적합성 | 결정과 이유 |
| --- | --- | --- |
| 기존 Playwright CRX 1.21.4 | Apache-2.0, 이미 확장 번들에 있음 | **실제 재사용**. 별도 CDP 세션/네트워크 프록시를 추가하지 않고 Page event listener와 기존 허용 URL 정책 사용 |
| Playwright 조건 기반 관찰 | 공식 [Page 대기 권고](https://playwright.dev/docs/api/class-page#page-wait-for-timeout) | **방법론 적용**. 고정 시간보다 상태를 검사. 기존 verifyPage의 가시성/URL 비교와 두 번 관찰을 재사용하되 wait는 최종 검증으로 처리하지 않음 |
| Pi Agent Core / p-limit | MIT, 기존 동일 모델 하위 분석 | **실제 재사용**. 새 에이전트 프레임워크 없이 근거 ID 전달과 제한된 recovery 역할 확장 |
| MiniSearch / LangChain / DeepAgents | MIT, 이미 사용 중 | 기존 문서 검색/긴 문서 위임 유지. 이번 결함은 검색 엔진 교체로 해결되지 않으므로 업그레이드하지 않음 |
| rrweb | [MIT](https://github.com/rrweb-io/rrweb/blob/main/LICENSE) | 미도입. [기록/재생 도구](https://github.com/rrweb-io/rrweb)이며 업무 의도/승인/최종 결과 판정을 대신하지 못함. C07은 원문 DOM 녹화 대신 값 없는 의미 기반 절차와 기존 Pi를 적용 |
| Chrome downloads/notifications/alarms/managed | 브라우저 API | **실제 적용**. C05~C08이 공식 API와 local 실행 상태를 사용. downloads/notifications는 선택 권한이며 기존 alarms/storage를 재사용 |
| buffer 6.0.3 | MIT, [upstream](https://github.com/feross/buffer) | **신규 도입**. Playwright buffer 업로드 계약에 원본 bytes를 전달. 전이 의존성 라이선스 포함 |
| Claude 배포 코드 | 재사용 허가 미확인 | 기능/구조 비교만 수행. 코드 복사/의존성 편입 없음 |

네트워크 진단은 [Playwright Page 이벤트](https://playwright.dev/docs/api/class-page#page-event-console)의 공개 API를 사용한다. C01~C04에는 새 의존성이 없었다. 후속 C05는 buffer를 추가했으며 Native Messaging/라우터는 추가하지 않았다. 파일 전송은 기존 승인을 거친다.

## C01~C04 검증 이력

- 신규 단위 검사: 비밀 패턴/query 제거, body/header 비접근, 탭 객체 격리, navigation/stop 정리, 제한/cursor/값 복사, 완료 검증 유지, recovery 하위 분석 근거 전달.
- 추가 경계 수정: console/pageerror의 발생 프레임을 확정할 수 없어 제한된 iframe이 존재하면 해당 콘솔 수집을 중지한다. 실제 auth iframe에서 출력한 오류가 진단에 나타나지 않고 `limited_by_restricted_frames`를 반환하는 것을 확인했다.
- 실제 Chrome: 로컬 HTTP 서버에서 버튼 한 번으로 console/error/503/연결 실패 발생. POST는 끝까지 **1회**. 다른 탭 제외, navigation 정리, 새 실행 초기화, 지연된 문구/URL 대기, 미충족/잘못된 인자/사용자 중지 검사.
- 신규 브라우저 suite를 `quality-baseline-v3`에 추가했다. 기존 65회에 신규 3회를 더한 **68회** 고정 회귀 계획이다. 전체 배포 매트릭스는 아니다.
- 중간 회귀는 진단 cursor/ID 변경이 복구 실패 기록을 초기화하는 결함을 추가 재현해 중단했다. 같은 503 로그의 ID/개수/cursor가 바뀌어도 반복 조회로 계산하고 실패 기록을 보존하도록 수정했다. 서로 다른 새 진단도 업무 진전으로 처리하지 않는다. 중단 결과를 최종 통과 수에 합산하지 않는다. [중간 근거](../verification/claude-comparison-2026-09-25/intermediate-findings.json).
- 초기 검사 실패도 기록: 브라우저 테스트가 취소한 실행 ID를 다시 사용해 정상적인 `cancelled` 응답을 받았다. 새 실행 ID로 수정했다. 기존 무검색 fixture의 `zzzz_unavailable_capability`는 신규 설명의 `unavailable`과 실제로 일치해, 존재하지 않는 단일 토큰으로 fixture를 수정했다. 제품의 취소/검색 계약을 완화하지 않았다.
- 최신 실행 결과와 해시는 [검증 요약](../verification/claude-comparison-2026-09-25/report.json)에 기록한다. 실제 Claude 로그인 실행/Qwen 정확도/사내 서버 성공/배포는 검증하지 않았다.


### 이전 C01~C04 후보 검증 결과

- [동일 후보 보고서](../verification/pre-release-2026-09-24T16-17-38-731Z/report.json), [당시 비교/변경 검증 요약](../verification/claude-comparison-2026-09-25/report-c01-c04.json).
- 단위 **744/744**, 고정 Chrome 회귀 **68/68**. 디자인/후보 빌드 통과. `quality-baseline-v3`, `fullMatrix=false`, `releaseApproved=false`. 검사 중 소스/테스트/의존성 입력과 빌드 해시 불변.
- 신규 단위 7개. 실제 Chrome의 새 진단/대기 시나리오는 새 프로필 3회 모두 통과했다. 중간 중단 2건과 초기 fixture 실패는 별도 보존하며 최종 수치에 합산하지 않는다.
- 빌드 트리 SHA-256: `4902f4ca83d9a9473b6bf8d4808f6e3e804a497b5f3b6bee59bd345d0b97565c`. 후보 ZIP SHA-256: `14a461bb53a668e679ce76609ed219c3bdf6bf8de8455fc6d97abcb3aded04aa`.
- npm audit production/개발 의존성 포함 알려진 취약점 0건. 새 의존성 없음. 기존 Playwright/Pi/p-limit 재사용.
- 이 이전 후보는 C01~C04만 포함한다. C05~C08은 후속 구현에 포함하며 실제 모델 정확도/실계정/사내 서버 성공은 미측정이다. 설치본 교체와 공개 배포는 하지 않았다.


## C05~C08 최종 후보 검증

- 단위 **756/756**, 고정 Chrome 기준선 **71/71**(21종 × 3회 + 8종), 별도 화면/통합 **22/22**. 디자인 검사와 후보 빌드 통과. 두 gate의 단위 검사를 중복 합산하지 않는다.
- [품질 기준선 보고서](../verification/pre-release-2026-09-24T17-35-22-617Z/report.json), [화면/통합 보고서](../verification/pre-release-2026-09-24T17-47-56-638Z/report.json), [최종 검증 요약](../verification/claude-comparison-2026-09-25/report.json). `quality-baseline-v4`, `fullMatrix=false`, `releaseApproved=false`.
- 각 실행 중 입력과 빌드 해시 불변. 두 gate의 제품 빌드는 동일하다. 중간에 접근성 테스트의 새 설정 기대 목록/키보드 검사를 갱신했으므로 테스트 디렉터리 해시는 다르다.
- 추가 발견/수정: 권한 허용·철회·재허용 이벤트, 놓친 다운로드 이벤트 조회, 알림 영수증 100개 제한, 잘못된 정책의 화면 표시, MV3 워커 휴면과 Chrome 전체 재시작 구분. 실제 워커 종료 전후의 예약 복구 실패/통과를 보존했다. [실패와 수정 근거](../verification/claude-comparison-2026-09-25/followup-findings.json).
- 제품 빌드 SHA-256: `8d976b0570d300f802c8af3cd60b0a6bb6cb9eff31cb8302ac86d3a0fb3af035`. 최종 화면 검사 후보 ZIP SHA-256: `39115af69ceb92a22a7298a09ca94bbcb115049e9d4ee4132ff1cceb232e2061`. 기준선 ZIP 해시는 해당 보고서에 별도로 보존한다.
- [npm audit](../verification/claude-comparison-2026-09-25/audit.json): 개발 의존성 포함 알려진 취약점 0건. buffer 6.0.3과 전이 라이선스를 포함했다. Claude 코드는 복사하지 않았다.
- 실제 Claude/Qwen 성공률, 사내 서버 저장 완료, OS 배너 표시, 조직 정책 배포와 네이티브 권한 대화상자 승인은 별도 검증이다. 설치본 교체와 공개 배포는 하지 않았다.


## C10~C12 후속 복구 재점검

[녹화 종료와 저장 복구 비교표](BROWSER-RECORDING-LIFECYCLE-2026-09-25.md)를 추가했다. 공식 CRX 1.0.94는 재다운로드한 해시가 동일했다. 녹화 만료/탭 종료/초안 저장 실패/응답 유실의 네 조건을 별도로 평가해 2/8에서 8/8로 개선했다. 기능 지원 26/26이나 실제 모델 성공률과 합산하지 않는다. 만료·탭 종료 처리, 저장 실패 체크포인트, 같은 초안 중복 저장 방지를 구현했다. 최종 후보의 회귀 결과는 후속 검증 요약에 기록한다.


### 후속 최종 검증 결과

- 전체 단위 **761/761**, 고정 Chrome 회귀 **71/71**, 디자인 검사와 후보 빌드 통과. [동일 후보 보고서](../verification/pre-release-2026-09-25T00-39-27-254Z/report.json), [후속 검증 요약](../verification/claude-lifecycle-2026-09-25/report.json).
- 새 녹화 만료/탭 종료 시나리오를 포함해 21종은 새 프로필 3회, 별도 8종은 1회 검사했다. UI 소스는 바꾸지 않았고 현재 routines suite에서 360/1280px을 확인했다. 이전 후보의 identity 22종 결과를 이번 후보에 합산하지 않는다.
- 입력/빌드 해시 불변. 제품 빌드 SHA-256 `085fc7bb6914863d6f7c163888dacc1913f1b06c48ce062a1a9f4ed09792c325`. 후보 ZIP SHA-256 `2e4b46c44b2cb5c1a3cface2772cb481afd98222b85d1134c28624d03a5d6dcb`.
- 신규 단위 5개, 수정 전 저장 실패 재현 2개. 새 의존성 없음, npm audit 알려진 취약점 0건. 실모델 정확도와 공개 배포는 검증하지 않았다.

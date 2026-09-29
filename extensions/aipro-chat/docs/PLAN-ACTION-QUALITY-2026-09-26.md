# 첫 계획과 브라우저 실행 개선

2026-09-26. 대상은 Chrome 확장 누비다. 계획 생성, 실제 대상 관찰, 행동, 단계 결과와 최종 검토를 연결한다. 브라우저 관찰/하위 분석/공식 하네스 연구를 병렬 점검하고 아래 변경을 통합했다.

| 우선순위 | 재현한 문제 | 실제 반영 | 확인 |
| --- | --- | --- | --- |
| P0 | 첫 계획 응답 형식이 맞지 않으면 같은 요청 2회 뒤 plan_failed로 종료 | 단일 계획/질문 호출과 전체 JSON 계획을 같은 스키마로 검증. 형식 실패 코드를 다음 요청에 전달하고 지원되는 제공자에서만 도구 응답 요구 | 실제 ChatGPT 어댑터 합성 재현 3 HTTP/도구 0회 실패. 변경 후 JSON 계획 1회 수용과 수정 응답 후 저장→읽기 확인. 새 13개와 관련 68개 통과. 실제 Chrome 워커 시작/RPC 확인 |
| P0 | 닫힌 details의 숨은 기록 5,100개가 뒤의 입력/버튼을 읽기 예산에서 밀어냄 | 숨은 자식은 순회하지 않고 첫 summary만 관찰. 펼치면 새로 읽음 | 변경 전 실제 Chromium 입력 누락, 변경 후 관찰과 부분 범위 복원 |
| P0 | visibility:collapse를 가시 대상으로 간주 | 관찰과 실행 전 검사에서 숨김 처리 | ref 미노출, 정상 Playwright 클릭 거부, 클릭 이벤트 0회 |
| P0 | 다음 출처로 이동하면 이전 본문도 폐기해 비교 근거를 잃음 | URL/frame/SHA-256/문자 범위가 검증된 page_content를 참고 스냅샷으로 보존. 같은 출처의 새 hash는 구버전 무효화 | Chrome에서 원문 2회, 링크 클릭 1회, 재방문 0회로 첫 계획 단계와 최종 검토 통과 |
| P0 | revise 단계 검토에서 같은 완료 제안 3회가 사용자 정보 부족 질문으로 전환 | 동일 근거/실패 키의 읽기 전용 recovery quick 조언을 먼저 전달. 주 실행기가 새 읽기/재검토 후 단계 완료 | 실제 Pi 재현 read_page → ask_user에서 read_page → recovery 조언 → 새 read_page → 검토 통과 → update_plan으로 개선. blocked/미확정 쓰기/정정/중복/미연결 경계 6개 검사 |
| P0 | 오류 문서의 DOM 연결 실패가 소유 탭 복구까지 차단 | list_tabs/switch_tab의 transient 메타데이터 경로. 정상 탭 전환 후 실제 문서 재연결 | Chrome 오류 문서 복구, 사용자 탭 제외, 미확정 쓰기와 조직 정책 차단 유지 |
| P1 | recovery 역할이 있어도 모델이 위임을 선택하지 않으면 시작되지 않음 | 같은 타깃 실패 2회에 기존 Pi/p-limit recovery quick 과제 1개 자동 시작 | 실제 Pi 하위 호출/조언 전달, 중복 시작 방지, 사용자 정정 취소 |
| P1 | 작은 실패 기록도 별도 조회를 위한 모델 왕복이 필요 | 배정된 기록 최대 2개와 직렬화 5,000자 한도로 첫 문맥에 전달 | 합성 Pi 진단에서 모델 결정 2회 경로를 1회로 줄임. 실모델 지연 측정은 아님 |
| P1 | partial 인계에 미확인/다음 행동이 비거나 문맥 초과 원인이 사라짐 | partial 유지, 실제 오류 이유와 부족한 확인/다음 행동 보완 | 기존 분석 회귀 76개와 신규 5개 통과. 취소 후 늦은 보고 폐기 |

## 원문과 현재 화면 구분

오류, 빈 본문/빈 범위, 잘못된 hash와 절단된 근거는 긍정 인용으로 승격하지 않는다. queryFiltered와 coverage.partial을 보존해 부분 조회를 전체 조사나 전역 부재로 바꾸지 않는다. 당시 원문은 현재 입력, 클릭 대상, 승인, 서버 저장 또는 미확정 쓰기의 근거가 아니다. 페이지 이동 뒤 DOM/ref/검증 결과는 계속 폐기한다. 두 출처는 검토 예산에서도 보호하고 모두 들어가지 않으면 한쪽을 조용히 버리지 않고 검토 한도 오류를 반환한다.

자동 recovery는 정해진 타깃 실패의 같은 정규화 호출/이유가 두 번 나왔을 때 현재 고정 근거만 배정한다. 최근 128개 실패 식별자 안에서는 동일 실패를 다시 자동 배정하지 않으며 기존 recovery 실행, 미확정 쓰기, 질문 대기와 검토 복구 중에는 시작하지 않는다. 현재 선택 모델을 유지하고 자식은 클릭/입력/탭 이동/승인 권한이 없다. 실제 시작/읽기/보고/전달만 기존 진행 기록에 표시한다. 사용자 추가 지시는 자동 복구/비교 워커를 취소한다.

## BP와 오픈소스

공식 소스와 라이선스/비용 비교는 [Codex/OpenCode/Claude/Stagehand/Nanobrowser 검토](HARNESS-BP-2026-09-26.md), [Playwright 액션 점검](ACTION-AUDIT-2026-09-26.md), [하위 분석 점검](DELEGATION-AUDIT-2026-09-26.md)에 있다. Playwright 가시성/actionability와 Anthropic의 격리된 문맥/역할별 워커, Codex/OpenCode의 계획/실행 결과 분리와 실패 피드백을 기존 실행기에 적용했다. Claude 내부 코드를 공개 소스로 주장하지 않는다.

기존 Pi 0.87.1, p-limit 7.3.3, Playwright CRX 1.21.4와 Readability/Turndown/LangChain을 개선했다. 새 프레임워크나 별도 CLI 런타임은 추가하지 않았다. 공유 페이지의 의존 쓰기는 순차 실행하고 독립 분석만 병렬 실행한다.

## 검증

- [변경 전 회귀](../verification/plan-action-quality-2026-09-26/source-before.log): 4개 중 3개 실패로 이전 출처 폐기, 구버전 유지, 잘못된 hash 인용 문제 재현.
- [원문/기존 검토 48개 회귀](../verification/plan-action-quality-2026-09-26/source-unit.log), [자동 복구/정정 취소](../verification/plan-action-quality-2026-09-26/recovery-unit.log) 통과.
- [실제 Chrome 첫 단계](../verification/source-reference/browser.json): 각 출처 방문 1회, 링크 클릭 1회, 본문 조회 2회, 첫 계획 단계와 최종 검토 확인. Node 공통 Pi 하네스와 확장의 실제 도구를 연결한 합성 모델 시험이며 전체 UI/실계정 모델 성능 시험은 아니다.
- 통합 전 전체 단위 922개와 후보 빌드 통과. 품질 목록 NQ-37과 고정 baseline v6에 새 관찰/첫 단계/검토 복구 회귀를 추가했다. 이전 v5는 새 소스의 완료 근거가 아니다.
- [추가 오류 탭/검토 복구 변경 전 core gate](../verification/pre-release-2026-09-26T06-45-11-641Z/report.json)는 103개 단계 전부 통과했다. 전체 단위 922개, 디자인 검사, 후보 빌드와 실제 Chrome 100회다. 주요 29개 종류는 3회씩, 나머지 13개 종류는 1회 실행했다. 당시 quality:status도 입력 해시와 NQ-37 current_core_passed를 확인했다. 이후 오류 탭/검토 복구 변경은 별도 최종 gate로 확인한다. 로컬 합성 모델/사이트 검증이며 실서비스 성공률은 아니다.
- [오류 탭/반복 단계 검토까지 통합한 core gate](../verification/pre-release-2026-09-26T07-09-49-002Z/report.json)는 단위 928개, 디자인, 후보 빌드와 Chrome 100회를 포함한 103개 단계 전부 통과했다. 이후 세 번째 실모델 시험에서 발견한 첫 계획 응답 복구 변경은 이 보고서의 검증 범위가 아니다.
- [최종 동일 후보 core gate](../verification/pre-release-2026-09-26T07-33-05-839Z/report.json)는 첫 계획 형식 복구와 파서 배포 수정까지 포함해 103/103 단계를 통과했다. 단위 941개, 디자인, 후보 빌드, Chrome 100회다. quality:status에서 현재 입력 해시와 NQ-37 current_core_passed를 확인했고 최종 실측과 ZIP SHA-256도 일치했다. actualModelQuality=null, releaseApproved=false이며 실제 완주 성공은 여전히 미검증이다.

평가 목록 확장 첫 실행은 과거 v5/87회 fixture 기대값에서 실패했다. v6/100회 및 구버전 보고서 거부로 전제를 갱신했고 해당 17개 품질 목록 검사를 통과했다. 실패 보고서는 보존하고 제품 성공으로 합산하지 않는다.

실모델은 이전에 선택한 GPT-5.6 Luna와 누비 자체 ChatGPT SSO로 Naver v2 한 건을 별도 측정한다. 인증 전에는 모델 호출/정확도를 측정한 것으로 표시하지 않는다. 독립 채점 없이 completed 상태로 정답률을 산출하지 않는다. 릴리스 업로드는 수행하지 않는다.

## Luna 실제 Naver 재시험

[2026-09-26 실측](../verification/naver-sso-luna-2026-09-26T06-45-34-662Z.json)은 누비 자체 ChatGPT SSO 인증과 gpt-5.6-luna를 확인했다. Naver v2 1번 과제는 205.516초 후 awaiting_user로 중단됐다. 요청 42회, HTTP 200 42회, HTTP 오류 0회다. 정답/전체 요청 완료는 확인하지 못했다. 첫 단계의 실제 plan/검토 상태가 기존 보고서에 보존되지 않아 단계 완료도 미확인으로 남긴다.

42회의 HTTP 응답 헤더 도착 중앙값은 927ms, p95는 2,036ms다. streaming 종료 이벤트가 수집되지 않아 모델 전체 응답 시간은 미측정이며 totalMs 0을 지연 0으로 해석하지 않는다. 실행 도구는 초기 화면 관찰 1회, 페이지 이동 시도 4회, 탭 전환 시도 3회, 탭 조회 4회, 단계 검토 7회였으며 read_page와 delegate_analysis 호출은 없었다. 타깃 클릭/입력 실패 조건에 해당하지 않아 새 자동 recovery가 실행됐다는 실모델 증거도 없다.

126.4초에 navigate_page, 이후 switch_tab 2회와 list_tabs 2회가 실패했다. 모델은 페이지 권한 오류라고 질문했지만 평가 manifest는 HTTPS 호스트 접근을 미리 허용했으며 기존 요약은 실제 호스트 오류 코드를 버렸다. 따라서 사용자 권한 미허용을 원인으로 확정하지 않는다. 현재 문서 연결이 실패해도 탭 복구 경로가 가능한지 로컬 재현하고, 별도 진단판은 동작을 바꾸지 않고 알려진 오류 코드/횟수와 실제 plan/검증 상태를 수집한다.

## 오류 탭 복구 재현

[실제 Chrome 재현](../verification/plan-action-quality-2026-09-26/workspace-error-before.json)에서는 정상 소유 탭에서 https://127.0.0.1:9/news 오류 문서로 이동한 뒤 바깥 connectWorkPage가 page_permission으로 실패했다. 같은 실행의 직접 list_tabs는 이미 소유한 두 탭을 반환했고, 정상 소유 탭으로 switch_tab한 뒤 실제 문서 연결은 다시 성공했다. 실행 시간 제한(기본 10분, 활동 중 lease 갱신)은 최초 실측 126초 실패를 설명하는 근거가 아니다. 실제 Naver 실패와 동일 원인이라는 단정은 하지 않는다.

Chrome 공식 [tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)와 [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)는 탭 메타데이터 조회와 문서 주입을 구분한다. 이 계약에 맞춰 소유 탭 조회/전환의 사전 문서 연결 의존성을 분리한다. 기존 lease/대화/제공자/인증 시점/window/tab 소유권, 정책, 승인/미확정 쓰기 차단은 유지한다. 문서 접근에 실패해도 임의 사용자 탭을 채택하거나 오류 페이지 읽기를 허용하지 않는다.

[코드/계획 진단 재시험](../verification/naver-sso-luna-2026-09-26T06-57-19-222Z.json)은 동일 v2 과제에서 213.719초, Luna 요청/HTTP 200 각각 36회, HTTP 오류 0회였다. 실제 계획의 첫 단계는 in_progress이고 나머지 둘은 pending이다. 정상 클릭 3회, browser_stale 클릭 1회, read_page 3회, verify_page 실패 2회/성공 1회, 별도 review_task 5회 후 “현재 페이지에 없는 뉴스 원문/갱신 시각을 미확인 처리해 보고할까요?”라고 질문했다. 이 시험에는 page_permission 실패가 없다. 현재 화면의 부족한 근거와 다른 출처 조사로 이어지지 못하는 경로를 별도로 점검하며, 정상 클릭을 전체 요구사항 완료로 계산하지 않는다.

진단은 복사한 평가용 background의 handle 반환값에서 알려진 오류 코드/횟수만 관찰한 임시 계측이다. 원래 입력/출력/예외를 그대로 전달하며 인증값, 도구 인자와 원문은 수집하지 않는다. 보고서의 ok false는 ok 속성 없는 조회 응답도 포함하므로 error 또는 실제 verification/plan 상태로 실패를 판정한다. 후보 archive hash와 계측 여부를 함께 남겼다. HTTP 헤더 중앙값 1,061ms/p95 2,744ms이며 전체 모델 응답 종료 시간은 여전히 미측정이다.

반복 계획 검토 복구는 주 실행기를 대신 완료 처리하지 않는다. 같은 계획 완료 제안이 3회 거부되고 독립 검토가 revise/구체적 next_step을 반환한 경우에만 배정 근거 1개로 분석한다. 사용자 정정 시 취소하고 최신 근거 없는 결과는 완료 인용으로 바꾸지 않는다. 새 6개와 기존 하네스 회귀 합계 105개를 통과했다. 최종 요구사항 검토의 별도 no-progress 분기는 이번 변경 범위가 아니며 남은 실제 완주 평가에 포함한다.

## 최신 후보의 계획 생성 실패

[세 번째 실모델 시험](../verification/naver-sso-luna-2026-09-26T07-13-15-152Z.json)은 로그인 후 18.974초, 모델 요청/HTTP 200 각각 3회 뒤 plan_failed로 끝났다. plan, 브라우저 도구와 답변은 없었다. 앞선 오류 탭/반복 단계 검토의 수정 효과를 검증할 단계까지 도달하지 못했으며 실서비스 완주 성공으로 계산하지 않는다. 기존 계획 재요청은 같은 문맥에서 형식 피드백 없이 두 번 실행한다. 응답 원문/형식 실패 이유가 보존되지 않아 특정 모델 형식을 원인으로 단정하지 않고 이 경로를 별도 점검한다.

[변경 전 합성 어댑터 재현](../verification/plan-action-quality-2026-09-26/plan-format-before.json)은 완전하고 유효한 JSON steps를 두 번 글로 반환했을 때 동일한 3 HTTP/도구 0회/plan_failed 형태를 보였다. 이것이 실제 Luna 응답이었다는 증거는 아니다. [계획/제공자/기존 검토 회귀 81개](../verification/plan-action-quality-2026-09-26/plan-format-regression.log)를 통과했다. 원래 목표/금지 조건, 질문 검증과 초기 상태 재설정은 유지하며 혼합/중복/미지원 도구를 실행하지 않는다. 인증 오류와 취소는 형식 재요청으로 바꾸지 않는다. 실제 검증 실패 코드만 기존 recover_model 진행 기록에 남기고 모델 원문/인자는 저장하지 않는다.

[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)의 도구 응답 요구와 로컬 고정 Pi SDK의 toolChoice 계약을 검토했다. 계획의 두 번째 요청에만 ChatGPT/AI Pro required를 사용한다. FabriX는 기존 어댑터가 required를 지원하지 않으므로 auto와 형식 피드백을 유지한다. 새로운 파서 라이브러리 대신 기존 TypeBox의 CSP 호환 스키마 검증을 재사용한다. provider 전반의 strict 옵션이나 새 실행기를 추가하지 않는다. ChatGPT 경로는 요청의 maxTokens를 별도 전송하지 않으므로 2048→4096 코드 값을 실제 생성 한도 증가라고 계산하지 않는다.

## 계획 파서 배포 경계 재검증

계획 복구를 처음 통합한 후보는 Node 검사와 빌드가 통과했지만 Chrome 워커가 시작하지 못했다. 원본 ESM으로 복사하는 task-plan이 패키징되지 않은 tool-validation을 참조했다. [의존성 누락 증거](../verification/plan-action-quality-2026-09-26/plan-format-package-before.json)를 보존하고 해당 [진행 중 gate](../verification/pre-release-2026-09-26T07-27-13-352Z/report.json)를 중단했다. 완료되지 않은 브라우저 단계를 통과로 합산하지 않는다. [평가 준비 실패](../verification/naver-sso-luna-2026-09-26T07-28-34-537Z.json)도 모델 호출 0회이므로 네 번째 모델 실패나 정확도 점수로 계산하지 않는다.

스키마 파서를 번들 전용 planning-response로 분리하고 task-plan과 agent-trace의 원본 ESM 의존성에는 패키지 import를 두지 않았다. Acorn으로 이 두 원본 모듈의 상대 의존성과 실제 복사 목록을 대조하는 회귀를 추가했다. 이는 실제 워커 부팅 검사를 대체하지 않는다.

[수정 후 실제 Chrome 시작](../verification/plan-action-quality-2026-09-26/plan-format-package-after.json)은 배포 워커의 정적 ESM 87개 파일, 워커 기동과 채팅 페이지 GET_STATE RPC를 확인했고 pageErrors는 없었다. 이 검사는 모델 추론이나 네이버 과제 완주 검사가 아니다.

## 최종 후보의 실제 Naver 실행

[동일 후보 실측](../verification/naver-sso-luna-2026-09-26T07-34-09-964Z.json)은 GPT-5.6 Luna/누비 ChatGPT SSO로 계획 생성과 실제 행동에 진입했다. 모델 요청/HTTP 200 각각 55회, HTTP 오류 0회였다. 최종 계획은 0/3 완료, 첫 단계 in_progress, 둘째와 셋째 pending이며 답변은 없었다. 481.863초 후 평가기의 8분 제한으로 중지했다. stopConfirmed=true이고 앱 자체 오류/질문에 의한 종료는 아니므로 이전 awaiting_user/plan_failed와 같은 종료 원인으로 합산하지 않는다.

클릭 6회, 이동 2회, 탭 전환 6회는 완료했으나 단계 완료 증거가 아니다. verify_page는 통과 4회/실패 1회, 독립 검토 5회 합계 30.432초였다. 마지막 검증 통과는 마지막 화면의 검사만 증명한다. read_page는 1회, browser_snapshot은 0회였고 page_content 원문 패킷은 수집되지 않았다. 서로 다른 출처의 명시적 읽기 2회가 없어 자동 비교 워커의 시작 조건을 충족했다고 볼 수 없다. 명시적 delegate_analysis는 2ms 오류로 끝났고 analysis 역할의 시작/완료 기록은 없었다. 입력/근거 범위의 사전 거부가 의심되지만 실제 오류 코드/인자가 보존되지 않아 원인을 확정하지 않는다.

진행 중 [계획/화면 기록](../verification/plan-action-quality-2026-09-26/final-live-step-progress.json), [저장된 검토/위임 이벤트](../verification/plan-action-quality-2026-09-26/final-live-trace-progress.json), [안전한 오류 코드 관찰](../verification/plan-action-quality-2026-09-26/final-live-safe-error-codes.json)을 보존했다. verification_required와 verification_failed를 확인했지만 검토의 정확한 미충족 항목은 저장된 자료만으로 확정할 수 없다. 화면에서 본 “열람 완료”와 실제 계획 완료를 구분한다.

헤더 도착 중앙값 946ms/p95 3,191ms이며 전체 모델 응답 종료는 미측정이다. 탭 전환 완료에서 다음 클릭 시작까지 103초와 105초 공백도 관측됐다. 모델 생성, 문맥 구성, 관찰과 중간 판단 중 어느 부분이 차지했는지는 분리 계측 전이다. 답변/독립 사실 채점이 없어 정확도는 미측정이다. 후보 SHA-256은 `d950ac5ef319cc3a16943775d5737edaebc9850c3d0268950819d7f12bec7cd2`다.

남은 개선 순서는 출처 이동 때 실제 비교용 원문을 확보하는 경로, 유효한 근거 ID에 기반한 위임과 거부 코드/스키마 경로 기록, 첫 후보 식별과 후속 세 출처 대조의 완료 조건 분리, 전체 모델 응답 종료 계측이다. 현재 구현한 조건부 복구가 이 실측에서 실행됐다는 증거는 없으며 실제 완주 문제를 해소했다고 판정하지 않는다.

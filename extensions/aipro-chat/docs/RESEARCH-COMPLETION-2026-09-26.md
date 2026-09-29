# 조사 근거와 단계 완료 연결

이 변경은 실제 네이버 과제가 첫 계획 0/3에서 끝난 기록을 바탕으로 한다. 이전 941개 단위 검사와 Chrome 100회 통과는 실제 완주 증거가 아니었다. 이번에도 합성 모델과 실제 모델 결과를 분리한다.

## 확인한 문제와 수정

| 문제 | 적용한 수정 | 완료로 오해하면 안 되는 경계 |
| --- | --- | --- |
| 페이지를 열고 탭을 오갔지만 원문 패킷은 없었음 | 읽기 전용 비교 요청에서 열린 문서의 첫 본문 구간을 기존 read_page로 확보. 문서 ID를 대조한 뒤 URL, hash, ranges와 함께 보존 | 첫 구간은 전체 문서 열람이 아님. 부족하면 같은 hash로 추가 조회 필요 |
| 단계 검토에 전체 요청 완료를 요구하는 공통 문구가 섞였음 | plan_step은 해당 단계 결과만 검토. 최종 검토는 원래 전체 요청의 모든 필수 조건 유지 | 단계 통과가 최종 완료는 아님 |
| 잘못된 하위 위임의 의미상 오류는 analysis_scope만 반환 | 실제 사용 가능한 ev_N ID와 잘못된 필드/범위를 반환 | 실패한 위임을 워커 실행으로 세지 않음 |
| 쿼리가 다른 검색 페이지도 표시 URL이 같음 | 실제 URL을 해시한 source_key로 구분. 표시/모델 출력에 원본 쿼리 필드를 추가하지 않음 | 해시는 출처 구분용이며 내용의 진실성 보증이 아님 |
| 실패 도구와 검토 보완 조건, 전체 모델 호출 시간을 평가 보고서에서 확인하기 어려움 | 선택적 진단 hook과 평가용 복사본의 관찰 계측 추가 | HTTP 헤더 도착 시간과 실제 host 호출 완료 시간은 별도 지표 |

원문 자동 확보는 비교 요청에만 적용하며 최대 16개 문서/시도다. 같은 문서로 탭을 다시 전환해도 반복 읽지 않는다. 실패, 취소, 사용자 대기, 미확정 쓰기, 검증이 필요한 변경, 복구 전용 모드에서는 자동 조회/위임을 확대하지 않는다. 다른 문서가 읽히면 근거에 넣지 않고 주 실행기에 명시적 재조회 방법을 반환한다.

서로 다른 두 출처가 확보되면 기존 Pi/p-limit의 읽기 전용 워커 두 개에 고정 근거를 배정한다. 워커는 브라우저 이동/클릭/쓰기 권한이 없으며 주 실행기가 결과와 원문을 대조한다. 역할 수를 늘리거나 새 CLI를 설치하지 않는다. 현재 구현은 모든 요청/출처를 자동 병렬화하는 기능이 아니다.

## 방법론과 오픈소스 판단

- [Anthropic 장기 실행 하네스](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents): 작은 단계의 결과를 보존하고 실제 브라우저 검증으로 확인하는 방법을 적용. 세션 요약이나 에이전트 선언만으로 성공을 판정하지 않음.
- [Nanobrowser 실행기 소스](https://github.com/nanobrowser/nanobrowser/blob/24a14b76e14a9c30fd84878ca7985049d1e7d064/chrome-extension/src/background/agent/executor.ts): 계획/브라우저 행동/추출의 책임 분리 참고. 별도 런타임을 도입하지 않고 기존 Pi 실행기와 Readability/Turndown 본문 추출을 재사용.
- Claude 공식 배포 확장은 기존 [정적 분석](CLAUDE-HARNESS-STATIC-2026-09-26.md)을 재사용. 공개 OSS 라이선스가 확인되지 않은 배포 코드를 복사하지 않음.
- 새 패키지는 추가하지 않음. 기존 Pi, p-limit, Readability, Turndown, LangChain splitter, MiniSearch의 실제 계약을 연결하는 변경이며 패키지를 추가하는 것으로 완주 품질을 대체하지 않음.

## 검증

`tests/research-source-capture.test.mjs`는 문서 교체 경합, 쿼리별 출처 구분, 같은 출처의 새 버전 무효화, 취소/미확정 경계와 위임 복구 정보를 검사한다.

`tests/research-source-browser.mjs`는 실제 Chrome의 서로 다른 두 문서에서 원문을 확보하고, 첫 단계 통과 후 두 Pi 워커가 각 근거를 읽은 뒤 최종 답변까지 연결한다. 모델 응답과 검토는 합성이므로 실제 모델 품질 점수가 아니다. 본문 읽기 2회, 이동 클릭 1회, 각 페이지 방문 1회를 확인한다. 추가 검사는 source-reference, role-agents, analysis-delivery, review-recovery, task-plan, uncertain-frame, completion-review, page-content다.

실제 Luna/ChatGPT SSO 네이버 과제는 별도 수행한다. 로그인 대기는 모델 실행이 아니며, 실제 완료 답변과 출처/시각/미확인 범위까지 확인하기 전에는 완주 문제가 해결됐다고 표시하지 않는다.

현재 소스의 [선택 회귀 보고서](../verification/pre-release-2026-09-26T08-31-37-388Z/report.json)는 단위 948개, 디자인, 후보 빌드, 관련 Chrome 9종 모두 통과했다. 전체 100회 baseline을 다시 실행한 결과는 아니다. 후보 ZIP SHA-256은 `48b418da47e8da03a72b77f0009e09020467294f1d2525f6e4d62afe02ca1d3b`이며 출시 ZIP을 덮어쓰거나 배포하지 않았다.

[첫 평가 준비](../verification/naver-sso-luna-2026-09-26T08-24-31-839Z.json)와 [두 번째 평가 준비](../verification/naver-sso-luna-2026-09-26T08-30-04-764Z.json)는 SSO의 5분 연결 유효 시간이 지나 `login_not_completed`로 끝났다. 모델 호출과 점수가 없는 평가 준비 실패다. 평가기의 대기 시간을 늘려도 SSO 연결 자체의 만료를 연장하지 않는다. 두 창은 정리됐으며 사용자 로그인 가능 시 같은 과제를 다시 열어 실행해야 한다. 실제 완주 문제의 해결 여부는 미확정이다.

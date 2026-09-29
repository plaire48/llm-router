# 오래된 검증 화면의 문맥 비용

## 원인

실측 b9998a E03은 압축 모델을 16회 호출해 179,460ms를 사용했다. 기록상 9회와 7회의 직렬 묶음이며, 이후 입력 크기는 크게 줄었다. 따라서 압축 실패 16회로 해석하지 않는다. 원본 요약 응답과 종료 사유는 이 기록만으로 확정할 수 없다.

기존 `clearCachedToolResults`는 검증 영수증을 보호하려고 `verify_page` 전체를 제외했다. 그 결과 성공한 검증에도 큰 화면 관찰이 반복 누적됐다. 기존 `analysis-agents`의 실행 내 원문 저장과 MiniSearch 조회를 재사용해 이 부분만 줄였다.

## 벤치마킹과 선택

| 근거 | 채택 | 제외 |
|---|---|---|
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 오래된 도구 결과를 별도 보존하고 필요한 근거를 다시 조회 | 요약을 원문이나 완료 증거로 대체 |
| [OpenCode compaction 실제 코드](https://github.com/anomalyco/opencode/blob/dab2637217f188afca5e6631f67b935723e6218a/packages/opencode/src/session/compaction.ts) | 오래된 성공 결과와 최근 결과를 구분하는 문맥 정리 | 고정 토큰 임계값 복사, 검증 영수증 전체 삭제 |
| [Pi compaction 실제 코드](https://github.com/badlogic/pi-mono/blob/d192bd6dcae78fb87cf5c1c5e2af2790a0296278/packages/coding-agent/src/core/compaction/compaction.ts) | 기존 Pi 0.87.1 실행 문맥과 요약 흐름 유지 | 누적 요약에 의존하는 분할 호출의 무조건 병렬화 |

OpenCode와 Pi의 MIT 라이선스를 확인했다. 소스 복사나 새 패키지 추가 없이 기존 Pi와 MiniSearch 기반 근거 저장소에 패턴을 적용했다. 상용 Claude 확장 분석은 기존 검토/대기 분리 기록을 재사용하며 오픈소스 도입으로 표시하지 않는다.

## 변경

1. 원문이 완전하게 보관된 성공 `verify_page`의 오래된 `observation`만 실행 내 근거 ID와 원문 경로로 바꾼다.
2. 검증의 나머지 필드는 그대로 둔다. 최신 유효 검증 두 개, 실패, 미확정 동작, 이미지, 실제 동작이 포함된 결과는 유지한다.
3. 원문이 잘렸거나 없어졌거나 도구/ID가 다르면 줄이지 않는다. `read_analysis_evidence`로 같은 원문 전체를 다시 읽을 수 있다.
4. 모델 전송 문맥만 변경한다. Pi 원문 기록과 최종 검토의 실제 근거는 수정하지 않는다.

## 검증

| 범위 | 결과 | 의미 |
|---|---|---|
| 관련 소스 검사 | 77/77 통과 | 영수증, 최신 두 개, 실패/미확정/이미지, 소스 소실과 절단, 최종 검토 원문 보존 |
| 합성 큰 관찰 6회 | 543,242 → 185,874자, 요약 호출 5 → 0회 | 합성 입력 약65.8% 감소. 실제 속도나 품질 점수 아님 |
| 실제 Chrome와 로컬 시험 페이지 | 625,630 → 214,226자 | 실제 검증 결과 6개 중 오래된4개 관찰만 참조화. 전체 원문 재조회 동등성 확인. 실모델0회 |

[합성 기록](../verification/browser-30/cached-verification-context-synthetic.json), [Chrome 기록](../verification/browser-30/verification-context-browser.json)을 보존했다. 통합 후보 검사는 별도로 기록한다.

통합 검사 [pre-release-2026-09-27T12-22-59-935Z](../verification/pre-release-2026-09-27T12-22-59-935Z/report.json)는 **단위1,173개, 디자인/빌드, Chrome18종**을 통과했다. 총21stage와 입력/빌드 해시 보존을 확인했다. 후보 SHA-256은 `0b11f4e977ac3926b18f2628bb07a50cd13ba1266206b574c9ce3fac7dfb4f28`이며 이 후보의 실제 모델 품질은 미측정이다.

## 실제 후보 경계와 남은 문제

현재 실행 `naver-sso-luna-2026-09-27T12-14-07-742Z.json`은 기존 고정 후보 **b4489e**다. 이 문맥 변경이 포함되지 않았으며 실행 중 교체하지 않았다. 같은 10개 과제와 기존 한도를 유지한다.

b4489e E01은 46호출, 362,168ms 뒤 0/3과 답변 없음으로 사용자 확인에 멈췄다. 성공으로 채점하지 않는다. 압축16호출184,324ms였으며 현재 페이지 주소 조건 `url_is`로 서로 다른 결과 링크를 검사하다 `url_origin_mismatch`가 반복됐다. 범위 감사는 unknown을 반환했다. 다음 개선은 링크 검증 계약과 단계 검토 범위를 실제 기록에 맞춰 분리하는 것이다. 캐시 개선만으로 이 의미 오류가 해결됐다고 주장하지 않는다.

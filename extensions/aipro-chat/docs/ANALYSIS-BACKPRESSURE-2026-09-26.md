# 분석 대기열 포화와 사용자 정정 수용

## 재현과 반영

NQ-44. 확장 실행기의 실제 Pi 루프에 합성 모델 응답을 연결해 두 실패를 재현했다. 변경 전 로그는 `verification/analysis-backpressure-before.log`다.

| 문제 | 변경 | 완료 기준 |
|---|---|---|
| 6개 분석이 실행/대기 중이면 반복 읽기의 복구 워커가 생략됨 | 반복 읽기 복구를 예약하고 `analysis_busy`이면 실제 완료 결과 수집 후 배정을 한 번 재시도 | 기존 6개 보고서 보존, 복구 워커 1개, 새로운 원문 읽기와 최종 검토 |
| 최종 답변 전 자동 수집이 느린 작업을 기다리는 동안 사용자 정정을 못 받음 | `waitForResults`와 `collect` 분리, 실행기에서 취소 가능한 대기와 입력 확인 | 늦은 분석 응답 전에 정정 반영, 기존 수동 분석 보고서 보존 |
| 명시적 `collect_analysis(wait=true)`도 같은 대기에 묶임 | 같은 대기 경로 사용, 정정 시 미수집 상태의 deferred 결과 반환 | 현재 요청으로 재판단, 완료되지 않은 수집을 성공이나 진전으로 세지 않음 |

동시 실행 2개와 실행/대기/미전달 합계 6개는 유지한다. 결과 회수는 빈 슬롯의 실제 근거다. 배정을 무한 재시도하거나 완료 결과를 삭제해서 공간을 만들지 않는다. 실패 보고서도 다음 판단에 전달한다. 대기 취소는 워커 성공이나 전달 완료가 아니며, 원문 보존은 실제 수집 때까지 유지한다. 새 사용자 정정은 기존 자동 복구/비교를 취소하고 수동 분석의 취소 여부는 주 실행기가 결정한다.

250ms는 입력 확인 주기이며 사용자 답변 제한이나 추론 만료 시간이 아니다. 실제 반응 시간은 이벤트 루프와 입력 조회 지연의 영향을 받는다. 기존 추론 통신 복구와 사용자 중지, 미확정 쓰기 재전송 금지, 독립 완료 검토를 유지한다. 이번 변경은 읽기/계획/최종 검토 복구와 결과 수집에 한정된다. 대상 클릭 오류의 별도 자동 복구 배정 경로는 후속 [NQ-45](ACTION-RECOVERY-ADMISSION-2026-09-26.md)에서 보강했다.

## 실제 코드와 방법론 검토

| 근거 | 확인한 계약 | 적용과 비채택 |
|---|---|---|
| [OpenAI Agents JS agentToolStream.ts](https://github.com/openai/openai-agents-js/blob/fdaf0a66ca6e9d89498909ad7cf64745630e8afb/packages/agents-core/src/runner/agentToolStream.ts), MIT | 하위 스트림의 제한된 대기, abort와 handler 완료를 함께 기다리고 listener 정리 | 취소 가능한 대기와 정리 패턴 적용. 스트림 overflow 정책을 누비 작업 대기열에 그대로 복제하지 않음. SDK 전체 교체 없음 |
| [Codex recorder.rs](https://github.com/openai/codex/blob/e72da2b53805894878023d01949a25a082e0a5cb/codex-rs/rollout/src/recorder.rs), Apache-2.0 | 256개 bounded channel과 별도 flush acknowledgement | 배정/완료/소비를 다른 상태로 다루는 참고. 파일 기록기를 브라우저 하위 분석기로 이식하지 않음 |
| [p-limit](https://github.com/sindresorhus/p-limit), MIT, 설치된 7.3.3 실제 소스 확인 | active/pending 분리, 슬롯 반환 뒤 다음 작업 실행 | 기존 번들 재사용. 새 스케줄러/프레임워크 추가 없이 실행 제한 유지 |
| [기존 Claude 공식 확장 1.0.94 분석](CLAUDE-HARNESS-STATIC-2026-09-26.md) | 도구 결과 피드백, 승인 대기와 통신 실패 분리, 순차 실행 | 포화/입력 대기를 사용자 요구 누락으로 오인하지 않는 설계에 참고. 배포 번들/프롬프트 복사 없음. Claude Code 비공개 전체 구현 분석으로 표현하지 않음 |
| [Anthropic 장기 실행 하네스](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 작은 개선 단위, 명시적 완료 기준, 브라우저 검증 | 실패 재현 → 단일 대기 계약 수정 → Chrome 회귀. 시험 통과를 전체 완주 해결로 표시하지 않음 |
| [기존 OpenCode 반복 감지 검토](READ-LOOP-RECOVERY-2026-09-26.md) | 같은 결과 반복과 실제 진전 구분 | 기존 반복 제한 유지. 큐 크기/전체 실행 횟수를 늘려 문제를 숨기지 않음 |

도입은 기존 Pi/p-limit 개선과 일반 제어 패턴이다. 신규 패키지와 모델 호출 상한 증가, 인증 경로 변경은 없다. 정상적인 단일 읽기에는 추가 모델 호출을 만들지 않는다. 포화로 생략됐던 복구 워커가 실제로 수행되므로 해당 실패 경로의 호출 비용은 발생한다.

## 검증 범위

`tests/analysis-backpressure.test.mjs`: 포화 6개 작업의 결과 보존과 복구, 자동/명시 수집 중 정정, 포화 대기 중 정정 시 복구 미시작. `tests/analysis-agents.test.mjs`: 취소된 대기가 보고서를 소비하지 않음, 부모/지역 abort 처리와 나중 수집.

`tests/analysis-backpressure-browser.mjs`: 실제 Chrome 확장에서 원문 읽기/재방문, 6개 읽기 전용 Pi 워커의 결과 수집, 복구 워커 1개, 배송비 구간 조회와 최종 검토. 합성 모델과 로컬 HTML 사용. 실제 로그인/네이버 실모델 완주나 실서비스 저장 성공은 이번 검사의 범위가 아니다.

최종 gate 결과는 검증 종료 후 아래에 기록한다.

### 최종 검증 결과

- [단일 gate](../verification/pre-release-2026-09-26T10-33-30-178Z/report.json): 단위 검사 977개, 디자인 검사, 후보 빌드, Chrome 25회 모두 통과. 관련 7개 회귀 3회씩과 포화/반복 읽기/최종 복구/근거 보존 4개 각 1회. 전체 고정 품질 매트릭스 통과로 합산하지 않는다.
- 소스/검사 입력, dist, 후보 ZIP SHA-256 재대조 일치. ZIP: `66cf5aedc256c988b42770d68685ec35ec30481d74987ceb7936e14aa0138dc0`.
- [Chrome 기록](../verification/analysis-backpressure/browser.json): 주 실행기 6회, 하위 모델 합성 응답 14회, 실제 원문 읽기 4회, 최종 검토 1회. 6개 원문 분석과 복구 분석 1개를 실제 Pi로 실행. 원문 화면 캡처도 확인했다. UI 디자인이나 실모델 평가 증거는 아니다.
- 실제 네이버/SSO 모델 완주율 미측정. 후보 ZIP만 생성했으며 배포하지 않았다.

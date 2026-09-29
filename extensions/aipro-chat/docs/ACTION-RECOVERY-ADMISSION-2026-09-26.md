# 클릭과 입력 복구의 배정 확인

NQ-45. 원래 코드는 복구 제안을 만들 때 `attempted`에 추가했다. coordinator가 `analysis_busy`로 거절해도 같은 대상의 복구 시도는 소비됐고, 결과 회수 뒤 다시 배정하는 경로가 없었다. 앞선 NQ-44는 반복 읽기와 계획/최종 검토 복구를 보강했으며 이 별도 경로는 남아 있었다.

## 반영

1. 제안과 배정 수락을 분리했다. `accepted(assignment)`는 coordinator의 성공 응답 뒤 호출한다. 제안은 실행 내 WeakMap에 연결하고 사용자 정정 시 초기화해 낡은 배정 확인을 무시한다.
2. 포화 시 제안 한 개를 다음 결정 시점까지 보존한다. 기존 분석의 실제 보고서를 수집해 공간이 생긴 뒤 한 번 배정하며, 읽기 전용 진단을 받기 전에 동일 오류 동작을 다시 실행하지 않는다.
3. 대기 중 정정은 기존 비소비 대기로 받는다. 수동 분석의 보고서는 보존하고 낡은 자동 복구는 취소한다. 대기 취소/배정 거부/실제 완료를 구분하며 보고서나 큐 항목을 버려 슬롯을 만들지 않는다.
4. 동시 실행 2개와 실행/대기/미전달 합계 6개, 실제 페이지 재관찰, 미확정 쓰기 재전송 금지, HITL을 유지한다. 워커는 클릭/입력 도구가 없으며 보고서가 작업 완료나 승인을 뜻하지 않는다.

일반 배정은 기존 비동기 실행을 유지한다. 포화가 재현된 경우에만 결과 수집 후 배정/진단을 기다린다. 같은 오류의 무제한 재시도나 워커 수 증가를 도입하지 않았다. 브라우저 종료 후 워커 전체 복원이나 전용 진단 UI는 별도 미구현 범위다.

## 코드와 BP의 선택 근거

| 자료 | 실제 확인 | 적용 |
|---|---|---|
| [OpenCode processor.ts](https://github.com/anomalyco/opencode/blob/696f41bc8e7586657375d53390925fc54c25d34c/packages/opencode/src/session/processor.ts), MIT | 도구 호출 ID와 Deferred 완료, running 상태에서만 완료/실패 처리, 실패 시 metadata 보존 | 제안과 실제 배정 수락을 분리하고 정정 뒤 낡은 수락 무효화. Effect 프레임워크 전체 이식은 기존 Pi 계약과 비용상 비채택 |
| [OpenAI Agents agentToolStream.ts](https://github.com/openai/openai-agents-js/blob/fdaf0a66ca6e9d89498909ad7cf64745630e8afb/packages/agents-core/src/runner/agentToolStream.ts), MIT | 제한된 backlog, 취소 가능한 handler 대기, listener 정리 | NQ-44의 취소 가능한 대기 재사용. overflow를 사용자 요구사항 부족으로 바꾸지 않음 |
| [Codex recorder.rs](https://github.com/openai/codex/blob/e72da2b53805894878023d01949a25a082e0a5cb/codex-rs/rollout/src/recorder.rs), Apache-2.0 | bounded channel 전송과 flush ack 분리. NQ-44의 실제 소스 검토 재사용 | 배정 요청과 수락을 구분하는 참고. 파일 기록/세션 재생 모듈 복사 없음 |
| [Claude 공식 배포 확장 분석](CLAUDE-HARNESS-STATIC-2026-09-26.md), 1.0.94 | 순차 도구 결과와 오류를 다음 판단에 반환, 승인 대기와 통신 실패 구분 | 실패 영수증과 기존 보고서를 보존하고 조언 뒤 실제 화면 확인. 번들/프롬프트를 복사하거나 Claude Code 비공개 코드를 확보했다고 표현하지 않음 |
| Pi 0.87.1 / p-limit 7.3.3, MIT | 현재 번들의 결정 경계, 제한된 병렬 배정 | 실제 재사용. 인증과 현재 선택 모델을 유지하고 신규 런타임/패키지 추가 없음 |

## 재현과 검사

`tests/fixtures/action-pressure.mjs`의 실제 Pi 실행을 단위/Chrome 시험에서 공유한다. 원문 분석 6개를 실제로 대기시킨 뒤 동일 타깃 오류 2개를 반환한다. 새 배정이 실패 동작을 재전송하지 않으며, 복구 보고와 기존 6개 보고서가 리더에 도착하는지 확인한다. 클릭/입력 각각에서 대기 중 정정을 검사한다.

초기 시험은 실제 brief에 없는 role 필드를 검사해 워커가 실패하는 fixture 오류가 있었다. 그 실패 로그를 제품 결함 재현 근거로 사용하지 않는다. 수정된 fixture로 이전 배정 동작(포화 거절 후 미보류)을 복원한 대조 실행은 `verification/action-pressure-admission-control.log`에서 4개 실패다. 수정 경로는 같은 4개를 통과했다. 기존 단위 시험도 잘못된 role 검사를 수정하고 `delivered`뿐 아니라 실제 보고 outcome=complete를 요구하도록 강화했다.

Chrome 초기 시험은 큰 오류 원문이 자동 evidence_reads에 들어오지 않는 경우를 처리하지 못했다. 명시적 `read_analysis_evidence` 후 보고하도록 수정했으며, 작은 오류 사전 읽기와 큰 오류 별도 읽기의 제품 계약은 바꾸지 않았다.

`action-pressure-browser`는 실제 Chrome의 누락된 메뉴 클릭 오류 2개, 복구 1개, DOM 재조회, 입력/클릭 이벤트 0회를 확인한다. 로컬 페이지와 합성 모델을 사용하므로 성공한 실제 메뉴 조작이나 실모델 완주율의 증거는 아니다.

## 검증 기준

기존 baseline v6의 100회를 모두 유지하고 포화 액션/분석, 반복 읽기, 최종 검토 복구, 진단 저널, 비교 원문 회귀 6개를 추가한 **baseline v7 106회**로 올렸다. 이전 버전의 통과 보고서나 여러 선택 회귀의 합산을 최신 핵심 통과로 인정하지 않는다. 전체 회귀 matrix나 실제 사이트/모델 평가와는 구분한다.

최종 검증 결과는 아래에 기록한다.

최초 v7 gate `pre-release-2026-09-26T10-46-20-627Z`는 clarification-browser에서 중단됐다. 과거 fixture는 같은 근거의 반복 revise가 사용자 담당 팀 질문을 새로 만들기를 기대했으나, NQ-40 이후 계약은 복구 분석 1회 뒤 기술적 다시 확인/중지 대기다. fixture에 실제 읽기 전용 복구 응답과 기술적 대기/재진입/쓰기 0 검사를 추가했다. 실제 사용자 정보 누락의 direct/blocked/blocked-choice/observe-first/planner 답변과 한 번 쓰기/검증 검사는 그대로 유지한다. 실패 gate를 통과로 덮어쓰지 않고 새 고정 후보 gate를 실행한다.

### 최종 결과

[동일 후보 v7 gate](../verification/pre-release-2026-09-26T10-51-31-039Z/report.json): 단위 **982개**, 디자인 검사, 후보 빌드와 Chrome **106회** 모두 통과했다. 29종 각 3회와 별도 19종 각 1회로 총 109단계다. 소스/검사/공유 입력, dist, 후보 ZIP SHA-256을 검증 후 다시 대조했다.

ZIP SHA-256: `cea572431743ca3870ff8c592c3fab193d665c702cb0ec15017d7237fb7d3730`. 후보판만 생성했으며 업로드/배포하지 않았다. 실제 선택 모델의 네이버 완주, Qwen 실계정 품질, 실제 서버 저장/등록 성공은 이번 결과에 포함하지 않는다.

[액션 포화 Chrome 기록](../verification/action-pressure/browser.json): 실패 명령 2회, 보존 보고서 6개, 복구 워커 1개(원문 읽기 포함 합성 모델 응답 2회), 새 DOM 조회 후 답변, 입력/클릭 이벤트 0회. 실제 페이지 캡처도 확인했다.

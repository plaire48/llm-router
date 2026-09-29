# 계획 완료와 결과 전달

2026-09-27. 사용자가 요청한 기준은 단계가 실제로 끝나고 최종 결과까지 확인할 수 있는 것이다. 체크 표시만 채우거나 모델이 답변을 끝낸 것을 완료로 계산하지 않는다.

## 확인한 결함

기존 `taskProgress`는 `done`과 최종 검토 통과만으로 남은 단계의 표시를 모두 completed로 바꿨다. 저장된 계획과 화면의 완료 수가 달라질 수 있었다. 전체 실모델 시험 `naver-sso-luna-2026-09-26T16-59-17-480Z.json`의 E07은 실제로 answered와 최종 complete인데 계획은 in_progress/pending이었다. E01은 32회 모델 요청 뒤 시간 초과했고 검색은 실행됐지만 검토의 인용 가능한 근거가 없었다.

## 반영한 계약

1. 모델이 종료 답변을 제안하면 미완료 계획의 결과를 같은 제공자와 모델의 별도 결과 검토로 확인한다. 구형 계획에 완료 기준이 없으면 단계 이름을 검토 대상으로 사용한다.
2. 통과한 계획을 기존 `update_plan` 저장 경로로 반영하고 반환된 전체 계획이 요청과 같은지 확인한다. 실패하면 완료 답변을 숨기고 오류를 유지한다. 페이지 쓰기를 다시 실행하지 않는다.
3. 원래 요청 전체와 최종 답변을 따로 검토한다. 단계 검토가 최종 검토를 대신하지 않는다. 새 사용자 지시가 도착하면 낡은 완료 판정을 적용하지 않는다.
4. 화면은 저장된 단계 상태만 표시한다. 단계가 3/3이어도 최종 검토 중이면 `답변 확인 중`이다. 최종 답변이 전달돼야 작업 완료다. 질문과 중지는 미완료 단계와 기존 결과를 보존한다.
5. 평가기는 정답 채점 외에 저장된 전체 계획, 실제 화면의 완료 개수, 진행 표시 종료, 최종 답변 표시, 실행 종료를 요구한다. 이 근거가 없는 과거 시험은 새 기준으로 통과시키지 않는다.

`goal-review.js`는 검증/실행 도구에 포함된 구조화 observation도 최대 320,000자까지 유지한다. 실패와 부분 범위, 오래된 관찰, 실제 모델 문맥 한도는 유지한다. 스크립트 자체의 반환 주장은 여전히 제외한다. 이는 모델의 의미 판단이 항상 정확하다는 보장이 아니다.

## 읽기 쉬운 표현

계획 목록을 먼저 배치하고 수정 사유는 그 아래에 둔다. 현재 단계는 기존 블루와 600 굵기로, 완료는 체크 아이콘으로 표현한다. 완료 수는 정렬된 숫자로 강조한다. 같은 단계 이름을 반복하는 도구 설명은 숨긴다. 완료 조건과 최근 실행, 다음 계획은 펼쳐 확인한다.

AI와 화면은 같은 `text/status/expected_outcome` 구조를 사용한다. 짧은 이름과 구체적인 완료 조건을 분리하며 줄이기 위해 요구사항을 버리지 않는다. 사용자용 문장은 결과와 다음 행동부터 쓰고 가운데 점, 반복 도입문, 불필요한 진행 설명을 피하도록 공통 응답 및 계획 계약에 반영했다. 원문 인용과 사용자 값은 변경하지 않는다.

## 근거와 선택

| 자료 | 적용 | 경계 |
| --- | --- | --- |
| [OpenCode todo 도구](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/todo.ts), [진행 규칙](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/todowrite.txt) | 구조화 상태를 화면과 실행에 공유하고 검증 후 완료 | MIT 구현을 참고했다. 서버 런타임을 확장에 새로 추가하지 않았다. 평소 단계별 갱신을 유지하며 최종 누락은 검토 후 저장으로 보완 |
| [Codex 계획 지침](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md) | 다음 단계 전에 완료 상태를 갱신하고 계획 변경 사유를 전달 | Apache-2.0 프로젝트의 패턴 참고. 프롬프트만으로 완료를 보장하지 않음 |
| [Claude Code TaskCompleted/Stop hooks](https://code.claude.com/docs/en/hooks) | 완료 직전 검증으로 종료를 막을 수 있는 경계 | 공식 공개 문서 참고. Claude Code 내부 소스를 분석했다고 주장하지 않음 |
| [Anthropic 장기 실행 하네스](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 실제 결과 검사와 남은 작업 기록을 유지 | 같은 모델의 자기 평가와 외부 독립 채점을 구분 |
| [Anthropic 결과 중심 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 실제 결과와 실행 기록을 함께 검사 | 단위/합성 검사로 실모델 80%를 주장하지 않음 |
| [Claude 확장 정적 분석](CLAUDE-HARNESS-STATIC-2026-09-26.md) | 응답 종료와 업무 완료를 분리 | 기존 1.0.94 기록 재사용. 비공개 서버나 최신 배포판 분석이 아니며 제품 코드를 복사하지 않음 |
| [GOV.UK Task list](https://design-system.service.gov.uk/components/task-list/) | 이름과 상태를 구분하고 모든 필수 항목 완료를 확인 | 사용자 수동 업무 목록을 그대로 복사하지 않고 누비의 검증 상태에 적용 |
| [NN/g Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | 현재 작업을 먼저 보여주고 상세와 이력은 펼침 | 기존 CX 컴포넌트와 Nubi 토큰 재사용. 별도 UI 라이브러리는 도입하지 않음 |

실제 사용한 오픈소스는 기존 Pi 실행 루프, React 렌더링, Playwright Chrome 검사와 Node 검사기다. 새 상태 관리 프레임워크로 교체하는 것은 현재 결함을 해결하지 않고 저장 경로를 늘리므로 채택하지 않았다.

## 검증

- `tests/task-plan.test.mjs`: 세 단계 검토→정확한 저장→최종 검토, 저장 실패, 질문 대기와 재로딩 상태.
- `tests/review-budget-browser.mjs`: 실제 Chrome의 약 37,800자 관찰을 1회 읽고 답변 보정, 저장된 3/3, 최종 답변, 새로고침 유지, 새 대화 전환. 모델은 합성이다.
- `tests/task-plan-browser.mjs`: 단계별 수치, 최종 답변 대기, 질문/중지, 320px, 키보드와 이력.
- `tests/browser-30-evaluation.test.mjs`: 정답이어도 미완료 계획/화면/전달 실패는 불합격. 전달 증거가 없는 과거 시험은 미채점.
- `tests/browser-30-fixtures-browser.mjs`: 실제 DOM에서 잘못된 토글, 다른 프레임 입력, 요청하지 않은 제출을 독립 채점기가 실패로 판정한다.

수정 전 후보 SHA-256 `4ccfbd3ccd2e42da59365f26dd3e21362ba33494d0c8d1329457a81aa5c865b4`의 시험은 7/30개 기록 후 E08 진단 수집 정체로 중단했다. 원본과 `verification/browser-30/quality80-full-interruption.json`을 함께 보존한다. 성공 사례를 다음 후보에 합산하지 않는다.

새 후보 SHA-256 `3b773b4c62dca43f95c6de3be567974adf5d57eea0c3dce98a00adfd2a9b4364`의 재시험은 `verification/naver-sso-luna-2026-09-26T17-31-03-511Z.json`이다. 2026-09-27 02:31:22 KST에 ChatGPT 인증과 GPT-5.6 Luna 실호출을 확인했다. 그러나 E04에서 평가 탭 연결 오류로 중단됐고 재사용 프로필의 실제 Service Worker 모듈이 이전 코드임을 CDP로 확인했다. 디스크의 새 파일과 실행 코드가 달라 이 시험 전체는 새 후보의 품질 점수에서 제외한다. 새 완료 기준은 저장된 전체 계획 완료, 진행 표시 종료, 최종 답변 표시와 독립 정답 확인이다. 전체 24/30 목표는 아직 달성 전이다.

단위 검사 1,032개와 개별 Chrome 검사는 통과했다. 전체 identity 검사는 모든 선택 단계가 통과했지만 검사 도중 소스가 변경돼 최종 해시 검증에 실패했다. 따라서 현재 소스 전체가 인증됐다고 표시하지 않으며 소스 고정 후 전체 검사가 필요하다.

## 재사용 평가 프로필의 코드 갱신 누락

`verification/browser-30/profile-code-probe.json`은 Chrome이 실행한 `task-plan.js`에 이전 화면 자동 완료 로직이 남아 있고 새 저장 상태 검사가 없음을 기록한다. 후보 ZIP 해시만으로 실행 버전을 보장할 수 없었다.

평가기만 다음과 같이 보완했다. 기존 표시/합성 모델을 실제 품질로 계산하지 않는다.

1. 후보 ZIP을 직접 풀어 평가하며 후보와 평가기 해시별 새 확장 경로를 사용한다. 평가 전용 프로필의 남은 시험/로그인 탭을 정리한다. 개인 Chrome은 다루지 않는다.
2. Chrome DevTools Protocol로 실제 실행한 background, task-plan, browser-workspace 모듈의 소스를 읽어 준비한 후보와 SHA-256을 비교한다. 인증값이나 페이지 내용은 수집하지 않는다.
3. 실행 코드가 일치할 때만 인증과 평가를 시작한다. 누락/불일치는 실행을 막는다. 명령행 설치 확장의 `runtime.reload()` 비활성화 문제를 실제 재현했으므로 반복 재로드를 사용하지 않는다.
4. 이전 버전 설치→파일 교체→동일 프로필 재시작에서 낡은 모듈을 검출한 후 후보별 새 경로 설치→실행 코드 일치→새 동작 확인을 Chrome 회귀 검사로 검증했다.

[Chromium 재로드 결함 402532200](https://issuetracker.google.com/issues/402532200), [Chrome의 확장 갱신 수명주기](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)와 기존 Playwright/CDP를 적용했다. 새 런타임이나 패키지는 추가하지 않았다. 실제 사이트 성공률 개선으로는 아직 계산하지 않는다.

## 하나의 누비 그룹과 엄격한 완주 채점

- `browser-workspace.js`: 창마다 세션의 공통 그룹을 재사용한다. 그룹은 표시만 공유하며 각 대화의 tabIds/인증/승인은 그대로 격리한다. 이전 기록의 소유 탭만 합치고 사용자가 넣은 탭과 원본 초안은 이동하거나 닫지 않는다. 소유 기록이 없는 과거 그룹을 이름만으로 회수하지 않는다.
- 다른 대화 3개를 순서대로 시작해 실제 Chrome 그룹이 1개인 것, 대화 간 탭 접근 거부, 원본 초안과 포커스 보존을 검증했다. 결과: `verification/browser-30/workspace-single-group.json`.
- 새 채점기는 실모델 답변이 있어도 계획 미완료, 답변 누락, 진행 표시 잔존, 실행 미종료가 확인되면 내용 채점 없이 완주 실패로 기록한다. 전달 증거 자체가 없으면 미채점이다. 질문 대기는 완료가 아니며 H10의 운영자 응답/정정 검증은 별도로 남아 있다.
- `tests/review-budget-browser.mjs`에서 저장된 전체 계획 완료→최종 검토→답변 표시→새로고침 유지를 재확인했다. 합성 모델 검사이며 실모델 80% 검증은 아니다.

그룹 결합은 [Chrome tabs.group](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-group)과 [tabGroups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)의 기존 그룹 ID 재사용 계약을 따른다. 기존 fflate 0.8.3으로 후보 ZIP 자체를 읽어 평가 경로에 풀며 별도 새 의존성을 추가하지 않았다. 실행 코드 검증과 그룹 검사는 모델 없이 실제 Chrome에서 수행했다.

## 최종 로컬 검증

소스 고정 후 `npm run verify:identity` 재실행은 **40/40 단계 통과**다. 단위 검사 **1,035/1,035**, 실제 Chrome의 계획/최종 답변/질문/승인/단일 그룹/실행 코드 해시 검사와 최종 입력 해시 일치를 포함한다. 보고서: `verification/pre-release-2026-09-26T17-53-55-143Z/report.json`.

후보 ZIP SHA-256: `f32d80c2ea1df1e3efe92625385447381fa4ba831203997e1b098409b1777694`. 검사 대상은 로컬/합성 모델이며 이 후보의 30개 실모델 재채점과 24/30 이상 통과는 아직 확인하지 않았다. 이전 캐시 혼합 시험은 제외한다. 릴리즈 업로드는 하지 않았다.

## 평가 창 자동 종료 진단

2026-09-27 실측 `naver-sso-luna-2026-09-26T18-06-02-788Z.json`은 E-01에서 181.6초/39개 모델 호출 뒤 timeout, E-02에서 계획 3/3 및 답변 생성 뒤 `evaluation_binding` 결과 수집 오류로 중단됐다. 평가기의 finally가 연결을 닫고 소유 Chrome 프로세스를 종료한 것이 창이 사라진 직접 원인이다. Chrome 자체 충돌의 근거는 없다. 세부 바인딩 실패 조건은 기존 보고서에 없으므로 추정하지 않는다.

평가기만 보완했다. 계획/화면 전달 증거를 대상 수집보다 먼저 저장하고 수집 전 결과 상태를 보존한다. 바인딩 검증은 약화하지 않고 오류 조건별 코드를 남긴다. 오류 화면을 캡처하고 중단/설정 오류/사용자 대기 시 Chrome 프로세스와 평가 화면을 사용자가 닫을 때까지 유지한다. 명시적인 `NUBI_EVAL_KEEP_BROWSER=1`은 정상 종료 후에도 같은 화면을 유지한다. 실패한 모델 작업을 자동 재개하지 않는다. 기존 Playwright의 브라우저 수명 관리와 Node 자식 프로세스 종료 이벤트를 사용하며 새 의존성은 추가하지 않았다. 참고: https://playwright.dev/docs/api/class-browser#browser-close

동일 제품 ZIP `f32d80c2ea1df1e3efe92625385447381fa4ba831203997e1b098409b1777694`의 E-02 단일 진단 재시험 `naver-sso-luna-2026-09-26T18-14-56-507Z.json`은 실제 실행 소스 확인과 ChatGPT SSO 후 33.7초/9개 모델 호출, 계획 2/2, task done, 답변 표시, 진행 표시 0을 기록했다. 종료 후 browserDisposition은 preserved_for_inspection이다. 관련 단위 검사 8/8 통과. 단독 실행은 연속 과제 전환 바인딩 문제의 해결 증거가 아니며 독립 정답 채점도 아니다. 전체 30개 성공률은 미측정으로 유지하고 이전 실패를 이 성공으로 대체하지 않는다.

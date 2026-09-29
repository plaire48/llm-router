# 브라우저 하네스 품질 평가 — beta32

2026-09-24. Chrome 확장 내부의 하네스와 실제 페이지 상태를 평가한다. UI, 외부 서비스 계정, OS 제어는 이번 변경 대상이 아니다. 표시 버전은 Beta 1.0.0, 내부 패키지 beta32, Chrome 업데이트 번호 1.4.35다.

## 발견한 문제와 반영

| 문제 | 이전 동작 | 변경 | 검증 |
| --- | --- | --- | --- |
| 결과를 잃은 클릭/입력 뒤 중복 실행 가능 | 일반 읽기 또는 복구용 캡처만 성공해도 다음 변경 허용 | `verify_page`가 요청한 검사를 실제로 모두 통과해야 다음 변경 허용 | 실제 토글은 1회만 실행, 재관찰 후 중복 클릭도 차단, 상태 검증 후 종료 |
| 오류 표현에 따라 복구 정책 불일치 | throw와 반환된 unknown 오류가 다른 경로 | 두 경로 모두 결과 불확실 상태 유지 | 반환 오류와 예외, 자동 캡처 각각 회귀 검사 |
| 실패를 완료 기록으로 저장 | error 필드 없이 `ok:false`이면 done 가능 | 실패와 `verified:false`는 error, 취소는 unknown | 체크포인트 영수증 회귀 검사 |
| 영역별 평가 근거 부족 | 개별 검사 로그로만 판단 | 8개 영역, 시나리오별 3회, JSON/Markdown 자동 보고 | 누락·중단·중복 기록 점수 미산정, 실패 회차 보존 |

일반 조회는 다음 판단의 근거이며 완료 판정이 아니다. 이전 동작이 적용됐거나 적용되지 않았다는 현재 상태를 검증하고 다음 행동을 판단한다. 서버 처리 결과 자체를 알 수 없다면 사용자 확인으로 이어간다. 이 변경은 서버 트랜잭션의 exactly-once 보장이 아니다. 모델이 관련 없는 조건을 검증하는 문제는 최종 목표 검토와 별도 실모델 평가로 확인해야 한다.

## 평가 영역과 남은 검증

| 영역 | 이번 회귀 시나리오 | 실모델/현장 평가에서 남은 점 |
| --- | --- | --- |
| 요구사항과 질문 | 여러 입력 양식, 부족한 정보 질문 | 사내 약어와 애매한 요청의 질문 적절성 |
| 계획과 방향 변경 | 단계 계획, 작업 중 추가 요청 | 장기 업무에서 변경된 목표를 얼마나 잘 반영하는지 |
| 도구 선택과 인자 | 잘못된 도구/인자 복구, 스크립트 사전 검사 | Qwen이 처음부터 올바른 도구를 고르는 비율 |
| 화면 이해와 조작 | 요소 맥락, 토글, 호버 링크 | 사내 iframe/가상 스크롤/복잡한 편집기별 성공률 |
| 오류 복구와 실행 유지 | 응답 유실, 추론 재시도, 취소, 채팅창 수명 | 실제 지연·SSO·망 단절 및 서버 반영 확인 |
| 컨텍스트와 지식 | 압축, 문서 근거, 내장 위키 | 위키 사용 전후 정확도·토큰·탐색 시간 비교 |
| 하위 분석과 결과 전달 | 읽기 전용 역할 분석, 결과 취합 | 병렬 분석의 품질 이득 대비 총 토큰 비용 |
| 결과 검증과 승인 | 완료 검토, 팝업 승인 | 실제 업무의 인수 기준 충족 및 승인 문구 적합성 |

각 영역은 미리 지정한 시나리오를 새 Chrome 프로필에서 3회 실행한다. 점수는 모든 계획 회차를 검사한 경우에만 `통과 회차 / 계획 회차 × 100`이다. 회귀 점수 100은 모델의 일반 업무 성공률 100%가 아니다. 미실행은 실패와 구분하고, 부분 실행으로 높은 점수를 만들지 않는다. 실패는 나중 회차의 성공으로 지우지 않는다.

## 공식 방법론과 오픈소스 선택

- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents): 작업·반복 시도·실행 기록·최종 환경 상태를 구분한다. 누비는 실제 DOM 결과와 동작 횟수로 판단하고 회귀 검사와 모델 능력 평가를 분리했다.
- [OpenAI: Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): 지시 이행, 도구 선택, 인자, 하위 에이전트 전달 등 구성 요소별로 평가한다. 하나의 포괄적 점수 대신 8개 영역의 근거를 남긴다.
- [OpenCode processor](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts): 실행 중·완료·오류를 구분하고 반복 도구 호출을 감지한다. 결과 상태 구분 원칙을 적용했으며 코드를 복사하거나 Node/Effect 런타임을 확장에 추가하지 않았다. 변경 가능한 dev 브랜치를 2026-09-24 확인한 참고 자료다.

| 적용 기반 | 사용 범위 | 판단 |
| --- | --- | --- |
| Pi Agent Core 0.86.1, MIT | 기존 도구 실행/결과 훅에서 불확실한 실행 통제 | 현재 실행기를 보강한다. 두 번째 에이전트 런타임 불필요 |
| Playwright 1.62.1, Apache-2.0 | 실제 Chrome 확장·DOM·저장 상태·재진입 검사 | 합성 응답이라도 실제 클릭 횟수와 화면 결과를 검사할 수 있음 |
| p-retry 8.0.1, MIT | 기존 추론 재시도, Retry-After와 취소 | 브라우저 변경 재실행과 분리. 이번 검사는 이 경계도 보호 |
| MiniSearch / 기존 문서 분할기 | 기존 도구·위키·문서 검색 | 재작성하지 않고 회귀 대상으로 포함. 검색 효과는 별도 실모델 비교 필요 |

Pi의 버전/라이선스/훅은 설치 패키지에서 확인했다. [p-retry 공식 문서](https://github.com/sindresorhus/p-retry)의 재시도·중단 기능을 기존 정책과 대조했다. 이번에는 새 의존성을 추가하지 않았다. 문제는 검색/실행 라이브러리의 부재보다 결과 상태와 평가 경계에 있었기 때문이다.

## 다음 개선의 우선순위

1. 실제 Qwen 3.8 27B로 같은 과제를 여러 번 실행해 목표 달성, 금지 동작, 질문 적절성, 요청 수/시간을 측정한다. 현재 평가용 인증이 없으므로 실모델 점수는 미산정이다.
2. 사내 업무를 익명화한 실패 사례를 평가 fixture에 추가한다. 특히 잘못된 검증 조건, iframe, 비동기 저장 완료를 우선한다.
3. 위키 사용/미사용과 하위 분석 사용/미사용을 같은 과제로 비교한다. 품질 개선 없이 토큰만 늘면 기본 활성 범위를 줄인다.

기존 `npm run eval:agent`는 실제 모델 + 격리된 합성 사이트 8과제다. 사내 사이트 벤치마크도, 모든 제공자 평가도 아니다. `NUBI_EVAL_TOKEN`은 로컬 환경으로만 제공하며 채팅·진단·보고서에 넣지 않는다.

검증 결과는 해당 실행 폴더의 `report.json`, `quality.json`, `QUALITY.md`에 기록한다. 후보 ZIP은 검증한 해시와 함께 보관하고 게시된 릴리즈와 구분한다.

## 재실행

`CHROME_BINARY`를 확장 로딩을 지원하는 Chrome for Testing 실행 파일로 지정한다. 아래 검사는 공개 서비스 로그인이나 실제 모델 호출 없이 실행된다.

```sh
NUBI_TEST_CONCURRENCY=3 NUBI_TEST_REPEATS=3 NUBI_TEST_SUITES=form-workflow-browser,clarification-browser,task-plan-browser,agent-input-browser,harness-repair-browser,script-preflight-browser,page-information-browser,toggle-recovery-browser,hover-links-browser,error-recovery-browser,background-lifetime-browser,context-browser,document-retrieval-browser,browser-wiki-browser,role-agents-browser,analysis-delivery-browser,completion-review-browser,popup-approval-browser npm run verify:browser
```

전체 릴리즈 검사 행렬을 실행한 것은 아니다. 이번 18개 시나리오 54회와 단위·디자인·후보 빌드를 검사한다. UI 코드는 변경하지 않았으며, 모든 모달의 시각 정합성을 이번 회차에서 다시 검증했다는 의미도 아니다.

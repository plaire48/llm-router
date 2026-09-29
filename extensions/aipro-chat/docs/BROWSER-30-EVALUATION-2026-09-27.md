# 브라우저 기능 평가 30개

쉬움 10개, 중간 10개, 어려움 10개를 고정한 첫 능력 평가다. 네이버 중심 공개 사이트 20개와 로컬 시험 페이지 10개를 분리한다. 과제 목록 생성, 시험 페이지 검사, 실제 모델 실행, 독립 채점은 서로 다른 상태다.

전체 요청과 완료 기준은 [평가 목록](../verification/browser-30/tasks.md), 원본은 [browser-30.mjs](../evaluation/browser-30.mjs)에 있다. 모델은 사용자가 선택한 ChatGPT SSO `gpt-5.6-luna`를 유지한다. 회사망 Qwen 기준 성능으로 해석하지 않는다.

## 난이도와 기능

| 난이도 | 수 | 범위 |
|---|---:|---|
| 쉬움 | 10 | 검색 입력, 공식 페이지 이동, 기사 읽기, 용어/인물 구분, 영상 길이, 화면 캡처, 날짜, 한글 초안, 이미 맞는 설정 유지 |
| 중간 | 10 | 뉴스/영상 필터, 상품/장소 비교, 예외 찾기, 프레임, 조건부 모달, 여러 쪽 집계, 지연/일시 오류 복구 |
| 어려움 | 10 | 여러 출처 시각 대조, 제약이 있는 계획, 영상 주장 검증, 역할별 분석, 접근성 근거, 탭 왕복, 긴 문서, 다운로드, 첨부 업로드, 질문 대기와 정정 |

난이도는 사전 설계 분류이며 실행 성공률을 보고 쉬운 문제로 다시 분류하지 않는다. 각 실행의 후보 SHA-256, 모델, 시각, 사이트, 도구 기록, 계획 상태 변화, 답변과 실제 페이지 상태를 남긴다. 답변 속도는 완료 정확도와 별도로 보고한다.

## 실제 적용한 방법론

1. [Anthropic 에이전트 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)의 task/trial/outcome 구분과 독립 완료 조건을 적용했다. 모델의 완료 선언이나 자체 검토만으로 통과시키지 않는다. 여러 번의 반복은 단일 시험과 분리하며 이번 1회 시험으로 신뢰도를 단정하지 않는다.
2. [BrowserGym task 계약](https://github.com/ServiceNow/BrowserGym/blob/main/browsergym/core/src/browsergym/core/task.py)의 초기 상태 준비와 결과 검증 분리를 참고했다. 공식 문제/평가기나 Python 런타임을 가져온 것은 아니며 이 결과는 BrowserGym/WebArena 점수가 아니다.
3. 기존 Playwright와 Node 기본 HTTP 서버를 그대로 사용했다. 새 의존성을 추가하지 않았다. 공개 사이트 원문은 사람이 독립 대조하고, 고정 폼/표/다운로드는 관찰 가능한 상태로 판정한다. BrowserGym 전체 도입은 이 확장의 SSO와 작업 탭 소유권 경로를 그대로 검증하는 데 불필요하여 이번에는 제외했다.

## 실행

```sh
node scripts/browser-evaluation-plan.mjs
node --test tests/browser-30-evaluation.test.mjs tests/evaluation-model-evidence.test.mjs tests/live-evaluation-score.test.mjs
node tests/browser-30-fixtures-browser.mjs

# 전용 임시 Chrome에 사용자가 SSO 로그인. 다른 앱 인증값을 가져오지 않는다.
node scripts/evaluate-browser-30.mjs

# 한 난이도 또는 특정 과제만 선택할 수 있다.
NUBI_EVAL_DIFFICULTY=easy node scripts/evaluate-browser-30.mjs
NUBI_EVAL_TASK_IDS=E-01,M-07,H-07 node scripts/evaluate-browser-30.mjs

# 실제 기록에서 빈 독립 채점표를 만든 뒤 원문/화면 증거로 채점한다.
node scripts/score-browser-30.mjs REPORT.json
node scripts/score-browser-30.mjs REPORT.json REPORT.json.grades.json
```

`CHROME_BINARY`로 설치된 Chrome for Testing을 지정할 수 있다. 쉬움 3분, 중간 5분, 어려움 8분은 평가 실행 예산이며 제품의 사용자 대기 제한이 아니다. 모든 조건의 채점이 끝나기 전 전체 성공률은 null이다. HTTP 200 외에 완료된 Responses 출력이 확인되어야 실모델 채점 대상이 된다. 환경 접근 실패, 사용자 대기, 실행 오류, 시간 초과, 답변 완료를 분리한다. `completedTrials`는 실행 기록 종료 수이며 성공 건수가 아니다.

로컬 파일 시험은 생성한 `training.txt`만 사용한다. H-09는 평가 준비 단계에서 누비의 실제 첨부 입력으로 파일을 전달하며, 모델이 웹 폼에 선택하는 행동을 대신하지 않는다. 다운로드는 전용 임시 폴더로 제한하고 Chrome 완료 상태와 실제 파일 해시를 기록한다. 등록/결제/게시나 개인 파일 업로드는 포함하지 않는다.

H-10은 사람이 개입하는 별도 절차가 있다. 자동 실행은 질문 발생까지만 기록할 수 있으며 3분 대기, 답변, 정정을 완료한 것으로 세지 않는다. 평가자가 같은 대화에서 해당 순서를 직접 수행하고 독립 증거를 붙이기 전에는 전체 과제를 미채점으로 둔다. 타 과제에서 질문이 나온 경우에도 자동 승인하거나 답변을 꾸며 넣지 않는다.

## 이번 확인 결과

1. 과제/채점/모델 응답 근거 관련 검사 13개 통과.
2. 로컬 페이지 Chrome 검사 10개 통과. 시험 데이터와 동작 검증이며 누비 LLM 성능이 아니다.
3. 새 30개 시험은 별도 보고서에 기록한다. 아직 전체 실측 점수는 없다.
4. 선행 네이버 복합 시험은 482.6초, 모델 요청 73회 후 평가 시간 초과. 최종 답변은 없었다. 뉴스/영상 근거가 확인된 뒤에도 카드/시각 근거 검토와 재계획이 반복됐다. 기존 평가기의 HTTP 200 기반 표기와 새 평가기의 완료 출력 검사를 구분한다.

선행 기록: `verification/naver-sso-luna-2026-09-26T14-56-38-282Z.json`. 별도 원문 대조: `verification/naver-independent-reference-2026-09-27.md`. 첫 복합 시험은 새 30개 목록의 H-01과 목표가 유사하더라도 별도 실행이므로 새 목록의 통과/실패 수에 넣지 않는다.

## 실패 분석 순서

1. E-01/E-02/E-09에서 입력, 이동, 원문 읽기, 기본 완료를 분리한다.
2. 중간 과제에서 타깃/프레임/필터 상태와 오류 복구를 확인한다.
3. 어려운 과제에서 원문 근거 보존, 미표시 정보의 처리, 하위 결과 수집, 완료 검토 반복을 확인한다.
4. 같은 출처를 반복 조회한 횟수와 실제 새 근거를 분리한다. 검토 요구가 사용자의 완료 조건을 넘어섰는지도 원문과 대조한다.
5. 실제 실패를 재현한 항목부터 수정하고 동일 후보의 실패 기록을 보존한 채 새 후보로 재시험한다.

현재 30개는 브라우저 기능의 대표 표본이다. Windows/Edge 설치, 회사망 Qwen, 실제 서비스 등록/저장, 예약/녹화/조직 정책의 전 범위 성능을 검증한 것은 아니다.

## 실행 중 발견한 측정 문제

현재 실행 `naver-sso-luna-2026-09-26T15-24-50-398Z.json`에서 HTTP 200과 실제 답변이 있어도 Playwright의 `requestfinished`가 기록되지 않았다. 제품의 `chatgpt-api.js`는 SDK가 종결 이벤트를 소비한 뒤 finally에서 전송을 취소한다. 따라서 `requestfinished`에서만 응답 본문을 검사하는 방식은 이 스트림의 응답 수신을 놓친다. Pi는 `response.done`도 종결 이벤트로 정규화한다.

원본 보고서를 덮어쓰지 않고 `assess-browser-30.mjs`에서 별도 평가 파일을 생성한다. 현재 실행 시각 안의 `review_result`는 `src/api.js`의 실제 모델 invoke와 `parseGoalReview` 후에만 발생하므로, 선택 모델 ID와 관찰한 제공자 HTTP 요청을 함께 대조해 최소 수신 응답 수를 확인한다. 단순 start/finish, HTTP 200, 검토 complete만으로 과제 통과를 판정하지 않는다. 이 근거는 전체 응답 수나 정확한 네트워크 완료 시간 측정이 아니다.

```sh
node scripts/assess-browser-30.mjs verification/naver-sso-luna-2026-09-26T15-24-50-398Z.json
```

별도 파일은 원본 보고서 해시와 사용한 근거 종류를 기록한다. 답변 완료 과제는 여전히 독립 채점표가 필요하고, 명시한 평가 시간 안에 최종 결과를 못 낸 timeout은 해당 실행의 완주 실패다. 실행 중인 과제나 사용자 대기는 실패/성공으로 자동 승격하지 않는다.

초기 3개 결과는 E-01 검색 입력/결과 수집 시간 초과, E-02 공식 관람 안내 원문 대조 통과, E-03 기사 읽기 시간 초과다. E-02는 공식 페이지를 별도 브라우저에서 확인했고 시간/휴관일/원문 URL이 일치했다. 이후 결과는 실행 보고서를 다시 읽어야 한다. 시험 대상 후보를 실행 중에 변경하지 않았다.

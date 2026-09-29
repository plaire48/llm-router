# 공개 기준으로 평가하기

임의의 종합 품질 점수는 사용하지 않는다. 공개 벤치마크, 자체 실모델 과제, 합성 회귀를 각각 보고한다. 외부 평가기관 인증을 받은 것으로 표시하지 않는다.

## 채택한 평가기

[ServiceNow WebArena-Verified](https://github.com/ServiceNow/webarena-verified) 1.2.3, Apache-2.0을 **개발용 평가 환경에만** 설치한다. Python이나 서버를 확장 사용자에게 요구하지 않는다. 공식 task/dataset/evaluator를 바꾸지 않고 `agent_response.json`과 `network.har`를 채점한다. 정답을 누비 프롬프트나 위키에 제공하지 않는다.

고정 소스: `6473f72db5dcefc97b5725b59e734504edc28a21`.

- 평가기 SHA-256: `35c3385b1db4b3378657589f95f50defd4234bd36e5b93d44733fd561b01db4e`
- 데이터 SHA-256: `d65275660814663375028e9017e1f929e3c38321041b125795e2713b52243d30`

명령은 버전과 위 해시를 확인하고 불일치/누락/중복 결과를 거부한다. 실패한 과제를 제외해 성공률을 올리지 않는다. HAR와 답변은 새 실행 폴더에 복사하고 입력 해시를 기록한다. config에서는 평가용 URL만 복사하며 인증값은 가져오지 않는다. HAR에는 사이트 정보가 있으므로 개인/사내 계정이 아닌 격리된 벤치마크 기록만 사용한다.

## 실행

확장 프로젝트 폴더에서 평가 전용 가상환경을 만든다.

```sh
python3 -m venv .venv-evaluation
.venv-evaluation/bin/python -m pip install -r scripts/requirements-evaluation.txt
NUBI_WEBARENA_BIN="$PWD/.venv-evaluation/bin/webarena-verified" npm run eval:webarena -- --logs /path/to/benchmark-run --config /path/to/benchmark-config.json --tasks 108
```

Windows에서는 가상환경의 `Scripts/webarena-verified.exe`를 지정한다. 각 task 폴더에는 공식 형식의 답변과 HAR가 필요하다. 공식 평가기의 출력은 그대로 보존하고, wrapper는 채점 규칙을 새로 구현하지 않는다. config의 별도 dataset 교체는 허용하지 않는다. Python 의존성 고정 목록은 실행 증거의 `requirements-resolved.txt`에도 기록했다.

결과는 `verification/webarena-official-<고유값>/report.json`에 남는다. `artifactSuccessRate`는 **제공된 실행 기록**의 성공률이다. 기록만으로 누비가 실제 실행했는지 증명할 수 없으므로 `agentRunVerified=false`, `nubiCapabilityScore=null`을 유지한다. 모든 과제가 성공하면 종료 코드 0, 공식 실패가 있으면 1, 채점/설정 오류면 2다. 공식 CLI가 실패 과제에 0을 반환하는 경우도 있어 결과 JSON을 검사한다.

## 이번에 실제 검증한 범위

- 공식 예제 task 108: 성공 1건. `verification/webarena-official-3QyBrA`.
- 같은 예제의 첫 주문 건수를 999로 바꾼 대조군: 실패 1건. `verification/webarena-official-rYXhaF`.
- 누비 실행/모델 평가는 아니다. 채점기 연결과 잘못된 답의 거부를 확인한 것이다.

## 초기 연결 시 남았던 작업 (후속 현황은 아래 참조)

1. 공식 WebArena 사이트를 격리 환경에 실행하고 reset 상태/이미지 버전을 고정한다. 현재 Docker daemon이 없어 사이트는 실행하지 않았다.
2. 누비의 **실제 확장 실행기**에 과제 intent/start URLs만 전달한다. task마다 초기 상태와 세션을 재설정한다. 사이트 내용으로 승인 권한을 확대하지 않는다.
3. 평가 브라우저에서 benchmark 도메인의 HAR와 공식 JSON 답변을 수집하는 어댑터를 연결한다. 사내 모델 인증/요청은 HAR에서 제외해야 한다. 이 시점에는 자동 수집 어댑터가 미구현이었다. 아래 NQ-08 후속에서 연결했다.
4. 고정 task 집합과 동일 모델/설정으로 반복하고 모든 실패/시간 초과/질문 대기와 환경 오류를 보존한다. 일부 과제면 subset 점수라고 명시한다.
5. 공식 채점 결과와 모델/하네스 버전, 시간, 요청 수, 실제 부작용을 묶어 비교한다. 위키와 하위 분석 효과는 동일 task의 on/off 조건으로 별도 비교한다.

[BrowserGym](https://github.com/ServiceNow/BrowserGym)/AgentLab은 공개 task 실행 확장의 후보지만, 누비 대신 별도 Python agent를 평가하면 제품 품질을 설명하지 못한다. 이번에는 누비 실행기를 유지하는 외부 채점 연결을 선택했다.

[Anthropic 평가 방법론](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)의 반복 시도 지표와 [OpenAI 평가 지침](https://developers.openai.com/api/docs/guides/evaluation-best-practices)의 구성요소별 검사를 적용한다. 실제 모델의 task 성공률, pass@k와 pass^k는 별도 출력하며 자체 회귀 성공률과 합산하지 않는다.

## NQ-08 후속: 누비 실행과 HAR 연결 (2026-09-24)

`npm run eval:webarena:run -- --config benchmark.json --tasks 108 --repeats 3`를 추가했다. `NUBI_EVAL_TOKEN`, 선택적 `NUBI_EVAL_MODEL`, 위 평가기 경로가 필요하다. 기본 Qwen과 새 Chromium 프로필에서 실제 누비 UI/worker 실행기를 호출한다. **현재 공식 Docker 사이트와 실제 모델은 미실행**이며 아래 연결의 로컬 검사만 완료했다.

설정 예시의 digest는 실제로 검토한 공식 이미지 digest로 교체해야 한다. 이미지를 미리 설치해야 하며 실행기가 임의로 내려받지 않는다. 기존 회사/개인 사이트나 이미 실행 중인 컨테이너는 사용하지 않는다.

```json
{
  "isolatedBenchmark": true,
  "sites": {
    "shopping_admin": {
      "image": "am1n3e/webarena-verified-shopping_admin@sha256:<검토한 64자리 digest>",
      "port": 17780,
      "controlPort": 17781,
      "headers": {"X-M2-Admin-Auto-Login": "admin:admin1234"}
    }
  }
}
```

- 공식 1.2.3 `dataset-get` 정규화 export 해시를 별도로 확인한 뒤 `agent-input-get`에서 intent/sites/start URLs만 선택한다. 정답/evaluator 내용은 모델에 전달하지 않는다.
- shopping/shopping_admin/reddit/gitlab만 연결했다. wikipedia/map은 데이터 볼륨/전용 초기화 검증 전이므로 거부한다.
- 매 과제/회차에 digest가 고정된 새 컨테이너를 만든다. 기존 볼륨을 연결하지 않고 localhost의 지정 포트만 연다. `init`은 URL 설정으로 기록하며 데이터 원복으로 부르지 않는다. 종료 때는 이번 실행의 label이 일치하는 컨테이너 ID만 삭제한다. 소유권이 다르면 중단한다.
- 공식 소스를 확인했을 때 environment-control 문서의 `/reset` 설명과 달리 해당 client/사이트 구현의 `init`은 주로 URL/캐시 설정이다. 그래서 가상의 reset 성공 표시 대신 새 컨테이너를 선택했다. 실제 이미지 준비/초기화 성공은 아직 검증 전이다.
- Playwright `recordHar`의 full/embed와 정확한 벤치마크 origin 필터를 사용한다. context 종료 후 HAR를 읽어 범위 밖 요청을 거부한다. AI Pro 통신은 HAR에 넣지 않는다. 공식 테스트 계정 헤더도 해당 사이트에만 붙이며 일반 인증 헤더는 설정에서 거부한다.
- UI 질문/최종 승인/native 확인은 자동 응답하지 않는다. `awaiting_user`로 남긴다. 모델 최종 JSON이 없으면 공식 답변을 만들어 채우지 않고 실패/대기 기록을 보존한다. 이 정책으로 MUTATE 과제는 사람 승인 없이는 멈출 수 있다.
- 각 회차의 새 환경 영수증, 후보 해시, 실제 유효 모델 응답 수, 시간, 답변/HAR 해시와 공식 grader 결과를 기록한다. 환경/형식/정리 오류 후 같은 시도를 재전송하지 않는다. 일부 회차 오류는 전체 능력 점수로 환산하지 않는다.
- `nubiCapabilityScore=null`은 계속 유지한다. `observedSuccessRate`는 구성한 과제/회차 결과이며 독립 인증/전체 WebArena 점수가 아니다. 현재 그 실제 수치도 미측정이다.

단위 4개: 이미지/포트/헤더 범위, 정답 유출 방지, 새 인스턴스/소유권 검사, 초기화 실패 정리. `webarena-har-browser.mjs`는 두 로컬 서버를 실제 브라우저로 호출해 벤치마크 frontend의 요청/응답은 보존하고 별도 모델 서버 내용이 HAR에 없음을 확인한다. Docker 동작은 이 단위 검사에서 주입한 합성 어댑터다. `verification/webarena-har-browser.json`.

사전 조건 검사: `verification/webarena-run-2026-09-24T14-39-06-000Z/report.json`는 `not_configured`다. Docker daemon의 실제 연결도 실패했다. 네트워크/모델/공식 이미지가 준비되기 전에는 NQ-08 전체 완료로 표시하지 않는다.

근거: [공식 사용법과 agent-input-get](https://servicenow.github.io/webarena-verified/getting_started/usage/), [환경 관리](https://servicenow.github.io/webarena-verified/environments/environment_control/), [실제 environment-control 소스](https://github.com/ServiceNow/webarena-verified/tree/6473f72db5dcefc97b5725b59e734504edc28a21/packages/environment_control). Apache-2.0 공식 CLI/평가기와 기존 Playwright를 재사용했고 별도 Python 에이전트를 제품에 도입하지 않았다.

### 공식 CLI export 보완

`dataset-get`은 원본 JSON을 복사하지 않고 typed 모델을 직렬화한다. 실제 고정 commit/1.2.3 CLI로 812문항을 export한 결과의 SHA-256은 `10752f67cb4652831da85419925863cc5315db9c53bae42370046b70f032484f`다. 실행 전 이 값(CRLF만 정규화)을 확인하고, 공식 grader의 원본 데이터 해시 `d652…3d30` 검사는 별도로 유지한다. 서로 다른 파일을 같은 해시로 검사하던 개발 어댑터의 사전 조건을 수정했다. 실제 CLI 출력과 task 108의 agent-input URL 변환은 통과했다. `verification/webarena-export-check.json`.

`verification/webarena-run-2026-09-24T14-54-10-871Z/report.json`은 존재하지 않는 이미지 digest/합성 placeholder 인증으로 수행한 환경 경계 음성 검사다. 정규화 export 검증을 통과한 뒤 Docker 단계에서 실패하며 실제 브라우저/모델 요청은 0회였다. 이 기록은 정상 사이트 초기화나 실제 모델 검증이 아니다.

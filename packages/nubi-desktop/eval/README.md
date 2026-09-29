# 누비 workspace 실측 평가

실제 모델로 고정 과제를 돌리고 관찰한 결과만으로 채점한다. 제품 번들에 포함하지 않는다.

## 실행

터미널 두 개를 쓴다. 첫째 터미널은 로그인을 유지하고, 둘째 터미널에서 평가를 반복 실행한다.

```bash
# 첫째 터미널: 브라우저에서 로그인한다. READY가 나오면 그대로 둔다.
# Office 평가의 세션과 소켓이 다르므로 두 세션을 함께 띄울 수 있다.
node eval/model-session.mjs --provider chatgpt --model gpt-5.6-luna
```

```bash
# 둘째 터미널: 개발용 과제 전체
node eval/run.mjs --split dev
```

| 옵션 | 뜻 | 기본값 |
|---|---|---|
| `--cases W1-ngrok-default-port,C2-free-shipping-threshold` | 실행할 과제 | 전체 |
| `--suites wiki,edit` | 실행할 묶음 | 전체 |
| `--split dev` | `dev`, `holdout`, `all` | `all` |
| `--trials 3` | 과제당 반복 횟수 | 1 |
| `--out <폴더>` | 결과 폴더 | `verification/eval-live/<시각>` |
| `--socket <경로>` | 모델 세션 소켓 | 사용자별 임시 폴더 |

두 보고서를 비교한다.

```bash
node eval/compare.mjs <이전>/report.json <이후>/report.json
```

## 결과 읽기

| 결과 | 뜻 | 통과로 셈 |
|---|---|---|
| `passed` | 모든 검사 통과 | 예 |
| `failed` | 검사 하나 이상 실패 | 아니오 |
| `needs_review` | 검사는 통과했으나 사람이 확인해야 함 | 아니오 |
| `needs_human` | 과제가 정의하지 않은 질문이나 대기가 발생 | 아니오 |
| `invalid` | 과제의 전제가 성립하지 않음. 예: 압축이 일어나지 않음 | 아니오 |
| `error` | 한도 초과, 세션 끊김, 실행 오류 | 아니오 |
| `not_run` | 모델 세션이 없어 실행하지 않음 | 집계에서 제외 |

과제별 폴더의 `result.json`에 답변과 검사 결과가, `transcript.jsonl`에 모델 호출 전체가, `metrics.json`에 계측이 있다.

## 한도

평가 한도는 제품 한도가 아니다.

| 한도 | 값 | 대상 |
|---|---:|---|
| 과제 시간 | 20분 | 과제 하나. Wiki 전체 검토 한 번이 10분을 넘는다 |
| 모델 호출 | 80회 | 주 에이전트와 그 계획, 검토, 요약 |
| 위임 호출 | 400회 | OpenWiki 에이전트. 첫 메시지가 `Plan OpenWiki research` 또는 `You are OpenWiki's`로 시작하는 호출 |
| 사용자 응답 | 12회 | 질문 답변과 이어가기 |

위임 호출을 따로 세는 이유: Wiki 질문은 OpenWiki 에이전트에 넘기고 그 방식은 바꾸지 않는다(사용자 결정 2026-09-29). Wiki 전체 검토 한 번이 약 150회 호출이다.

## 다른 평가

| 평가 | 명령 | 재는 것 |
|---|---|---|
| 압축 품질 | `node eval/compaction.mjs --socket <경로> --out <폴더>` | 압축 뒤에 남은 내용. 질문 17개 |
| 앱 조작 | `node eval/computer.mjs --socket <경로> --out <폴더>` | 가상 Windows 앱에서의 읽기, 입력, 거절, 묶음 승인. 과제 15개. A12~A15는 OpenWiki 에이전트에게 규정을 묻고 그 답과 근거로 앱을 고친다 |
| OpenWiki 갱신 | `node eval/wiki-update.mjs --socket <경로> --out <폴더>` | 주문 서비스 자료에서 OpenWiki로 Wiki를 만든 뒤(준비) 원본 하나를 바꾸고, Desktop의 갱신 흐름(상태, 제안, 실행, 반영)을 잰다 |

압축과 앱 조작 평가는 `--only <ID 앞부분>`으로 일부만 실행한다.

앱 조작 평가의 가상 사용자는 묶음 승인을 한 번에 결정한다. 묶음의 단계 하나라도 과제가 금지한 컨트롤을 대상으로 하면 묶음 전체를 거절한다. 보고서는 묶음 승인 수와 묶음에 든 입력 수를 따로 센다.

더 강한 모델로도 잰다. 같은 하네스에서 강한 모델도 실패하면 하네스의 결함일 가능성이 높다.

```bash
node eval/model-session.mjs --provider chatgpt --model gpt-5.6-sol
```

## 과제 추가

1. `eval/cases/<ID>.json`을 만든다. 파일 이름은 `id`와 같아야 한다.
2. 정답의 근거를 자료 원문에서 직접 확인한다. 추측한 정답을 넣지 않는다.
3. `node --test tests/eval-cases.test.mjs`로 형식과 정답 경로를 검사한다.
4. 개발용과 보류용의 비율을 유지한다. 보류용 결과를 보고 하네스를 조정하지 않는다.

## 자료 다시 고정

```bash
node eval/pin-corpus.mjs openwiki-sds order-service
```

자료 해시가 바뀐다. 그 자료를 쓰는 모든 과제의 정답을 원문과 다시 대조한다. 이전 보고서와는 비교할 수 없다.

## 하지 말 것

- 회사 저장소나 회사 문서를 자료로 등록하지 않는다. 모델 호출 전체를 파일로 남기기 때문이다.
- 검사를 통과시키려고 정답이나 한도를 고치지 않는다. 맞는 답을 놓치는 정답 목록은 사용자 결정을 받아 고치고, 고친 날짜와 이유를 검사에 남긴다.
- 모델의 완료 선언이나 검토 결과를 통과 근거로 쓰지 않는다.

범위와 근거의 경계는 [실측 평가 문서](../docs/LIVE-EVAL.md)를 따른다.

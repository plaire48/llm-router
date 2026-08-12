# §7A 검증 체크리스트 — Claude 구독 OAuth 실제 동작 확인

- 대상: 스펙 `2026-08-12-llm-router-design.md` §7A의 미검증 4항목
- 수행자: **사용자 본인** (실제 Claude 구독 계정 로그인이 필요해 자동화 불가)
- 소요: 약 15분
- 목적: 구독 OAuth 경로를 "실험적"에서 "검증됨"으로 올린다. 이 검증 전까지 CLAUDE.md는 이 경로를 MUST 실험적으로 표시한다.

> **키가 필요 없는 절차입니다.** 여기서 쓰는 인증은 전부 브라우저 구독 로그인(OAuth)입니다. `LLM_ROUTER_MASTER_KEY`는 제공자 키가 아니라 **내 라우터를 보호하는 로컬 비밀번호**이고, 값은 아무거나 정하면 됩니다.

---

## 결과 기록

각 단계 결과를 `docs/superpowers/specs/oauth-findings.md`의 "아직 검증하지 않은 항목" 절에 옮겨 적는다. 하나라도 실패하면 **그 지점에서 멈추고** §실패 시 대응을 따른다.

| # | 항목 | 결과 |
|---|---|---|
| 1 | 로그인·토큰 저장 | ☐ |
| 2 | Messages 200 + 가용 모델 | ☐ |
| 3 | 스트리밍 SSE | ☐ |
| 4 | 도구 호출 | ☐ |
| 4.5 | 사용량·잔여량 헤더 | ☐ |
| 5 | refresh 토큰 회전 | ☐ |

---

## 준비 (1회)

작업용 임시 디렉터리에서 진행한다. 프로젝트를 더럽히지 않는다.

```bash
mkdir -p ~/llm-router-check && cd ~/llm-router-check
```

`.env` 생성 — 마스터 키는 **내가 정하는 임의의 로컬 비밀번호**다.

```bash
printf 'LLM_ROUTER_MASTER_KEY=sk-local-check\nLLM_ROUTER_PORT=8788\n' > .env
```

`profiles.yaml` 생성 — `auth: oauth`가 핵심이다. API key 항목이 없다.

```bash
cat > profiles.yaml <<'YAML'
profiles:
  - name: claude-oauth
    provider: anthropic
    auth: oauth
    model: claude-opus-4-8
YAML
```

---

## 1. 로그인과 토큰 저장

```bash
llm-router oauth login anthropic
```

브라우저가 열리면 Claude 계정으로 로그인하고 승인한다. 터미널에 `Saved Anthropic credentials.`가 뜨면 성공.

**확인:**

```bash
ls -l ~/.llm-router/credentials.json
```

- [ ] 파일이 존재한다
- [ ] 권한이 `-rw-------` (0600)이다 — 다른 사용자가 못 읽어야 한다

```bash
python3 -c "import json,datetime;d=json.load(open('$HOME/.llm-router/credentials.json'));print('access_token:', bool(d.get('access_token')));print('refresh_token:', bool(d.get('refresh_token')));print('expires_at:', datetime.datetime.fromtimestamp(d['expires_at']))"
```

- [ ] `access_token`, `refresh_token` 모두 `True`
- [ ] `expires_at`이 미래 시각

---

## 2. Messages 200과 가용 모델

서버를 띄운다(이 터미널은 그대로 두고 새 터미널에서 이어서 진행).

```bash
llm-router serve --profiles profiles.yaml
```

새 터미널에서:

```bash
curl -sS http://127.0.0.1:8788/v1/chat/completions \
  -H "authorization: Bearer sk-local-check" \
  -H "content-type: application/json" \
  -d '{"model":"claude-oauth","messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":16}'
```

- [ ] HTTP 200이고 `choices[0].message.content`에 `OK`가 들어 있다
- [ ] `usage.prompt_tokens` / `completion_tokens`가 0이 아니다

**가용 모델 확인.** `profiles.yaml`의 `model:` 값을 바꿔가며 위 요청을 반복하고, 200이 나오는 모델을 기록한다. 구독 등급에 따라 열리는 모델이 다르다.

```
claude-opus-4-8      → ☐ 200  ☐ 실패(코드: ____)
claude-sonnet-4-6    → ☐ 200  ☐ 실패(코드: ____)
claude-haiku-4-5     → ☐ 200  ☐ 실패(코드: ____)
```

- [ ] **실제로 200이 나온 모델을 최소 하나 기록했다** ← 이게 §7A의 핵심 산출물

---

## 3. 스트리밍 SSE

```bash
curl -sS -N http://127.0.0.1:8788/v1/chat/completions \
  -H "authorization: Bearer sk-local-check" \
  -H "content-type: application/json" \
  -d '{"model":"claude-oauth","stream":true,"messages":[{"role":"user","content":"Count from 1 to 5."}],"max_tokens":64}'
```

- [ ] `data: {...}` 청크가 **여러 개** 순차적으로 나온다 (한 덩어리로 오면 스트리밍이 아니다)
- [ ] 청크에 `"delta":{"content":"..."}` 형태의 부분 텍스트가 있다
- [ ] 마지막 줄이 `data: [DONE]`이다
- [ ] 중간에 `"error"`가 없다

---

## 4. 도구 호출

```bash
curl -sS http://127.0.0.1:8788/v1/chat/completions \
  -H "authorization: Bearer sk-local-check" \
  -H "content-type: application/json" \
  -d '{
    "model":"claude-oauth",
    "max_tokens":256,
    "messages":[{"role":"user","content":"What is the weather in Seoul? Use the tool."}],
    "tools":[{"type":"function","function":{
      "name":"get_weather",
      "description":"Get current weather for a city",
      "parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}
    }}]
  }'
```

- [ ] `choices[0].message.tool_calls`가 존재한다
- [ ] `tool_calls[0].function.name`이 `get_weather`다
- [ ] `tool_calls[0].function.arguments`가 **유효한 JSON 문자열**이고 `city`를 담고 있다
- [ ] `finish_reason`이 `tool_calls`다

**도구 결과 왕복도 확인** (에이전트가 실제로 돌려면 이 왕복이 돼야 한다). 위 응답의 `tool_calls[0].id`를 `CALL_ID`에 넣는다:

```bash
CALL_ID="여기에_붙여넣기"
curl -sS http://127.0.0.1:8788/v1/chat/completions \
  -H "authorization: Bearer sk-local-check" \
  -H "content-type: application/json" \
  -d "{
    \"model\":\"claude-oauth\",
    \"max_tokens\":128,
    \"messages\":[
      {\"role\":\"user\",\"content\":\"What is the weather in Seoul? Use the tool.\"},
      {\"role\":\"assistant\",\"content\":null,\"tool_calls\":[{\"id\":\"$CALL_ID\",\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"arguments\":\"{\\\"city\\\":\\\"Seoul\\\"}\"}}]},
      {\"role\":\"tool\",\"tool_call_id\":\"$CALL_ID\",\"content\":\"22C, sunny\"}
    ]
  }"
```

- [ ] 200이고, 응답 텍스트가 `22`나 `sunny`를 반영한다 (도구 결과를 실제로 읽었다는 증거)

---

## 4.5 사용량·잔여 할당량 헤더 (추가 조사)

**목적:** "로그인만으로 사용량까지 본다"가 가능한지 판별한다. Anthropic API는 응답에 `anthropic-ratelimit-*` 헤더를 실어 보낸다. 구독 OAuth 경로에서도 이 헤더가 오면, **별도 키 없이 로그인만으로 잔여 할당량을 표시할 수 있다.**

라우터를 거치지 않고 업스트림 응답 헤더를 직접 본다. 저장된 토큰을 꺼내 쓴다(값은 화면에 안 찍힌다):

```bash
python3 - <<'PY'
import json, pathlib, httpx
from llm_router.oauth import constants

d = json.loads((pathlib.Path.home()/'.llm-router/credentials.json').read_text())
r = httpx.post(
    constants.ANTHROPIC_API_URL,
    headers=constants.auth_headers(d["access_token"]),
    json={"model": "claude-opus-4-8", "max_tokens": 8,
          "messages": [{"role": "user", "content": "hi"}]},
    timeout=30,
)
print("status:", r.status_code)
for k, v in sorted(r.headers.items()):
    if "ratelimit" in k.lower() or "quota" in k.lower() or "usage" in k.lower():
        print(f"  {k}: {v}")
PY
```

- [ ] `anthropic-ratelimit-*` 계열 헤더가 **하나라도** 보인다 → **로그인만으로 잔여량 표시 가능.** 보이는 헤더 이름을 전부 기록한다
- [ ] 아무것도 안 보인다 → 구독 잔여량은 응답 헤더로도 알 수 없다. 사용량은 라우터가 자체 집계한 값만 표시한다

> 어느 쪽이든 **라우터 자체 사용량 대시보드는 이미 동작한다.** 이 단계는 "그 위에 잔여 할당량까지 얹을 수 있는가"를 가르는 것이다.

---

## 5. refresh 토큰 회전

만료를 강제로 앞당겨 자동 갱신이 도는지 본다. **먼저 백업**한다.

```bash
cp ~/.llm-router/credentials.json ~/.llm-router/credentials.backup.json
python3 -c "
import json, time, pathlib
p = pathlib.Path.home()/'.llm-router/credentials.json'
d = json.loads(p.read_text())
before = d['access_token']
d['expires_at'] = time.time() - 10   # 이미 만료된 것으로 표시
p.write_text(json.dumps(d))
print('old access_token tail:', before[-12:])
"
```

이제 아무 요청이나 한 번 보낸다:

```bash
curl -sS -o /dev/null -w "status=%{http_code}\n" http://127.0.0.1:8788/v1/chat/completions \
  -H "authorization: Bearer sk-local-check" \
  -H "content-type: application/json" \
  -d '{"model":"claude-oauth","messages":[{"role":"user","content":"hi"}],"max_tokens":8}'
```

- [ ] `status=200` — 만료된 토큰으로도 요청이 성공했다(= 자동 refresh가 돌았다)

```bash
python3 -c "
import json, datetime, pathlib
d = json.loads((pathlib.Path.home()/'.llm-router/credentials.json').read_text())
print('new access_token tail:', d['access_token'][-12:])
print('new expires_at:', datetime.datetime.fromtimestamp(d['expires_at']))
"
```

- [ ] `access_token`이 **이전과 다른 값**이다 (갱신됨)
- [ ] `expires_at`이 다시 미래다
- [ ] `refresh_token`이 회전됐는지 기록: ☐ 같은 값 유지  ☐ 새 값으로 교체

문제가 있으면 백업으로 되돌린다:

```bash
mv ~/.llm-router/credentials.backup.json ~/.llm-router/credentials.json
```

---

## 실패 시 대응

| 증상 | 의미와 대응 |
|---|---|
| 로그인 브라우저가 안 열림 / 콜백 안 옴 | 방화벽이 로컬 콜백 포트를 막았을 수 있다. 터미널에 출력된 authorize URL을 직접 브라우저에 붙여넣어 본다 |
| 1번은 되는데 2번이 401/403 | **가장 중요한 실패.** 토큰은 받았지만 그 토큰으로 Messages API를 못 쓴다는 뜻 → 구독 OAuth로 추론하는 경로 자체가 성립하지 않는다. 응답 본문 전체를 기록하고 §7A 후퇴 계획(Anthropic API key 경로를 1차 지원으로 승격)으로 전환 |
| 2번이 404 model_not_found | 라우터가 프로필을 못 찾은 것. `profiles.yaml`의 `name`과 요청의 `model` 값이 같은지 확인 |
| 2번이 400인데 모델 관련 메시지 | 그 모델이 구독 등급에 없는 것. 다른 모델로 반복 |
| 3번에서 청크가 한 덩어리로 옴 | curl에 `-N`이 빠졌거나 프록시가 버퍼링 중. `-N` 확인 |
| 4번에 `tool_calls`가 없음 | 모델이 도구를 안 쓴 것일 수 있다. 프롬프트를 더 강하게("You must call get_weather") 바꿔 재시도. 그래도 없으면 변환기 문제일 수 있으니 기록 |
| 5번이 401 | refresh가 실패했다. `llm-router oauth login anthropic`으로 재로그인하면 복구되지만, **자동 갱신이 안 된다는 뜻이므로 반드시 기록** |

---

## 완료 후

1. 위 표의 결과를 `oauth-findings.md`에 옮긴다.
2. 5개 전부 통과하면 `CLAUDE.md`에서 "MUST 실험적으로 표시한다" 줄을 **검증 완료**로 바꾼다.
3. 2번에서 확인된 **실제 가용 모델 목록**을 `profiles.example.yaml`에 반영한다.
4. 정리:

```bash
cd ~ && rm -rf ~/llm-router-check
```

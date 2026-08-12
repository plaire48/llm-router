# llm-router

localhost에서 실행되는 OpenAI 호환 LLM 게이트웨이입니다. 클라이언트는 하나의
`base_url + api_key + model` 계약으로 Anthropic, OpenAI, OpenAI 호환 제공자를 호출합니다.

## 현재 상태

- 지원: Anthropic API key, OpenAI API key, 임의 OpenAI 호환 `base_url`
- 지원: `/v1/chat/completions` 비스트리밍·스트리밍·도구 호출, `/v1/models`, `/health`
- 실험적: Claude 구독 OAuth. 현재 설치된 공식 Claude Code 바이너리에서 로그인 및 API 계약을
  확인해 구현했지만 실제 구독 계정 스모크 테스트는 아직 필요합니다.
- 보류: OpenAI(ChatGPT) 구독 OAuth. 실제 호출 가능 API를 검증하기 전까지 CLI와 서버에서
  명시적으로 차단합니다.

OAuth 조사 내용은
[`oauth-findings.md`](docs/superpowers/specs/oauth-findings.md)에 기록되어 있습니다.

## 설치

Python 3.11 이상이 필요합니다.

```bash
python3 -m pip install -e '.[dev]'
```

`.env.example`을 `.env`로 복사하고 마스터 키와 사용할 제공자의 API key를 설정합니다.

```dotenv
LLM_ROUTER_MASTER_KEY=sk-local-change-me
LLM_ROUTER_HOST=127.0.0.1
LLM_ROUTER_PORT=8787
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

마스터 키가 비어 있으면 서버는 시작하지 않습니다. 비밀은 `profiles.yaml`이 아니라 `.env`에만
둡니다.

## 프로필

`profiles.example.yaml`을 `profiles.yaml`로 복사한 뒤 모델 ID와 프로필을 조정합니다.

```yaml
profiles:
  - name: claude
    provider: anthropic
    auth: api_key
    api_key_env: ANTHROPIC_API_KEY
    model: your-anthropic-model-id
    aliases: [assistant]
    params:
      max_tokens: 4096

  - name: openai
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: your-openai-model-id

  - name: local
    provider: openai_compatible
    auth: api_key
    api_key_env: LOCAL_API_KEY
    base_url: http://localhost:11434/v1
    model: llama3.1
```

클라이언트의 `model`에는 업스트림 모델 ID가 아니라 프로필 `name` 또는 `aliases` 값을 넣습니다.

프로필과 자격증명 상태를 확인할 수 있습니다.

```bash
llm-router profiles list --profiles profiles.yaml
```

## Claude OAuth 로그인

Claude 구독 OAuth를 실험하려면 브라우저에서 직접 로그인합니다.

```bash
llm-router oauth login anthropic
```

토큰은 `~/.llm-router/credentials.json`에 0600 권한으로 저장되며 만료 전에 자동으로 한 번만
refresh됩니다. 구독 OAuth 토큰의 외부 도구 재사용은 제공자 정책과 충돌할 수 있으므로 개인 로컬
사용 전 약관을 확인해야 합니다.

## 실행

```bash
llm-router serve --profiles profiles.yaml
```

기본 바인딩은 `127.0.0.1:8787`입니다. 외부 인터페이스에 노출하려면 `--host`를 명시해야 합니다.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Authorization: Bearer sk-local-change-me' \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude","messages":[{"role":"user","content":"Hello"}]}'
```

OpenAI Python SDK는 별도 변환 없이 연결됩니다.

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-local-change-me",
    base_url="http://127.0.0.1:8787/v1",
)
response = client.chat.completions.create(
    model="claude",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)
```

OpenCrew 등 OpenAI 호환 설정을 받는 도구에도 같은 값을 사용합니다.

- `base_url`: `http://127.0.0.1:8787/v1`
- `api_key`: `LLM_ROUTER_MASTER_KEY` 값
- `model`: 프로필 name 또는 alias

## 개발

```bash
python3 -m pytest
ruff check src tests
ruff format --check src tests
```

테스트는 실제 제공자에 요청하지 않습니다. respx 업스트림 목과 실제 OpenAI Python SDK 계약
테스트를 사용합니다. 실제 구독 OAuth 검증은 별도 수동 스모크 단계입니다.

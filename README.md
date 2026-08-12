# llm-router

localhost에서 실행되는 OpenAI 호환 LLM 게이트웨이입니다. 클라이언트는 하나의
`base_url + api_key + model` 계약으로 Anthropic, OpenAI, OpenAI 호환 제공자를 호출합니다.

## 현재 상태

- 지원: Anthropic API key, OpenAI API key, 임의 OpenAI 호환 `base_url`
- 지원: `/v1/chat/completions` 비스트리밍·스트리밍·도구 호출, `/v1/models`, `/health`
- 지원: SQLite 사용량 기록과 `/dashboard` 웹 대시보드
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
LLM_ROUTER_USAGE_DB=~/.llm-router/usage.db
LLM_ROUTER_LOG_BODIES=false
CLAUDE_ANALYTICS_KEY=
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

### opencode 연결

opencode는 `@ai-sdk/openai-compatible` 제공자로 임의의 OpenAI 호환 엔드포인트를 받습니다.
`opencode.json`에 다음을 추가합니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "llm-router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llm-router (로컬)",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "sk-local-change-me"
      },
      "models": {
        "claude": { "name": "Claude (구독 로그인)" },
        "openai": { "name": "OpenAI" }
      }
    }
  }
}
```

`models`의 키는 라우터로 그대로 전달되므로 **`profiles.yaml`의 프로필 `name`과 정확히 일치해야
합니다.** 위 예시는 프로필 `claude`, `openai`가 있다고 가정합니다. 프로필을 추가하면 opencode의
`models`에도 같은 이름을 넣어야 목록에 나타납니다.

`llm-router serve`가 실행 중이어야 하며, opencode는 뒤에서 구독 OAuth가 쓰이는지 API key가
쓰이는지 알지 못합니다.

## 사용량 대시보드

`llm-router serve`를 실행한 뒤 브라우저에서
`http://localhost:8787/dashboard`를 열고 `LLM_ROUTER_MASTER_KEY` 값을 입력합니다. 최근
7·30·90일의 토큰 사용량과 호출 이력을 프로필을 가로질러 확인할 수 있습니다.

사용량 데이터는 기본적으로 `~/.llm-router/usage.db`에 저장됩니다. 위치를 바꾸려면
`LLM_ROUTER_USAGE_DB`를 설정합니다. 요청·응답 본문은 기본적으로 저장하지 않으며, 디버깅에
필요한 경우에만 다음 값을 명시적으로 켭니다.

```dotenv
LLM_ROUTER_LOG_BODIES=true
```

본문에는 민감한 프롬프트와 도구 결과가 포함될 수 있습니다. 필요한 기간에만 활성화하는 것을
권장합니다. 대시보드 HTML 자체는 인증 없이 열리지만, 사용량 API는 마스터 키 인증을 요구하며
입력한 키는 현재 브라우저 탭의 세션 저장소에만 보관됩니다.

### Claude Enterprise 조직 사용량

대시보드는 라우터 자체 계측과 별도로 Claude Enterprise 조직의 일별 토큰 사용량을 표시할 수
있습니다. Primary owner가 `claude.ai`의 **Organization settings → API**에서 public API access를
활성화하고 `read:analytics` 범위의 Analytics API key를 발급한 뒤 다음 환경변수에 설정합니다.

```dotenv
CLAUDE_ANALYTICS_KEY=your-analytics-key
```

관리자 키는 브라우저로 전달되지 않고 라우터가 Analytics API를 대신 호출합니다. 응답은 5분간
메모리에 캐시되며, 조직 단위 요청 한도에 걸리면 마지막 캐시를 표시합니다. 조직 데이터는 최대
24시간 지연되고 최근 값이 사후 조정될 수 있습니다. 비용과 usage credits의 의미는 Enterprise
플랜에 따라 달라지므로 플랜이 확인되기 전까지 대시보드에는 토큰과 요청 수만 표시합니다.

## 개발

```bash
python3 -m pytest
ruff check src tests
ruff format --check src tests
```

테스트는 실제 제공자에 요청하지 않습니다. respx 업스트림 목과 실제 OpenAI Python SDK 계약
테스트를 사용합니다. 실제 구독 OAuth 검증은 별도 수동 스모크 단계입니다.

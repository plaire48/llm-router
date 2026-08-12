# llm-router

Claude, OpenAI, FabriX, 사내 OpenAI 호환 LLM을 localhost의 OpenAI 호환 API로 서빙하는 데스크톱형
로컬 관리 콘솔입니다.

## 화면 구성

- **연결** — Claude와 OpenAI 공식 브라우저 로그인
- **LLM 서빙** — 단일 로컬 Gateway와 model 기반 프로필 라우팅
- **대시보드** — 계정 한도, 프로필·모델별 비용, 일별 입력·출력 토큰

대시보드 진입에는 키 입력이 없습니다. `GET /dashboard`가 localhost 전용 HttpOnly 세션을 자동으로
만듭니다.

## 설치와 실행

Python 3.11 이상이 필요합니다. 브라우저 로그인 방식에는 공식 Claude Code CLI와 Codex CLI가
필요합니다.

```bash
python3 -m pip install -e '.[dev]'
cp .env.example .env
cp profiles.example.yaml profiles.yaml
llm-router serve --profiles profiles.yaml
```

기본 localhost 실행에는 로컬 API 키가 필요하지 않습니다.

```dotenv
LLM_ROUTER_HOST=127.0.0.1
LLM_ROUTER_PORT=8787
LLM_ROUTER_USAGE_DB=~/.llm-router/usage.db
LLM_ROUTER_LOG_BODIES=false
```

서버 실행 후 [http://localhost:8787/dashboard](http://localhost:8787/dashboard)를 엽니다.

## 브라우저 로그인

화면의 `연결` 메뉴에서 두 버튼을 사용합니다.

- Claude: 공식 `claude auth login --claudeai`
- OpenAI: 공식 `codex login`

CLI에서 직접 실행해도 동일한 로그인 세션을 사용합니다.

```bash
llm-router oauth login anthropic
llm-router oauth login openai
```

Claude OAuth 프로필의 추론은 공식 Claude Code CLI의 비대화식 안전 모드 결과를 Chat Completions로
변환합니다. OpenAI OAuth 프로필은 Codex Responses 스트림을 Chat Completions로 변환합니다.

## LLM 서빙 프로필

`LLM 서빙` 메뉴에서 다음 연결 방식을 선택할 수 있습니다.

1. Claude 브라우저 로그인
2. OpenAI 브라우저 로그인
3. FabriX 사내 API
4. OpenAI 호환 LLM Endpoint

라우터가 실행되면 모든 프로필은 다음 하나의 OpenAI 호환 Gateway에서 바로 사용할 수 있습니다.

```text
Base URL:         http://127.0.0.1:8787/v1
Chat Completions: http://127.0.0.1:8787/v1/chat/completions
Models:           http://127.0.0.1:8787/v1/models
```

프로필마다 별도 포트를 시작하거나 중지하지 않습니다. 요청의 `model`에 프로필 이름을 넣으면 Gateway가
Claude 브라우저 로그인, OpenAI 브라우저 로그인, FabriX, OpenAI 호환 LLM 중 알맞은 연결로 라우팅합니다.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet","messages":[{"role":"user","content":"안녕"}]}'
```

API 키는 FabriX와 OpenAI 호환 사내 LLM 프로필에서만 입력할 수 있습니다. 키는 `profiles.yaml`에 기록하지 않고
`~/.llm-router/profile-secrets.json`에 0600 권한으로 저장하며 API 응답에도 반환하지 않습니다.
OpenAI 호환 LLM은 다음 계약을 지원하면 연결됩니다.

- `GET {base_url}/models`
- `POST {base_url}/chat/completions`
- Bearer API key

FabriX 프로필은 Endpoint, 모델 ID, Client Key, API Token을 입력합니다. `next_langgraph`와 같은
FabriX 계약으로 업스트림을 호출합니다.

- `POST {endpoint}/openapi/chat/v1/messages`
- `x-fabrix-client: <Client Key>`
- `x-openapi-token: Bearer <API Token>`
- `modelIds`, `contents`, `isStream`, `llmConfig`, `systemPrompt` 요청 본문

두 비밀값 모두 같은 로컬 0600 비밀 저장소에 보관되고 YAML 및 제어 API 응답에는 노출되지 않습니다.
FabriX의 SSE `CHUNK` 응답도 로컬 OpenAI Chat Completions 스트림으로 변환됩니다.

## Agent Factory SDK 연결

`agent-factory-sdk`는 수정하지 않습니다. Studio가 이미 제공하는 **OpenAI 호환 서버** 연결에 아래 값을
등록하면 기존 HTTP LLM 프로필이 라우터를 그대로 소비합니다.

- 서버 주소: `http://127.0.0.1:8787/v1/chat/completions`
- 모델: 사용할 라우터 프로필 이름(예: `claude-sonnet`)
- API 키·Authorization: 비워 둠

Studio/SDK는 OpenAI Chat Completions 요청을 보내고, 라우터가 실제 업스트림 모델과 인증 방식을
결정합니다. 따라서 Agent 프로젝트는 Claude/OpenAI 로그인 토큰이나 FabriX 키를 알 필요가 없습니다.

배포 패키지에는 Endpoint와 model 프로필 이름만 포함합니다. 설치 런처는 다음 두 검사만 통과하면 같은
Agent 코드를 그대로 실행할 수 있습니다.

1. `GET http://127.0.0.1:8787/health`가 성공하는지 확인
2. `GET /v1/models`에 Agent가 사용할 프로필 이름이 있는지 확인

이 경계 덕분에 이후 Agent Factory Studio나 Python 코드로 만든 Agent를 HTML에서 내려받는 설치형
패키지로 묶더라도, Agent Factory SDK 자체와 Agent 로직은 변경하지 않습니다.

## opencode 연결

모든 프로필이 같은 `http://127.0.0.1:8787/v1` 주소를 OpenAI 호환 provider로 사용합니다. 전체 설정은 인증된
`GET /v1/connect/opencode`에서 받을 수 있습니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "llm-router-claude-sonnet": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llm-router / claude-sonnet",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1"
      },
      "models": {
        "claude-sonnet": {"name": "claude-sonnet"}
      }
    }
  }
}
```

## 사용량

라우터를 통과한 모든 호출은 프로필별 일일 입력·출력 토큰으로 SQLite에 기록됩니다. 요청·응답 본문은
기본적으로 저장하지 않습니다. OpenAI 로그인 계정은 공식 Codex app-server가 제공하는 개인 사용 창과
일별 토큰 버킷도 대시보드에 표시합니다.

## API

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /v1/auth/status`
- `POST /v1/auth/{anthropic|openai}/login`
- `DELETE /v1/auth/{anthropic|openai}`
- `GET /v1/profiles`
- `POST /v1/profiles`
- `PUT /v1/profiles/{name}`
- `DELETE /v1/profiles/{name}`
- `POST /v1/profiles/discover-models`
- `GET /v1/connect/opencode`
- `GET /v1/usage/summary`
- `GET /v1/usage/account/openai`

localhost의 `/v1/models`와 `/v1/chat/completions`는 로컬 API 키 없이 호출합니다. 데스크톱 화면의
제어 API는 대시보드가 자동 발급한 localhost 세션 쿠키를 사용합니다. `0.0.0.0` 등 localhost 밖으로
바인딩할 때만 `LLM_ROUTER_MASTER_KEY`를 반드시 설정해야 하며, 이 경우 LLM API에는 Bearer 인증이
적용됩니다.

## 개발

```bash
pytest -q
ruff check src tests
ruff format --check src tests
```

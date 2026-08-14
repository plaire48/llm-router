# llm-router

OpenAI, FabriX, 사내 OpenAI 호환 LLM을 localhost의 OpenAI 호환 API로 서빙하는 데스크톱형
로컬 관리 콘솔입니다.

## 화면 구성

- **연결** — ChatGPT 계정 OAuth와 사내 API 연결
- **LLM 서빙** — 단일 로컬 Gateway와 model 기반 프로필 라우팅
- **대시보드** — 계정 한도, 프로필·모델별 비용, 일별 입력·출력 토큰

대시보드 진입에는 키 입력이 없습니다. `GET /dashboard`가 localhost 전용 HttpOnly 세션을 자동으로
만듭니다.

## 설치와 실행

Python 3.11 이상이 필요합니다. ChatGPT 계정 OAuth에 필요한 공식 런타임은 Python 의존성에
포함되므로 별도 OpenAI CLI는 필요하지 않습니다. OpenAI 추론은 내부 OpenCode 서버에서 실행되므로
`opencode` 명령은 설치되어 있어야 합니다.

```bash
python3 -m pip install -e '.[dev]'
cp .env.example .env
cp profiles.example.yaml profiles.yaml
llm-router serve --profiles profiles.yaml
```

`llm-router`는 설치 후 생성되는 콘솔 명령입니다. Python 모듈로 직접 실행할 때는 하이픈 대신
밑줄을 사용합니다.

```bash
python3 -m llm_router serve --profiles profiles.yaml
```

`python3 -m llm-router`는 유효한 Python 모듈명이 아니므로 사용할 수 없습니다.

기본 localhost 실행에는 로컬 API 키가 필요하지 않습니다.

```dotenv
LLM_ROUTER_HOST=127.0.0.1
LLM_ROUTER_PORT=8787
LLM_ROUTER_USAGE_DB=~/.llm-router/usage.db
LLM_ROUTER_LOG_BODIES=false
LLM_ROUTER_OPENCODE_URL=http://127.0.0.1:4097
LLM_ROUTER_OPENCODE_BINARY=opencode
LLM_ROUTER_OPENCODE_DIRECTORY=~/.llm-router/opencode
LLM_ROUTER_OPENCODE_AUTO_START=true
```

사내 HTTPS 프록시가 자체 CA로 인증서를 서명하는 환경에서는 PEM 인증서 파일을 설정합니다. 라우터는
기본 공개 CA에 인증서를 추가하고 공식 Codex 로그인 변수 `CODEX_CA_CERTIFICATE`에도 전달하여 로그인,
토큰 교환·갱신, 추론 요청에 동일하게 적용합니다. `NODE_EXTRA_CA_CERTS`만 설정해도 라우터가 Codex
변수로 변환합니다.

```bash
export NODE_EXTRA_CA_CERTS=/absolute/path/company-ca.pem
llm-router serve --profiles profiles.yaml
```

Windows 11에서는 프로젝트의 `.env`에 실제 파일 경로를 넣는 방식이 가장 확실합니다. 변수 이름 자체가
인증서 위치는 아니며, 값이 `-----BEGIN CERTIFICATE-----`로 시작하는 PEM 파일이어야 합니다. 경로에
공백이 있으면 따옴표로 감쌉니다.

```dotenv
NODE_EXTRA_CA_CERTS=C:/certs/company-ca.pem
CODEX_CA_CERTIFICATE=C:/certs/company-ca.pem
```

PowerShell에서 현재 프로세스에만 적용하려면 다음처럼 설정한 뒤 같은 창에서 라우터를 실행합니다.

```powershell
$env:NODE_EXTRA_CA_CERTS = 'C:\certs\company-ca.pem'
$env:CODEX_CA_CERTIFICATE = $env:NODE_EXTRA_CA_CERTS
python -m llm_router serve --profiles profiles.yaml
```

Windows 인증서 저장소에만 있는 `.cer`가 DER 바이너리라면 먼저 PEM으로 내보내거나
`certutil -encode company.cer company-ca.pem`으로 변환합니다. 사내 프록시 체인에 중간 CA가 있으면
같은 PEM 파일에 루트와 중간 인증서를 모두 포함합니다.

인증서 검증을 끄는 방식(`verify=False`)은 지원하지 않습니다.

서버 실행 후 [http://localhost:8787/dashboard](http://localhost:8787/dashboard)를 엽니다.

## 브라우저 로그인

화면의 `연결` 메뉴에서 **Sign in with ChatGPT** 계정 OAuth를 사용할 수 있습니다.

- 기본적으로 `CODEX_HOME` 또는 `~/.codex/auth.json`의 기존 `auth_mode=chatgpt` 세션을 공유합니다.
- 유효한 세션이 없을 때만 공식 계정 서비스가 브라우저 OAuth와 localhost 콜백을 시작합니다.
- 별도 계정 저장소가 필요하면 `LLM_ROUTER_OPENAI_HOME=~/.llm-router/openai`처럼 명시합니다.

공유 세션은 Codex CLI와 같은 공식 계정 캐시를 사용하므로 대시보드에서 연결을 해제하면 Codex
CLI/IDE의 ChatGPT 로그인도 함께 해제될 수 있습니다. `codex login`이라는 명령 이름과 무관하게
인증 방식은 API 키가 아닌 ChatGPT 계정 OAuth입니다.

Claude 구독 OAuth는 정책 준수를 위해 비활성화되어 있으며 로그인, 프로필 생성, 추론 요청을 모두
거부합니다. 기존 자격증명 파일은 자동 삭제하지 않지만 라우터가 사용하지 않습니다.

터미널에서 직접 시작하려면 다음 명령을 사용합니다.

```bash
llm-router oauth login openai
```

OpenAI OAuth 프로필의 추론은 내부 OpenCode 세션에서 실행한 뒤 Chat Completions로 변환합니다. 같은
계정의 사용 창과 일별 토큰 버킷은 기존 `/dashboard`의 OpenAI 사용량 카드에 표시됩니다.

## LLM 서빙 프로필

`LLM 서빙` 메뉴에서 다음 연결 방식을 선택할 수 있습니다.

1. ChatGPT 계정 OAuth
2. FabriX 사내 API
3. OpenAI 호환 LLM Endpoint

라우터가 실행되면 모든 프로필은 다음 하나의 OpenAI 호환 Gateway에서 바로 사용할 수 있습니다.

```text
Base URL:         http://127.0.0.1:8787/v1
Chat Completions: http://127.0.0.1:8787/v1/chat/completions
Models:           http://127.0.0.1:8787/v1/models
```

프로필마다 별도 포트를 시작하거나 중지하지 않습니다. 요청의 `model`에 프로필 이름을 넣으면 Gateway가
ChatGPT 계정 OAuth, FabriX, OpenAI 호환 LLM 중 알맞은 연결로 라우팅합니다.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openai","messages":[{"role":"user","content":"안녕"}]}'
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

## 내부 OpenCode 실행

ChatGPT 계정 OAuth 프로필의 실제 호출 경로는 `사용자/IDE → llm-router → OpenCode → OpenAI`입니다.
라우터가 OpenCode의 headless 서버를 localhost에서 지연 시작하고, 요청마다 임시 세션을 만든 뒤 응답을
OpenAI Chat Completions 형식으로 변환합니다. 사용자가 `opencode.json`을 복사하거나 OpenCode를 별도로
실행할 필요는 없습니다.

라우터가 시작한 OpenCode는 별도의 `~/.llm-router/opencode` 데이터 디렉터리를 사용합니다. 프로젝트
설정은 읽지 않고 파일·쉘·웹 등 모든 OpenCode 도구 권한과 세션 공유를 차단합니다. 브라우저 로그인
자격증명은 호출 직전에 이 내부 런타임에 동기화되며, 로그와 API 응답에는 노출하지 않습니다.

현재 내부 세션 API는 호출자 정의 `tool_calls`를 투명하게 전달하지 못하므로, `tools`가 포함된 요청은
실행하지 않고 명시적인 400 오류를 반환합니다. `stream=true`는 OpenCode 응답 완료 후 유효한 SSE 청크로
전달하는 버퍼링 방식입니다.

## 사용량

라우터를 통과한 모든 호출은 프로필별 일일 입력·출력 토큰으로 SQLite에 기록됩니다. 요청·응답 본문은
기본적으로 저장하지 않습니다. OpenAI 로그인 계정의 개인 사용 창과 일별 토큰 버킷도 기존
대시보드에 표시합니다.

## API

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /v1/auth/status`
- `POST /v1/auth/openai/login`
- `DELETE /v1/auth/{anthropic|openai}` (`anthropic`은 기존 로컬 토큰 삭제 전용)
- `GET /v1/profiles`
- `POST /v1/profiles`
- `PUT /v1/profiles/{name}`
- `DELETE /v1/profiles/{name}`
- `POST /v1/profiles/discover-models`
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

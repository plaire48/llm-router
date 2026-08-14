# llm-router

OpenAI, AI Pro, FabriX, 사내 OpenAI 호환 LLM을 localhost의 OpenAI 호환 API로 서빙하는 데스크톱형
로컬 관리 콘솔입니다.

## 화면 구성

- **연결** — ChatGPT 계정 OAuth와 사내 API 연결
- **LLM 서빙** — 단일 로컬 Gateway와 model 기반 프로필 라우팅
- **대시보드** — 계정 한도, 프로필·모델별 비용, 일별 입력·출력 토큰

대시보드 진입에는 키 입력이 없습니다. `GET /dashboard`가 localhost 전용 HttpOnly 세션을 자동으로
만듭니다.

## 설치와 실행

Python 3.11 이상이 필요합니다. ChatGPT 계정 OAuth와 OpenAI 추론에 사용하는 플랫폼별 OpenCode 실행
파일은 배포 wheel에 포함됩니다. 별도 OpenAI CLI나 OpenCode 설치는 필요하지 않습니다.

```bash
python3 -m pip install llm_router-0.1.0-<platform>.whl
cp .env.example .env
cp profiles.example.yaml profiles.yaml
llm-router serve --profiles profiles.yaml
```

소스에서 개발할 때만 `python3 -m pip install -e '.[dev]'`를 사용합니다. editable 설치는 wheel 빌드가
아니므로 시스템 `PATH`의 OpenCode를 개발용 fallback으로 사용합니다.

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
# 기본값은 배포 wheel에 포함된 OpenCode입니다. 외부 실행 파일을 강제할 때만 절대 경로로 바꿉니다.
LLM_ROUTER_OPENCODE_BINARY=opencode
LLM_ROUTER_OPENCODE_DIRECTORY=~/.llm-router/opencode
LLM_ROUTER_OPENCODE_AUTO_START=true
```

사내 HTTPS 프록시가 자체 CA로 인증서를 서명하는 환경에서는 PEM 인증서 파일을 설정합니다. 라우터의
Python HTTP 클라이언트와 내부 OpenCode 프로세스가 `NODE_EXTRA_CA_CERTS`를 상속하므로 로그인, 토큰
교환·갱신, 추론 요청에 동일하게 적용됩니다.

```bash
export NODE_EXTRA_CA_CERTS=/absolute/path/company-ca.pem
llm-router serve --profiles profiles.yaml
```

Windows 11에서는 프로젝트의 `.env`에 실제 파일 경로를 넣는 방식이 가장 확실합니다. 변수 이름 자체가
인증서 위치는 아니며, 값이 `-----BEGIN CERTIFICATE-----`로 시작하는 PEM 파일이어야 합니다. 경로에
공백이 있으면 따옴표로 감쌉니다.

```dotenv
NODE_EXTRA_CA_CERTS=C:/certs/company-ca.pem
```

PowerShell에서 현재 프로세스에만 적용하려면 다음처럼 설정한 뒤 같은 창에서 라우터를 실행합니다.

```powershell
$env:NODE_EXTRA_CA_CERTS = 'C:\certs\company-ca.pem'
python -m llm_router serve --profiles profiles.yaml
```

Windows 인증서 저장소에만 있는 `.cer`가 DER 바이너리라면 먼저 PEM으로 내보내거나
`certutil -encode company.cer company-ca.pem`으로 변환합니다. 사내 프록시 체인에 중간 CA가 있으면
같은 PEM 파일에 루트와 중간 인증서를 모두 포함합니다.

인증서 검증을 끄는 방식(`verify=False`)은 지원하지 않습니다.

서버 실행 후 [http://localhost:8787/dashboard](http://localhost:8787/dashboard)를 엽니다.

## 브라우저 로그인

화면의 `연결` 메뉴에서 **Sign in with ChatGPT**를 사용할 수 있습니다.

- wheel에 포함된 OpenCode가 브라우저 OAuth 시작, localhost callback, token exchange와 refresh를
  직접 처리합니다.
- 자격증명은 `~/.llm-router/opencode/data/opencode/auth.json`에 격리되며 Codex CLI/IDE 세션을 공유하거나
  변경하지 않습니다.
- OpenAI 추론 요청의 `User-Agent`와 `originator`는 번들 OpenCode의 공식 내장 플러그인이 직접 생성하며,
  라우터는 해당 헤더를 덮어쓰거나 다른 클라이언트로 위장하지 않습니다.

Claude 구독 OAuth는 정책 준수를 위해 비활성화되어 있으며 로그인, 프로필 생성, 추론 요청을 모두
거부합니다. 기존 자격증명 파일은 자동 삭제하지 않지만 라우터가 사용하지 않습니다.

터미널에서 직접 시작하려면 다음 명령을 사용합니다.

```bash
llm-router oauth login openai
```

OpenAI OAuth 프로필의 추론은 내부 OpenCode 세션에서 실행한 뒤 Chat Completions로 변환합니다.
프로필을 등록하거나 수정할 때 번들 OpenCode를 즉시 기동해 사용 가능 여부를 확인하며,
프로필 API에는 `inference_engine: opencode`가 표시됩니다.

## LLM 서빙 프로필

`LLM 서빙` 메뉴에서 다음 연결 방식을 선택할 수 있습니다.

1. ChatGPT 계정 OAuth
2. AI Pro API Key
3. FabriX 사내 API
4. OpenAI 호환 LLM Endpoint

라우터가 실행되면 모든 프로필은 다음 하나의 OpenAI 호환 Gateway에서 바로 사용할 수 있습니다.

```text
Base URL:         http://127.0.0.1:8787/v1
Chat Completions: http://127.0.0.1:8787/v1/chat/completions
Models:           http://127.0.0.1:8787/v1/models
```

프로필마다 별도 포트를 시작하거나 중지하지 않습니다. 요청의 `model`에 프로필 이름을 넣으면 Gateway가
ChatGPT 계정 OAuth, AI Pro API Key, FabriX, OpenAI 호환 LLM 중 알맞은 연결로 라우팅합니다.

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openai","messages":[{"role":"user","content":"안녕"}]}'
```

API 키는 AI Pro, FabriX와 OpenAI 호환 사내 LLM 프로필에서 입력할 수 있습니다. 키는 `profiles.yaml`에 기록하지 않고
`~/.llm-router/profile-secrets.json`에 0600 권한으로 저장하며 API 응답에도 반환하지 않습니다.
AI Pro는 기본 Endpoint `https://aipro.sdsdev.co.kr/v1`과 발급받은 모델 ID를 사용합니다. 라우터는
`@ai-sdk/openai-compatible` custom provider에 Endpoint, 모델, API Key 환경변수 참조만 등록하고 모든 추론을
번들 OpenCode 세션으로 실행합니다. `User-Agent`를 설정하는 코드는 없으며 실제 OpenCode가 생성한 헤더를
그대로 사용합니다.

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
라우터가 wheel에 포함된 OpenCode의 headless 서버를 localhost에서 지연 시작하고, 요청마다 임시 세션을
만든 뒤 응답을 OpenAI Chat Completions 형식으로 변환합니다. 사용자가 OpenCode를 설치하거나
`opencode.json`을 복사하거나 OpenCode를 별도로 실행할 필요는 없습니다.

배포 wheel은 빌드 호스트와 같은 플랫폼의 OpenCode `1.18.18` 공식 릴리스 바이너리를 내려받아
SHA-256을 검증한 뒤 포함합니다. macOS arm64/x64, Linux glibc·musl arm64/x64, Windows arm64/x64를
지원하며 x64는 CPU 호환성을 위해 baseline 바이너리를 사용합니다. 따라서 각 대상 플랫폼에서 wheel을
각각 빌드해 배포합니다. 소스 editable 설치는 배포물이 아니므로 시스템 `opencode`를 fallback으로
사용할 수 있습니다.

라우터가 시작한 OpenCode는 별도의 `~/.llm-router/opencode` 데이터 디렉터리를 사용합니다. 프로젝트
설정은 읽지 않고 파일·쉘·웹 등 모든 OpenCode 도구 권한과 세션 공유를 차단합니다. 브라우저 로그인
자격증명도 같은 내부 런타임이 직접 소유하며, 로그와 API 응답에는 노출하지 않습니다. 로그인·토큰
교환·refresh·추론 요청은 별도 Codex 런타임을 우회하지 않습니다.

부모 프로세스의 `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `BUN_OPTIONS` 및 OpenCode 플러그인 비활성화 설정은
내부 런타임에 전달하지 않습니다. 설치 환경의 우발적인 override가 공식 OpenCode OAuth·endpoint·식별
동작을 바꾸지 않도록 하기 위한 격리이며, OpenCode 자체의 요청 헤더는 수정하지 않습니다.

현재 내부 세션 API는 호출자 정의 `tool_calls`를 투명하게 전달하지 못하므로, `tools`가 포함된 요청은
실행하지 않고 명시적인 400 오류를 반환합니다. `stream=true`는 OpenCode 응답 완료 후 유효한 SSE 청크로
전달하는 버퍼링 방식입니다.

## 사용량

라우터를 통과한 모든 호출은 프로필별 일일 입력·출력 토큰으로 SQLite에 기록됩니다. 요청·응답 본문은
기본적으로 저장하지 않습니다. OpenCode가 계정 한도 API를 공개하지 않는 동안 OpenAI 계정 한도 카드는
미구성 상태로 표시되고, 라우터를 통과한 로컬 토큰 사용량은 계속 집계됩니다.

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

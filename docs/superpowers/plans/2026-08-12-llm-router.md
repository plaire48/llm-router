# llm-router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **이 저장소의 역할 분담:** 구현은 Codex가 담당한다. 이 문서는 Codex가 사전 지식 없이 태스크 단위로 실행할 수 있도록 작성됐다. Claude는 계획·리뷰만 한다.

**Goal:** localhost에서 도는 OpenAI 호환 LLM 게이트웨이를 만든다 — Claude·OpenAI 구독 OAuth와 API-key 제공자를 하나의 엔드포인트로 열어, LLM을 API 형태로 서빙한다. `base_url + api_key + model`로 소비하는 어떤 클라이언트든 대상(검증 클라이언트: OpenCrew).

**Architecture:** FastAPI 서버가 OpenAI 호환 표면(`/v1/chat/completions`, `/v1/models`, `/health`)을 노출한다. 요청의 `model`을 프로필로 라우팅하고, 프로필의 `provider`가 어댑터를 고른다. AnthropicAdapter는 OpenAI↔Anthropic 포맷을 순수 함수로 변환하고 OAuth 또는 API key 자격증명을 붙인다. OpenAIAdapter는 패스스루(API key/OpenAI OAuth)하되, OpenAI 구독 OAuth가 Responses API만 열면 변환 경로를 추가한다(Task 2B·14). 두 OAuth 경로는 코드 투입 전 스파이크(Task 2·2B)로 선검증한다.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, httpx, Pydantic v2, PyYAML, typer, pytest, pytest-asyncio, respx.

**설계 스펙:** `docs/superpowers/specs/2026-08-12-llm-router-design.md` (확정본). 이 계획은 그 스펙을 구현한다.

## Global Constraints

- Python `>=3.11`. 소스는 src 레이아웃(`src/llm_router/`).
- 서버 기본 바인딩 `127.0.0.1`, 기본 포트 `8787`. 외부 노출은 명시적 옵트인.
- 모든 에러 응답은 OpenAI 에러 포맷 `{"error": {"message": str, "type": str, "code": str|null}}`.
- 클라이언트가 보는 `model` 값은 항상 **프로필 name** (업스트림 모델 id를 노출하지 않는다).
- 비밀(마스터 키, API key)은 `.env`에서만 읽는다. 절대 코드·로그·커밋에 넣지 않는다.
- 마스터 키 미설정 시 서버는 기동을 거부한다(빈 키로 열지 않는다).
- OAuth 토큰 저장 파일은 권한 `0600`.
- `max_tokens` 결정 순서: 요청 값 → 프로필 `params.max_tokens` → 최종 기본 `4096`.
- `finish_reason` 매핑: Anthropic `end_turn`/`stop_sequence`→`stop`, `max_tokens`→`length`, `tool_use`→`tool_calls`.
- 각 태스크 끝에서 `ruff check`와 `pytest`가 통과해야 커밋한다.

---

## 파일 구조

```
llm_router/
├── pyproject.toml                      # Task 1
├── .env.example                        # Task 1
├── profiles.example.yaml               # Task 4
├── src/llm_router/
│   ├── __init__.py                     # Task 1
│   ├── errors.py                       # Task 1  (OpenAI 에러 포맷 헬퍼/예외)
│   ├── models.py                       # Task 3  (OpenAI + Anthropic + Profile Pydantic 모델)
│   ├── config.py                       # Task 4  (.env + profiles.yaml 로드, ProfileRegistry)
│   ├── translate.py                    # Task 5,6,7 (OpenAI↔Anthropic 순수 변환 함수)
│   ├── credentials/
│   │   ├── __init__.py                 # Task 8
│   │   ├── base.py                     # Task 8  (Credential 프로토콜)
│   │   ├── env_key.py                  # Task 8
│   │   └── anthropic_oauth.py          # Task 8,11 (토큰 저장·refresh)
│   ├── adapters/
│   │   ├── __init__.py                 # Task 9
│   │   ├── base.py                     # Task 9  (Adapter 프로토콜)
│   │   ├── openai.py                   # Task 9  (패스스루)
│   │   └── anthropic.py                # Task 9  (translate + credential + httpx)
│   ├── oauth/
│   │   ├── __init__.py                 # Task 2
│   │   ├── constants.py                # Task 2  (스파이크가 채우는 발견값)
│   │   └── flow.py                     # Task 11 (PKCE 로그인)
│   ├── server.py                       # Task 10 (FastAPI 앱, 엔드포인트, 인증)
│   └── cli.py                          # Task 12 (typer)
├── tests/
│   ├── conftest.py                     # Task 1
│   ├── fixtures/                        # 태스크별 픽스처
│   └── test_*.py
└── docs/superpowers/
    ├── specs/2026-08-12-llm-router-design.md
    └── plans/2026-08-12-llm-router.md   # 이 문서
```

**태스크 의존성 요약:** Task 3–7(모델·설정·변환)은 스파이크(Task 2·2B)와 무관하게 진행 가능. Task 8·11(Anthropic 자격증명·OAuth 로그인)은 Task 2의 `oauth/constants.py`에 의존. Task 14(OpenAI OAuth)는 Task 2B의 `oauth/openai_constants.py`에 의존하며, Task 2B가 미지원으로 결론나면 스킵. 스파이크가 막히면(수동 로그인 필요) 3–7·9·10을 먼저 진행한다. 두 스파이크는 서로 독립.

**파일 구조 추가(OpenAI OAuth):** `src/llm_router/oauth/openai_constants.py`(Task 2B), `src/llm_router/oauth/openai_flow.py`·`src/llm_router/credentials/openai_oauth.py`(Task 14).

---

### Task 1: 프로젝트 스캐폴드 & 툴링

**Files:**
- Create: `pyproject.toml`, `.env.example`, `src/llm_router/__init__.py`, `src/llm_router/errors.py`, `tests/conftest.py`, `tests/test_smoke.py`

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `llm_router.__version__: str`
  - `errors.RouterError(message: str, *, type: str = "invalid_request_error", code: str | None = None, status_code: int = 400)` — 예외. 속성 `.message, .type, .code, .status_code`.
  - `errors.to_openai_error(exc: RouterError) -> dict` → `{"error": {"message", "type", "code"}}`

- [ ] **Step 1: pyproject.toml 작성**

```toml
[project]
name = "llm-router"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "httpx>=0.27",
    "pydantic>=2.8",
    "pydantic-settings>=2.4",
    "pyyaml>=6.0",
    "typer>=0.12",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "respx>=0.21", "ruff>=0.6"]

[project.scripts]
llm-router = "llm_router.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/llm_router"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
src = ["src"]
```

- [ ] **Step 2: 실패하는 스모크 테스트 작성**

`tests/test_smoke.py`:
```python
from llm_router import __version__
from llm_router.errors import RouterError, to_openai_error


def test_version_present():
    assert isinstance(__version__, str) and __version__


def test_error_serializes_to_openai_format():
    exc = RouterError("nope", type="invalid_request_error", code="bad", status_code=404)
    assert to_openai_error(exc) == {
        "error": {"message": "nope", "type": "invalid_request_error", "code": "bad"}
    }
    assert exc.status_code == 404
```

`tests/conftest.py`: (빈 파일 — 이후 태스크에서 픽스처 추가)
```python
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pip install -e ".[dev]" && pytest tests/test_smoke.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'llm_router'` 또는 import 에러.

- [ ] **Step 4: 최소 구현**

`src/llm_router/__init__.py`:
```python
__version__ = "0.1.0"
```

`src/llm_router/errors.py`:
```python
from __future__ import annotations


class RouterError(Exception):
    def __init__(
        self,
        message: str,
        *,
        type: str = "invalid_request_error",
        code: str | None = None,
        status_code: int = 400,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.type = type
        self.code = code
        self.status_code = status_code


def to_openai_error(exc: RouterError) -> dict:
    return {"error": {"message": exc.message, "type": exc.type, "code": exc.code}}
```

`.env.example`:
```
LLM_ROUTER_MASTER_KEY=sk-local-change-me
LLM_ROUTER_PORT=8787
LLM_ROUTER_HOST=127.0.0.1
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pytest tests/test_smoke.py -v && ruff check src tests`
Expected: PASS, lint 통과.

- [ ] **Step 6: 커밋**

```bash
git add pyproject.toml .env.example src/llm_router tests
git commit -m "chore: project scaffold + OpenAI error format"
```

---

### Task 2: 스파이크 — Claude 구독 OAuth 경로 발견

> **성격:** 이 태스크는 TDD가 아니라 조사(investigation)다. 목표는 Anthropic 구독 OAuth의 정확한 파라미터를 **발견해 코드로 고정**하고, 실제 구독 계정으로 1회 검증하는 것이다. 이것이 프로젝트의 유일한 미지수다. **여기서 값을 지어내지 말 것** — 반드시 실제로 확인한 값만 기록한다.

**Files:**
- Create: `src/llm_router/oauth/__init__.py`, `src/llm_router/oauth/constants.py`, `docs/superpowers/specs/oauth-findings.md`

**Interfaces:**
- Consumes: (없음)
- Produces (Task 8·11이 import):
  - `oauth.constants.AUTHORIZE_URL: str`
  - `oauth.constants.TOKEN_URL: str`
  - `oauth.constants.CLIENT_ID: str`
  - `oauth.constants.SCOPES: list[str]`
  - `oauth.constants.REDIRECT_URI: str`
  - `oauth.constants.ANTHROPIC_API_URL: str`  (예: `https://api.anthropic.com/v1/messages`)
  - `oauth.constants.OAUTH_BETA_HEADER: str | None`  (OAuth 토큰 사용 시 필요한 `anthropic-beta` 값. 없으면 `None`)
  - `oauth.constants.auth_headers(access_token: str) -> dict[str, str]`  — OAuth 토큰으로 Messages API를 호출할 때 붙일 헤더 전체(예: `authorization: Bearer ...`, `anthropic-version`, 필요 시 `anthropic-beta`). API key 경로와의 정확한 차이를 여기서 캡슐화.

- [ ] **Step 1: 조사 — OAuth 엔드포인트/클라이언트/헤더 확인**

다음을 확인해 `docs/superpowers/specs/oauth-findings.md`에 기록한다. 확인 방법(택1 이상): Anthropic 공식 OAuth 문서, Claude Code가 수행하는 로그인 플로우 관찰(로컬 콜백 포트, authorize/token URL, client_id, PKCE 사용 여부, scope), 토큰으로 Messages API 호출 시 `x-api-key` 대신 `Authorization: Bearer`를 쓰는지 및 추가로 요구되는 `anthropic-beta`/`anthropic-version` 헤더.

기록 항목:
1. authorize URL, token URL, client_id, redirect_uri(로컬 콜백), scope 목록, PKCE(S256) 사용 여부.
2. refresh 토큰 grant 방식(`grant_type=refresh_token` 파라미터·응답 필드 `access_token`/`refresh_token`/`expires_in`).
3. OAuth access token으로 `POST /v1/messages` 호출 시 필요한 정확한 헤더 세트.
4. 구독 권한으로 실제 가용한 모델 id 예시(예: `claude-sonnet-4-5`가 되는지).

- [ ] **Step 2: 발견값을 constants.py에 고정**

`src/llm_router/oauth/constants.py` — 실제 확인한 값으로 채운다. (아래는 **구조 템플릿**이며 값은 Step 1에서 확정한 실값으로 대체한다.)
```python
from __future__ import annotations

ANTHROPIC_VERSION = "2023-06-01"          # 확인값으로 대체
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

AUTHORIZE_URL = "..."                      # 확인값
TOKEN_URL = "..."                          # 확인값
CLIENT_ID = "..."                          # 확인값
REDIRECT_URI = "http://localhost:54545/callback"  # 확인값(포트 포함)
SCOPES: list[str] = [...]                  # 확인값
OAUTH_BETA_HEADER: str | None = None       # 확인값(없으면 None 유지)


def auth_headers(access_token: str) -> dict[str, str]:
    headers = {
        "authorization": f"Bearer {access_token}",
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    if OAUTH_BETA_HEADER:
        headers["anthropic-beta"] = OAUTH_BETA_HEADER
    return headers
```

`src/llm_router/oauth/__init__.py`: 빈 파일.

- [ ] **Step 3: 수동 검증 (자동화 불가 영역)**

실제 구독 계정으로 access token을 얻어(임시로 curl/스크립트 사용) `oauth.constants.auth_headers(token)`로 `ANTHROPIC_API_URL`에 최소 messages 요청을 보내 200과 정상 completion을 받는지 확인한다. 스트리밍(`"stream": true`)과 tools 포함 요청도 각 1회 확인해 findings에 결과를 적는다.

- [ ] **Step 4: 실패 시 후퇴 경로 기록**

토큰은 얻어도 Messages 호출이 거부되면(구독 토큰의 API 사용 불가), findings에 그 사실을 적고 **Task 8·11에서 OAuth 경로를 보류하고 Anthropic API key 경로를 1차 지원으로 승격**한다고 명시한다. 나머지 설계(어댑터/자격증명 분리)는 그대로 유효하다.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/oauth docs/superpowers/specs/oauth-findings.md
git commit -m "spike: discover and pin Anthropic subscription OAuth params"
```

---

### Task 2B: 스파이크 — OpenAI(ChatGPT) 구독 OAuth 발견 (리스크 높음)

> **성격:** 조사(investigation). Task 2와 독립적으로 진행 가능. **여기서 값을 지어내지 말 것.** 이 경로는 Anthropic보다 불확실하다 — 구독 OAuth가 여는 것이 일반 `chat/completions`가 아니라 Codex 전용 백엔드/Responses API일 수 있고, 그 경우 변환기가 필요하다. 스파이크의 임무는 **무엇이 실제로 가능한지**를 코드 투입 전에 확정하는 것이다.

**Files:**
- Create: `src/llm_router/oauth/openai_constants.py`, `docs/superpowers/specs/openai-oauth-findings.md`

**Interfaces:**
- Consumes: (없음)
- Produces (Task 8·11·14가 import):
  - `oauth.openai_constants.AUTHORIZE_URL: str`, `TOKEN_URL: str`, `CLIENT_ID: str`, `REDIRECT_URI: str`, `SCOPES: list[str]`
  - `oauth.openai_constants.API_URL: str` — 구독 토큰으로 호출 가능한 실제 엔드포인트(스파이크 확정)
  - `oauth.openai_constants.API_STYLE: Literal["chat_completions", "responses"]` — 그 엔드포인트가 어떤 스키마인지. Task 14가 이 값으로 패스스루/변환 분기.
  - `oauth.openai_constants.AVAILABLE_MODELS: list[str]` — 구독으로 실제 호출된 모델 id 목록(제한적일 수 있음)
  - `oauth.openai_constants.auth_headers(access_token: str) -> dict[str, str]`

- [ ] **Step 1: 조사 — Codex식 ChatGPT 구독 OAuth 확인**

다음을 확인해 `docs/superpowers/specs/openai-oauth-findings.md`에 기록. 확인 방법: OpenAI/Codex CLI의 "Sign in with ChatGPT" 로그인 플로우 관찰(로컬 콜백 포트, authorize/token URL, client_id, PKCE), 그리고 `~/.codex/`에 저장된 인증 토큰 구조 관찰(이 환경에 Codex 설정 존재). 기록 항목:
1. authorize URL, token URL, client_id, redirect_uri, scope, PKCE(S256) 여부, refresh grant 방식.
2. **획득한 access token으로 무엇을 호출할 수 있나** — 시도: (a) `https://api.openai.com/v1/chat/completions`, (b) `https://api.openai.com/v1/responses`, (c) Codex가 실제 쓰는 백엔드 URL. 각각의 성공/실패와 응답 스키마.
3. 성공한 엔드포인트의 스키마가 chat/completions인지 responses인지 → `API_STYLE` 결정.
4. 구독으로 실제 성공한 모델 id 목록.
5. 스트리밍·도구 호출 지원 여부.

- [ ] **Step 2: 발견값을 openai_constants.py에 고정**

`src/llm_router/oauth/openai_constants.py` — 실측값으로 채운다(아래는 구조 템플릿, 값은 Step 1 실값으로 대체):
```python
from __future__ import annotations

from typing import Literal

AUTHORIZE_URL = "..."          # 확인값
TOKEN_URL = "..."              # 확인값
CLIENT_ID = "..."              # 확인값
REDIRECT_URI = "http://localhost:1455/callback"   # 확인값(포트 포함)
SCOPES: list[str] = [...]      # 확인값

API_URL = "..."                # 구독 토큰으로 실제 성공한 엔드포인트
API_STYLE: Literal["chat_completions", "responses"] = "chat_completions"  # 실측 결정
AVAILABLE_MODELS: list[str] = [...]   # 실측 성공 모델


def auth_headers(access_token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {access_token}", "content-type": "application/json"}
```

- [ ] **Step 3: 수동 검증**

실제 구독 계정으로 토큰을 얻어 `API_URL`에 최소 요청을 보내 200과 정상 completion을 확인. 스트리밍·도구 호출도 각 1회 시도해 findings에 결과 기록.

- [ ] **Step 4: 실패/제약 시 결론 기록**

토큰으로 유효 호출이 전혀 불가하면 → findings에 "OpenAI 구독 OAuth 미지원, API key 경로로 대체"를 명기하고 **Task 14를 건너뛴다**. 부분 가능(제한 모델·Responses만)하면 그 제약을 `API_STYLE`/`AVAILABLE_MODELS`에 반영하고 Task 14를 그에 맞춰 구현.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/oauth/openai_constants.py docs/superpowers/specs/openai-oauth-findings.md
git commit -m "spike: discover OpenAI (ChatGPT) subscription OAuth surface"
```

---

### Task 3: Pydantic 모델 (OpenAI · Anthropic · Profile)

**Files:**
- Create: `src/llm_router/models.py`, `tests/test_models.py`

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `models.ChatMessage` — `role: str`, `content: str | list | None = None`, `name: str | None = None`, `tool_calls: list[ToolCall] | None = None`, `tool_call_id: str | None = None`
  - `models.ToolCall` — `id: str`, `type: str = "function"`, `function: FunctionCall`
  - `models.FunctionCall` — `name: str`, `arguments: str`  (arguments는 JSON 문자열)
  - `models.ToolDef` — `type: str = "function"`, `function: dict` (`{name, description?, parameters}`)
  - `models.ChatCompletionRequest` — `model: str`, `messages: list[ChatMessage]`, `temperature: float | None`, `top_p: float | None`, `max_tokens: int | None`, `stream: bool = False`, `tools: list[ToolDef] | None`, `tool_choice: str | dict | None`, `stop: str | list[str] | None`. `model_config = ConfigDict(extra="allow")` (미지 필드 통과).
  - `models.Profile` — `name: str`, `provider: Literal["anthropic","openai","openai_compatible"]`, `auth: Literal["oauth","api_key"]`, `model: str`, `api_key_env: str | None = None`, `base_url: str | None = None`, `params: dict = {}`, `aliases: list[str] = []`

- [ ] **Step 1: 실패 테스트**

`tests/test_models.py`:
```python
from llm_router.models import ChatCompletionRequest, Profile


def test_chat_request_parses_openai_shape():
    req = ChatCompletionRequest.model_validate({
        "model": "claude-sonnet",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 100,
        "stream": True,
    })
    assert req.model == "claude-sonnet"
    assert req.messages[0].role == "user"
    assert req.stream is True


def test_chat_request_parses_tool_calls():
    req = ChatCompletionRequest.model_validate({
        "model": "x",
        "messages": [
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_1", "type": "function",
                 "function": {"name": "get_weather", "arguments": "{\"city\":\"seoul\"}"}}
            ]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
        ],
    })
    assert req.messages[0].tool_calls[0].function.name == "get_weather"
    assert req.messages[1].tool_call_id == "call_1"


def test_profile_requires_base_url_for_compat():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Profile.model_validate({
            "name": "x", "provider": "openai_compatible",
            "auth": "api_key", "model": "m",  # base_url 누락
        })
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_models.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/models.py`:
```python
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator


class FunctionCall(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    type: str = "function"
    function: FunctionCall


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: str
    content: str | list | None = None
    name: str | None = None
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None


class ToolDef(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str = "function"
    function: dict


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    stream: bool = False
    tools: list[ToolDef] | None = None
    tool_choice: str | dict | None = None
    stop: str | list[str] | None = None


class Profile(BaseModel):
    name: str
    provider: Literal["anthropic", "openai", "openai_compatible"]
    auth: Literal["oauth", "api_key"]
    model: str
    api_key_env: str | None = None
    base_url: str | None = None
    params: dict = {}
    aliases: list[str] = []

    @model_validator(mode="after")
    def _check_provider_fields(self) -> "Profile":
        if self.provider == "openai_compatible" and not self.base_url:
            raise ValueError("openai_compatible requires base_url")
        if self.auth == "api_key" and not self.api_key_env:
            raise ValueError("auth=api_key requires api_key_env")
        if self.auth == "oauth" and self.provider not in ("anthropic", "openai"):
            raise ValueError("auth=oauth is only supported for provider in {anthropic, openai}")
        return self
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_models.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/models.py tests/test_models.py
git commit -m "feat: pydantic models for OpenAI request + profiles"
```

---

### Task 4: 설정 로더 + ProfileRegistry (라우팅 포함)

**Files:**
- Create: `src/llm_router/config.py`, `profiles.example.yaml`, `tests/test_config.py`

**Interfaces:**
- Consumes: `models.Profile`, `errors.RouterError`
- Produces:
  - `config.Settings` (pydantic-settings) — `master_key: str`, `host: str = "127.0.0.1"`, `port: int = 8787`. env prefix `LLM_ROUTER_`. `master_key` 없으면 로드 실패.
  - `config.load_profiles(path: str | Path) -> ProfileRegistry`
  - `config.ProfileRegistry` — `.resolve(model: str) -> Profile` (정확 name → alias 순, 미존재 시 `RouterError(status_code=404, type="invalid_request_error", code="model_not_found")` 메시지에 가용 name 목록 포함), `.names() -> list[str]` (프로필 name만, 정렬).

- [ ] **Step 1: 실패 테스트**

`tests/test_config.py`:
```python
import pytest

from llm_router.config import load_profiles
from llm_router.errors import RouterError

YAML = """
profiles:
  - name: claude-sonnet
    provider: anthropic
    auth: oauth
    model: claude-sonnet-4-5
    aliases: [sonnet]
  - name: gpt-4o
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: gpt-4o
"""


def _write(tmp_path, text):
    p = tmp_path / "profiles.yaml"
    p.write_text(text)
    return p


def test_resolve_by_name_and_alias(tmp_path):
    reg = load_profiles(_write(tmp_path, YAML))
    assert reg.resolve("claude-sonnet").model == "claude-sonnet-4-5"
    assert reg.resolve("sonnet").name == "claude-sonnet"
    assert reg.names() == ["claude-sonnet", "gpt-4o"]


def test_resolve_unknown_raises_404(tmp_path):
    reg = load_profiles(_write(tmp_path, YAML))
    with pytest.raises(RouterError) as ei:
        reg.resolve("does-not-exist")
    assert ei.value.status_code == 404
    assert "does-not-exist" in ei.value.message


def test_duplicate_name_rejected(tmp_path):
    dup = YAML + """
  - name: sonnet
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: x
"""
    with pytest.raises(RouterError):
        load_profiles(_write(tmp_path, dup))
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_config.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/config.py`:
```python
from __future__ import annotations

from pathlib import Path

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

from llm_router.errors import RouterError
from llm_router.models import Profile


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LLM_ROUTER_", env_file=".env", extra="ignore")
    master_key: str
    host: str = "127.0.0.1"
    port: int = 8787


class ProfileRegistry:
    def __init__(self, profiles: list[Profile]) -> None:
        self._by_name: dict[str, Profile] = {}
        self._alias: dict[str, Profile] = {}
        for p in profiles:
            if p.name in self._by_name or p.name in self._alias:
                raise RouterError(f"duplicate profile name/alias: {p.name}")
            self._by_name[p.name] = p
        for p in profiles:
            for a in p.aliases:
                if a in self._by_name or a in self._alias:
                    raise RouterError(f"duplicate profile name/alias: {a}")
                self._alias[a] = p

    def resolve(self, model: str) -> Profile:
        hit = self._by_name.get(model) or self._alias.get(model)
        if hit is None:
            raise RouterError(
                f"model '{model}' not found. Available: {', '.join(self.names())}",
                type="invalid_request_error",
                code="model_not_found",
                status_code=404,
            )
        return hit

    def names(self) -> list[str]:
        return sorted(self._by_name)


def load_profiles(path: str | Path) -> ProfileRegistry:
    raw = yaml.safe_load(Path(path).read_text()) or {}
    items = raw.get("profiles", [])
    if not items:
        raise RouterError("no profiles defined in profiles.yaml")
    try:
        profiles = [Profile.model_validate(i) for i in items]
    except Exception as e:  # pydantic ValidationError → 명확한 기동 실패
        raise RouterError(f"invalid profiles.yaml: {e}") from e
    return ProfileRegistry(profiles)
```

`profiles.example.yaml`:
```yaml
profiles:
  - name: claude-sonnet
    provider: anthropic
    auth: oauth
    model: claude-sonnet-4-5
    params: { max_tokens: 4096 }
    aliases: [sonnet, claude]
  - name: claude-key
    provider: anthropic
    auth: api_key
    api_key_env: ANTHROPIC_API_KEY
    model: claude-sonnet-4-5
  - name: gpt-4o
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: gpt-4o
  - name: local-llama
    provider: openai_compatible
    auth: api_key
    api_key_env: LOCAL_API_KEY
    base_url: http://localhost:11434/v1
    model: llama3.1
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_config.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/config.py profiles.example.yaml tests/test_config.py
git commit -m "feat: config loader + profile registry with routing"
```

---

### Task 5: 변환 — OpenAI 요청/응답 ↔ Anthropic (비스트리밍, 텍스트)

**Files:**
- Create: `src/llm_router/translate.py`, `tests/test_translate_basic.py`

**Interfaces:**
- Consumes: `models.ChatCompletionRequest`, `models.Profile`
- Produces:
  - `translate.to_anthropic_request(req: ChatCompletionRequest, profile: Profile) -> dict` — Anthropic Messages 요청 본문(system 분리, max_tokens 규칙, temperature/top_p/stop_sequences 매핑, stream 플래그 반영). tools/tool_calls는 Task 7에서 확장.
  - `translate.from_anthropic_response(data: dict, profile: Profile) -> dict` — OpenAI ChatCompletion 응답. tool_use는 Task 7에서 확장.
  - `translate.map_finish_reason(stop_reason: str | None) -> str | None`

- [ ] **Step 1: 실패 테스트**

`tests/test_translate_basic.py`:
```python
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.translate import (
    from_anthropic_response,
    map_finish_reason,
    to_anthropic_request,
)

PROFILE = Profile(name="claude-sonnet", provider="anthropic", auth="oauth",
                  model="claude-sonnet-4-5", params={"max_tokens": 4096})


def test_request_splits_system_and_maps_max_tokens():
    req = ChatCompletionRequest.model_validate({
        "model": "claude-sonnet",
        "messages": [
            {"role": "system", "content": "be terse"},
            {"role": "user", "content": "hi"},
        ],
    })
    body = to_anthropic_request(req, PROFILE)
    assert body["model"] == "claude-sonnet-4-5"
    assert body["system"] == "be terse"
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert body["max_tokens"] == 4096  # profile default


def test_request_max_tokens_request_wins():
    req = ChatCompletionRequest.model_validate({
        "model": "claude-sonnet", "max_tokens": 55,
        "messages": [{"role": "user", "content": "x"}],
    })
    assert to_anthropic_request(req, PROFILE)["max_tokens"] == 55


def test_finish_reason_mapping():
    assert map_finish_reason("end_turn") == "stop"
    assert map_finish_reason("max_tokens") == "length"
    assert map_finish_reason("tool_use") == "tool_calls"
    assert map_finish_reason("stop_sequence") == "stop"


def test_response_maps_text_and_usage():
    data = {
        "id": "msg_1", "model": "claude-sonnet-4-5", "stop_reason": "end_turn",
        "content": [{"type": "text", "text": "hello"}],
        "usage": {"input_tokens": 3, "output_tokens": 5},
    }
    out = from_anthropic_response(data, PROFILE)
    assert out["object"] == "chat.completion"
    assert out["model"] == "claude-sonnet"          # 프로필 name 노출
    assert out["choices"][0]["message"]["content"] == "hello"
    assert out["choices"][0]["finish_reason"] == "stop"
    assert out["usage"] == {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8}
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_translate_basic.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/translate.py`:
```python
from __future__ import annotations

import time
import uuid

from llm_router.models import ChatCompletionRequest, Profile

_FINISH = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool_calls",
}


def map_finish_reason(stop_reason: str | None) -> str | None:
    if stop_reason is None:
        return None
    return _FINISH.get(stop_reason, "stop")


def _resolve_max_tokens(req: ChatCompletionRequest, profile: Profile) -> int:
    if req.max_tokens is not None:
        return req.max_tokens
    if isinstance(profile.params, dict) and profile.params.get("max_tokens"):
        return int(profile.params["max_tokens"])
    return 4096


def _content_to_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    # OpenAI content parts: [{type:text, text:...}, ...]
    parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
    return "".join(parts)


def to_anthropic_request(req: ChatCompletionRequest, profile: Profile) -> dict:
    system_chunks: list[str] = []
    messages: list[dict] = []
    for m in req.messages:
        if m.role == "system":
            system_chunks.append(_content_to_text(m.content))
            continue
        messages.append({"role": m.role, "content": _content_to_text(m.content)})

    body: dict = {
        "model": profile.model,
        "messages": messages,
        "max_tokens": _resolve_max_tokens(req, profile),
    }
    if system_chunks:
        body["system"] = "\n".join(c for c in system_chunks if c)
    if req.temperature is not None:
        body["temperature"] = req.temperature
    if req.top_p is not None:
        body["top_p"] = req.top_p
    if req.stop is not None:
        body["stop_sequences"] = [req.stop] if isinstance(req.stop, str) else req.stop
    if req.stream:
        body["stream"] = True
    # 프로필 기본 파라미터 중 max_tokens 외 나머지 병합(요청이 우선)
    for k, v in (profile.params or {}).items():
        body.setdefault(k, v) if k != "max_tokens" else None
    return body


def from_anthropic_response(data: dict, profile: Profile) -> dict:
    text_parts: list[str] = []
    for block in data.get("content", []):
        if block.get("type") == "text":
            text_parts.append(block.get("text", ""))
    usage = data.get("usage", {}) or {}
    prompt = usage.get("input_tokens", 0)
    completion = usage.get("output_tokens", 0)
    return {
        "id": data.get("id", f"chatcmpl-{uuid.uuid4().hex}"),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": profile.name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "".join(text_parts)},
                "finish_reason": map_finish_reason(data.get("stop_reason")),
            }
        ],
        "usage": {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
        },
    }
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_translate_basic.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/translate.py tests/test_translate_basic.py
git commit -m "feat: OpenAI<->Anthropic translation for text (non-streaming)"
```

---

### Task 6: 변환 — 스트리밍 (Anthropic SSE → OpenAI chunk, 텍스트)

**Files:**
- Modify: `src/llm_router/translate.py`
- Create: `tests/test_translate_stream.py`

**Interfaces:**
- Consumes: Task 5의 translate 모듈
- Produces:
  - `translate.StreamTranslator(profile: Profile, completion_id: str | None = None)` — Anthropic SSE 이벤트를 순차 입력받아 OpenAI chunk dict 리스트를 방출:
    - `.start() -> dict` — 첫 role 델타 chunk.
    - `.feed(event_type: str, data: dict) -> list[dict]` — 이벤트당 0개 이상 chunk.
    - `.done() -> list[str]` — 종료 시 `["data: [DONE]\n\n"]` 형태가 아니라 순수 페이로드는 서버가 감쌈. 여기서는 마지막 finish chunk를 반환(아래 테스트 참조).
  - chunk 형식: `{"id","object":"chat.completion.chunk","created","model":profile.name,"choices":[{"index":0,"delta":{...},"finish_reason":...}]}`

- [ ] **Step 1: 실패 테스트**

`tests/test_translate_stream.py`:
```python
from llm_router.models import Profile
from llm_router.translate import StreamTranslator

PROFILE = Profile(name="claude-sonnet", provider="anthropic", auth="oauth",
                  model="claude-sonnet-4-5")


def test_stream_text_sequence():
    st = StreamTranslator(PROFILE, completion_id="chatcmpl-x")
    first = st.start()
    assert first["choices"][0]["delta"] == {"role": "assistant"}
    assert first["object"] == "chat.completion.chunk"

    st.feed("content_block_start", {"index": 0, "content_block": {"type": "text", "text": ""}})
    d1 = st.feed("content_block_delta",
                 {"index": 0, "delta": {"type": "text_delta", "text": "he"}})
    d2 = st.feed("content_block_delta",
                 {"index": 0, "delta": {"type": "text_delta", "text": "llo"}})
    assert d1[0]["choices"][0]["delta"] == {"content": "he"}
    assert d2[0]["choices"][0]["delta"] == {"content": "llo"}

    fin = st.feed("message_delta", {"delta": {"stop_reason": "end_turn"}})
    assert fin[0]["choices"][0]["finish_reason"] == "stop"
    assert fin[0]["choices"][0]["delta"] == {}
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_translate_stream.py -v`
Expected: FAIL — ImportError (`StreamTranslator`).

- [ ] **Step 3: 구현 — translate.py에 추가**

```python
class StreamTranslator:
    def __init__(self, profile: Profile, completion_id: str | None = None) -> None:
        self.profile = profile
        self.id = completion_id or f"chatcmpl-{uuid.uuid4().hex}"
        self.created = int(time.time())
        # tool_use 블록 index → OpenAI tool_calls index 매핑 (Task 7에서 사용)
        self._tool_index: dict[int, int] = {}
        self._next_tool_slot = 0

    def _chunk(self, delta: dict, finish_reason: str | None = None) -> dict:
        return {
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.profile.name,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }

    def start(self) -> dict:
        return self._chunk({"role": "assistant"})

    def feed(self, event_type: str, data: dict) -> list[dict]:
        if event_type == "content_block_delta":
            delta = data.get("delta", {})
            if delta.get("type") == "text_delta":
                return [self._chunk({"content": delta.get("text", "")})]
            # input_json_delta 등 tool 관련은 Task 7에서 처리
            return self._feed_tool_delta(data)
        if event_type == "content_block_start":
            return self._feed_tool_start(data)
        if event_type == "message_delta":
            stop = (data.get("delta") or {}).get("stop_reason")
            if stop is not None:
                return [self._chunk({}, finish_reason=map_finish_reason(stop))]
            return []
        return []

    # Task 7이 아래 두 메서드를 구현. Task 6 단계에서는 텍스트만 지원하도록 빈 결과.
    def _feed_tool_start(self, data: dict) -> list[dict]:
        return []

    def _feed_tool_delta(self, data: dict) -> list[dict]:
        return []
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_translate_stream.py tests/test_translate_basic.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/translate.py tests/test_translate_stream.py
git commit -m "feat: streaming translation (Anthropic SSE -> OpenAI chunks, text)"
```

---

### Task 7: 변환 — 도구 호출(tool calling) 확장

**Files:**
- Modify: `src/llm_router/translate.py`
- Create: `tests/test_translate_tools.py`

**Interfaces:**
- Consumes: Task 5·6의 translate 모듈
- Produces (기존 함수 확장, 시그니처 불변):
  - `to_anthropic_request`: `req.tools`→Anthropic `tools`(`{name, description, input_schema}`), `req.tool_choice`→`tool_choice`(`auto`→`{type:"auto"}`, `required`→`{type:"any"}`, `{type:function,function:{name}}`→`{type:"tool","name":...}`), assistant `tool_calls`→`tool_use` content 블록, `tool` 롤 메시지→`user` 롤 + `tool_result` 블록.
  - `from_anthropic_response`: `tool_use` 블록→`message.tool_calls`(arguments는 `json.dumps(input)`).
  - `StreamTranslator._feed_tool_start` / `_feed_tool_delta`: `tool_use` 시작→tool_calls 델타(id·function.name), `input_json_delta`→tool_calls 델타(function.arguments 부분 문자열).

- [ ] **Step 1: 실패 테스트**

`tests/test_translate_tools.py`:
```python
import json

from llm_router.models import ChatCompletionRequest, Profile
from llm_router.translate import (
    StreamTranslator,
    from_anthropic_response,
    to_anthropic_request,
)

PROFILE = Profile(name="c", provider="anthropic", auth="oauth", model="claude-sonnet-4-5")


def test_request_tools_and_tool_choice():
    req = ChatCompletionRequest.model_validate({
        "model": "c",
        "messages": [{"role": "user", "content": "weather?"}],
        "tools": [{"type": "function", "function": {
            "name": "get_weather", "description": "w",
            "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}],
        "tool_choice": "required",
    })
    body = to_anthropic_request(req, PROFILE)
    assert body["tools"][0]["name"] == "get_weather"
    assert body["tools"][0]["input_schema"]["type"] == "object"
    assert body["tool_choice"] == {"type": "any"}


def test_request_assistant_toolcall_and_tool_result_roundtrip():
    req = ChatCompletionRequest.model_validate({
        "model": "c",
        "messages": [
            {"role": "user", "content": "weather?"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_1", "type": "function",
                 "function": {"name": "get_weather", "arguments": "{\"city\":\"seoul\"}"}}]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
        ],
    })
    body = to_anthropic_request(req, PROFILE)
    asst = body["messages"][1]
    assert asst["role"] == "assistant"
    assert asst["content"][0]["type"] == "tool_use"
    assert asst["content"][0]["name"] == "get_weather"
    assert asst["content"][0]["input"] == {"city": "seoul"}
    tool_msg = body["messages"][2]
    assert tool_msg["role"] == "user"
    assert tool_msg["content"][0]["type"] == "tool_result"
    assert tool_msg["content"][0]["tool_use_id"] == "call_1"


def test_response_tool_use_maps_to_tool_calls():
    data = {
        "id": "msg", "model": "claude-sonnet-4-5", "stop_reason": "tool_use",
        "content": [{"type": "tool_use", "id": "toolu_1", "name": "get_weather",
                     "input": {"city": "seoul"}}],
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }
    out = from_anthropic_response(data, PROFILE)
    tc = out["choices"][0]["message"]["tool_calls"][0]
    assert tc["id"] == "toolu_1"
    assert tc["function"]["name"] == "get_weather"
    assert json.loads(tc["function"]["arguments"]) == {"city": "seoul"}
    assert out["choices"][0]["finish_reason"] == "tool_calls"


def test_stream_tool_call_deltas():
    st = StreamTranslator(PROFILE, completion_id="x")
    start = st.feed("content_block_start",
                    {"index": 0, "content_block": {"type": "tool_use", "id": "toolu_1",
                                                    "name": "get_weather"}})
    assert start[0]["choices"][0]["delta"]["tool_calls"][0]["id"] == "toolu_1"
    assert start[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["name"] == "get_weather"
    d = st.feed("content_block_delta",
                {"index": 0, "delta": {"type": "input_json_delta", "partial_json": "{\"city\""}})
    assert d[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["arguments"] == "{\"city\""
    assert d[0]["choices"][0]["delta"]["tool_calls"][0]["index"] == 0
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_translate_tools.py -v`
Expected: FAIL (tools 미처리로 assert 실패).

- [ ] **Step 3: 구현 — translate.py 수정**

`import json`을 파일 상단에 추가. `to_anthropic_request`의 메시지 루프와 본문 구성을 아래로 교체·확장:

```python
def _openai_tools_to_anthropic(tools) -> list[dict]:
    out = []
    for t in tools or []:
        fn = t.function if hasattr(t, "function") else t.get("function", {})
        out.append({
            "name": fn["name"],
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return out


def _map_tool_choice(choice):
    if choice in (None, "auto"):
        return {"type": "auto"} if choice == "auto" else None
    if choice == "required":
        return {"type": "any"}
    if choice == "none":
        return None
    if isinstance(choice, dict) and choice.get("type") == "function":
        return {"type": "tool", "name": choice["function"]["name"]}
    return None
```

`to_anthropic_request` 내부 메시지 루프를 tool 대응으로 교체:
```python
    for m in req.messages:
        if m.role == "system":
            system_chunks.append(_content_to_text(m.content))
        elif m.role == "assistant" and m.tool_calls:
            blocks = []
            text = _content_to_text(m.content)
            if text:
                blocks.append({"type": "text", "text": text})
            for tc in m.tool_calls:
                blocks.append({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.function.name,
                    "input": json.loads(tc.function.arguments or "{}"),
                })
            messages.append({"role": "assistant", "content": blocks})
        elif m.role == "tool":
            messages.append({"role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": m.tool_call_id,
                "content": _content_to_text(m.content),
            }]})
        else:
            messages.append({"role": m.role, "content": _content_to_text(m.content)})
```

`to_anthropic_request` 본문 구성 뒤에 tools 추가:
```python
    if req.tools:
        body["tools"] = _openai_tools_to_anthropic(req.tools)
        tc = _map_tool_choice(req.tool_choice)
        if tc is not None:
            body["tool_choice"] = tc
```

`from_anthropic_response`를 tool_use 대응으로 확장:
```python
    tool_calls = []
    for block in data.get("content", []):
        if block.get("type") == "text":
            text_parts.append(block.get("text", ""))
        elif block.get("type") == "tool_use":
            tool_calls.append({
                "id": block.get("id"),
                "type": "function",
                "function": {
                    "name": block.get("name"),
                    "arguments": json.dumps(block.get("input", {})),
                },
            })
    message = {"role": "assistant", "content": "".join(text_parts) or None}
    if tool_calls:
        message["tool_calls"] = tool_calls
```
(그리고 응답 dict의 `"message"` 값을 위 `message`로 사용.)

`StreamTranslator`의 tool 메서드 구현:
```python
    def _feed_tool_start(self, data: dict) -> list[dict]:
        block = data.get("content_block", {})
        if block.get("type") != "tool_use":
            return []
        a_index = data.get("index", 0)
        slot = self._next_tool_slot
        self._tool_index[a_index] = slot
        self._next_tool_slot += 1
        return [self._chunk({"tool_calls": [{
            "index": slot,
            "id": block.get("id"),
            "type": "function",
            "function": {"name": block.get("name"), "arguments": ""},
        }]})]

    def _feed_tool_delta(self, data: dict) -> list[dict]:
        delta = data.get("delta", {})
        if delta.get("type") != "input_json_delta":
            return []
        slot = self._tool_index.get(data.get("index", 0), 0)
        return [self._chunk({"tool_calls": [{
            "index": slot,
            "function": {"arguments": delta.get("partial_json", "")},
        }]})]
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/ -v && ruff check src tests`
Expected: PASS (기존 텍스트 테스트 포함 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/translate.py tests/test_translate_tools.py
git commit -m "feat: tool-calling translation (request, response, streaming)"
```

---

### Task 8: 자격증명 — EnvApiKey + AnthropicOAuth(저장·refresh)

**Files:**
- Create: `src/llm_router/credentials/__init__.py`, `base.py`, `env_key.py`, `anthropic_oauth.py`, `tests/test_credentials.py`
- Depends on: Task 2의 `oauth.constants` (TOKEN_URL, CLIENT_ID, auth_headers)

**Interfaces:**
- Consumes: `errors.RouterError`, `oauth.constants`
- Produces:
  - `credentials.base.Credential` (Protocol) — `async def headers(self) -> dict[str, str]`
  - `credentials.env_key.EnvApiKey(env_var: str, style: Literal["bearer","x-api-key"])` — env에서 키를 읽어 헤더 생성. 없으면 `RouterError(status_code=401, code="missing_credential")` (메시지에 어떤 env 변수인지 포함).
  - `credentials.anthropic_oauth.TokenStore(path: Path)` — `.load() -> dict | None`, `.save(tokens: dict) -> None`(파일 권한 0600), `.is_expired(tokens, skew=300) -> bool`.
  - `credentials.anthropic_oauth.AnthropicOAuth(store: TokenStore, client: httpx.AsyncClient)` — `async def headers(self)`; 만료 임박 시 refresh 후 저장. 토큰 없음/refresh 실패 시 `RouterError(status_code=401, code="oauth_required")` 메시지 `"Run: llm-router oauth login anthropic"`.
  - `credentials.build_credential(profile, client) -> Credential` — 프로필 auth/provider로 구현 선택.

- [ ] **Step 1: 실패 테스트**

`tests/test_credentials.py`:
```python
import json
import time

import httpx
import pytest
import respx

from llm_router.credentials.anthropic_oauth import AnthropicOAuth, TokenStore
from llm_router.credentials.env_key import EnvApiKey
from llm_router.errors import RouterError


async def test_env_key_bearer(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-abc")
    cred = EnvApiKey("OPENAI_API_KEY", style="bearer")
    assert (await cred.headers())["authorization"] == "Bearer sk-abc"


async def test_env_key_missing_raises_401(monkeypatch):
    monkeypatch.delenv("MISSING_KEY", raising=False)
    cred = EnvApiKey("MISSING_KEY", style="bearer")
    with pytest.raises(RouterError) as ei:
        await cred.headers()
    assert ei.value.status_code == 401
    assert "MISSING_KEY" in ei.value.message


def test_token_store_roundtrip_and_perms(tmp_path):
    p = tmp_path / "creds.json"
    store = TokenStore(p)
    store.save({"access_token": "a", "refresh_token": "r",
                "expires_at": time.time() + 1000})
    assert store.load()["access_token"] == "a"
    assert oct(p.stat().st_mode & 0o777) == "0o600"


def test_token_store_expiry(tmp_path):
    store = TokenStore(tmp_path / "c.json")
    assert store.is_expired({"expires_at": time.time() - 1})
    assert not store.is_expired({"expires_at": time.time() + 10_000})


@respx.mock
async def test_oauth_refreshes_when_expired(tmp_path):
    from llm_router.oauth import constants
    store = TokenStore(tmp_path / "c.json")
    store.save({"access_token": "old", "refresh_token": "r",
                "expires_at": time.time() - 1})
    route = respx.post(constants.TOKEN_URL).mock(return_value=httpx.Response(
        200, json={"access_token": "new", "refresh_token": "r2", "expires_in": 3600}))
    async with httpx.AsyncClient() as client:
        oauth = AnthropicOAuth(store, client)
        headers = await oauth.headers()
    assert route.called
    assert "new" in headers["authorization"]
    assert store.load()["access_token"] == "new"


async def test_oauth_no_tokens_raises(tmp_path):
    store = TokenStore(tmp_path / "none.json")
    async with httpx.AsyncClient() as client:
        oauth = AnthropicOAuth(store, client)
        with pytest.raises(RouterError) as ei:
            await oauth.headers()
    assert ei.value.code == "oauth_required"
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_credentials.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/credentials/__init__.py`:
```python
from __future__ import annotations

import httpx

from llm_router.credentials.anthropic_oauth import AnthropicOAuth, TokenStore
from llm_router.credentials.base import Credential
from llm_router.credentials.env_key import EnvApiKey
from llm_router.models import Profile

__all__ = ["Credential", "EnvApiKey", "AnthropicOAuth", "TokenStore", "build_credential"]


def build_credential(profile: Profile, client: httpx.AsyncClient) -> Credential:
    if profile.auth == "oauth":
        return AnthropicOAuth(TokenStore.default(), client)
    style = "x-api-key" if profile.provider == "anthropic" else "bearer"
    return EnvApiKey(profile.api_key_env, style=style)
```

`base.py`:
```python
from __future__ import annotations

from typing import Protocol


class Credential(Protocol):
    async def headers(self) -> dict[str, str]: ...
```

`env_key.py`:
```python
from __future__ import annotations

import os
from typing import Literal

from llm_router.errors import RouterError


class EnvApiKey:
    def __init__(self, env_var: str, style: Literal["bearer", "x-api-key"]) -> None:
        self.env_var = env_var
        self.style = style

    async def headers(self) -> dict[str, str]:
        key = os.environ.get(self.env_var)
        if not key:
            raise RouterError(
                f"missing credential: set {self.env_var} in .env",
                type="authentication_error", code="missing_credential", status_code=401,
            )
        if self.style == "bearer":
            return {"authorization": f"Bearer {key}"}
        return {"x-api-key": key, "anthropic-version": "2023-06-01"}
```

`anthropic_oauth.py`:
```python
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import httpx

from llm_router.errors import RouterError
from llm_router.oauth import constants


class TokenStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    @classmethod
    def default(cls) -> "TokenStore":
        return cls(Path.home() / ".llm-router" / "credentials.json")

    def load(self) -> dict | None:
        if not self.path.exists():
            return None
        return json.loads(self.path.read_text())

    def save(self, tokens: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(tokens))
        os.chmod(self.path, 0o600)

    def is_expired(self, tokens: dict, skew: int = 300) -> bool:
        return time.time() >= float(tokens.get("expires_at", 0)) - skew


class AnthropicOAuth:
    def __init__(self, store: TokenStore, client: httpx.AsyncClient) -> None:
        self.store = store
        self.client = client

    async def headers(self) -> dict[str, str]:
        tokens = self.store.load()
        if not tokens:
            raise RouterError(
                "not logged in. Run: llm-router oauth login anthropic",
                type="authentication_error", code="oauth_required", status_code=401,
            )
        if self.store.is_expired(tokens):
            tokens = await self._refresh(tokens)
        return constants.auth_headers(tokens["access_token"])

    async def _refresh(self, tokens: dict) -> dict:
        resp = await self.client.post(constants.TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": constants.CLIENT_ID,
        })
        if resp.status_code != 200:
            raise RouterError(
                "token refresh failed. Run: llm-router oauth login anthropic",
                type="authentication_error", code="oauth_required", status_code=401,
            )
        data = resp.json()
        new = {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", tokens["refresh_token"]),
            "expires_at": time.time() + int(data.get("expires_in", 3600)),
        }
        self.store.save(new)
        return new
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_credentials.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/credentials tests/test_credentials.py
git commit -m "feat: credentials (env api key + anthropic oauth store/refresh)"
```

---

### Task 9: 어댑터 — base · OpenAI(패스스루) · Anthropic(조립)

**Files:**
- Create: `src/llm_router/adapters/__init__.py`, `base.py`, `openai.py`, `anthropic.py`, `tests/test_adapters.py`

**Interfaces:**
- Consumes: `models`, `translate`, `credentials`, `oauth.constants`, `errors`
- Produces:
  - `adapters.base.Adapter` (Protocol) — `async def complete(self, req, profile) -> dict`(비스트리밍 OpenAI 응답), `async def stream(self, req, profile) -> AsyncIterator[str]`(SSE 라인들, 각 `"data: {json}\n\n"`, 마지막 `"data: [DONE]\n\n"`).
  - `adapters.openai.OpenAIAdapter(client, credential_factory)` — 요청을 그대로 업스트림(`profile.base_url` 또는 `https://api.openai.com/v1`)의 `/chat/completions`로 보냄. body의 `model`만 `profile.model`로 치환.
  - `adapters.anthropic.AnthropicAdapter(client, credential_factory)` — translate + credential.headers()로 `constants.ANTHROPIC_API_URL` 호출. 비스트리밍/스트리밍(SSE 파싱→StreamTranslator).
  - `adapters.build_adapter(profile, client) -> Adapter`

- [ ] **Step 1: 실패 테스트**

`tests/test_adapters.py`:
```python
import json

import httpx
import pytest
import respx

from llm_router.adapters import build_adapter
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.oauth import constants

ANTH = Profile(name="c", provider="anthropic", auth="api_key",
               api_key_env="ANTHROPIC_API_KEY", model="claude-sonnet-4-5")
OAI = Profile(name="g", provider="openai", auth="api_key",
              api_key_env="OPENAI_API_KEY", model="gpt-4o")


@respx.mock
async def test_anthropic_adapter_non_stream(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(return_value=httpx.Response(
        200, json={"id": "msg", "model": "claude-sonnet-4-5", "stop_reason": "end_turn",
                   "content": [{"type": "text", "text": "hi"}],
                   "usage": {"input_tokens": 1, "output_tokens": 1}}))
    req = ChatCompletionRequest.model_validate(
        {"model": "c", "messages": [{"role": "user", "content": "hi"}]})
    async with httpx.AsyncClient() as client:
        out = await build_adapter(ANTH, client).complete(req, ANTH)
    assert out["choices"][0]["message"]["content"] == "hi"
    assert out["model"] == "c"


@respx.mock
async def test_openai_adapter_passthrough_replaces_model(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oai")
    captured = {}

    def _handler(request):
        captured["body"] = json.loads(request.content)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"id": "x", "object": "chat.completion",
                                         "choices": [], "usage": {}})

    respx.post("https://api.openai.com/v1/chat/completions").mock(side_effect=_handler)
    req = ChatCompletionRequest.model_validate(
        {"model": "g", "messages": [{"role": "user", "content": "hi"}]})
    async with httpx.AsyncClient() as client:
        await build_adapter(OAI, client).complete(req, OAI)
    assert captured["body"]["model"] == "gpt-4o"   # 프로필 업스트림 id로 치환
    assert captured["auth"] == "Bearer sk-oai"


@respx.mock
async def test_anthropic_adapter_stream(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    sse = (
        "event: content_block_delta\n"
        'data: {"index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n'
        "event: message_delta\n"
        'data: {"delta":{"stop_reason":"end_turn"}}\n\n'
        "event: message_stop\ndata: {}\n\n"
    )
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(200, text=sse,
                                    headers={"content-type": "text/event-stream"}))
    req = ChatCompletionRequest.model_validate(
        {"model": "c", "stream": True, "messages": [{"role": "user", "content": "hi"}]})
    chunks = []
    async with httpx.AsyncClient() as client:
        async for line in build_adapter(ANTH, client).stream(req, ANTH):
            chunks.append(line)
    assert any('"content": "hi"' in c or '"content":"hi"' in c for c in chunks)
    assert chunks[-1] == "data: [DONE]\n\n"
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_adapters.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/adapters/base.py`:
```python
from __future__ import annotations

from typing import AsyncIterator, Protocol

from llm_router.models import ChatCompletionRequest, Profile


class Adapter(Protocol):
    async def complete(self, req: ChatCompletionRequest, profile: Profile) -> dict: ...
    def stream(self, req: ChatCompletionRequest, profile: Profile) -> AsyncIterator[str]: ...
```

`src/llm_router/adapters/__init__.py`:
```python
from __future__ import annotations

import httpx

from llm_router.adapters.anthropic import AnthropicAdapter
from llm_router.adapters.base import Adapter
from llm_router.adapters.openai import OpenAIAdapter
from llm_router.credentials import build_credential
from llm_router.models import Profile

__all__ = ["Adapter", "AnthropicAdapter", "OpenAIAdapter", "build_adapter"]


def build_adapter(profile: Profile, client: httpx.AsyncClient) -> Adapter:
    cred = build_credential(profile, client)
    if profile.provider == "anthropic":
        return AnthropicAdapter(client, cred)
    return OpenAIAdapter(client, cred)
```

`src/llm_router/adapters/openai.py`:
```python
from __future__ import annotations

import json
from typing import AsyncIterator

from llm_router.credentials.base import Credential
from llm_router.models import ChatCompletionRequest, Profile

DEFAULT_BASE = "https://api.openai.com/v1"


class OpenAIAdapter:
    def __init__(self, client, credential: Credential) -> None:
        self.client = client
        self.credential = credential

    def _url(self, profile: Profile) -> str:
        base = (profile.base_url or DEFAULT_BASE).rstrip("/")
        return f"{base}/chat/completions"

    def _body(self, req: ChatCompletionRequest, profile: Profile) -> dict:
        body = req.model_dump(exclude_none=True)
        body["model"] = profile.model
        return body

    async def complete(self, req: ChatCompletionRequest, profile: Profile) -> dict:
        headers = await self.credential.headers()
        body = self._body(req, profile)
        body["stream"] = False
        resp = await self.client.post(self._url(profile), json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        data["model"] = profile.name
        return data

    async def stream(self, req: ChatCompletionRequest, profile: Profile) -> AsyncIterator[str]:
        headers = await self.credential.headers()
        body = self._body(req, profile)
        body["stream"] = True
        async with self.client.stream("POST", self._url(profile), json=body,
                                      headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                # 업스트림 chunk의 model을 프로필 name으로 치환하며 그대로 전달
                if line.startswith("data: ") and line != "data: [DONE]":
                    try:
                        obj = json.loads(line[6:])
                        obj["model"] = profile.name
                        yield f"data: {json.dumps(obj)}\n\n"
                        continue
                    except json.JSONDecodeError:
                        pass
                yield f"{line}\n\n" if line != "data: [DONE]" else "data: [DONE]\n\n"
```

`src/llm_router/adapters/anthropic.py`:
```python
from __future__ import annotations

import json
from typing import AsyncIterator

from llm_router.credentials.base import Credential
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.oauth import constants
from llm_router.translate import (
    StreamTranslator,
    from_anthropic_response,
    to_anthropic_request,
)


class AnthropicAdapter:
    def __init__(self, client, credential: Credential) -> None:
        self.client = client
        self.credential = credential

    async def complete(self, req: ChatCompletionRequest, profile: Profile) -> dict:
        headers = await self.credential.headers()
        body = to_anthropic_request(req, profile)
        body["stream"] = False
        resp = await self.client.post(constants.ANTHROPIC_API_URL, json=body, headers=headers)
        resp.raise_for_status()
        return from_anthropic_response(resp.json(), profile)

    async def stream(self, req: ChatCompletionRequest, profile: Profile) -> AsyncIterator[str]:
        headers = await self.credential.headers()
        body = to_anthropic_request(req, profile)
        body["stream"] = True
        translator = StreamTranslator(profile)
        yield f"data: {json.dumps(translator.start())}\n\n"
        async with self.client.stream("POST", constants.ANTHROPIC_API_URL, json=body,
                                      headers=headers) as resp:
            resp.raise_for_status()
            event_type = None
            async for line in resp.aiter_lines():
                if line.startswith("event: "):
                    event_type = line[7:].strip()
                elif line.startswith("data: "):
                    data = json.loads(line[6:])
                    for chunk in translator.feed(event_type, data):
                        yield f"data: {json.dumps(chunk)}\n\n"
        yield "data: [DONE]\n\n"
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_adapters.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/adapters tests/test_adapters.py
git commit -m "feat: provider adapters (anthropic translate + openai passthrough)"
```

---

### Task 10: FastAPI 서버 — 엔드포인트 + 마스터 키 인증

**Files:**
- Create: `src/llm_router/server.py`, `tests/test_server.py`

**Interfaces:**
- Consumes: `config`, `adapters`, `models`, `errors`
- Produces:
  - `server.create_app(settings: Settings, registry: ProfileRegistry, client: httpx.AsyncClient | None = None) -> FastAPI`
  - 엔드포인트: `POST /v1/chat/completions`(stream 분기), `GET /v1/models`, `GET /health`(무인증).
  - 인증: `Authorization: Bearer <master_key>` 불일치 401. `RouterError`는 상태코드+OpenAI 에러 포맷으로 변환하는 예외 핸들러.

- [ ] **Step 1: 실패 테스트**

`tests/test_server.py`:
```python
import httpx
import respx
from fastapi.testclient import TestClient

from llm_router.config import ProfileRegistry, Settings
from llm_router.models import Profile
from llm_router.oauth import constants
from llm_router.server import create_app

SETTINGS = Settings(master_key="sk-local", host="127.0.0.1", port=8787)
REG = ProfileRegistry([Profile(name="c", provider="anthropic", auth="api_key",
                               api_key_env="ANTHROPIC_API_KEY", model="claude-sonnet-4-5")])


def _client():
    return TestClient(create_app(SETTINGS, REG))


def test_health_no_auth():
    assert _client().get("/health").status_code == 200


def test_models_lists_profile_names():
    r = _client().get("/v1/models", headers={"authorization": "Bearer sk-local"})
    assert r.status_code == 200
    assert r.json()["data"][0]["id"] == "c"


def test_missing_auth_401():
    r = _client().post("/v1/chat/completions", json={"model": "c", "messages": []})
    assert r.status_code == 401
    assert r.json()["error"]["type"]


def test_unknown_model_404():
    r = _client().post("/v1/chat/completions",
                       headers={"authorization": "Bearer sk-local"},
                       json={"model": "nope", "messages": [{"role": "user", "content": "x"}]})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "model_not_found"


@respx.mock
def test_chat_completion_end_to_end(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(return_value=httpx.Response(
        200, json={"id": "msg", "model": "claude-sonnet-4-5", "stop_reason": "end_turn",
                   "content": [{"type": "text", "text": "pong"}],
                   "usage": {"input_tokens": 1, "output_tokens": 1}}))
    r = _client().post("/v1/chat/completions",
                       headers={"authorization": "Bearer sk-local"},
                       json={"model": "c", "messages": [{"role": "user", "content": "ping"}]})
    assert r.status_code == 200
    assert r.json()["choices"][0]["message"]["content"] == "pong"
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_server.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/server.py`:
```python
from __future__ import annotations

import time

import httpx
from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse

from llm_router.adapters import build_adapter
from llm_router.config import ProfileRegistry, Settings
from llm_router.errors import RouterError, to_openai_error
from llm_router.models import ChatCompletionRequest


def create_app(settings: Settings, registry: ProfileRegistry,
               client: httpx.AsyncClient | None = None) -> FastAPI:
    app = FastAPI()
    app.state.client = client

    async def get_client() -> httpx.AsyncClient:
        if app.state.client is None:
            app.state.client = httpx.AsyncClient(timeout=httpx.Timeout(600.0))
        return app.state.client

    def require_auth(authorization: str | None = Header(default=None)) -> None:
        expected = f"Bearer {settings.master_key}"
        if authorization != expected:
            raise RouterError("invalid master key", type="authentication_error",
                              code="invalid_api_key", status_code=401)

    @app.exception_handler(RouterError)
    async def _router_error(_: Request, exc: RouterError):
        return JSONResponse(status_code=exc.status_code, content=to_openai_error(exc))

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/v1/models")
    async def models(_: None = Depends(require_auth)):
        now = int(time.time())
        return {"object": "list",
                "data": [{"id": n, "object": "model", "created": now, "owned_by": "llm-router"}
                         for n in registry.names()]}

    @app.post("/v1/chat/completions")
    async def chat(req: ChatCompletionRequest, _: None = Depends(require_auth)):
        profile = registry.resolve(req.model)
        client = await get_client()
        adapter = build_adapter(profile, client)
        if req.stream:
            async def gen():
                try:
                    async for line in adapter.stream(req, profile):
                        yield line
                except httpx.HTTPStatusError as e:
                    err = RouterError(f"upstream error: {e.response.text}",
                                      type="upstream_error", status_code=e.response.status_code)
                    import json as _json
                    yield f"data: {_json.dumps(to_openai_error(err))}\n\n"
                    yield "data: [DONE]\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")
        try:
            return await adapter.complete(req, profile)
        except httpx.HTTPStatusError as e:
            raise RouterError(f"upstream error: {e.response.text}", type="upstream_error",
                              status_code=e.response.status_code) from e

    return app
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_server.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/server.py tests/test_server.py
git commit -m "feat: FastAPI server with OpenAI-compatible endpoints + auth"
```

---

### Task 11: OAuth 로그인 플로우 (PKCE, CLI 구동)

**Files:**
- Create: `src/llm_router/oauth/flow.py`, `tests/test_oauth_flow.py`
- Depends on: Task 2의 `oauth.constants`, Task 8의 `TokenStore`

**Interfaces:**
- Consumes: `oauth.constants`, `credentials.anthropic_oauth.TokenStore`
- Produces:
  - `oauth.flow.build_authorize_url(state: str, verifier: str) -> str` — PKCE S256 challenge 포함 authorize URL.
  - `oauth.flow.make_pkce() -> tuple[str, str]` — `(verifier, challenge)`.
  - `oauth.flow.exchange_code(client: httpx.AsyncClient, code: str, verifier: str) -> dict` — 토큰 응답을 `{access_token, refresh_token, expires_at}`로 정규화.
  - `oauth.flow.login(store: TokenStore) -> None` — 로컬 콜백 서버를 띄우고 브라우저를 열어 코드 수신→교환→저장. (수동 브라우저 로그인은 사용자가 수행.)

- [ ] **Step 1: 실패 테스트**

`tests/test_oauth_flow.py`:
```python
import base64
import hashlib
import time
from urllib.parse import parse_qs, urlparse

import httpx
import respx

from llm_router.oauth import constants
from llm_router.oauth.flow import build_authorize_url, exchange_code, make_pkce


def test_pkce_challenge_is_s256_of_verifier():
    verifier, challenge = make_pkce()
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert challenge == expected


def test_authorize_url_has_pkce_and_client():
    _, challenge = make_pkce()
    url = build_authorize_url(state="st", verifier="v")  # verifier→challenge 내부 계산
    q = parse_qs(urlparse(url).query)
    assert q["client_id"] == [constants.CLIENT_ID]
    assert q["code_challenge_method"] == ["S256"]
    assert q["response_type"] == ["code"]


@respx.mock
async def test_exchange_code_normalizes_tokens():
    respx.post(constants.TOKEN_URL).mock(return_value=httpx.Response(
        200, json={"access_token": "a", "refresh_token": "r", "expires_in": 3600}))
    async with httpx.AsyncClient() as client:
        tokens = await exchange_code(client, code="c", verifier="v")
    assert tokens["access_token"] == "a"
    assert tokens["expires_at"] > time.time()
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_oauth_flow.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/oauth/flow.py`:
```python
from __future__ import annotations

import base64
import hashlib
import http.server
import secrets
import threading
import time
import urllib.parse
import webbrowser

import httpx

from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.oauth import constants


def make_pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _challenge_of(verifier: str) -> str:
    return base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def build_authorize_url(state: str, verifier: str) -> str:
    params = {
        "response_type": "code",
        "client_id": constants.CLIENT_ID,
        "redirect_uri": constants.REDIRECT_URI,
        "scope": " ".join(constants.SCOPES),
        "state": state,
        "code_challenge": _challenge_of(verifier),
        "code_challenge_method": "S256",
    }
    return f"{constants.AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


async def exchange_code(client: httpx.AsyncClient, code: str, verifier: str) -> dict:
    resp = await client.post(constants.TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": code,
        "client_id": constants.CLIENT_ID,
        "redirect_uri": constants.REDIRECT_URI,
        "code_verifier": verifier,
    })
    resp.raise_for_status()
    data = resp.json()
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "expires_at": time.time() + int(data.get("expires_in", 3600)),
    }


def login(store: TokenStore) -> None:
    verifier, _ = make_pkce()
    state = secrets.token_urlsafe(16)
    received: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            received["code"] = q.get("code", [None])[0]
            received["state"] = q.get("state", [None])[0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Login complete. You can close this tab.")

        def log_message(self, *a):  # 조용히
            pass

    port = int(urllib.parse.urlparse(constants.REDIRECT_URI).port or 54545)
    server = http.server.HTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()

    url = build_authorize_url(state=state, verifier=verifier)
    print(f"Opening browser for Anthropic login:\n{url}")
    webbrowser.open(url)

    # 콜백 대기
    while "code" not in received:
        time.sleep(0.2)
    if received.get("state") != state:
        raise RuntimeError("OAuth state mismatch")

    import asyncio

    async def _do():
        async with httpx.AsyncClient() as client:
            return await exchange_code(client, code=received["code"], verifier=verifier)

    tokens = asyncio.run(_do())
    store.save(tokens)
    print("Saved credentials.")
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_oauth_flow.py -v && ruff check src tests`
Expected: PASS. (`login()`은 대화형이라 단위 테스트에서 호출하지 않음 — Task 2 수동 검증에서 실제 확인.)

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/oauth/flow.py tests/test_oauth_flow.py
git commit -m "feat: Anthropic OAuth PKCE login flow"
```

---

### Task 12: CLI (typer) — serve · oauth login · profiles list

**Files:**
- Create: `src/llm_router/cli.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `config`, `server`, `oauth.flow`, `credentials.anthropic_oauth.TokenStore`
- Produces:
  - `cli.app` (typer.Typer). 커맨드: `serve --profiles PATH --host --port`, `oauth login PROVIDER`, `profiles list --profiles PATH`.
  - `serve`는 `Settings()` 로드(마스터 키 없으면 명확한 에러 후 종료 코드 1), `load_profiles`로 레지스트리 구성, uvicorn 기동.

- [ ] **Step 1: 실패 테스트**

`tests/test_cli.py`:
```python
from typer.testing import CliRunner

from llm_router.cli import app

runner = CliRunner()

YAML = """
profiles:
  - name: gpt-4o
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: gpt-4o
"""


def test_profiles_list(tmp_path):
    p = tmp_path / "profiles.yaml"
    p.write_text(YAML)
    result = runner.invoke(app, ["profiles", "list", "--profiles", str(p)])
    assert result.exit_code == 0
    assert "gpt-4o" in result.stdout


def test_serve_without_master_key_fails(tmp_path, monkeypatch):
    monkeypatch.delenv("LLM_ROUTER_MASTER_KEY", raising=False)
    p = tmp_path / "profiles.yaml"
    p.write_text(YAML)
    # env_file 무시하도록 빈 디렉터리에서 실행
    monkeypatch.chdir(tmp_path)
    result = runner.invoke(app, ["serve", "--profiles", str(p)])
    assert result.exit_code != 0
    assert "master" in result.stdout.lower() or "master" in str(result.exception).lower()
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_cli.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현**

`src/llm_router/cli.py`:
```python
from __future__ import annotations

import typer

from llm_router.config import Settings, load_profiles

app = typer.Typer(help="llm-router: local OpenAI-compatible LLM gateway")
oauth_app = typer.Typer(help="OAuth login")
profiles_app = typer.Typer(help="Profiles")
app.add_typer(oauth_app, name="oauth")
app.add_typer(profiles_app, name="profiles")


@app.command()
def serve(
    profiles: str = typer.Option("profiles.yaml", help="path to profiles.yaml"),
    host: str | None = typer.Option(None),
    port: int | None = typer.Option(None),
) -> None:
    try:
        settings = Settings()
    except Exception as e:  # master_key 누락 등
        typer.echo(f"config error (is LLM_ROUTER_MASTER_KEY set?): {e}")
        raise typer.Exit(code=1) from e
    registry = load_profiles(profiles)
    import uvicorn

    from llm_router.server import create_app

    app_ = create_app(settings, registry)
    uvicorn.run(app_, host=host or settings.host, port=port or settings.port)


@oauth_app.command("login")
def oauth_login(provider: str) -> None:
    if provider != "anthropic":
        typer.echo(f"unsupported provider: {provider}")
        raise typer.Exit(code=1)
    from llm_router.credentials.anthropic_oauth import TokenStore
    from llm_router.oauth.flow import login

    login(TokenStore.default())


@profiles_app.command("list")
def profiles_list(profiles: str = typer.Option("profiles.yaml")) -> None:
    registry = load_profiles(profiles)
    for name in registry.names():
        typer.echo(name)
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/ -v && ruff check src tests`
Expected: PASS (전체 스위트).

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/cli.py tests/test_cli.py
git commit -m "feat: typer CLI (serve, oauth login, profiles list)"
```

---

### Task 13: 계약 테스트 — OpenAI SDK로 로컬 서버 검증 + README

**Files:**
- Create: `tests/test_contract_openai_sdk.py`, `README.md`
- Modify: `pyproject.toml` (dev 의존성에 `openai>=1.40` 추가)

**Interfaces:**
- Consumes: `server.create_app`
- Produces: "표준 OpenAI SDK가 수정 없이 동작한다" 보장(도구 호출 포함).

- [ ] **Step 1: 실패 테스트**

`tests/test_contract_openai_sdk.py`:
```python
import httpx
import respx
from fastapi.testclient import TestClient
from openai import OpenAI

from llm_router.config import ProfileRegistry, Settings
from llm_router.models import Profile
from llm_router.oauth import constants
from llm_router.server import create_app

REG = ProfileRegistry([Profile(name="c", provider="anthropic", auth="api_key",
                               api_key_env="ANTHROPIC_API_KEY", model="claude-sonnet-4-5")])
SETTINGS = Settings(master_key="sk-local", host="127.0.0.1", port=8787)


@respx.mock
def test_openai_sdk_against_local_server(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(return_value=httpx.Response(
        200, json={"id": "msg", "model": "claude-sonnet-4-5", "stop_reason": "end_turn",
                   "content": [{"type": "text", "text": "pong"}],
                   "usage": {"input_tokens": 1, "output_tokens": 1}}))
    test_client = TestClient(create_app(SETTINGS, REG))
    sdk = OpenAI(api_key="sk-local", base_url="http://testserver/v1",
                 http_client=httpx.Client(transport=httpx.WSGITransport(app=test_client.app)))
    # 참고: WSGI/ASGI 브리지 대신 TestClient 세션을 쓰도록 transport 조정이 필요할 수 있음.
    resp = sdk.chat.completions.create(
        model="c", messages=[{"role": "user", "content": "ping"}])
    assert resp.choices[0].message.content == "pong"
```

> 구현 주의: OpenAI SDK를 FastAPI TestClient에 물리려면 httpx transport를 ASGI로 연결해야 한다. `httpx.ASGITransport(app=create_app(...))`로 `httpx.Client`를 만들어 `OpenAI(http_client=...)`에 주입한다. 위 테스트의 transport 라인을 `httpx.ASGITransport(app=create_app(SETTINGS, REG))` 기반으로 작성할 것.

- [ ] **Step 2: 실패 확인**

Run: `pip install -e ".[dev]" && pytest tests/test_contract_openai_sdk.py -v`
Expected: FAIL (초기 transport 미구성).

- [ ] **Step 3: transport 연결 수정 + README 작성**

테스트의 클라이언트 구성을 ASGI transport로 확정:
```python
    transport = httpx.ASGITransport(app=create_app(SETTINGS, REG))
    sdk = OpenAI(api_key="sk-local", base_url="http://router.local/v1",
                 http_client=httpx.Client(transport=transport))
```

`README.md` (최소):
```markdown
# llm-router

로컬 OpenAI 호환 LLM 게이트웨이. Claude 구독 OAuth와 API-key 제공자를 하나의 엔드포인트로 연다.

## 빠른 시작
1. `pip install -e ".[dev]"`
2. `.env` 작성 (`.env.example` 참고): `LLM_ROUTER_MASTER_KEY` 필수.
3. `profiles.yaml` 작성 (`profiles.example.yaml` 참고).
4. Claude 구독 사용 시: `llm-router oauth login anthropic`
5. `llm-router serve`

## OpenCrew 연결
`base_url=http://localhost:8787/v1`, `api_key=<LLM_ROUTER_MASTER_KEY>`, `model=<프로필 name>`.
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/ -v && ruff check src tests`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add tests/test_contract_openai_sdk.py README.md pyproject.toml
git commit -m "test: OpenAI SDK contract test + README"
```

---

### Task 14: OpenAI 구독 OAuth 경로 (Task 2B 스파이크 결과에 게이트됨)

> **선행 조건:** Task 2B 완료. 스파이크가 "OpenAI 구독 OAuth 미지원"으로 결론나면 **이 태스크 전체를 건너뛴다**(OpenAI는 API key 경로만). `openai_constants.API_STYLE` 값이 어댑터 분기를 결정한다.

**Files:**
- Create: `src/llm_router/credentials/openai_oauth.py`, `src/llm_router/oauth/openai_flow.py`, `tests/test_openai_oauth.py`
- Modify: `src/llm_router/credentials/__init__.py` (build_credential), `src/llm_router/adapters/openai.py` (oauth 분기), `src/llm_router/adapters/__init__.py` (엔드포인트 주입), `src/llm_router/cli.py` (oauth login openai)
- Depends on: Task 2B `oauth.openai_constants`, Task 8 `TokenStore`, Task 11 패턴

**Interfaces:**
- Consumes: `oauth.openai_constants`, `credentials.anthropic_oauth.TokenStore`(제네릭 재사용)
- Produces:
  - `credentials.openai_oauth.OpenAIOAuth(store, client)` — `AnthropicOAuth`와 동일 계약(`async def headers()`), `openai_constants` 사용, 저장 파일 `~/.llm-router/openai_credentials.json`.
  - `oauth.openai_flow.login(store)` — Anthropic `login`과 동일 패턴, `openai_constants` 사용.
  - `build_credential`이 `provider=="openai" and auth=="oauth"` → `OpenAIOAuth` 반환.
  - OpenAIAdapter가 oauth 프로필이면 업스트림 URL을 `openai_constants.API_URL`로, 헤더를 `OpenAIOAuth.headers()`로 사용. `API_STYLE=="responses"`면 14E 변환 경로.

- [ ] **Step 1: 실패 테스트 (credential + wiring)**

`tests/test_openai_oauth.py`:
```python
import time

import httpx
import pytest
import respx

from llm_router.credentials import build_credential
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.credentials.openai_oauth import OpenAIOAuth
from llm_router.errors import RouterError
from llm_router.models import Profile
from llm_router.oauth import openai_constants


async def test_openai_oauth_no_tokens_raises(tmp_path):
    store = TokenStore(tmp_path / "none.json")
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as ei:
            await OpenAIOAuth(store, client).headers()
    assert ei.value.code == "oauth_required"


@respx.mock
async def test_openai_oauth_refreshes(tmp_path):
    store = TokenStore(tmp_path / "c.json")
    store.save({"access_token": "old", "refresh_token": "r", "expires_at": time.time() - 1})
    respx.post(openai_constants.TOKEN_URL).mock(return_value=httpx.Response(
        200, json={"access_token": "new", "refresh_token": "r2", "expires_in": 3600}))
    async with httpx.AsyncClient() as client:
        headers = await OpenAIOAuth(store, client).headers()
    assert "new" in headers["authorization"]
    assert store.load()["access_token"] == "new"


def test_build_credential_routes_openai_oauth():
    p = Profile(name="gpt-oauth", provider="openai", auth="oauth", model="gpt-x")
    with httpx.Client() as _:
        pass
    import httpx as _httpx
    cred = build_credential(p, _httpx.AsyncClient())
    assert isinstance(cred, OpenAIOAuth)
```

- [ ] **Step 2: 실패 확인**

Run: `pytest tests/test_openai_oauth.py -v`
Expected: FAIL — ImportError.

- [ ] **Step 3: 구현 — OpenAIOAuth + login + wiring**

`src/llm_router/credentials/openai_oauth.py` (AnthropicOAuth와 동일 구조, constants만 교체):
```python
from __future__ import annotations

import time

import httpx

from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.errors import RouterError
from llm_router.oauth import openai_constants


class OpenAIOAuth:
    def __init__(self, store: TokenStore, client: httpx.AsyncClient) -> None:
        self.store = store
        self.client = client

    @staticmethod
    def default_store() -> TokenStore:
        from pathlib import Path
        return TokenStore(Path.home() / ".llm-router" / "openai_credentials.json")

    async def headers(self) -> dict[str, str]:
        tokens = self.store.load()
        if not tokens:
            raise RouterError("not logged in. Run: llm-router oauth login openai",
                              type="authentication_error", code="oauth_required", status_code=401)
        if self.store.is_expired(tokens):
            tokens = await self._refresh(tokens)
        return openai_constants.auth_headers(tokens["access_token"])

    async def _refresh(self, tokens: dict) -> dict:
        resp = await self.client.post(openai_constants.TOKEN_URL, data={
            "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
            "client_id": openai_constants.CLIENT_ID})
        if resp.status_code != 200:
            raise RouterError("token refresh failed. Run: llm-router oauth login openai",
                              type="authentication_error", code="oauth_required", status_code=401)
        data = resp.json()
        new = {"access_token": data["access_token"],
               "refresh_token": data.get("refresh_token", tokens["refresh_token"]),
               "expires_at": time.time() + int(data.get("expires_in", 3600))}
        self.store.save(new)
        return new
```

`src/llm_router/oauth/openai_flow.py`: Task 11 `flow.py`와 동일하되 `from llm_router.oauth import openai_constants as constants`로 교체하고 저장은 `OpenAIOAuth.default_store()` 사용. (PKCE·콜백·exchange 로직 동일.)

`build_credential` 수정 (`credentials/__init__.py`):
```python
def build_credential(profile: Profile, client: httpx.AsyncClient) -> Credential:
    if profile.auth == "oauth":
        if profile.provider == "openai":
            from llm_router.credentials.openai_oauth import OpenAIOAuth
            return OpenAIOAuth(OpenAIOAuth.default_store(), client)
        return AnthropicOAuth(TokenStore.default(), client)
    style = "x-api-key" if profile.provider == "anthropic" else "bearer"
    return EnvApiKey(profile.api_key_env, style=style)
```

`cli.py` `oauth_login` 수정:
```python
@oauth_app.command("login")
def oauth_login(provider: str) -> None:
    from llm_router.credentials.anthropic_oauth import TokenStore
    if provider == "anthropic":
        from llm_router.oauth.flow import login
        login(TokenStore.default())
    elif provider == "openai":
        from llm_router.credentials.openai_oauth import OpenAIOAuth
        from llm_router.oauth.openai_flow import login
        login(OpenAIOAuth.default_store())
    else:
        typer.echo(f"unsupported provider: {provider}")
        raise typer.Exit(code=1)
```

- [ ] **Step 4: 통과 확인**

Run: `pytest tests/test_openai_oauth.py -v && ruff check src tests`
Expected: PASS.

- [ ] **Step 5: OpenAIAdapter oauth 분기 (API_STYLE=="chat_completions" 경로)**

`adapters/openai.py`의 `_url`이 oauth 프로필일 때 `openai_constants.API_URL`을 쓰도록 하고, `adapters/__init__.py`의 `build_adapter`가 oauth면 그 사실을 어댑터에 전달. 스파이크가 `API_STYLE=="chat_completions"`로 나온 경우, 기존 패스스루 로직에 URL·헤더만 openai_constants로 교체하면 된다. 테스트: respx로 `openai_constants.API_URL` 목킹해 oauth 프로필 completion이 통과하는지 확인(Task 9 패턴 재사용).

- [ ] **Step 6: (조건부 14E) API_STYLE=="responses"이면 chat↔Responses 변환기 추가**

스파이크가 Responses API만 열린다고 결론낸 경우에만 수행. `src/llm_router/translate_responses.py`에 `to_responses_request(openai_req, profile) -> dict`, `from_responses_response(data, profile) -> dict`, 스트리밍 변환을 추가한다. 필드 매핑은 **Task 2B findings에 기록된 실제 Responses 스키마**를 근거로 작성한다(입력 items, output items, function_call/tool 처리, 스트리밍 이벤트 타입). 각 매핑에 Task 5~7과 동형의 픽스처 단위 테스트를 붙인다. OpenAIAdapter는 `API_STYLE`로 이 경로와 패스스루를 분기.

- [ ] **Step 7: 커밋**

```bash
git add src/llm_router/credentials/openai_oauth.py src/llm_router/oauth/openai_flow.py \
        src/llm_router/credentials/__init__.py src/llm_router/adapters tests/test_openai_oauth.py src/llm_router/cli.py
git commit -m "feat: OpenAI subscription OAuth path (credential, flow, wiring)"
```

---

## Self-Review (계획 작성자 체크)

**1. 스펙 커버리지:**
- OpenAI 호환 표면(chat/completions·models·health) → Task 10 ✓
- 마스터 키 인증 → Task 10 ✓
- model→프로필 라우팅 + 별칭 → Task 4 ✓
- `.env` + profiles.yaml → Task 1·4 ✓
- AnthropicAdapter(oauth/api_key) + 포맷 변환 → Task 5·6·7·9 ✓
- OpenAIAdapter(openai/openai_compatible) 패스스루 → Task 9 ✓
- 도구 호출 번역(요청/응답/스트리밍) → Task 7 ✓
- AnthropicOAuth 저장·refresh → Task 8 ✓
- OAuth 로그인(PKCE) → Task 11 ✓
- CLI(serve/oauth login/profiles list) → Task 12 ✓
- Claude OAuth 스파이크 최우선 + 실패 후퇴 → Task 2 ✓
- **OpenAI 구독 OAuth 스파이크 + 후퇴 → Task 2B ✓**
- **OpenAI OAuth 경로(credential/flow/wiring, Responses 조건부) → Task 14 ✓**
- **auth=oauth를 provider∈{anthropic,openai} 허용 → Task 3 검증기 ✓**
- **CLI oauth login openai → Task 14(Task 12 수정) ✓**
- **소비자 계약(agent factory SDK 등 OpenAI 호환) + /v1/models 모델목록 → Task 10 + 13 ✓**
- OpenAI 에러 포맷 통일 → Task 1·10 ✓
- 스트리밍 중 에러 → Task 10 gen() ✓
- 테스트(단위/통합/계약) → 각 태스크 + Task 13 ✓
- MVP 제외 항목(프로필별 키, litellm, embeddings, CLI 자격증명 임포트 등) → 계획에 포함 안 함 ✓

**2. 플레이스홀더 스캔:** Task 2·2B의 `constants.py`/`openai_constants.py`는 스파이크가 실측값으로 채우는 것으로 명시(값 날조 아님, 구조 템플릿). Task 14의 14E(Responses 변환)는 Task 2B findings의 실제 스키마에 근거해 작성하도록 게이트됨(스파이크 전 코드 날조 금지). 그 외 TBD/TODO 없음. ✓

**3. 타입 일관성:** `to_anthropic_request`/`from_anthropic_response`/`StreamTranslator`/`build_adapter`/`build_credential`/`create_app`/`ProfileRegistry.resolve` 이름이 소비 태스크와 일치. `oauth.constants`(Anthropic)와 `oauth.openai_constants`(OpenAI)가 각각 `TOKEN_URL/CLIENT_ID/REDIRECT_URI/SCOPES/AUTHORIZE_URL/auth_headers`를 노출하고 Task 8·11·14에서 동형 참조. `OpenAIOAuth`가 `AnthropicOAuth`와 동일 `headers()` 계약. `TokenStore`는 경로 인자로 두 제공자 공유. ✓

**알려진 리스크(구현 시 유의):**
- Task 2·2B 스파이크 결과에 따라 OAuth 세부(refresh 파라미터, 헤더, 엔드포인트)가 조정될 수 있음. 실측 우선.
- **Task 2B가 OpenAI 구독 OAuth 미지원으로 결론나면 Task 14 전체 스킵**, OpenAI는 API key 경로만. `API_STYLE=="responses"`면 14E 변환기 필수.
- Task 13 계약 테스트의 ASGI transport 연결은 openai SDK 버전에 따라 미세 조정 필요.

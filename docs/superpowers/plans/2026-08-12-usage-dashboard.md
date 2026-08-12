# 사용량 대시보드 Implementation Plan

> **For Codex:** 태스크 단위 TDD(실패 테스트 → 최소 구현 → 통과 → 커밋). 체크박스로 진행을 추적한다.
>
> **선행:** `2026-08-12-fix-streaming-upstream-error.md`를 **먼저 적용한다.** Task 4가 같은 함수(`server.py`의 스트리밍 제너레이터)를 건드리므로 순서를 지켜야 충돌이 없다.

**Goal:** 라우터가 중계한 모든 호출의 토큰 사용량·이력을 SQLite에 기록하고, `/dashboard`에서 웹으로 본다.

**Architecture:** `usage/` 모듈 3조각(저장소·레코더·라우트) + 단일 HTML. 기존 어댑터·변환기의 **출력 계약은 불변**이고, 관측값을 밖으로 내보내는 통로만 추가한다.

**Tech Stack:** 기존 스택 + `sqlite3`(표준 라이브러리). **새 의존성 없음.**

**설계 스펙:** `docs/superpowers/specs/2026-08-12-usage-dashboard-design.md`

## Global Constraints

- **로깅 실패가 추론 요청을 절대 깨뜨리지 않는다.** 모든 저장 호출은 예외를 삼킨다.
- 클라이언트가 보는 응답 본문과 SSE 청크는 이 작업으로 **변하지 않는다.**
- 새 런타임 의존성 추가 금지(`sqlite3`는 표준 라이브러리).
- 집계 API 3종은 기존 `require_auth`와 동일한 마스터 키 의존성을 쓴다.
- 대시보드 HTML은 외부 요청 0(인라인 CSS/JS, CDN·폰트·이미지 금지).
- DB 파일과 부모 디렉터리는 자격증명과 같은 위치 정책(`~/.llm-router/`, 디렉터리 0700).
- 각 태스크 끝에서 `python3 -m pytest`와 `ruff check src tests`가 통과해야 커밋한다.

---

## 파일 구조

```
src/llm_router/usage/
├── __init__.py          # Task 1
├── store.py             # Task 1  CallRecord, UsageStore
├── recorder.py          # Task 3  UsageRecorder
├── routes.py            # Task 5  build_usage_router()
└── dashboard.html       # Task 6
tests/
├── test_usage_store.py      # Task 1
├── test_usage_capture.py    # Task 2
├── test_usage_recorder.py   # Task 3
└── test_usage_api.py        # Task 5,6
(수정) src/llm_router/translate.py, adapters/{anthropic,openai,base}.py,
       config.py, server.py, cli.py
```

---

### Task 1: UsageStore (SQLite 저장소)

**Files:**
- Create: `src/llm_router/usage/__init__.py`, `src/llm_router/usage/store.py`, `tests/test_usage_store.py`

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `usage.store.CallRecord` — 데이터클래스. 필드: `started_at: float`, `profile: str`, `provider: str`, `upstream_model: str`, `stream: bool`, `duration_ms: int|None`, `status: int|None`, `ok: bool`, `error_code: str|None`, `error_message: str|None`, `prompt_tokens: int|None`, `completion_tokens: int|None`, `total_tokens: int|None`, `request_body: str|None`, `response_body: str|None`
  - `usage.store.UsageStore(path)` — `async record(CallRecord) -> None`, `async summary(days: int) -> list[dict]`, `async calls(limit: int, offset: int, profile: str|None) -> list[dict]`, `async call(call_id: int) -> dict|None`, `close() -> None`

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_usage_store.py`

```python
import time

from llm_router.usage.store import CallRecord, UsageStore


def _record(**overrides) -> CallRecord:
    base = {
        "started_at": time.time(),
        "profile": "c",
        "provider": "anthropic",
        "upstream_model": "claude-sonnet-4-5",
        "stream": False,
        "duration_ms": 12,
        "status": 200,
        "ok": True,
        "prompt_tokens": 10,
        "completion_tokens": 5,
        "total_tokens": 15,
    }
    base.update(overrides)
    return CallRecord(**base)


async def test_record_and_read_back(tmp_path):
    store = UsageStore(tmp_path / "usage.db")
    try:
        await store.record(_record())
        rows = await store.calls(limit=10, offset=0, profile=None)
        assert len(rows) == 1
        assert rows[0]["profile"] == "c"
        assert rows[0]["total_tokens"] == 15
        assert rows[0]["ok"] == 1
    finally:
        store.close()


async def test_summary_aggregates_tokens_and_errors(tmp_path):
    store = UsageStore(tmp_path / "usage.db")
    try:
        await store.record(_record())
        await store.record(_record(prompt_tokens=1, completion_tokens=2, total_tokens=3))
        await store.record(
            _record(ok=False, status=429, error_code="upstream_error",
                    prompt_tokens=None, completion_tokens=None, total_tokens=None)
        )
        summary = await store.summary(days=7)
        assert len(summary) == 1
        row = summary[0]
        assert row["profile"] == "c"
        assert row["calls"] == 3
        assert row["total_tokens"] == 18
        assert row["errors"] == 1
    finally:
        store.close()


async def test_calls_filter_and_detail_includes_bodies(tmp_path):
    store = UsageStore(tmp_path / "usage.db")
    try:
        await store.record(_record(request_body='{"a":1}', response_body='{"b":2}'))
        await store.record(_record(profile="other"))
        filtered = await store.calls(limit=10, offset=0, profile="other")
        assert [row["profile"] for row in filtered] == ["other"]

        listed = await store.calls(limit=10, offset=0, profile="c")
        detail = await store.call(listed[0]["id"])
        assert detail["request_body"] == '{"a":1}'
        assert detail["response_body"] == '{"b":2}'
        assert "request_body" not in listed[0]
    finally:
        store.close()


async def test_missing_call_returns_none(tmp_path):
    store = UsageStore(tmp_path / "usage.db")
    try:
        assert await store.call(9999) is None
    finally:
        store.close()


def test_creates_parent_directory(tmp_path):
    store = UsageStore(tmp_path / "nested" / "dir" / "usage.db")
    try:
        assert (tmp_path / "nested" / "dir").is_dir()
    finally:
        store.close()
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_usage_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'llm_router.usage'`

- [ ] **Step 3: 구현**

`src/llm_router/usage/__init__.py`:
```python
from __future__ import annotations

from llm_router.usage.store import CallRecord, UsageStore

__all__ = ["CallRecord", "UsageStore"]
```

`src/llm_router/usage/store.py`:
```python
from __future__ import annotations

import asyncio
import sqlite3
import time
from dataclasses import asdict, dataclass
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL,
    duration_ms INTEGER,
    profile TEXT NOT NULL,
    provider TEXT NOT NULL,
    upstream_model TEXT NOT NULL,
    stream INTEGER NOT NULL,
    status INTEGER,
    ok INTEGER NOT NULL,
    error_code TEXT,
    error_message TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    request_body TEXT,
    response_body TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_profile ON calls(profile);
"""

_LIST_COLUMNS = (
    "id, started_at, duration_ms, profile, provider, upstream_model, stream, "
    "status, ok, error_code, error_message, prompt_tokens, completion_tokens, total_tokens"
)


@dataclass
class CallRecord:
    started_at: float
    profile: str
    provider: str
    upstream_model: str
    stream: bool
    duration_ms: int | None = None
    status: int | None = None
    ok: bool = False
    error_code: str | None = None
    error_message: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    request_body: str | None = None
    response_body: str | None = None


class UsageStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.executescript(_SCHEMA)
        self._connection.commit()
        self._lock = asyncio.Lock()

    def close(self) -> None:
        self._connection.close()

    async def record(self, record: CallRecord) -> None:
        payload = asdict(record)
        payload["stream"] = int(record.stream)
        payload["ok"] = int(record.ok)
        columns = ", ".join(payload)
        placeholders = ", ".join(f":{name}" for name in payload)
        async with self._lock:
            self._connection.execute(
                f"INSERT INTO calls ({columns}) VALUES ({placeholders})", payload
            )
            self._connection.commit()

    async def summary(self, days: int) -> list[dict]:
        since = time.time() - days * 86400
        async with self._lock:
            rows = self._connection.execute(
                """
                SELECT date(started_at, 'unixepoch', 'localtime') AS day,
                       profile,
                       COUNT(*) AS calls,
                       SUM(COALESCE(prompt_tokens, 0)) AS prompt_tokens,
                       SUM(COALESCE(completion_tokens, 0)) AS completion_tokens,
                       SUM(COALESCE(total_tokens, 0)) AS total_tokens,
                       SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors
                FROM calls
                WHERE started_at >= ?
                GROUP BY day, profile
                ORDER BY day DESC, profile ASC
                """,
                (since,),
            ).fetchall()
        return [dict(row) for row in rows]

    async def calls(self, limit: int, offset: int, profile: str | None) -> list[dict]:
        async with self._lock:
            rows = self._connection.execute(
                f"""
                SELECT {_LIST_COLUMNS}
                FROM calls
                WHERE (:profile IS NULL OR profile = :profile)
                ORDER BY started_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """,
                {"profile": profile, "limit": limit, "offset": offset},
            ).fetchall()
        return [dict(row) for row in rows]

    async def call(self, call_id: int) -> dict | None:
        async with self._lock:
            row = self._connection.execute(
                "SELECT * FROM calls WHERE id = ?", (call_id,)
            ).fetchone()
        return dict(row) if row is not None else None
```

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest tests/test_usage_store.py -v && ruff check src tests`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/usage tests/test_usage_store.py
git commit -m "feat: SQLite usage store for call records"
```

---

### Task 2: 토큰 관측 — StreamTranslator usage 누적 + 어댑터 노출

**Files:**
- Modify: `src/llm_router/translate.py`, `src/llm_router/adapters/base.py`, `src/llm_router/adapters/anthropic.py`, `src/llm_router/adapters/openai.py`
- Create: `tests/test_usage_capture.py`

**Interfaces:**
- Consumes: 기존 `StreamTranslator`, 어댑터들
- Produces:
  - `translate.StreamTranslator.usage -> dict|None` — `{"prompt_tokens", "completion_tokens", "total_tokens"}` 또는 아무것도 관측 못 했으면 `None`
  - `adapters.base.Adapter.observed_usage: dict|None` — 프로토콜에 추가
  - `AnthropicAdapter.observed_usage`, `OpenAIAdapter.observed_usage` — 요청 종료 후 채워짐

- [ ] **Step 1: 실패 테스트** — `tests/test_usage_capture.py`

```python
import httpx
import respx

from llm_router.adapters import build_adapter
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.oauth import constants
from llm_router.translate import StreamTranslator

PROFILE = Profile(
    name="c", provider="anthropic", auth="api_key",
    api_key_env="ANTHROPIC_API_KEY", model="claude-sonnet-4-5",
)
OAI = Profile(
    name="g", provider="openai", auth="api_key",
    api_key_env="OPENAI_API_KEY", model="gpt-4o",
)


def test_translator_starts_with_no_usage():
    assert StreamTranslator(PROFILE).usage is None


def test_translator_accumulates_usage_without_emitting_chunks():
    translator = StreamTranslator(PROFILE)
    emitted = translator.feed(
        "message_start",
        {"message": {"usage": {"input_tokens": 11, "output_tokens": 0}}},
    )
    assert emitted == []
    translator.feed(
        "message_delta",
        {"delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 7}},
    )
    assert translator.usage == {
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "total_tokens": 18,
    }


@respx.mock
async def test_anthropic_adapter_exposes_usage_non_stream(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg", "model": "claude-sonnet-4-5", "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "hi"}],
                "usage": {"input_tokens": 3, "output_tokens": 4},
            },
        )
    )
    request = ChatCompletionRequest.model_validate(
        {"model": "c", "messages": [{"role": "user", "content": "hi"}]}
    )
    async with httpx.AsyncClient() as client:
        adapter = build_adapter(PROFILE, client)
        assert adapter.observed_usage is None
        await adapter.complete(request, PROFILE)
    assert adapter.observed_usage["total_tokens"] == 7


@respx.mock
async def test_anthropic_adapter_exposes_usage_from_stream(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    sse = (
        "event: message_start\n"
        'data: {"message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n'
        "event: content_block_delta\n"
        'data: {"index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n'
        "event: message_delta\n"
        'data: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n'
    )
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(
            200, text=sse, headers={"content-type": "text/event-stream"}
        )
    )
    request = ChatCompletionRequest.model_validate(
        {"model": "c", "stream": True, "messages": [{"role": "user", "content": "hi"}]}
    )
    async with httpx.AsyncClient() as client:
        adapter = build_adapter(PROFILE, client)
        chunks = [line async for line in adapter.stream(request, PROFILE)]
    assert chunks[-1] == "data: [DONE]\n\n"
    assert adapter.observed_usage == {
        "prompt_tokens": 5, "completion_tokens": 9, "total_tokens": 14,
    }


@respx.mock
async def test_openai_adapter_usage_is_none_when_upstream_omits_it(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oai")
    respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"id": "x", "object": "chat.completion", "choices": []}
        )
    )
    request = ChatCompletionRequest.model_validate(
        {"model": "g", "messages": [{"role": "user", "content": "hi"}]}
    )
    async with httpx.AsyncClient() as client:
        adapter = build_adapter(OAI, client)
        await adapter.complete(request, OAI)
    assert adapter.observed_usage is None
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_usage_capture.py -v`
Expected: FAIL — `AttributeError: 'StreamTranslator' object has no attribute 'usage'`

- [ ] **Step 3: 구현**

`translate.py` — `StreamTranslator.__init__` 끝에 추가:
```python
        self._prompt_tokens: int | None = None
        self._completion_tokens: int | None = None
```

`translate.py` — `StreamTranslator`에 프로퍼티 추가:
```python
    @property
    def usage(self) -> dict[str, int] | None:
        if self._prompt_tokens is None and self._completion_tokens is None:
            return None
        prompt = self._prompt_tokens or 0
        completion = self._completion_tokens or 0
        return {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
        }

    def _absorb_usage(self, usage: dict | None) -> None:
        if not isinstance(usage, dict):
            return
        if isinstance(usage.get("input_tokens"), int):
            self._prompt_tokens = usage["input_tokens"]
        if isinstance(usage.get("output_tokens"), int):
            self._completion_tokens = usage["output_tokens"]
```

`translate.py` — `feed()` 시작 부분에 `message_start` 처리를 추가하고 `message_delta`에서 usage를 흡수한다:
```python
    def feed(self, event_type: str, data: dict) -> list[dict]:
        if event_type == "message_start":
            self._absorb_usage((data.get("message") or {}).get("usage"))
            return []
        if event_type == "content_block_delta":
            delta = data.get("delta", {})
            if delta.get("type") == "text_delta":
                return [self._chunk({"content": delta.get("text", "")})]
            return self._feed_tool_delta(data)
        if event_type == "content_block_start":
            return self._feed_tool_start(data)
        if event_type == "message_delta":
            self._absorb_usage(data.get("usage"))
            stop_reason = (data.get("delta") or {}).get("stop_reason")
            if stop_reason is not None:
                return [self._chunk({}, finish_reason=map_finish_reason(stop_reason))]
        return []
```

`adapters/base.py` — 프로토콜에 속성 추가:
```python
class Adapter(Protocol):
    observed_usage: dict | None

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict: ...
    def stream(self, request: ChatCompletionRequest, profile: Profile) -> AsyncIterator[str]: ...
```

`adapters/anthropic.py` — `__init__`에 `self.observed_usage: dict | None = None` 추가.
`complete()`에서 `return from_anthropic_response(data, profile)`를 아래로 교체:
```python
        result = from_anthropic_response(data, profile)
        self.observed_usage = result.get("usage")
        return result
```
`stream()`의 마지막 `yield "data: [DONE]\n\n"` **직전**에 추가:
```python
        self.observed_usage = translator.usage
```

`adapters/openai.py` — `__init__`에 `self.observed_usage: dict | None = None` 추가.
`complete()`에서 `data["model"] = profile.name` 다음 줄에 추가:
```python
        usage = data.get("usage")
        self.observed_usage = usage if isinstance(usage, dict) else None
```
`stream()`의 청크 처리에서 `chunk["model"] = profile.name` 다음 줄에 추가:
```python
                    chunk_usage = chunk.get("usage")
                    if isinstance(chunk_usage, dict):
                        self.observed_usage = chunk_usage
```

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest -q && ruff check src tests`
Expected: 전체 PASS. **기존 스트리밍 테스트가 그대로 통과해야 한다**(내보내는 청크 불변 확인).

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/translate.py src/llm_router/adapters tests/test_usage_capture.py
git commit -m "feat: observe token usage in translator and adapters"
```

---

### Task 3: UsageRecorder + Settings 확장

**Files:**
- Create: `src/llm_router/usage/recorder.py`, `tests/test_usage_recorder.py`
- Modify: `src/llm_router/config.py`, `src/llm_router/usage/__init__.py`

**Interfaces:**
- Consumes: `usage.store.CallRecord/UsageStore`, `models.ChatCompletionRequest/Profile`, `errors.RouterError`
- Produces:
  - `usage.recorder.UsageRecorder(store: UsageStore|None, log_bodies: bool)`
    - `start(profile: Profile, request: ChatCompletionRequest) -> CallRecord`
    - `async finish(record, *, adapter=None, response: dict|None = None, error: RouterError|None = None) -> None`
    - `store is None`이면 완전한 no-op.
  - `config.Settings.usage_db: Path` (기본 `~/.llm-router/usage.db`), `config.Settings.log_bodies: bool` (기본 `False`)

- [ ] **Step 1: 실패 테스트** — `tests/test_usage_recorder.py`

```python
import pytest

from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.usage.recorder import UsageRecorder
from llm_router.usage.store import UsageStore

PROFILE = Profile(
    name="c", provider="anthropic", auth="api_key",
    api_key_env="ANTHROPIC_API_KEY", model="claude-sonnet-4-5",
)
REQUEST = ChatCompletionRequest.model_validate(
    {"model": "c", "messages": [{"role": "user", "content": "hi"}]}
)


class _Adapter:
    def __init__(self, usage=None):
        self.observed_usage = usage


async def test_null_recorder_is_noop():
    recorder = UsageRecorder(None, log_bodies=False)
    record = recorder.start(PROFILE, REQUEST)
    await recorder.finish(record, adapter=_Adapter(), response={"usage": {}})


async def test_success_is_recorded_with_usage(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        recorder = UsageRecorder(store, log_bodies=False)
        record = recorder.start(PROFILE, REQUEST)
        await recorder.finish(
            record,
            adapter=_Adapter({"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}),
            response={"id": "x"},
        )
        rows = await store.calls(limit=10, offset=0, profile=None)
        assert rows[0]["ok"] == 1
        assert rows[0]["status"] == 200
        assert rows[0]["total_tokens"] == 5
        assert rows[0]["upstream_model"] == "claude-sonnet-4-5"
        assert rows[0]["duration_ms"] is not None
    finally:
        store.close()


async def test_error_is_recorded(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        recorder = UsageRecorder(store, log_bodies=False)
        record = recorder.start(PROFILE, REQUEST)
        await recorder.finish(
            record,
            adapter=_Adapter(),
            error=RouterError("boom", type="upstream_error", code="upstream_error",
                              status_code=429),
        )
        rows = await store.calls(limit=10, offset=0, profile=None)
        assert rows[0]["ok"] == 0
        assert rows[0]["status"] == 429
        assert rows[0]["error_code"] == "upstream_error"
        assert "boom" in rows[0]["error_message"]
    finally:
        store.close()


async def test_bodies_only_stored_when_enabled(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        off = UsageRecorder(store, log_bodies=False)
        await off.finish(off.start(PROFILE, REQUEST), adapter=_Adapter(),
                         response={"id": "x"})
        on = UsageRecorder(store, log_bodies=True)
        await on.finish(on.start(PROFILE, REQUEST), adapter=_Adapter(),
                        response={"id": "x"})
        listed = await store.calls(limit=10, offset=0, profile=None)
        newest = await store.call(listed[0]["id"])
        oldest = await store.call(listed[1]["id"])
        assert newest["request_body"] is not None
        assert newest["response_body"] is not None
        assert oldest["request_body"] is None
        assert oldest["response_body"] is None
    finally:
        store.close()


async def test_store_failure_never_propagates(tmp_path):
    class _BrokenStore:
        async def record(self, record):
            raise RuntimeError("disk on fire")

    recorder = UsageRecorder(_BrokenStore(), log_bodies=False)
    record = recorder.start(PROFILE, REQUEST)
    await recorder.finish(record, adapter=_Adapter(), response={"id": "x"})


def test_settings_expose_usage_options(monkeypatch, tmp_path):
    from llm_router.config import Settings

    monkeypatch.setenv("LLM_ROUTER_MASTER_KEY", "sk-local")
    monkeypatch.setenv("LLM_ROUTER_USAGE_DB", str(tmp_path / "custom.db"))
    monkeypatch.setenv("LLM_ROUTER_LOG_BODIES", "true")
    settings = Settings(_env_file=None)
    assert str(settings.usage_db).endswith("custom.db")
    assert settings.log_bodies is True
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_usage_recorder.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'llm_router.usage.recorder'`

- [ ] **Step 3: 구현**

`src/llm_router/usage/recorder.py`:
```python
from __future__ import annotations

import json
import time
from typing import Any

from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.usage.store import CallRecord


def _dump(value: Any) -> str | None:
    try:
        return json.dumps(value, default=str)
    except (TypeError, ValueError):
        return None


class UsageRecorder:
    def __init__(self, store: Any | None, log_bodies: bool) -> None:
        self.store = store
        self.log_bodies = log_bodies

    def start(self, profile: Profile, request: ChatCompletionRequest) -> CallRecord:
        record = CallRecord(
            started_at=time.time(),
            profile=profile.name,
            provider=profile.provider,
            upstream_model=profile.model,
            stream=request.stream,
        )
        if self.log_bodies:
            record.request_body = _dump(request.model_dump(exclude_none=True, mode="json"))
        return record

    async def finish(
        self,
        record: CallRecord,
        *,
        adapter: Any | None = None,
        response: dict | None = None,
        error: RouterError | None = None,
    ) -> None:
        if self.store is None:
            return
        try:
            record.duration_ms = int((time.time() - record.started_at) * 1000)
            usage = getattr(adapter, "observed_usage", None)
            if isinstance(usage, dict):
                record.prompt_tokens = usage.get("prompt_tokens")
                record.completion_tokens = usage.get("completion_tokens")
                record.total_tokens = usage.get("total_tokens")
            if error is not None:
                record.ok = False
                record.status = error.status_code
                record.error_code = error.code
                record.error_message = error.message
            else:
                record.ok = True
                record.status = 200
                if self.log_bodies and response is not None:
                    record.response_body = _dump(response)
            await self.store.record(record)
        except Exception:  # noqa: BLE001 - logging must never break a request
            return
```

`src/llm_router/usage/__init__.py` — export 추가:
```python
from __future__ import annotations

from llm_router.usage.recorder import UsageRecorder
from llm_router.usage.store import CallRecord, UsageStore

__all__ = ["CallRecord", "UsageRecorder", "UsageStore"]
```

`src/llm_router/config.py` — `Settings`에 두 필드 추가(기존 필드 아래):
```python
    usage_db: Path = Path.home() / ".llm-router" / "usage.db"
    log_bodies: bool = False
```
(`from pathlib import Path`는 이미 import되어 있다.)

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest -q && ruff check src tests`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/usage src/llm_router/config.py tests/test_usage_recorder.py
git commit -m "feat: usage recorder with opt-in body logging"
```

---

### Task 4: 서버 통합 (기록 지점 연결)

**Files:**
- Modify: `src/llm_router/server.py`, `src/llm_router/cli.py`
- Modify: `tests/test_server.py` (신규 테스트 추가)

**Interfaces:**
- Consumes: `usage.UsageRecorder/UsageStore`
- Produces: `server.create_app(settings, registry, client=None, store=None)` — `store`가 주어지면 모든 호출을 기록. `None`이면 기록 없음(기존 테스트 무변경).

> **주의:** 선행 문서(`2026-08-12-fix-streaming-upstream-error.md`)의 수정이 이미 적용되어 있어야 한다.

- [ ] **Step 1: 실패 테스트** — `tests/test_server.py` 끝에 추가

```python
def test_calls_are_recorded_when_store_is_provided(tmp_path, monkeypatch):
    import asyncio

    from llm_router.usage import UsageStore

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    store = UsageStore(tmp_path / "usage.db")
    try:
        with respx.mock:
            respx.post(constants.ANTHROPIC_API_URL).mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "id": "msg", "model": "claude-sonnet-4-5",
                        "stop_reason": "end_turn",
                        "content": [{"type": "text", "text": "pong"}],
                        "usage": {"input_tokens": 4, "output_tokens": 6},
                    },
                )
            )
            with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
                response = client.post(
                    "/v1/chat/completions",
                    headers=AUTH,
                    json={"model": "c", "messages": [{"role": "user", "content": "ping"}]},
                )
        assert response.status_code == 200
        rows = asyncio.run(store.calls(limit=10, offset=0, profile=None))
        assert len(rows) == 1
        assert rows[0]["profile"] == "c"
        assert rows[0]["ok"] == 1
        assert rows[0]["total_tokens"] == 10
    finally:
        store.close()


def test_failed_calls_are_recorded_as_errors(tmp_path, monkeypatch):
    import asyncio

    from llm_router.usage import UsageStore

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    store = UsageStore(tmp_path / "usage.db")
    try:
        with respx.mock:
            respx.post(constants.ANTHROPIC_API_URL).mock(
                return_value=httpx.Response(429, json={"error": {"message": "slow down"}})
            )
            with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
                response = client.post(
                    "/v1/chat/completions",
                    headers=AUTH,
                    json={"model": "c", "messages": [{"role": "user", "content": "ping"}]},
                )
        assert response.status_code == 429
        rows = asyncio.run(store.calls(limit=10, offset=0, profile=None))
        assert rows[0]["ok"] == 0
        assert rows[0]["status"] == 429
    finally:
        store.close()
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_server.py -k recorded -v`
Expected: FAIL — `create_app() got an unexpected keyword argument 'store'`

- [ ] **Step 3: 구현**

`server.py` — import 추가:
```python
from llm_router.usage import UsageRecorder
```

`create_app` 시그니처와 앞부분:
```python
def create_app(
    settings: Settings,
    registry: ProfileRegistry,
    client: httpx.AsyncClient | None = None,
    store: object | None = None,
) -> FastAPI:
    owns_client = client is None
    recorder = UsageRecorder(store, log_bodies=settings.log_bodies)
```

`chat()` 핸들러 전체를 아래로 교체(스트리밍 분기의 중복 except 4개를 하나로 정리하면서 기록 지점을 단일화):
```python
    @app.post("/v1/chat/completions", response_model=None)
    async def chat(
        request: ChatCompletionRequest,
        _: None = Depends(require_auth),
    ) -> dict | StreamingResponse:
        profile = registry.resolve(request.model)
        active_client = await get_client()
        adapter = build_adapter(profile, active_client)
        record = recorder.start(profile, request)

        if request.stream:

            async def generate() -> AsyncIterator[str]:
                error: RouterError | None = None
                try:
                    async for line in adapter.stream(request, profile):
                        yield line
                except RouterError as exc:
                    error = exc
                except httpx.HTTPStatusError as exc:
                    error = _upstream_status_error(exc)
                except httpx.RequestError as exc:
                    error = _upstream_connection_error(exc)
                except Exception:  # noqa: BLE001 - response started; emit an SSE error
                    error = RouterError(
                        "streaming failed",
                        type="server_error",
                        code="stream_error",
                        status_code=500,
                    )
                if error is not None:
                    yield f"data: {json.dumps(to_openai_error(error))}\n\n"
                    yield "data: [DONE]\n\n"
                await recorder.finish(record, adapter=adapter, error=error)

            return StreamingResponse(generate(), media_type="text/event-stream")

        try:
            response = await adapter.complete(request, profile)
        except RouterError as exc:
            await recorder.finish(record, adapter=adapter, error=exc)
            raise
        except httpx.HTTPStatusError as exc:
            error = _upstream_status_error(exc)
            await recorder.finish(record, adapter=adapter, error=error)
            raise error from exc
        except httpx.RequestError as exc:
            error = _upstream_connection_error(exc)
            await recorder.finish(record, adapter=adapter, error=error)
            raise error from exc
        await recorder.finish(record, adapter=adapter, response=response)
        return response
```

`cli.py` — `serve()`에서 스토어를 만들어 주입한다. `application = create_app(settings, registry)`를 아래로 교체:
```python
    from llm_router.usage import UsageStore

    store = UsageStore(settings.usage_db)
    application = create_app(settings, registry, store=store)
```

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest -q && ruff check src tests`
Expected: 전체 PASS. 기존 서버 테스트(store 미주입)도 그대로 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/server.py src/llm_router/cli.py tests/test_server.py
git commit -m "feat: record every routed call to the usage store"
```

---

### Task 5: 사용량 조회 API

**Files:**
- Create: `src/llm_router/usage/routes.py`, `tests/test_usage_api.py`
- Modify: `src/llm_router/server.py`

**Interfaces:**
- Consumes: `UsageStore`, 서버의 `require_auth`
- Produces: `usage.routes.build_usage_router(store, auth_dependency) -> APIRouter`
  - `GET /v1/usage/summary?days=7`
  - `GET /v1/usage/calls?limit=50&offset=0&profile=`
  - `GET /v1/usage/calls/{call_id}`
  - `store is None`이면 세 엔드포인트 모두 503 + "usage recording is disabled".

- [ ] **Step 1: 실패 테스트** — `tests/test_usage_api.py`

```python
import asyncio
import time

from fastapi.testclient import TestClient

from llm_router.config import ProfileRegistry, Settings
from llm_router.models import Profile
from llm_router.server import create_app
from llm_router.usage import UsageStore
from llm_router.usage.store import CallRecord

SETTINGS = Settings(master_key="sk-local", host="127.0.0.1", port=8787, _env_file=None)
REGISTRY = ProfileRegistry(
    [
        Profile(
            name="c", provider="anthropic", auth="api_key",
            api_key_env="ANTHROPIC_API_KEY", model="claude-sonnet-4-5",
        )
    ]
)
AUTH = {"authorization": "Bearer sk-local"}


def _seed(store: UsageStore) -> None:
    asyncio.run(
        store.record(
            CallRecord(
                started_at=time.time(), profile="c", provider="anthropic",
                upstream_model="claude-sonnet-4-5", stream=False, duration_ms=42,
                status=200, ok=True, prompt_tokens=8, completion_tokens=2,
                total_tokens=10, request_body='{"q":1}', response_body='{"a":2}',
            )
        )
    )


def test_usage_endpoints_require_auth(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            assert client.get("/v1/usage/summary").status_code == 401
            assert client.get("/v1/usage/calls").status_code == 401
    finally:
        store.close()


def test_summary_and_calls_and_detail(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        _seed(store)
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            summary = client.get("/v1/usage/summary?days=7", headers=AUTH).json()
            assert summary["data"][0]["profile"] == "c"
            assert summary["data"][0]["total_tokens"] == 10

            listed = client.get("/v1/usage/calls", headers=AUTH).json()
            assert listed["data"][0]["duration_ms"] == 42
            assert "request_body" not in listed["data"][0]

            call_id = listed["data"][0]["id"]
            detail = client.get(f"/v1/usage/calls/{call_id}", headers=AUTH).json()
            assert detail["request_body"] == '{"q":1}'

            missing = client.get("/v1/usage/calls/99999", headers=AUTH)
            assert missing.status_code == 404
    finally:
        store.close()


def test_usage_endpoints_report_disabled_without_store():
    with TestClient(create_app(SETTINGS, REGISTRY)) as client:
        response = client.get("/v1/usage/summary", headers=AUTH)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "usage_disabled"
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_usage_api.py -v`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 3: 구현**

`src/llm_router/usage/routes.py`:
```python
from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, Query

from llm_router.errors import RouterError


def _require_store(store: Any | None) -> Any:
    if store is None:
        raise RouterError(
            "usage recording is disabled. Start the server with `llm-router serve`.",
            type="configuration_error",
            code="usage_disabled",
            status_code=503,
        )
    return store


def build_usage_router(store: Any | None, auth_dependency: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/v1/usage", dependencies=[Depends(auth_dependency)])

    @router.get("/summary")
    async def summary(days: int = Query(default=7, ge=1, le=365)) -> dict:
        rows = await _require_store(store).summary(days=days)
        return {"object": "list", "days": days, "data": rows}

    @router.get("/calls")
    async def calls(
        limit: int = Query(default=50, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        profile: str | None = Query(default=None),
    ) -> dict:
        rows = await _require_store(store).calls(limit=limit, offset=offset, profile=profile)
        return {"object": "list", "data": rows}

    @router.get("/calls/{call_id}")
    async def call_detail(call_id: int) -> dict:
        row = await _require_store(store).call(call_id)
        if row is None:
            raise RouterError(
                f"call {call_id} not found",
                type="invalid_request_error",
                code="call_not_found",
                status_code=404,
            )
        return row

    return router
```

`server.py` — `chat()` 정의 다음, `return app` 직전에 추가:
```python
    from llm_router.usage.routes import build_usage_router

    app.include_router(build_usage_router(store, require_auth))
```

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest -q && ruff check src tests`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/usage/routes.py src/llm_router/server.py tests/test_usage_api.py
git commit -m "feat: usage summary/history query API"
```

---

### Task 6: 대시보드 웹 UI

**Files:**
- Create: `src/llm_router/usage/dashboard.html`
- Modify: `src/llm_router/usage/routes.py`, `tests/test_usage_api.py`, `README.md`

**Interfaces:**
- Produces: `GET /dashboard` — 인증 없이 HTML 반환(정적 마크업). 페이지가 마스터 키를 입력받아 `sessionStorage`에 저장하고 `/v1/usage/*`를 호출한다.

- [ ] **Step 1: 실패 테스트** — `tests/test_usage_api.py`에 추가

```python
def test_dashboard_serves_self_contained_html(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            response = client.get("/dashboard")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        body = response.text
        assert "llm-router" in body
        # 외부 요청이 없어야 한다
        assert "http://" not in body.replace("http://localhost", "")
        assert "https://" not in body
    finally:
        store.close()
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_usage_api.py -k dashboard -v`
Expected: FAIL — 404

- [ ] **Step 3: 구현**

`src/llm_router/usage/dashboard.html` — 단일 자립 페이지. 요구사항:
- `<title>llm-router usage</title>`, 상단에 제목과 기간 선택(7/30/90일).
- 마스터 키 입력 폼. 입력하면 `sessionStorage.setItem("llmRouterKey", …)` 후 데이터 로드. 401이 오면 다시 입력을 요구한다.
- `fetch("/v1/usage/summary?days=" + days, {headers: {authorization: "Bearer " + key}})`로 집계를 받아 **인라인 SVG 막대 차트**(일자별 total_tokens 합계)를 그린다. 라이브러리 금지.
- `fetch("/v1/usage/calls?limit=50")`로 최근 호출 테이블(시각·프로필·모델·스트림·토큰·지연·상태)을 그린다. 토큰이 `null`이면 `—`로 표시한다.
- 행을 클릭하면 `/v1/usage/calls/{id}`를 불러 상세를 펼친다. 본문이 `null`이면 "본문 로깅이 꺼져 있습니다"를 보여준다.
- `@media (prefers-color-scheme: dark)` 대응. 모든 CSS/JS는 인라인.
- 외부 URL·폰트·이미지 참조 금지(테스트가 검사한다).

`src/llm_router/usage/routes.py` — 파일 상단에 import 추가:
```python
from importlib import resources

from fastapi.responses import HTMLResponse
```

`build_usage_router` 아래에 별도 함수 추가:
```python
def build_dashboard_router() -> APIRouter:
    router = APIRouter()

    @router.get("/dashboard", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        html = (
            resources.files("llm_router.usage").joinpath("dashboard.html").read_text("utf-8")
        )
        return HTMLResponse(html)

    return router
```

`server.py` — include 부분을 아래로 교체:
```python
    from llm_router.usage.routes import build_dashboard_router, build_usage_router

    app.include_router(build_usage_router(store, require_auth))
    app.include_router(build_dashboard_router())
```

`pyproject.toml` — 휠에 HTML이 포함되는지 확인한다. hatchling은 패키지 디렉터리의 비-Python 파일을 기본 포함하지만, `python3 -m build` 후 휠 안에 `llm_router/usage/dashboard.html`이 있는지 확인하고 없으면 아래를 추가한다:
```toml
[tool.hatch.build.targets.wheel.force-include]
"src/llm_router/usage/dashboard.html" = "llm_router/usage/dashboard.html"
```

`README.md` — "사용량 대시보드" 절 추가: `llm-router serve` 후 `http://localhost:8787/dashboard` 접속, 마스터 키 입력, `LLM_ROUTER_LOG_BODIES=true`로 본문 로깅 활성화, DB 위치는 `LLM_ROUTER_USAGE_DB`.

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest -q && ruff check src tests && ruff format --check src tests`
Expected: 전체 PASS

- [ ] **Step 5: 수동 확인**

`.env`에 `LLM_ROUTER_MASTER_KEY`를 설정하고 `llm-router serve` 실행 후 브라우저로 `http://localhost:8787/dashboard`를 열어, 마스터 키 입력 → 차트·테이블 렌더 → 행 클릭 상세를 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/llm_router/usage/dashboard.html src/llm_router/usage/routes.py \
        src/llm_router/server.py tests/test_usage_api.py README.md pyproject.toml
git commit -m "feat: self-contained usage dashboard at /dashboard"
```

---

## Self-Review (계획 작성자 체크)

**1. 스펙 커버리지**
- SQLite 저장소·스키마 → Task 1 ✓
- 스트리밍 토큰 수집(`message_start`/`message_delta`) → Task 2 ✓
- 어댑터 usage 노출, 출력 계약 불변 → Task 2 ✓
- 레코더 + 본문 옵트인 + 예외 삼킴 → Task 3 ✓
- 설정 2개(`usage_db`, `log_bodies`) → Task 3 ✓
- 서버 기록 지점(스트리밍·비스트리밍·에러) → Task 4 ✓
- 집계/목록/상세 API + 마스터 키 인증 + 503 비활성화 → Task 5 ✓
- 대시보드 HTML, 외부 의존성 0 → Task 6 ✓
- 제외 항목(비용 추정·구독 잔여량·보존기간) → 계획에 없음 ✓

**2. 플레이스홀더 스캔:** Task 6의 HTML만 요구사항 서술로 두었다(마크업을 통째로 적는 것보다 요구사항+검증 테스트가 낫다). 나머지는 전부 실제 코드. TBD 없음 ✓

**3. 타입 일관성:** `CallRecord` 필드명이 SQL 컬럼명과 1:1 대응(`asdict`로 바로 INSERT). `observed_usage`의 키(`prompt_tokens`/`completion_tokens`/`total_tokens`)가 `StreamTranslator.usage`, `from_anthropic_response`의 usage, `CallRecord` 필드, 대시보드 표시까지 동일 ✓

**알려진 리스크**
- Task 4는 선행 버그 수정과 같은 함수를 수정한다. **순서를 반드시 지킬 것.**
- 클라이언트 조기 연결 종료(`GeneratorExit`) 시 스트리밍 호출 기록이 누락될 수 있다(스펙 §8에 명시된 허용 한계).
- hatchling의 HTML 포함 여부는 Task 6 Step 3에서 실제 휠을 확인해 판단한다.

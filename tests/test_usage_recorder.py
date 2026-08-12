from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.usage.recorder import UsageRecorder
from llm_router.usage.store import UsageStore

PROFILE = Profile(
    name="c",
    provider="anthropic",
    auth="api_key",
    api_key_env="ANTHROPIC_API_KEY",
    model="claude-sonnet-4-5",
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
            error=RouterError(
                "boom",
                type="upstream_error",
                code="upstream_error",
                status_code=429,
            ),
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
        await off.finish(
            off.start(PROFILE, REQUEST),
            adapter=_Adapter(),
            response={"id": "x"},
        )
        on = UsageRecorder(store, log_bodies=True)
        await on.finish(
            on.start(PROFILE, REQUEST),
            adapter=_Adapter(),
            response={"id": "x"},
        )
        listed = await store.calls(limit=10, offset=0, profile=None)
        newest = await store.call(listed[0]["id"])
        oldest = await store.call(listed[1]["id"])
        assert newest["request_body"] is not None
        assert newest["response_body"] is not None
        assert oldest["request_body"] is None
        assert oldest["response_body"] is None
    finally:
        store.close()


async def test_store_failure_never_propagates():
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

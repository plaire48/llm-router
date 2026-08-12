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
            _record(
                ok=False,
                status=429,
                error_code="upstream_error",
                prompt_tokens=None,
                completion_tokens=None,
                total_tokens=None,
            )
        )
        summary = await store.summary(days=7)
        assert len(summary) == 1
        row = summary[0]
        assert row["profile"] == "c"
        assert row["provider"] == "anthropic"
        assert row["upstream_model"] == "claude-sonnet-4-5"
        assert row["calls"] == 3
        assert row["total_tokens"] == 18
        assert row["errors"] == 1
    finally:
        store.close()


async def test_summary_keeps_models_separate_within_a_profile(tmp_path):
    store = UsageStore(tmp_path / "usage.db")
    try:
        await store.record(_record(upstream_model="claude-sonnet-4-5"))
        await store.record(_record(upstream_model="claude-sonnet-5"))

        summary = await store.summary(days=7)

        assert [row["upstream_model"] for row in summary] == [
            "claude-sonnet-4-5",
            "claude-sonnet-5",
        ]
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

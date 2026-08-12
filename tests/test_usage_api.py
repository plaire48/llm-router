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
            name="c",
            provider="anthropic",
            auth="api_key",
            api_key_env="ANTHROPIC_API_KEY",
            model="claude-sonnet-4-5",
        )
    ]
)
AUTH = {"authorization": "Bearer sk-local"}


def _seed(store: UsageStore) -> None:
    asyncio.run(
        store.record(
            CallRecord(
                started_at=time.time(),
                profile="c",
                provider="anthropic",
                upstream_model="claude-sonnet-4-5",
                stream=False,
                duration_ms=42,
                status=200,
                ok=True,
                prompt_tokens=8,
                completion_tokens=2,
                total_tokens=10,
                request_body='{"q":1}',
                response_body='{"a":2}',
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

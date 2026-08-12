import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from llm_router.config import ProfileRegistry, Settings
from llm_router.errors import RouterError
from llm_router.models import Profile
from llm_router.oauth import constants
from llm_router.server import create_app

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


def _client() -> TestClient:
    return TestClient(create_app(SETTINGS, REGISTRY))


def test_health_requires_no_auth():
    with _client() as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_models_lists_profile_names():
    with _client() as client:
        response = client.get("/v1/models", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "c"


def test_local_gateway_lists_models_without_a_local_api_key():
    settings = Settings(host="127.0.0.1", port=8787, _env_file=None)
    with TestClient(create_app(settings, REGISTRY)) as client:
        response = client.get("/v1/models")
    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "c"


def test_keyless_gateway_rejects_non_loopback_bind():
    settings = Settings(host="0.0.0.0", port=8787, _env_file=None)
    with pytest.raises(RouterError, match="required when binding outside localhost"):
        create_app(settings, REGISTRY)


def test_configured_master_key_still_uses_openai_error_shape():
    with _client() as client:
        response = client.post("/v1/chat/completions", json={"model": "c", "messages": []})
    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "message": "invalid master key",
            "type": "authentication_error",
            "code": "invalid_api_key",
        }
    }


def test_invalid_request_uses_openai_error_shape():
    with _client() as client:
        response = client.post(
            "/v1/chat/completions",
            headers=AUTH,
            json={"model": "c"},
        )
    assert response.status_code == 422
    assert set(response.json()["error"]) == {"message", "type", "code"}
    assert response.json()["error"]["type"] == "invalid_request_error"


def test_unknown_model_returns_404():
    with _client() as client:
        response = client.post(
            "/v1/chat/completions",
            headers=AUTH,
            json={"model": "nope", "messages": [{"role": "user", "content": "x"}]},
        )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "model_not_found"


@respx.mock
def test_chat_completion_end_to_end(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg",
                "model": "claude-sonnet-4-5",
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "pong"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )
    )
    with _client() as client:
        response = client.post(
            "/v1/chat/completions",
            headers=AUTH,
            json={"model": "c", "messages": [{"role": "user", "content": "ping"}]},
        )
    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "pong"
    assert response.json()["model"] == "c"


@respx.mock
def test_upstream_status_is_preserved_in_openai_error(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(429, json={"error": {"message": "rate limited"}})
    )
    with _client() as client:
        response = client.post(
            "/v1/chat/completions",
            headers=AUTH,
            json={"model": "c", "messages": [{"role": "user", "content": "ping"}]},
        )
    assert response.status_code == 429
    assert response.json()["error"]["type"] == "upstream_error"
    assert "rate limited" in response.json()["error"]["message"]


@respx.mock
def test_upstream_connection_failure_returns_502(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(side_effect=httpx.ConnectError("offline"))
    with _client() as client:
        response = client.post(
            "/v1/chat/completions",
            headers=AUTH,
            json={"model": "c", "messages": [{"role": "user", "content": "ping"}]},
        )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upstream_connection_error"


@respx.mock
def test_streaming_completion_is_sse(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    sse = (
        "event: content_block_delta\n"
        'data: {"index":0,"delta":{"type":"text_delta","text":"pong"}}\n\n'
        "event: message_delta\n"
        'data: {"delta":{"stop_reason":"end_turn"}}\n\n'
    )
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(
            200,
            text=sse,
            headers={"content-type": "text/event-stream"},
        )
    )
    with _client() as client:
        response = client.post(
            "/v1/chat/completions",
            headers=AUTH,
            json={
                "model": "c",
                "stream": True,
                "messages": [{"role": "user", "content": "ping"}],
            },
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    payloads = [line.removeprefix("data: ") for line in response.text.splitlines() if line]
    assert json.loads(payloads[1])["choices"][0]["delta"] == {"content": "pong"}
    assert payloads[-1] == "[DONE]"


@respx.mock
def test_streaming_upstream_error_emits_sse_error_instead_of_crashing(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(429, json={"error": {"message": "rate limited"}})
    )
    with (
        _client() as client,
        client.stream(
            "POST",
            "/v1/chat/completions",
            headers=AUTH,
            json={
                "model": "c",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        ) as response,
    ):
        body = b"".join(response.iter_bytes()).decode()

    assert body.rstrip().endswith("data: [DONE]")
    first_payload = json.loads(body.split("data: ", 1)[1].split("\n\n", 1)[0])
    assert first_payload["error"]["type"] == "upstream_error"
    assert "rate limited" in first_payload["error"]["message"]


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
                        "id": "msg",
                        "model": "claude-sonnet-4-5",
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


def test_streaming_calls_are_recorded_with_usage(tmp_path, monkeypatch):
    import asyncio

    from llm_router.usage import UsageStore

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    sse = (
        "event: message_start\n"
        'data: {"message":{"usage":{"input_tokens":4,"output_tokens":0}}}\n\n'
        "event: content_block_delta\n"
        'data: {"index":0,"delta":{"type":"text_delta","text":"pong"}}\n\n'
        "event: message_delta\n"
        'data: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":6}}\n\n'
    )
    store = UsageStore(tmp_path / "usage.db")
    try:
        with respx.mock:
            respx.post(constants.ANTHROPIC_API_URL).mock(
                return_value=httpx.Response(
                    200,
                    text=sse,
                    headers={"content-type": "text/event-stream"},
                )
            )
            with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
                response = client.post(
                    "/v1/chat/completions",
                    headers=AUTH,
                    json={
                        "model": "c",
                        "stream": True,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
        assert response.status_code == 200
        rows = asyncio.run(store.calls(limit=10, offset=0, profile=None))
        assert rows[0]["stream"] == 1
        assert rows[0]["ok"] == 1
        assert rows[0]["total_tokens"] == 10
    finally:
        store.close()

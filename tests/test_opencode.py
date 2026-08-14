import base64
import json
import time
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from llm_router.adapters.opencode import OpenCodeAdapter, to_opencode_prompt
from llm_router.config import ProfileRegistry, Settings
from llm_router.credentials.openai_oauth import OpenAIAccountStore
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.server import create_app

PROFILE = Profile(
    name="openai",
    provider="openai",
    auth="oauth",
    model="gpt-5.6-sol",
    params={"reasoning_effort": "medium"},
)
AIPRO_PROFILE = Profile(
    name="aipro",
    provider="aipro",
    auth="oauth",
    model="sds-aipro/company-model",
)


def _jwt(payload: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


def _request(*, stream=False, tools=False) -> ChatCompletionRequest:
    value = {
        "model": "openai",
        "stream": stream,
        "messages": [
            {"role": "system", "content": "Be concise."},
            {"role": "user", "content": "First question"},
            {"role": "assistant", "content": "First answer"},
            {"role": "user", "content": "Final question"},
        ],
    }
    if tools:
        value["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": "list_files",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ]
    return ChatCompletionRequest.model_validate(value)


class FakeRuntime:
    base_url = "http://127.0.0.1:4097"
    directory = Path("/tmp/llm-router-opencode-test")

    def __init__(self):
        self.started = False

    async def ensure_started(self, _client):
        self.started = True

    async def close(self):
        return None


def _assistant_payload(*, text="hello"):
    return {
        "info": {
            "id": "msg_1",
            "role": "assistant",
            "finish": "stop",
            "tokens": {"input": 11, "output": 4, "reasoning": 2},
        },
        "parts": [{"type": "reasoning", "text": "hidden"}, {"type": "text", "text": text}],
    }


def test_chat_completion_request_translates_to_opencode_session_prompt():
    body = to_opencode_prompt(_request(), PROFILE)

    assert body["model"] == {"providerID": "openai", "modelID": "gpt-5.6-sol"}
    assert "Be concise." in body["system"]
    assert "User: First question" in body["system"]
    assert "Assistant: First answer" in body["system"]
    assert body["parts"] == [{"type": "text", "text": "Final question"}]


def test_aipro_model_reference_is_passed_to_opencode_without_rewriting_provider():
    body = to_opencode_prompt(_request(), AIPRO_PROFILE)

    assert body["model"] == {
        "providerID": "sds-aipro",
        "modelID": "company-model",
    }


def test_opencode_prompt_rejects_caller_tools_instead_of_executing_them():
    with pytest.raises(RouterError) as error:
        to_opencode_prompt(_request(tools=True), PROFILE)

    assert error.value.code == "opencode_tools_unsupported"
    assert error.value.status_code == 400


@respx.mock
async def test_non_stream_completion_runs_inside_temporary_opencode_session():
    runtime = FakeRuntime()
    captured = {}

    def prompt_handler(request):
        captured["prompt"] = json.loads(request.content)
        return httpx.Response(200, json=_assistant_payload())

    respx.get(f"{runtime.base_url}/experimental/tool/ids").mock(
        return_value=httpx.Response(200, json=["bash", "read"])
    )
    respx.post(f"{runtime.base_url}/session").mock(
        return_value=httpx.Response(200, json={"id": "ses_1"})
    )
    respx.post(f"{runtime.base_url}/session/ses_1/message").mock(side_effect=prompt_handler)
    deleted = respx.delete(f"{runtime.base_url}/session/ses_1").mock(
        return_value=httpx.Response(200, json=True)
    )

    async with httpx.AsyncClient() as client:
        adapter = OpenCodeAdapter(client, runtime)
        output = await adapter.complete(_request(), PROFILE)

    assert runtime.started is True
    assert captured["prompt"]["tools"] == {"bash": False, "read": False}
    assert output["id"] == "msg_1"
    assert output["model"] == "openai"
    assert output["choices"][0]["message"]["content"] == "hello"
    assert output["usage"] == {
        "prompt_tokens": 11,
        "completion_tokens": 6,
        "total_tokens": 17,
    }
    assert deleted.called


@respx.mock
async def test_streaming_contract_buffers_opencode_result_as_valid_sse():
    runtime = FakeRuntime()
    respx.get(f"{runtime.base_url}/experimental/tool/ids").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.post(f"{runtime.base_url}/session").mock(
        return_value=httpx.Response(200, json={"id": "ses_1"})
    )
    respx.post(f"{runtime.base_url}/session/ses_1/message").mock(
        return_value=httpx.Response(200, json=_assistant_payload(text="streamed"))
    )
    respx.delete(f"{runtime.base_url}/session/ses_1").mock(
        return_value=httpx.Response(200, json=True)
    )

    async with httpx.AsyncClient() as client:
        adapter = OpenCodeAdapter(client, runtime)
        chunks = [chunk async for chunk in adapter.stream(_request(stream=True), PROFILE)]

    payloads = [
        json.loads(chunk.removeprefix("data: ")) for chunk in chunks if chunk.startswith("data: {")
    ]
    assert payloads[0]["choices"][0]["delta"] == {"role": "assistant"}
    assert payloads[1]["choices"][0]["delta"] == {"content": "streamed"}
    assert payloads[-1]["usage"]["total_tokens"] == 17
    assert chunks[-1] == "data: [DONE]\n\n"


@respx.mock
def test_registered_openai_profile_routes_chat_completions_through_opencode(tmp_path):
    runtime = FakeRuntime()
    store = OpenAIAccountStore(tmp_path / "auth.json")
    store.save(
        {
            "auth_mode": "chatgpt",
            "tokens": {
                "access_token": _jwt({"exp": time.time() + 3600}),
                "refresh_token": "refresh-current",
                "account_id": "account_1",
            },
        }
    )
    respx.get(f"{runtime.base_url}/experimental/tool/ids").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.post(f"{runtime.base_url}/session").mock(
        return_value=httpx.Response(200, json={"id": "ses_e2e"})
    )
    prompt = respx.post(f"{runtime.base_url}/session/ses_e2e/message").mock(
        return_value=httpx.Response(200, json=_assistant_payload(text="routed by OpenCode"))
    )
    respx.delete(f"{runtime.base_url}/session/ses_e2e").mock(
        return_value=httpx.Response(200, json=True)
    )
    app = create_app(
        Settings(host="127.0.0.1", _env_file=None),
        ProfileRegistry([]),
        codex_token_store=store,
        opencode_runtime=runtime,
        profiles_path=tmp_path / "profiles.yaml",
    )

    with TestClient(app) as client:
        client.get("/dashboard")
        registered = client.post(
            "/v1/profiles",
            json={
                "name": "openai",
                "provider": "openai",
                "auth": "oauth",
                "model": "gpt-5.6-sol",
                "params": {"reasoning_effort": "medium"},
            },
        )
        assert registered.status_code == 200
        assert registered.json()["inference_engine"] == "opencode"
        assert runtime.started is True
        response = client.post(
            "/v1/chat/completions",
            json={"model": "openai", "messages": [{"role": "user", "content": "hello"}]},
        )

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "routed by OpenCode"
    assert prompt.called


def test_openai_oauth_status_reads_router_owned_opencode_credential(tmp_path):
    store = OpenAIAccountStore.from_opencode(tmp_path / "auth.json")
    store.save(
        {
            "openai": {
                "type": "oauth",
                "access": _jwt({"exp": time.time() + 3600}),
                "refresh": "refresh-current",
                "metadata": {"accountID": "account_1"},
                "expires": int((time.time() + 3600) * 1000),
            },
        }
    )

    tokens = store.tokens()

    assert tokens["refresh_token"] == "refresh-current"
    assert tokens["account_id"] == "account_1"
    assert store.expires_at(tokens) > time.time()

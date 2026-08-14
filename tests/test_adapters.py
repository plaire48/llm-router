import json

import httpx
import pytest
import respx

from llm_router.adapters import build_adapter
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.oauth import constants

ANTHROPIC_PROFILE = Profile(
    name="c",
    provider="anthropic",
    auth="api_key",
    api_key_env="ANTHROPIC_API_KEY",
    model="claude-sonnet-4-5",
)
OPENAI_PROFILE = Profile(
    name="g",
    provider="openai",
    auth="api_key",
    api_key_env="OPENAI_API_KEY",
    model="gpt-4o",
)
FABRIX_PROFILE = Profile(
    name="fabrix-local",
    provider="fabrix",
    auth="api_key",
    api_key_env="FABRIX_API_TOKEN",
    client_key_env="FABRIX_CLIENT_KEY",
    base_url="https://fabrix.company.test/gateway/",
    model="019a-model-id",
)
AIPRO_PROFILE = Profile(
    name="aipro",
    provider="aipro",
    auth="api_key",
    api_key_env="AIPRO_API_KEY",
    model="company-model",
)
LEGACY_AIPRO_PROFILE = Profile(
    name="aipro-legacy",
    provider="openai_compatible",
    auth="api_key",
    api_key_env="AIPRO_LEGACY_API_KEY",
    base_url="https://aipro.sdsdev.co.kr/v1/",
    model="company-model",
)


def _request(model: str, *, stream: bool = False) -> ChatCompletionRequest:
    return ChatCompletionRequest.model_validate(
        {
            "model": model,
            "stream": stream,
            "messages": [{"role": "user", "content": "hi"}],
        }
    )


def test_aipro_api_key_routes_through_the_managed_opencode_adapter():
    runtime = object()
    adapter = build_adapter(AIPRO_PROFILE, object(), opencode_runtime=runtime)

    assert adapter.__class__.__name__ == "OpenCodeAdapter"
    assert adapter.runtime is runtime


def test_legacy_aipro_endpoint_profile_also_routes_through_opencode():
    runtime = object()
    adapter = build_adapter(LEGACY_AIPRO_PROFILE, object(), opencode_runtime=runtime)

    assert adapter.__class__.__name__ == "OpenCodeAdapter"
    assert adapter.runtime is runtime


@respx.mock
async def test_anthropic_adapter_non_stream(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        captured["api_key"] = request.headers.get("x-api-key")
        return httpx.Response(
            200,
            json={
                "id": "msg",
                "model": "claude-sonnet-4-5",
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "hi"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )

    respx.post(constants.ANTHROPIC_API_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        output = await build_adapter(ANTHROPIC_PROFILE, client).complete(
            _request("c"), ANTHROPIC_PROFILE
        )
    assert captured["body"]["model"] == "claude-sonnet-4-5"
    assert captured["body"]["stream"] is False
    assert captured["api_key"] == "sk-ant"
    assert output["choices"][0]["message"]["content"] == "hi"
    assert output["model"] == "c"


@respx.mock
async def test_openai_adapter_passthrough_replaces_model(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oai")
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={"id": "x", "object": "chat.completion", "choices": [], "usage": {}},
        )

    respx.post("https://api.openai.com/v1/chat/completions").mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        output = await build_adapter(OPENAI_PROFILE, client).complete(_request("g"), OPENAI_PROFILE)
    assert captured["body"]["model"] == "gpt-4o"
    assert captured["body"]["stream"] is False
    assert captured["auth"] == "Bearer sk-oai"
    assert output["model"] == "g"


@respx.mock
async def test_openai_compatible_uses_profile_base_url(monkeypatch):
    monkeypatch.setenv("LOCAL_API_KEY", "local")
    profile = Profile(
        name="local",
        provider="openai_compatible",
        auth="api_key",
        api_key_env="LOCAL_API_KEY",
        base_url="http://localhost:11434/v1/",
        model="llama3.1",
    )
    captured = {}

    def handler(request):
        captured["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json={"choices": []})

    route = respx.post("http://localhost:11434/v1/chat/completions").mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        await build_adapter(profile, client).complete(_request("local"), profile)
    assert route.called
    assert captured["authorization"] == "Bearer local"


@respx.mock
async def test_openai_compatible_can_call_a_keyless_upstream_without_authorization():
    profile = Profile(
        name="keyless",
        provider="openai_compatible",
        auth="none",
        base_url="http://localhost:11434/v1",
        model="local-model",
    )
    captured = {}

    def handler(request):
        captured["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json={"choices": []})

    respx.post("http://localhost:11434/v1/chat/completions").mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        await build_adapter(profile, client).complete(_request("keyless"), profile)

    assert captured["authorization"] is None


@respx.mock
async def test_fabrix_adapter_uses_reference_protocol_and_headers(monkeypatch):
    monkeypatch.setenv("FABRIX_CLIENT_KEY", "client-key-123")
    monkeypatch.setenv("FABRIX_API_TOKEN", "token-abc")
    captured = {}

    def handler(request):
        captured["headers"] = request.headers
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "content": "안녕하세요",
                "status": "SUCCESS",
                "finishReason": "stop",
                "filterBlockReason": {"resultCode": "FR-201"},
            },
        )

    route = respx.post("https://fabrix.company.test/gateway/openapi/chat/v1/messages").mock(
        side_effect=handler
    )
    request = ChatCompletionRequest.model_validate(
        {
            "model": "fabrix-local",
            "messages": [
                {"role": "system", "content": "친절하게 답하세요."},
                {"role": "user", "content": "안녕"},
            ],
            "temperature": 0.2,
            "max_tokens": 128,
        }
    )
    async with httpx.AsyncClient() as client:
        output = await build_adapter(FABRIX_PROFILE, client).complete(request, FABRIX_PROFILE)

    assert route.called
    assert captured["headers"]["x-fabrix-client"] == "client-key-123"
    assert captured["headers"]["x-openapi-token"] == "Bearer token-abc"
    assert captured["body"] == {
        "modelIds": ["019a-model-id"],
        "contents": ["안녕"],
        "isStream": False,
        "llmConfig": {"max_new_tokens": 128, "temperature": 0.2},
        "systemPrompt": "친절하게 답하세요.",
    }
    assert output["model"] == "fabrix-local"
    assert output["choices"][0]["message"]["content"] == "안녕하세요"


@respx.mock
async def test_fabrix_adapter_stream_translates_snake_case_sse(monkeypatch):
    monkeypatch.setenv("FABRIX_CLIENT_KEY", "client-key-123")
    monkeypatch.setenv("FABRIX_API_TOKEN", "Bearer token-abc")
    sse = (
        'data: {"event_status":"THINK","content":"private reasoning",'
        '"filter_block_reason":{"result_code":"FR-201"}}\n\n'
        'data: {"event_status":"CHUNK","content":"안녕",'
        '"finish_reason":null,"filter_block_reason":{"result_code":"FR-201"}}\n\n'
        'data: {"event_status":"CHUNK","content":"하세요",'
        '"finish_reason":"stop","filter_block_reason":{"result_code":"FR-201"}}\n\n'
        "data: [DONE]\n\n"
    )
    respx.post("https://fabrix.company.test/gateway/openapi/chat/v1/messages").mock(
        return_value=httpx.Response(
            200,
            text=sse,
            headers={"content-type": "text/event-stream"},
        )
    )
    chunks = []
    async with httpx.AsyncClient() as client:
        async for chunk in build_adapter(FABRIX_PROFILE, client).stream(
            _request("fabrix-local", stream=True),
            FABRIX_PROFILE,
        ):
            chunks.append(chunk)

    assert not any("private reasoning" in chunk for chunk in chunks)
    assert any("안녕" in chunk for chunk in chunks)
    assert any("하세요" in chunk for chunk in chunks)
    assert chunks[-1] == "data: [DONE]\n\n"


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
        return_value=httpx.Response(
            200,
            text=sse,
            headers={"content-type": "text/event-stream"},
        )
    )
    chunks = []
    async with httpx.AsyncClient() as client:
        async for line in build_adapter(ANTHROPIC_PROFILE, client).stream(
            _request("c", stream=True), ANTHROPIC_PROFILE
        ):
            chunks.append(line)
    assert any('"content": "hi"' in chunk or '"content":"hi"' in chunk for chunk in chunks)
    assert any('"finish_reason": "stop"' in chunk for chunk in chunks)
    assert chunks[-1] == "data: [DONE]\n\n"


@respx.mock
async def test_openai_adapter_stream_rewrites_public_model(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oai")
    sse = (
        'data: {"id":"x","object":"chat.completion.chunk","model":"gpt-4o",'
        '"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
        "data: [DONE]\n\n"
    )
    respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            text=sse,
            headers={"content-type": "text/event-stream"},
        )
    )
    chunks = []
    async with httpx.AsyncClient() as client:
        async for line in build_adapter(OPENAI_PROFILE, client).stream(
            _request("g", stream=True), OPENAI_PROFILE
        ):
            chunks.append(line)
    first = json.loads(chunks[0].removeprefix("data: "))
    assert first["model"] == "g"
    assert chunks[-1] == "data: [DONE]\n\n"


@respx.mock
async def test_openai_adapter_rejects_invalid_upstream_json(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oai")
    respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(200, text="not-json")
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await build_adapter(OPENAI_PROFILE, client).complete(_request("g"), OPENAI_PROFILE)
    assert error.value.status_code == 502
    assert error.value.code == "invalid_upstream_response"

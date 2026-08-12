import json

import httpx
import respx

from llm_router.adapters import build_adapter
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


def _request(model: str, *, stream: bool = False) -> ChatCompletionRequest:
    return ChatCompletionRequest.model_validate(
        {
            "model": model,
            "stream": stream,
            "messages": [{"role": "user", "content": "hi"}],
        }
    )


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
        output = await build_adapter(OPENAI_PROFILE, client).complete(
            _request("g"), OPENAI_PROFILE
        )
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
    route = respx.post("http://localhost:11434/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": []})
    )
    async with httpx.AsyncClient() as client:
        await build_adapter(profile, client).complete(_request("local"), profile)
    assert route.called


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

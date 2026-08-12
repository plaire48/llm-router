import json

import httpx
import respx
from openai import AsyncOpenAI

from llm_router.config import ProfileRegistry, Settings
from llm_router.models import Profile
from llm_router.oauth import constants
from llm_router.server import create_app

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
SETTINGS = Settings(master_key="sk-local", host="127.0.0.1", port=8787, _env_file=None)
KEYLESS_SETTINGS = Settings(host="127.0.0.1", port=8787, _env_file=None)


async def _sdk(
    upstream_client: httpx.AsyncClient,
    registry: ProfileRegistry = REGISTRY,
) -> tuple[AsyncOpenAI, httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=create_app(SETTINGS, registry, client=upstream_client))
    http_client = httpx.AsyncClient(transport=transport)
    sdk = AsyncOpenAI(
        api_key="sk-local",
        base_url="http://router.local/v1",
        http_client=http_client,
        max_retries=0,
    )
    return sdk, http_client


async def test_openai_sdk_lists_gateway_profile_names():
    async with httpx.AsyncClient() as upstream_client:
        sdk, http_client = await _sdk(upstream_client)
        try:
            models = await sdk.models.list()
        finally:
            await sdk.close()
            await http_client.aclose()

    assert [model.id for model in models.data] == ["c"]


@respx.mock
async def test_openai_sdk_text_completion(monkeypatch):
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
    async with httpx.AsyncClient() as upstream_client:
        sdk, http_client = await _sdk(upstream_client)
        try:
            response = await sdk.chat.completions.create(
                model="c",
                messages=[{"role": "user", "content": "ping"}],
            )
        finally:
            await sdk.close()
            await http_client.aclose()
    assert response.model == "c"
    assert response.choices[0].message.content == "pong"


@respx.mock
async def test_openai_sdk_tool_call(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "msg",
                "model": "claude-sonnet-4-5",
                "stop_reason": "tool_use",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "get_weather",
                        "input": {"city": "Seoul"},
                    }
                ],
                "usage": {"input_tokens": 2, "output_tokens": 3},
            },
        )

    respx.post(constants.ANTHROPIC_API_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as upstream_client:
        sdk, http_client = await _sdk(upstream_client)
        try:
            response = await sdk.chat.completions.create(
                model="c",
                messages=[{"role": "user", "content": "weather?"}],
                tools=[
                    {
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "parameters": {
                                "type": "object",
                                "properties": {"city": {"type": "string"}},
                            },
                        },
                    }
                ],
                tool_choice="required",
            )
        finally:
            await sdk.close()
            await http_client.aclose()
    assert captured["body"]["tools"][0]["input_schema"]["type"] == "object"
    tool_call = response.choices[0].message.tool_calls[0]
    assert tool_call.function.name == "get_weather"
    assert json.loads(tool_call.function.arguments) == {"city": "Seoul"}
    assert response.choices[0].finish_reason == "tool_calls"


@respx.mock
async def test_openai_sdk_streaming(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    sse = (
        "event: content_block_delta\n"
        'data: {"index":0,"delta":{"type":"text_delta","text":"po"}}\n\n'
        "event: content_block_delta\n"
        'data: {"index":0,"delta":{"type":"text_delta","text":"ng"}}\n\n'
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
    async with httpx.AsyncClient() as upstream_client:
        sdk, http_client = await _sdk(upstream_client)
        try:
            stream = await sdk.chat.completions.create(
                model="c",
                messages=[{"role": "user", "content": "ping"}],
                stream=True,
            )
            chunks = [chunk async for chunk in stream]
        finally:
            await sdk.close()
            await http_client.aclose()
    assert "".join(chunk.choices[0].delta.content or "" for chunk in chunks) == "pong"
    assert chunks[-1].choices[0].finish_reason == "stop"


@respx.mock
async def test_agent_factory_style_request_is_forwarded_to_openai_compatible_upstream(
    monkeypatch,
):
    monkeypatch.setenv("COMPANY_LLM_API_KEY", "company-secret")
    registry = ProfileRegistry(
        [
            Profile(
                name="company",
                provider="openai_compatible",
                auth="api_key",
                api_key_env="COMPANY_LLM_API_KEY",
                base_url="https://llm.company.test/v1",
                model="company-model",
            )
        ]
    )
    captured = {}

    def handler(request):
        captured["authorization"] = request.headers["authorization"]
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-company",
                "object": "chat.completion",
                "model": "company-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": '{"ok":true}'},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16},
            },
        )

    respx.post("https://llm.company.test/v1/chat/completions").mock(side_effect=handler)
    async with httpx.AsyncClient() as upstream_client:
        transport = httpx.ASGITransport(
            app=create_app(KEYLESS_SETTINGS, registry, client=upstream_client)
        )
        async with httpx.AsyncClient(transport=transport, base_url="http://router.local") as client:
            response = await client.post(
                "/v1/chat/completions",
                json={
                    "model": "company",
                    "messages": [
                        {"role": "developer", "content": "Return JSON."},
                        {"role": "user", "content": "Run the task."},
                    ],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "finish_task",
                                "parameters": {"type": "object", "properties": {}},
                            },
                        }
                    ],
                    "tool_choice": "auto",
                    "response_format": {"type": "json_object"},
                    "parallel_tool_calls": False,
                },
            )

    assert response.status_code == 200
    assert response.json()["model"] == "company"
    assert captured["authorization"] == "Bearer company-secret"
    assert captured["body"]["model"] == "company-model"
    assert captured["body"]["messages"][0]["role"] == "developer"
    assert captured["body"]["tools"][0]["function"]["name"] == "finish_task"
    assert captured["body"]["response_format"] == {"type": "json_object"}
    assert captured["body"]["parallel_tool_calls"] is False

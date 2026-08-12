import base64
import json
import time

import httpx
import respx

from llm_router.adapters.openai_codex import (
    CODEX_RESPONSES_URL,
    OpenAICodexAdapter,
    to_codex_response_request,
)
from llm_router.credentials.openai_oauth import (
    OPENAI_TOKEN_URL,
    CodexTokenStore,
    OpenAICodexOAuth,
)
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.usage.openai_account import OpenAIAccountSource

PROFILE = Profile(
    name="openai-codex",
    provider="openai",
    auth="oauth",
    model="gpt-5.6-sol",
    params={"reasoning_effort": "medium"},
)


def _jwt(payload: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


def _request(*, stream=False, tools=False) -> ChatCompletionRequest:
    value = {
        "model": "openai-codex",
        "stream": stream,
        "messages": [
            {"role": "system", "content": "Be concise."},
            {"role": "user", "content": "List files"},
        ],
    }
    if tools:
        value.update(
            {
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "list_files",
                            "description": "List files",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
                "tool_choice": "auto",
            }
        )
    return ChatCompletionRequest.model_validate(value)


class StaticCredential:
    async def headers(self):
        return {
            "authorization": "Bearer access",
            "chatgpt-account-id": "account_1",
        }


def _text_sse() -> str:
    events = [
        {"type": "response.created", "response": {"id": "resp_1"}},
        {"type": "response.output_text.delta", "delta": "hello"},
        {
            "type": "response.completed",
            "response": {
                "id": "resp_1",
                "status": "completed",
                "usage": {"input_tokens": 11, "output_tokens": 4, "total_tokens": 15},
            },
        },
    ]
    return "".join(f"data: {json.dumps(event)}\n\n" for event in events) + "data: [DONE]\n\n"


def _tool_sse() -> str:
    events = [
        {"type": "response.created", "response": {"id": "resp_tool"}},
        {
            "type": "response.output_item.added",
            "item": {
                "id": "item_1",
                "type": "function_call",
                "call_id": "call_1",
                "name": "list_files",
                "arguments": "",
            },
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": "item_1",
            "delta": "{}",
        },
        {
            "type": "response.output_item.done",
            "item": {
                "id": "item_1",
                "type": "function_call",
                "call_id": "call_1",
                "name": "list_files",
                "arguments": "{}",
            },
        },
        {
            "type": "response.completed",
            "response": {
                "id": "resp_tool",
                "status": "completed",
                "usage": {"input_tokens": 20, "output_tokens": 3, "total_tokens": 23},
            },
        },
    ]
    return "".join(f"data: {json.dumps(event)}\n\n" for event in events)


def test_chat_completion_request_translates_to_codex_responses():
    body = to_codex_response_request(_request(tools=True), PROFILE)
    assert body["model"] == "gpt-5.6-sol"
    assert body["instructions"] == "Be concise."
    assert body["input"][0]["role"] == "user"
    assert body["tools"][0]["name"] == "list_files"
    assert body["reasoning"] == {"effort": "medium"}
    assert body["stream"] is True
    assert body["store"] is False


@respx.mock
async def test_codex_non_stream_completion_aggregates_responses_stream():
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        captured["account"] = request.headers.get("chatgpt-account-id")
        return httpx.Response(200, text=_text_sse(), headers={"content-type": "text/event-stream"})

    respx.post(CODEX_RESPONSES_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        adapter = OpenAICodexAdapter(client, StaticCredential())
        output = await adapter.complete(_request(), PROFILE)

    assert captured["body"]["model"] == "gpt-5.6-sol"
    assert captured["account"] == "account_1"
    assert output["id"] == "resp_1"
    assert output["model"] == "openai-codex"
    assert output["choices"][0]["message"]["content"] == "hello"
    assert output["usage"]["total_tokens"] == 15


@respx.mock
async def test_codex_tools_stream_as_openai_compatible_chunks():
    respx.post(CODEX_RESPONSES_URL).mock(
        return_value=httpx.Response(
            200,
            text=_tool_sse(),
            headers={"content-type": "text/event-stream"},
        )
    )
    chunks = []
    async with httpx.AsyncClient() as client:
        adapter = OpenAICodexAdapter(client, StaticCredential())
        async for chunk in adapter.stream(_request(stream=True, tools=True), PROFILE):
            chunks.append(chunk)

    payloads = [
        json.loads(chunk.removeprefix("data: ")) for chunk in chunks if chunk.startswith("data: {")
    ]
    starts = [
        payload
        for payload in payloads
        if payload["choices"]
        and payload["choices"][0]["delta"].get("tool_calls")
        and payload["choices"][0]["delta"]["tool_calls"][0].get("id")
    ]
    assert starts[0]["choices"][0]["delta"]["tool_calls"][0]["id"] == "call_1"
    assert any(
        payload["choices"] and payload["choices"][0]["finish_reason"] == "tool_calls"
        for payload in payloads
    )
    assert payloads[-1]["usage"]["total_tokens"] == 23
    assert chunks[-1] == "data: [DONE]\n\n"


@respx.mock
async def test_codex_oauth_refreshes_and_preserves_rotated_refresh_token(tmp_path):
    path = tmp_path / "auth.json"
    store = CodexTokenStore(path)
    store.save(
        {
            "auth_mode": "chatgpt",
            "tokens": {
                "access_token": _jwt({"exp": time.time() - 1}),
                "refresh_token": "refresh-old",
                "account_id": "account_1",
            },
        }
    )
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "access_token": _jwt({"exp": time.time() + 3600}),
                "refresh_token": "refresh-new",
            },
        )

    respx.post(OPENAI_TOKEN_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        headers = await OpenAICodexOAuth(store, client).headers()

    assert captured["body"]["grant_type"] == "refresh_token"
    assert headers["chatgpt-account-id"] == "account_1"
    assert store.tokens()["refresh_token"] == "refresh-new"
    assert "access_token" not in json.dumps(headers).replace(headers["authorization"], "")


async def test_openai_account_source_reports_individual_limit_and_daily_tokens():
    async def rpc(method):
        if method == "account/rateLimits/read":
            return {
                "rateLimits": {
                    "primary": {
                        "usedPercent": 32,
                        "windowDurationMins": 300,
                        "resetsAt": 1_800_000_000,
                    },
                    "secondary": None,
                    "individualLimit": {
                        "limit": "6000",
                        "used": "1500",
                        "remainingPercent": 75,
                        "resetsAt": 1_800_000_000,
                    },
                    "spendControlReached": False,
                }
            }
        return {
            "summary": {"lifetimeTokens": 123_456, "peakDailyTokens": 45_000},
            "dailyUsageBuckets": [
                {"startDate": "2026-08-11", "tokens": 12_345},
            ],
        }

    report = await OpenAIAccountSource(rpc=rpc).report()
    payload = report.to_dict()
    assert payload["rate_limits"]["individualLimit"]["remainingPercent"] == 75
    assert payload["token_usage"]["daily_usage_buckets"][0]["tokens"] == 12_345

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest
import respx

from llm_router.adapters.opencode import OpenCodeAdapter
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.opencode_tool_bridge import OpenCodeToolBridge, _atomic_json

PROFILE = Profile(
    name="openai",
    provider="openai",
    auth="oauth",
    model="gpt-5.6-sol",
)


class FakeRuntime:
    base_url = "http://127.0.0.1:4097"

    def __init__(self, directory: Path, bridge: OpenCodeToolBridge):
        self.directory = directory
        self.tool_bridge = bridge
        self.started = False

    async def ensure_profile(self, _client, _profile):
        self.started = True


def _tool_request() -> ChatCompletionRequest:
    return ChatCompletionRequest.model_validate(
        {
            "model": "openai",
            "messages": [{"role": "user", "content": "What is the weather in Seoul?"}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get the current weather for a city.",
                        "parameters": {
                            "type": "object",
                            "properties": {"city": {"type": "string"}},
                            "required": ["city"],
                        },
                    },
                }
            ],
        }
    )


def _assistant(*, finish=None, text="") -> dict:
    info = {
        "id": "msg_tool",
        "role": "assistant",
        "tokens": {"input": 8, "output": 2, "reasoning": 0},
        "time": {"created": 1},
    }
    if finish is not None:
        info["finish"] = finish
    parts = [{"type": "text", "text": text}] if text else []
    return {"info": info, "parts": parts}


def test_stdio_mcp_bridge_lists_tools_and_waits_for_caller_result(tmp_path):
    bridge_dir = tmp_path / "bridge"
    _atomic_json(
        bridge_dir / "tools.json",
        {
            "tools": [
                {
                    "name": "get_weather",
                    "description": "Get weather",
                    "inputSchema": {"type": "object", "properties": {}},
                }
            ]
        },
    )
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(Path(__file__).parents[1] / "src")
    environment["LLM_ROUTER_TOOL_BRIDGE_DIR"] = str(bridge_dir)
    process = subprocess.Popen(
        [sys.executable, "-m", "llm_router.opencode_tool_bridge", "--stdio"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    try:
        process.stdin.write(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {"protocolVersion": "2025-06-18"},
                }
            )
            + "\n"
        )
        process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) + "\n")
        process.stdin.flush()
        initialized = json.loads(process.stdout.readline())
        listed = json.loads(process.stdout.readline())
        assert initialized["result"]["capabilities"] == {"tools": {"listChanged": False}}
        assert listed["result"]["tools"][0]["name"] == "get_weather"

        process.stdin.write(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {"name": "get_weather", "arguments": {"city": "Seoul"}},
                }
            )
            + "\n"
        )
        process.stdin.flush()
        deadline = time.monotonic() + 3
        call_files = []
        while time.monotonic() < deadline:
            call_files = list((bridge_dir / "calls").glob("*.json"))
            if call_files:
                break
            time.sleep(0.01)
        assert len(call_files) == 1
        call = json.loads(call_files[0].read_text(encoding="utf-8"))
        assert call["arguments"] == {"city": "Seoul"}
        _atomic_json(
            bridge_dir / "results" / call_files[0].name,
            {"content": "sunny", "is_error": False},
        )
        result = json.loads(process.stdout.readline())
        assert result["id"] == 3
        assert result["result"]["content"] == [{"type": "text", "text": "sunny"}]
    finally:
        process.terminate()
        process.wait(timeout=3)


@respx.mock
async def test_opencode_tool_call_round_trip_resumes_the_same_session(tmp_path):
    bridge = OpenCodeToolBridge(tmp_path)
    runtime = FakeRuntime(tmp_path, bridge)
    registered = {}

    def register_mcp(request):
        body = json.loads(request.content)
        registered["name"] = body["name"]
        return httpx.Response(200, json={body["name"]: {"status": "connected"}})

    def tool_ids(_request):
        context = next(iter(bridge._contexts.values()))
        return httpx.Response(200, json=["bash", *context.opencode_tool_ids])

    def prompt_async(_request):
        context = next(iter(bridge._contexts.values()))
        _atomic_json(
            context.directory / "calls" / "weather.json",
            {
                "id": "call_weather",
                "name": "get_weather",
                "arguments": {"city": "Seoul"},
                "created_at": 1,
            },
        )
        return httpx.Response(204)

    def messages(_request):
        context = next(iter(bridge._contexts.values()))
        result = context.directory / "results" / "weather.json"
        if result.exists():
            assert json.loads(result.read_text(encoding="utf-8"))["content"] == "sunny"
            return httpx.Response(200, json=[_assistant(finish="stop", text="It is sunny.")])
        return httpx.Response(200, json=[_assistant()])

    respx.post(f"{runtime.base_url}/session").mock(
        return_value=httpx.Response(200, json={"id": "ses_tools"})
    )
    respx.post(f"{runtime.base_url}/mcp").mock(side_effect=register_mcp)
    respx.get(f"{runtime.base_url}/experimental/tool/ids").mock(side_effect=tool_ids)
    prompt = respx.post(f"{runtime.base_url}/session/ses_tools/prompt_async").mock(
        side_effect=prompt_async
    )
    respx.get(f"{runtime.base_url}/session/ses_tools/message").mock(side_effect=messages)
    abort = respx.post(f"{runtime.base_url}/session/ses_tools/abort").mock(
        return_value=httpx.Response(200, json=True)
    )
    disconnect = respx.post(url__regex=rf"{runtime.base_url}/mcp/llmrouter_[^/]+/disconnect").mock(
        return_value=httpx.Response(200, json=True)
    )
    deleted = respx.delete(f"{runtime.base_url}/session/ses_tools").mock(
        return_value=httpx.Response(200, json=True)
    )

    async with httpx.AsyncClient() as client:
        first_adapter = OpenCodeAdapter(client, runtime, bridge)
        first = await first_adapter.complete(_tool_request(), PROFILE)
        call = first["choices"][0]["message"]["tool_calls"][0]
        assert call == {
            "id": "call_weather",
            "type": "function",
            "function": {"name": "get_weather", "arguments": '{"city":"Seoul"}'},
        }
        assert first["choices"][0]["finish_reason"] == "tool_calls"
        assert deleted.called is False

        resumed_payload = _tool_request().model_dump()
        resumed_payload["messages"].extend(
            [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [call],
                },
                {"role": "tool", "tool_call_id": call["id"], "content": "sunny"},
            ]
        )
        resumed = ChatCompletionRequest.model_validate(resumed_payload)
        second_adapter = OpenCodeAdapter(client, runtime, bridge)
        final = await second_adapter.complete(resumed, PROFILE)

    prompt_body = json.loads(prompt.calls[0].request.content)
    assert prompt_body["tools"]["bash"] is False
    assert prompt_body["tools"][f"{registered['name']}_get_weather"] is True
    assert final["choices"][0]["message"]["content"] == "It is sunny."
    assert final["choices"][0]["finish_reason"] == "stop"
    assert abort.called
    assert disconnect.called
    assert deleted.called


async def test_parallel_tool_results_must_be_returned_together(tmp_path):
    bridge = OpenCodeToolBridge(tmp_path)
    context = await bridge.create(
        _tool_request().tools or [],
        session_id="ses_parallel",
        profile_name="openai",
    )
    _atomic_json(
        context.directory / "calls" / "first.json",
        {
            "id": "call_first",
            "name": "get_weather",
            "arguments": {"city": "Seoul"},
            "created_at": 1,
        },
    )
    _atomic_json(
        context.directory / "calls" / "second.json",
        {
            "id": "call_second",
            "name": "get_weather",
            "arguments": {"city": "Busan"},
            "created_at": 2,
        },
    )
    calls = await bridge.new_calls(context)
    assert [call.id for call in calls] == ["call_first", "call_second"]
    messages = ChatCompletionRequest.model_validate(
        {
            "model": "openai",
            "messages": [
                {"role": "user", "content": "weather?"},
                {"role": "tool", "tool_call_id": "call_first", "content": "sunny"},
            ],
        }
    ).messages

    with pytest.raises(RouterError) as error:
        await bridge.context_for_results(messages, profile_name="openai")

    assert error.value.code == "incomplete_tool_results"
    assert "call_second" in str(error.value)
    await bridge.close()


@respx.mock
async def test_required_tool_choice_rejects_an_opencode_final_answer(tmp_path):
    bridge = OpenCodeToolBridge(tmp_path)
    runtime = FakeRuntime(tmp_path, bridge)
    request = _tool_request().model_copy(update={"tool_choice": "required"})

    respx.post(f"{runtime.base_url}/session").mock(
        return_value=httpx.Response(200, json={"id": "ses_required"})
    )
    respx.post(f"{runtime.base_url}/mcp").mock(
        side_effect=lambda call: httpx.Response(
            200,
            json={json.loads(call.content)["name"]: {"status": "connected"}},
        )
    )
    respx.get(f"{runtime.base_url}/experimental/tool/ids").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.post(f"{runtime.base_url}/session/ses_required/prompt_async").mock(
        return_value=httpx.Response(204)
    )
    respx.get(f"{runtime.base_url}/session/ses_required/message").mock(
        return_value=httpx.Response(200, json=[_assistant(finish="stop", text="No tool")])
    )
    respx.post(f"{runtime.base_url}/session/ses_required/abort").mock(
        return_value=httpx.Response(200, json=True)
    )
    respx.post(url__regex=rf"{runtime.base_url}/mcp/llmrouter_[^/]+/disconnect").mock(
        return_value=httpx.Response(200, json=True)
    )
    respx.delete(f"{runtime.base_url}/session/ses_required").mock(
        return_value=httpx.Response(200, json=True)
    )

    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await OpenCodeAdapter(client, runtime, bridge).complete(request, PROFILE)

    assert error.value.code == "required_tool_call_missing"


@respx.mock
async def test_parallel_tool_calls_false_is_enforced_after_model_response(tmp_path):
    bridge = OpenCodeToolBridge(tmp_path)
    runtime = FakeRuntime(tmp_path, bridge)
    request = _tool_request().model_copy(update={"parallel_tool_calls": False})

    def prompt_async(_request):
        context = next(iter(bridge._contexts.values()))
        for index, city in enumerate(("Seoul", "Busan")):
            _atomic_json(
                context.directory / "calls" / f"weather-{index}.json",
                {
                    "id": f"call_{index}",
                    "name": "get_weather",
                    "arguments": {"city": city},
                    "created_at": index,
                },
            )
        return httpx.Response(204)

    respx.post(f"{runtime.base_url}/session").mock(
        return_value=httpx.Response(200, json={"id": "ses_serial"})
    )
    respx.post(f"{runtime.base_url}/mcp").mock(
        side_effect=lambda call: httpx.Response(
            200,
            json={json.loads(call.content)["name"]: {"status": "connected"}},
        )
    )
    respx.get(f"{runtime.base_url}/experimental/tool/ids").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.post(f"{runtime.base_url}/session/ses_serial/prompt_async").mock(side_effect=prompt_async)
    respx.get(f"{runtime.base_url}/session/ses_serial/message").mock(
        return_value=httpx.Response(200, json=[_assistant()])
    )
    respx.post(f"{runtime.base_url}/session/ses_serial/abort").mock(
        return_value=httpx.Response(200, json=True)
    )
    respx.post(url__regex=rf"{runtime.base_url}/mcp/llmrouter_[^/]+/disconnect").mock(
        return_value=httpx.Response(200, json=True)
    )
    respx.delete(f"{runtime.base_url}/session/ses_serial").mock(
        return_value=httpx.Response(200, json=True)
    )

    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await OpenCodeAdapter(client, runtime, bridge).complete(request, PROFILE)

    assert error.value.code == "parallel_tool_calls_not_allowed"


async def test_streaming_tool_call_uses_openai_delta_shape(tmp_path):
    bridge = OpenCodeToolBridge(tmp_path)
    runtime = FakeRuntime(tmp_path, bridge)
    response = {
        "id": "chatcmpl_tool",
        "object": "chat.completion",
        "created": 1,
        "model": "openai",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_weather",
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "arguments": '{"city":"Seoul"}',
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }

    async with httpx.AsyncClient() as client:
        adapter = OpenCodeAdapter(client, runtime, bridge)

        async def complete(_request, _profile):
            return response

        adapter.complete = complete
        chunks = [chunk async for chunk in adapter.stream(_tool_request(), PROFILE)]

    payloads = [
        json.loads(chunk.removeprefix("data: ")) for chunk in chunks if chunk.startswith("data: {")
    ]
    delta = payloads[1]["choices"][0]["delta"]["tool_calls"][0]
    assert delta["index"] == 0
    assert delta["id"] == "call_weather"
    assert payloads[2]["choices"][0]["finish_reason"] == "tool_calls"
    assert chunks[-1] == "data: [DONE]\n\n"

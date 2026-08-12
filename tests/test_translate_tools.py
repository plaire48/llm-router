import json

from llm_router.models import ChatCompletionRequest, Profile
from llm_router.translate import (
    StreamTranslator,
    from_anthropic_response,
    to_anthropic_request,
)

PROFILE = Profile(name="c", provider="anthropic", auth="oauth", model="claude-sonnet-4-5")


def test_request_tools_and_tool_choice():
    request = ChatCompletionRequest.model_validate(
        {
            "model": "c",
            "messages": [{"role": "user", "content": "weather?"}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "w",
                        "parameters": {
                            "type": "object",
                            "properties": {"city": {"type": "string"}},
                        },
                    },
                }
            ],
            "tool_choice": "required",
        }
    )
    body = to_anthropic_request(request, PROFILE)
    assert body["tools"][0]["name"] == "get_weather"
    assert body["tools"][0]["input_schema"]["type"] == "object"
    assert body["tool_choice"] == {"type": "any"}


def test_request_named_tool_choice():
    request = ChatCompletionRequest.model_validate(
        {
            "model": "c",
            "messages": [{"role": "user", "content": "weather?"}],
            "tools": [
                {
                    "type": "function",
                    "function": {"name": "get_weather", "parameters": {"type": "object"}},
                }
            ],
            "tool_choice": {"type": "function", "function": {"name": "get_weather"}},
        }
    )
    assert to_anthropic_request(request, PROFILE)["tool_choice"] == {
        "type": "tool",
        "name": "get_weather",
    }


def test_request_assistant_toolcall_and_tool_result_roundtrip():
    request = ChatCompletionRequest.model_validate(
        {
            "model": "c",
            "messages": [
                {"role": "user", "content": "weather?"},
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "arguments": '{"city":"seoul"}',
                            },
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
            ],
        }
    )
    body = to_anthropic_request(request, PROFILE)
    assistant = body["messages"][1]
    assert assistant["role"] == "assistant"
    assert assistant["content"][0]["type"] == "tool_use"
    assert assistant["content"][0]["name"] == "get_weather"
    assert assistant["content"][0]["input"] == {"city": "seoul"}
    tool_message = body["messages"][2]
    assert tool_message["role"] == "user"
    assert tool_message["content"][0]["type"] == "tool_result"
    assert tool_message["content"][0]["tool_use_id"] == "call_1"


def test_consecutive_tool_results_merge_into_one_anthropic_user_message():
    request = ChatCompletionRequest.model_validate(
        {
            "model": "c",
            "messages": [
                {"role": "user", "content": "compare"},
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "function": {"name": "first", "arguments": "{}"},
                        },
                        {
                            "id": "call_2",
                            "function": {"name": "second", "arguments": "{}"},
                        },
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "one"},
                {"role": "tool", "tool_call_id": "call_2", "content": "two"},
            ],
        }
    )
    messages = to_anthropic_request(request, PROFILE)["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant", "user"]
    assert [block["tool_use_id"] for block in messages[-1]["content"]] == [
        "call_1",
        "call_2",
    ]


def test_response_tool_use_maps_to_tool_calls():
    data = {
        "id": "msg",
        "model": "claude-sonnet-4-5",
        "stop_reason": "tool_use",
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "get_weather",
                "input": {"city": "seoul"},
            }
        ],
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }
    output = from_anthropic_response(data, PROFILE)
    tool_call = output["choices"][0]["message"]["tool_calls"][0]
    assert tool_call["id"] == "toolu_1"
    assert tool_call["function"]["name"] == "get_weather"
    assert json.loads(tool_call["function"]["arguments"]) == {"city": "seoul"}
    assert output["choices"][0]["finish_reason"] == "tool_calls"


def test_stream_tool_call_deltas():
    translator = StreamTranslator(PROFILE, completion_id="x")
    start = translator.feed(
        "content_block_start",
        {
            "index": 0,
            "content_block": {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "get_weather",
            },
        },
    )
    assert start[0]["choices"][0]["delta"]["tool_calls"][0]["id"] == "toolu_1"
    assert start[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["name"] == "get_weather"
    delta = translator.feed(
        "content_block_delta",
        {"index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"city"'}},
    )
    streamed_call = delta[0]["choices"][0]["delta"]["tool_calls"][0]
    assert streamed_call["function"]["arguments"] == '{"city"'
    assert streamed_call["index"] == 0

from llm_router.models import ChatCompletionRequest, Profile
from llm_router.translate import (
    from_anthropic_response,
    map_finish_reason,
    to_anthropic_request,
)

PROFILE = Profile(
    name="claude-sonnet",
    provider="anthropic",
    auth="oauth",
    model="claude-sonnet-4-5",
    params={"max_tokens": 4096},
)


def test_request_splits_system_and_maps_max_tokens():
    request = ChatCompletionRequest.model_validate(
        {
            "model": "claude-sonnet",
            "messages": [
                {"role": "system", "content": "be terse"},
                {"role": "user", "content": "hi"},
            ],
        }
    )
    body = to_anthropic_request(request, PROFILE)
    assert body["model"] == "claude-sonnet-4-5"
    assert body["system"] == "be terse"
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert body["max_tokens"] == 4096


def test_request_parameters_and_request_max_tokens_win():
    request = ChatCompletionRequest.model_validate(
        {
            "model": "claude-sonnet",
            "max_tokens": 55,
            "temperature": 0.2,
            "top_p": 0.8,
            "stop": "END",
            "stream": True,
            "messages": [{"role": "user", "content": "x"}],
        }
    )
    body = to_anthropic_request(request, PROFILE)
    assert body["max_tokens"] == 55
    assert body["temperature"] == 0.2
    assert body["top_p"] == 0.8
    assert body["stop_sequences"] == ["END"]
    assert body["stream"] is True


def test_finish_reason_mapping():
    assert map_finish_reason("end_turn") == "stop"
    assert map_finish_reason("max_tokens") == "length"
    assert map_finish_reason("tool_use") == "tool_calls"
    assert map_finish_reason("stop_sequence") == "stop"
    assert map_finish_reason(None) is None


def test_response_maps_text_and_usage():
    data = {
        "id": "msg_1",
        "model": "claude-sonnet-4-5",
        "stop_reason": "end_turn",
        "content": [{"type": "text", "text": "hello"}],
        "usage": {"input_tokens": 3, "output_tokens": 5},
    }
    output = from_anthropic_response(data, PROFILE)
    assert output["object"] == "chat.completion"
    assert output["model"] == "claude-sonnet"
    assert output["choices"][0]["message"]["content"] == "hello"
    assert output["choices"][0]["finish_reason"] == "stop"
    assert output["usage"] == {
        "prompt_tokens": 3,
        "completion_tokens": 5,
        "total_tokens": 8,
    }

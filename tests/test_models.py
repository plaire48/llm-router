import pytest
from pydantic import ValidationError

from llm_router.models import ChatCompletionRequest, Profile


def test_chat_request_parses_openai_shape():
    req = ChatCompletionRequest.model_validate(
        {
            "model": "claude-sonnet",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 100,
            "stream": True,
        }
    )
    assert req.model == "claude-sonnet"
    assert req.messages[0].role == "user"
    assert req.stream is True


def test_chat_request_parses_tool_calls():
    req = ChatCompletionRequest.model_validate(
        {
            "model": "x",
            "messages": [
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
    assert req.messages[0].tool_calls[0].function.name == "get_weather"
    assert req.messages[1].tool_call_id == "call_1"


def test_profile_requires_base_url_for_compat():
    with pytest.raises(ValidationError):
        Profile.model_validate(
            {
                "name": "x",
                "provider": "openai_compatible",
                "auth": "api_key",
                "api_key_env": "LOCAL_API_KEY",
                "model": "m",
            }
        )

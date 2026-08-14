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


def test_openai_compatible_profile_can_explicitly_disable_authentication():
    profile = Profile.model_validate(
        {
            "name": "local",
            "provider": "openai_compatible",
            "auth": "none",
            "base_url": "http://127.0.0.1:11434/v1",
            "model": "local-model",
        }
    )

    assert profile.auth == "none"
    assert profile.api_key_env is None

    with pytest.raises(ValidationError):
        Profile.model_validate(
            {
                "name": "aipro",
                "provider": "aipro",
                "auth": "none",
                "model": "company-model",
            }
        )

    with pytest.raises(ValidationError):
        Profile.model_validate(
            {
                "name": "aipro-compatible",
                "provider": "openai_compatible",
                "auth": "none",
                "base_url": "https://aipro.sdsdev.co.kr/api/v1",
                "model": "company-model",
            }
        )


def test_fabrix_profile_requires_endpoint_and_both_credentials():
    profile = Profile.model_validate(
        {
            "name": "fabrix",
            "provider": "fabrix",
            "auth": "api_key",
            "api_key_env": "FABRIX_API_TOKEN",
            "client_key_env": "FABRIX_CLIENT_KEY",
            "base_url": "https://fabrix.company.test",
            "model": "019a-model-id",
        }
    )
    assert profile.provider == "fabrix"

    with pytest.raises(ValidationError):
        Profile.model_validate(
            {
                "name": "fabrix",
                "provider": "fabrix",
                "auth": "api_key",
                "api_key_env": "FABRIX_API_TOKEN",
                "base_url": "https://fabrix.company.test",
                "model": "019a-model-id",
            }
        )


def test_aipro_profiles_support_api_key_and_browser_jwt_endpoints():
    profile = Profile.model_validate(
        {
            "name": "aipro",
            "provider": "aipro",
            "auth": "api_key",
            "api_key_env": "AIPRO_KEY",
            "model": "company-model",
        }
    )
    assert profile.base_url == "https://aipro.sdsdev.co.kr/open/api/v1"

    browser = Profile.model_validate(
        {
            "name": "aipro-browser",
            "provider": "aipro",
            "auth": "oauth",
            "model": "company-model",
        }
    )
    assert browser.base_url == "https://aipro.sdsdev.co.kr/api/v1"
    assert browser.api_key_env is None

    migrated = Profile.model_validate(
        {
            "name": "aipro-legacy",
            "provider": "aipro",
            "auth": "api_key",
            "api_key_env": "AIPRO_API_KEY",
            "base_url": "https://aipro.sdsdev.co.kr/v1/",
            "model": "company-model",
        }
    )
    assert migrated.base_url == "https://aipro.sdsdev.co.kr/open/api/v1"

    for overrides in ({"api_key_env": None}, {"model": ""}):
        with pytest.raises(ValidationError):
            Profile.model_validate(
                {
                    "name": "aipro",
                    "provider": "aipro",
                    "auth": "api_key",
                    "api_key_env": "AIPRO_KEY",
                    "model": "company-model",
                    **overrides,
                }
            )

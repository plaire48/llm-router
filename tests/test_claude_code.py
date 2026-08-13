import pytest

from llm_router.adapters import build_adapter
from llm_router.adapters.claude_code import ClaudeCodeAdapter, ClaudeOAuthAdapter
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile


def test_claude_oauth_profile_is_policy_disabled():
    profile = Profile(
        name="claude-local",
        provider="anthropic",
        auth="oauth",
        model="sonnet",
        port=18801,
    )
    with pytest.raises(RouterError) as error:
        build_adapter(profile, object())
    assert error.value.code == "anthropic_oauth_policy_disabled"


async def test_claude_oauth_adapter_uses_existing_router_browser_token_without_cli(
    tmp_path, monkeypatch
):
    store = TokenStore(tmp_path / "claude.json")
    store.save({"access_token": "a", "refresh_token": "r", "expires_at": 9999999999})
    adapter = ClaudeOAuthAdapter(object(), store=store)
    monkeypatch.setattr("llm_router.adapters.claude_code.shutil.which", lambda _: None)
    assert (await adapter._delegate()).__class__.__name__ == "AnthropicAdapter"


def test_claude_cli_command_uses_safe_non_persistent_mode():
    profile = Profile(name="c", provider="anthropic", auth="oauth", model="sonnet")
    request = ChatCompletionRequest(model="c", messages=[{"role": "user", "content": "hi"}])
    adapter = ClaudeCodeAdapter(binary_finder=lambda _: "/opt/bin/claude")
    system = adapter._system_prompt(request)

    assert system == ""
    assert adapter._prompt(request) == "User: hi\n\nAssistant:"
    assert profile.model == "sonnet"

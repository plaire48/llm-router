import json

from llm_router.adapters import build_adapter
from llm_router.adapters.claude_code import ClaudeCodeAdapter, ClaudeOAuthAdapter
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.models import ChatCompletionRequest, Profile


class FakeProcess:
    returncode = 0

    def __init__(self, payload):
        self.payload = payload
        self.input = None

    async def communicate(self, value):
        self.input = value
        return json.dumps(self.payload).encode(), b""


async def test_claude_oauth_profile_uses_hybrid_browser_login_adapter(monkeypatch):
    profile = Profile(
        name="claude-local",
        provider="anthropic",
        auth="oauth",
        model="sonnet",
        port=18801,
    )
    adapter = build_adapter(profile, object())
    assert isinstance(adapter, ClaudeOAuthAdapter)
    cli_adapter = ClaudeCodeAdapter()

    async def cli_delegate():
        return cli_adapter

    monkeypatch.setattr(adapter, "_delegate", cli_delegate)

    process = FakeProcess(
        {
            "result": "안녕하세요",
            "usage": {
                "input_tokens": 5,
                "cache_creation_input_tokens": 2,
                "cache_read_input_tokens": 3,
                "output_tokens": 4,
            },
        }
    )

    async def fake_spawn(request, selected_profile, *, stream):
        assert selected_profile is profile
        assert stream is False
        return process

    monkeypatch.setattr(cli_adapter, "_spawn", fake_spawn)
    request = ChatCompletionRequest.model_validate(
        {
            "model": "claude-local",
            "messages": [
                {"role": "system", "content": "짧게 답하세요."},
                {"role": "user", "content": "안녕"},
            ],
        }
    )
    response = await adapter.complete(request, profile)

    assert response["model"] == "claude-local"
    assert response["choices"][0]["message"]["content"] == "안녕하세요"
    assert response["usage"] == {
        "prompt_tokens": 10,
        "completion_tokens": 4,
        "total_tokens": 14,
    }
    assert process.input.decode().endswith("Assistant:")


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

from pathlib import Path

import pytest

from llm_router.config import Settings, load_profiles
from llm_router.errors import RouterError

YAML = """
profiles:
  - name: claude-sonnet
    provider: anthropic
    auth: oauth
    model: claude-sonnet-4-5
    aliases: [sonnet]
  - name: gpt-4o
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: gpt-4o
"""


def _write(tmp_path, text):
    path = tmp_path / "profiles.yaml"
    path.write_text(text)
    return path


def test_settings_defaults_to_keyless_localhost_and_normalizes_master_key():
    settings = Settings(_env_file=None)
    assert settings.host == "127.0.0.1"
    assert settings.port == 8787
    assert settings.opencode_url == "http://127.0.0.1:0"
    assert settings.opencode_startup_timeout == 120.0
    assert settings.master_key is None
    assert Settings(master_key="  ", _env_file=None).master_key is None
    assert Settings(master_key=" secret ", _env_file=None).master_key == "secret"


def test_opencode_startup_timeout_is_configurable_and_bounded():
    assert Settings(opencode_startup_timeout=240, _env_file=None).opencode_startup_timeout == 240
    with pytest.raises(ValueError):
        Settings(opencode_startup_timeout=0, _env_file=None)
    with pytest.raises(ValueError):
        Settings(opencode_startup_timeout=601, _env_file=None)


def test_settings_expands_home_in_usage_database_path():
    settings = Settings(
        master_key="secret",
        usage_db="~/.llm-router/custom-usage.db",
        _env_file=None,
    )
    assert settings.usage_db == Path.home() / ".llm-router" / "custom-usage.db"


def test_resolve_by_name_and_alias(tmp_path):
    registry = load_profiles(_write(tmp_path, YAML))
    assert registry.resolve("claude-sonnet").model == "claude-sonnet-4-5"
    assert registry.resolve("sonnet").name == "claude-sonnet"
    assert registry.names() == ["claude-sonnet", "gpt-4o"]


def test_resolve_unknown_raises_404(tmp_path):
    registry = load_profiles(_write(tmp_path, YAML))
    with pytest.raises(RouterError) as error:
        registry.resolve("does-not-exist")
    assert error.value.status_code == 404
    assert error.value.code == "model_not_found"
    assert "does-not-exist" in error.value.message


def test_duplicate_name_or_alias_rejected(tmp_path):
    duplicate = (
        YAML
        + """
  - name: sonnet
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: x
"""
    )
    with pytest.raises(RouterError, match="duplicate profile name/alias: sonnet"):
        load_profiles(_write(tmp_path, duplicate))


def test_invalid_yaml_is_reported_as_router_error(tmp_path):
    with pytest.raises(RouterError, match="invalid profiles.yaml"):
        load_profiles(_write(tmp_path, "profiles: ["))

import subprocess
import sys

from typer.testing import CliRunner

from llm_router.cli import app

runner = CliRunner()

YAML = """
profiles:
  - name: gpt-4o
    provider: openai
    auth: api_key
    api_key_env: OPENAI_API_KEY
    model: gpt-4o
"""


def _profiles_file(tmp_path):
    path = tmp_path / "profiles.yaml"
    path.write_text(YAML)
    return path


def test_profiles_list(tmp_path):
    result = runner.invoke(
        app,
        ["profiles", "list", "--profiles", str(_profiles_file(tmp_path))],
    )
    assert result.exit_code == 0
    assert "gpt-4o" in result.stdout
    assert "openai" in result.stdout
    assert "api_key" in result.stdout


def test_package_module_exposes_cli_entrypoint():
    result = subprocess.run(
        [sys.executable, "-m", "llm_router", "--help"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "local OpenAI-compatible LLM gateway" in result.stdout


def test_serve_without_master_key_starts_on_localhost(tmp_path, monkeypatch):
    monkeypatch.delenv("LLM_ROUTER_MASTER_KEY", raising=False)
    monkeypatch.setenv("LLM_ROUTER_USAGE_DB", str(tmp_path / "usage.db"))
    called = {}

    def fake_run(application, *, host, port):
        called.update(application=application, host=host, port=port)

    monkeypatch.setattr("uvicorn.run", fake_run)
    result = runner.invoke(
        app,
        ["serve", "--profiles", str(_profiles_file(tmp_path))],
    )
    assert result.exit_code == 0
    assert called["host"] == "127.0.0.1"
    assert called["port"] == 8787


def test_serve_without_master_key_rejects_external_bind(tmp_path, monkeypatch):
    monkeypatch.delenv("LLM_ROUTER_MASTER_KEY", raising=False)
    monkeypatch.setenv("LLM_ROUTER_USAGE_DB", str(tmp_path / "usage.db"))
    result = runner.invoke(
        app,
        [
            "serve",
            "--profiles",
            str(_profiles_file(tmp_path)),
            "--host",
            "0.0.0.0",
        ],
    )
    assert result.exit_code != 0
    assert "LLM_ROUTER_MASTER_KEY" in result.stdout


def test_serve_uses_settings_and_overrides(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_ROUTER_MASTER_KEY", "secret")
    monkeypatch.setenv("LLM_ROUTER_USAGE_DB", str(tmp_path / "usage.db"))
    called = {}

    def fake_run(application, *, host, port):
        called.update(application=application, host=host, port=port)

    monkeypatch.setattr("uvicorn.run", fake_run)
    result = runner.invoke(
        app,
        [
            "serve",
            "--profiles",
            str(_profiles_file(tmp_path)),
            "--host",
            "0.0.0.0",
            "--port",
            "9999",
        ],
    )
    assert result.exit_code == 0
    assert called["host"] == "0.0.0.0"
    assert called["port"] == 9999
    assert called["application"].title == "FastAPI"


def test_oauth_login_openai_uses_managed_browser_flow(monkeypatch):
    called = {}

    async def fake_login():
        called["login"] = True

    monkeypatch.setattr("llm_router.cli.login_openai", fake_login)
    result = runner.invoke(app, ["oauth", "login", "openai"])
    assert result.exit_code == 0
    assert called == {"login": True}


def test_oauth_login_anthropic_is_policy_disabled():
    result = runner.invoke(app, ["oauth", "login", "anthropic"])
    assert result.exit_code == 1
    assert "disabled for policy compliance" in result.stdout


def test_oauth_login_aipro_is_not_supported():
    result = runner.invoke(app, ["oauth", "login", "aipro"])

    assert result.exit_code == 1
    assert "unsupported provider: aipro" in result.stdout

from __future__ import annotations

import json
import os
import shutil
import subprocess

import typer

from llm_router.config import Settings, load_profiles
from llm_router.errors import RouterError

app = typer.Typer(help="llm-router: local OpenAI-compatible LLM gateway")
oauth_app = typer.Typer(help="OAuth login")
profiles_app = typer.Typer(help="Profile inspection")
app.add_typer(oauth_app, name="oauth")
app.add_typer(profiles_app, name="profiles")


@app.command()
def serve(
    profiles: str = typer.Option("profiles.yaml", help="Path to profiles.yaml"),
    host: str | None = typer.Option(None, help="Bind host (default: 127.0.0.1)"),
    port: int | None = typer.Option(None, help="Bind port (default: 8787)"),
) -> None:
    try:
        settings = Settings()
        registry = load_profiles(profiles)
    except Exception as exc:
        typer.echo(f"config error (is LLM_ROUTER_MASTER_KEY set?): {exc}")
        raise typer.Exit(code=1) from exc

    import uvicorn

    from llm_router.server import create_app
    from llm_router.usage import UsageStore

    settings.host = settings.host if host is None else host
    settings.port = settings.port if port is None else port
    store = UsageStore(settings.usage_db)
    application = create_app(settings, registry, store=store, profiles_path=profiles)
    try:
        uvicorn.run(
            application,
            host=settings.host,
            port=settings.port,
        )
    finally:
        store.close()


@oauth_app.command("login")
def oauth_login(provider: str) -> None:
    commands = {
        "openai": ("codex", ["login"]),
        "anthropic": ("claude", ["auth", "login", "--claudeai"]),
    }
    if provider not in commands:
        typer.echo(f"unsupported provider: {provider}")
        raise typer.Exit(code=1)
    executable, arguments = commands[provider]
    binary = shutil.which(executable)
    if binary is None:
        typer.echo(f"{executable} CLI is required for {provider} browser login.")
        raise typer.Exit(code=1)
    try:
        subprocess.run([binary, *arguments], check=True)
    except subprocess.CalledProcessError as exc:
        typer.echo(f"{provider} browser login failed.")
        raise typer.Exit(code=1) from exc


def _credential_status(provider: str, auth: str, api_key_env: str | None) -> str:
    if auth == "api_key":
        from llm_router.credentials.env_key import load_provider_env

        load_provider_env()
        return "set" if api_key_env and os.environ.get(api_key_env) else "missing"
    if provider == "openai":
        from llm_router.credentials.openai_oauth import CodexTokenStore

        try:
            tokens = CodexTokenStore.default().tokens()
            return (
                "logged_in" if tokens and CodexTokenStore.account_id(tokens) else "login_required"
            )
        except RouterError:
            return "invalid_store"

    try:
        binary = shutil.which("claude")
        if binary is None:
            return "cli_missing"
        result = subprocess.run(
            [binary, "auth", "status", "--json"],
            check=False,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout) if result.returncode == 0 else {}
        return "logged_in" if payload.get("loggedIn") is True else "login_required"
    except (OSError, json.JSONDecodeError):
        return "invalid_store"


@profiles_app.command("list")
def profiles_list(
    profiles: str = typer.Option("profiles.yaml", help="Path to profiles.yaml"),
) -> None:
    try:
        registry = load_profiles(profiles)
    except RouterError as exc:
        typer.echo(f"config error: {exc.message}")
        raise typer.Exit(code=1) from exc

    typer.echo("NAME\tPROVIDER\tAUTH\tCREDENTIAL")
    for name in registry.names():
        profile = registry.resolve(name)
        status = _credential_status(profile.provider, profile.auth, profile.api_key_env)
        typer.echo(f"{profile.name}\t{profile.provider}\t{profile.auth}\t{status}")
